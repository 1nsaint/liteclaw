# Ollama streaming: official OpenClaw vs LiteClaw

## How official OpenClaw does it

In [openclaw/openclaw](https://github.com/openclaw/openclaw) (`src/agents/ollama-stream.ts`):

- **No incremental streaming.** The NDJSON stream is read in a single loop; nothing is pushed until the end.
- **No `message.thinking`.** The response type only has `reasoning?` (Qwen 3). There is no separate “thinking” stream.
- **Single text block.** Content is accumulated as:
  - `accumulatedContent += chunk.message.content` **or**, when content is empty, `chunk.message.reasoning` (fallback).
- On `chunk.done` it sets `finalResponse.message.content = accumulatedContent`, builds one assistant message with `content: [{ type: "text", text }]`, and pushes **one** `{ type: "done", message }`.
- **Gateway** (`server-chat.ts`): no thinking buffer; only `evt.stream === "assistant"` with `evt.data.text`. Payload is always `content: [{ type: "text", text: cleaned }]`.

So in upstream there is **no separate “thinking”** and **no token-by-token streaming** from Ollama. The assistant message is one blob (content or reasoning), so “thinking leaking into reply” cannot happen.

## What LiteClaw added

- **Incremental streaming:** `thinking_start`, `thinking_delta`, `thinking_end`, `text_start`, `text_delta`, `text_end` so the UI can show thinking and reply as they arrive.
- **`message.thinking`** (Ollama thinking models) and `message.reasoning` as separate streams.
- **Separate buffers** in the gateway: thinking vs reply text, and payloads with `content: [{ type: "thinking", thinking }, { type: "text", text }]`.

The leak happened because:

1. Some models send reasoning in **both** `message.thinking`/`message.reasoning` **and** `message.content`.
2. We were streaming `message.content` as the “reply” without stripping that leading reasoning, so the reply buffer (and final message) contained thinking + reply.

## Fix in LiteClaw

- **Reply-only content:** `replyContent = stripReasoningFromContent(accumulatedContent, accumulatedReasoning)` so the reply buffer and final text never include reasoning.
- **Stream only reply in text:** `text_start` / `text_delta` / `text_end` use `replyContent` (and deltas from it), not raw `accumulatedContent`.
- **Final message:** built with separate `thinking` and `text` blocks; `finalContent` is from `replyContent` (with existing dedupe).

## Optional: upstream-style mode

If you want the **exact official OpenClaw behavior** (no streaming, no thinking UI, single text block, so no possibility of leak), set:

```bash
export OPENCLAW_OLLAMA_UPSTREAM_STYLE=1
```

(or `OPENCLAW_OLLAMA_UPSTREAM_STYLE=true`). Then the Ollama stream:

- Buffers the full response (no `thinking_start` / `text_delta` pushes).
- Merges `content`, `reasoning`, and `thinking` into one string (like upstream).
- Builds one message with `content: [{ type: "text", text }]` and pushes a single `done`.

The gateway then only ever sees one assistant payload with one text block. No thinking buffer, no leak. Trade-off: no live thinking in the UI and no separate collapsible thinking block.
