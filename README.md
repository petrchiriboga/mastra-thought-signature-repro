# Mastra working memory drops Gemini thought signatures

`Memory.saveMessages` removes `updateWorkingMemory` tool calls before persisting. Gemini signs only the first function call of a parallel step. When that first call is `updateWorkingMemory`, its `providerMetadata.google.thoughtSignature` is removed with it. The remaining calls of the step are stored unsigned. Replaying that history in the same turn, for example when continuing after a client tool result, is rejected by Gemini.

Versions: `@mastra/core` 1.78.0, `@mastra/memory` 1.38.0, `@mastra/libsql` 1.26.2, `ai` 5.0.195, `@ai-sdk/google-vertex` 3.0.137. Model: Vertex `gemini-3.6-flash`.

## Run

Requires Google Cloud application default credentials with Vertex AI access.

```bash
npm install && GOOGLE_VERTEX_PROJECT=<project> npm run repro
```

## Expected

Both replays are accepted: the history read back from memory keeps a thought signature on the first function call of the step.

## Actual

```
Before Memory.saveMessages: tool calls = [updateWorkingMemory (signed), suggestReplies (unsigned)]
  accepted

After Memory.saveMessages + recall: tool calls = [suggestReplies (unsigned)]
  rejected: Function call is missing a thought_signature in functionCall parts. ...
```
