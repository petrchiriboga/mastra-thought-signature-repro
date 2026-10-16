import { createVertex } from "@ai-sdk/google-vertex";
import { MessageList, type MastraDBMessage } from "@mastra/core/agent";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { generateText, jsonSchema, tool, type ModelMessage } from "ai";

const vertex = createVertex({
  project: process.env.GOOGLE_VERTEX_PROJECT,
  location: process.env.GOOGLE_VERTEX_LOCATION ?? "global",
});
const model = vertex(process.env.MODEL ?? "gemini-3.6-flash");

const tools = {
  updateWorkingMemory: tool({
    description: "Store facts about the user.",
    inputSchema: jsonSchema({ type: "object", properties: { memory: { type: "string" } }, required: ["memory"] }),
  }),
  suggestReplies: tool({
    description: "Show reply buttons to the user.",
    inputSchema: jsonSchema({
      type: "object",
      properties: { replies: { type: "array", items: { type: "string" } } },
      required: ["replies"],
    }),
  }),
};
const system =
  "In your first response call updateWorkingMemory and suggestReplies together, in parallel, in that order, with no text. After the tool results, answer in one sentence.";
const userText = "My name is Sam and I like hiking. What should I do this weekend?";

const signedCalls = (messages: ModelMessage[]) =>
  messages.flatMap((m) =>
    m.role === "assistant" && typeof m.content !== "string"
      ? m.content
          .filter((p) => p.type === "tool-call")
          .map((p) => `${p.toolName}${p.providerOptions?.google?.thoughtSignature ? " (signed)" : " (unsigned)"}`)
      : [],
  );

async function send(label: string, messages: ModelMessage[]) {
  console.log(`\n${label}: tool calls = [${signedCalls(messages).join(", ")}]`);
  try {
    await generateText({ model, system, messages, tools });
    console.log("  accepted");
  } catch (e) {
    console.log(`  rejected: ${String((e as Error).message).slice(0, 160)}`);
  }
}

async function main() {
  let first;
  for (let i = 0; i < 5; i++) {
    first = await generateText({ model, system, prompt: userText, tools });
    if (first.toolCalls[0]?.toolName === "updateWorkingMemory" && first.toolCalls.length > 1) break;
  }
  if (!first || first.toolCalls[0]?.toolName !== "updateWorkingMemory" || first.toolCalls.length < 2) {
    throw new Error("Model did not return parallel [updateWorkingMemory, suggestReplies] calls; rerun.");
  }

  const threadId = "thread-1";
  const resourceId = "user-1";
  const now = Date.now();
  const user: MastraDBMessage = {
    id: "m1", role: "user", threadId, resourceId, createdAt: new Date(now),
    content: { format: 2, parts: [{ type: "text", text: userText }] },
  };
  const assistant: MastraDBMessage = {
    id: "m2", role: "assistant", threadId, resourceId, createdAt: new Date(now + 1),
    content: {
      format: 2,
      parts: [
        { type: "step-start" },
        ...first.toolCalls.map((c) => ({
          type: "tool-invocation" as const,
          toolInvocation: {
            state: "result" as const,
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            args: c.input,
            result: { ok: true },
          },
          ...(c.providerMetadata && { providerMetadata: c.providerMetadata }),
        })),
      ],
    },
  };

  const memory = new Memory({
    storage: new LibSQLStore({ id: "repro", url: ":memory:" }),
    options: { lastMessages: 20, workingMemory: { enabled: true } },
  });
  await memory.createThread({ threadId, resourceId });
  await memory.saveMessages({ messages: [user, assistant] });
  const { messages: recalled } = await memory.recall({ threadId, resourceId });

  await send("Before Memory.saveMessages", new MessageList({ threadId, resourceId }).add([user, assistant], "memory").get.all.aiV5.model());
  await send("After Memory.saveMessages + recall", new MessageList({ threadId, resourceId }).add(recalled, "memory").get.all.aiV5.model());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
