import { randomUUID } from "node:crypto";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  StopReason,
  TextContent,
  ToolCall,
  Tool,
  Usage,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("ollama-stream");

export const OLLAMA_NATIVE_BASE_URL = "http://127.0.0.1:11434";

// ── Ollama /api/chat request types ──────────────────────────────────────────

interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: boolean;
  tools?: OllamaTool[];
  options?: Record<string, unknown>;
}

interface OllamaChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

const MAX_SAFE_INTEGER_ABS_STR = String(Number.MAX_SAFE_INTEGER);

function isAsciiDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function parseJsonNumberToken(
  input: string,
  start: number,
): { token: string; end: number; isInteger: boolean } | null {
  let idx = start;
  if (input[idx] === "-") {
    idx += 1;
  }
  if (idx >= input.length) {
    return null;
  }

  if (input[idx] === "0") {
    idx += 1;
  } else if (isAsciiDigit(input[idx]) && input[idx] !== "0") {
    while (isAsciiDigit(input[idx])) {
      idx += 1;
    }
  } else {
    return null;
  }

  let isInteger = true;
  if (input[idx] === ".") {
    isInteger = false;
    idx += 1;
    if (!isAsciiDigit(input[idx])) {
      return null;
    }
    while (isAsciiDigit(input[idx])) {
      idx += 1;
    }
  }

  if (input[idx] === "e" || input[idx] === "E") {
    isInteger = false;
    idx += 1;
    if (input[idx] === "+" || input[idx] === "-") {
      idx += 1;
    }
    if (!isAsciiDigit(input[idx])) {
      return null;
    }
    while (isAsciiDigit(input[idx])) {
      idx += 1;
    }
  }

  return {
    token: input.slice(start, idx),
    end: idx,
    isInteger,
  };
}

function isUnsafeIntegerLiteral(token: string): boolean {
  const digits = token[0] === "-" ? token.slice(1) : token;
  if (digits.length < MAX_SAFE_INTEGER_ABS_STR.length) {
    return false;
  }
  if (digits.length > MAX_SAFE_INTEGER_ABS_STR.length) {
    return true;
  }
  return digits > MAX_SAFE_INTEGER_ABS_STR;
}

function quoteUnsafeIntegerLiterals(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  let idx = 0;

  while (idx < input.length) {
    const ch = input[idx] ?? "";
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      idx += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      idx += 1;
      continue;
    }

    if (ch === "-" || isAsciiDigit(ch)) {
      const parsed = parseJsonNumberToken(input, idx);
      if (parsed) {
        if (parsed.isInteger && isUnsafeIntegerLiteral(parsed.token)) {
          out += `"${parsed.token}"`;
        } else {
          out += parsed.token;
        }
        idx = parsed.end;
        continue;
      }
    }

    out += ch;
    idx += 1;
  }

  return out;
}

function parseJsonPreservingUnsafeIntegers(input: string): unknown {
  return JSON.parse(quoteUnsafeIntegerLiterals(input)) as unknown;
}

// ── Ollama /api/chat response types ─────────────────────────────────────────

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: "assistant";
    content?: string | null;
    /** Qwen 3 and some backends use this for reasoning. */
    reasoning?: string;
    /** Official Ollama thinking models use this (see docs). */
    thinking?: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

// ── Message conversion ──────────────────────────────────────────────────────

type InputContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return (content as InputContentPart[])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function extractOllamaImages(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return (content as InputContentPart[])
    .filter((part): part is { type: "image"; data: string } => part.type === "image")
    .map((part) => part.data);
}

function extractToolCalls(content: unknown): OllamaToolCall[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const parts = content as InputContentPart[];
  const result: OllamaToolCall[] = [];
  for (const part of parts) {
    if (part.type === "toolCall") {
      result.push({ function: { name: part.name, arguments: part.arguments } });
    } else if (part.type === "tool_use") {
      result.push({ function: { name: part.name, arguments: part.input } });
    }
  }
  return result;
}

export function convertToOllamaMessages(
  messages: Array<{ role: string; content: unknown }>,
  system?: string,
): OllamaChatMessage[] {
  const result: OllamaChatMessage[] = [];

  if (system) {
    result.push({ role: "system", content: system });
  }

  for (const msg of messages) {
    const { role } = msg;

    if (role === "user") {
      const text = extractTextContent(msg.content);
      const images = extractOllamaImages(msg.content);
      result.push({
        role: "user",
        content: text,
        ...(images.length > 0 ? { images } : {}),
      });
    } else if (role === "assistant") {
      const text = extractTextContent(msg.content);
      const toolCalls = extractToolCalls(msg.content);
      result.push({
        role: "assistant",
        content: text,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else if (role === "tool" || role === "toolResult") {
      // SDK uses "toolResult" (camelCase) for tool result messages.
      // Ollama API expects "tool" role with tool_name per the native spec.
      const text = extractTextContent(msg.content);
      const toolName =
        typeof (msg as { toolName?: unknown }).toolName === "string"
          ? (msg as { toolName?: string }).toolName
          : undefined;
      result.push({
        role: "tool",
        content: text,
        ...(toolName ? { tool_name: toolName } : {}),
      });
    }
  }

  return result;
}

// ── Tool extraction ─────────────────────────────────────────────────────────

const OLLAMA_TOOL_DESC_MAX_CHARS_SMALL_CTX = 80;
const OLLAMA_SMALL_CONTEXT_WINDOW_THRESHOLD = 65_536;

function shortenToolDescription(description: string, maxChars: number): string {
  const trimmed = description.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  const firstSentenceEnd = trimmed.search(/[.!?]\s/);
  if (firstSentenceEnd !== -1 && firstSentenceEnd + 1 <= maxChars) {
    return trimmed.slice(0, firstSentenceEnd + 1).trim();
  }
  return trimmed.slice(0, Math.max(0, maxChars - 3)).trim() + "...";
}

function extractOllamaTools(tools: Tool[] | undefined, contextWindowTokens?: number): OllamaTool[] {
  if (!tools || !Array.isArray(tools)) {
    return [];
  }
  const shortenDescriptions =
    typeof contextWindowTokens === "number" &&
    contextWindowTokens <= OLLAMA_SMALL_CONTEXT_WINDOW_THRESHOLD;
  const result: OllamaTool[] = [];
  for (const tool of tools) {
    if (typeof tool.name !== "string" || !tool.name) {
      continue;
    }
    let description = typeof tool.description === "string" ? tool.description : "";
    if (shortenDescriptions && description) {
      description = shortenToolDescription(description, OLLAMA_TOOL_DESC_MAX_CHARS_SMALL_CTX);
    }
    result.push({
      type: "function",
      function: {
        name: tool.name,
        description,
        parameters: (tool.parameters ?? {}) as Record<string, unknown>,
      },
    });
  }
  return result;
}

// ── Response conversion ─────────────────────────────────────────────────────

export function buildAssistantMessage(
  response: OllamaChatResponse,
  modelInfo: { api: string; provider: string; id: string },
): AssistantMessage {
  const content: (TextContent | ToolCall)[] = [];

  // Qwen 3 (and potentially other reasoning models) may return their final
  // answer in `reasoning` or `thinking` with an empty `content`. Fall back so
  // the response isn't silently dropped.
  const text =
    (response.message.content ?? "") ||
    (response.message.reasoning ?? "") ||
    (response.message.thinking ?? "") ||
    "";
  if (text) {
    content.push({ type: "text", text });
  }

  const toolCalls = response.message.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      content.push({
        type: "toolCall",
        id: `ollama_call_${randomUUID()}`,
        name: tc.function.name,
        arguments: tc.function.arguments,
      });
    }
  }

  const hasToolCalls = toolCalls && toolCalls.length > 0;
  const stopReason: StopReason = hasToolCalls ? "toolUse" : "stop";

  const usage: Usage = {
    input: response.prompt_eval_count ?? 0,
    output: response.eval_count ?? 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: (response.prompt_eval_count ?? 0) + (response.eval_count ?? 0),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };

  return {
    role: "assistant",
    content,
    stopReason,
    api: modelInfo.api,
    provider: modelInfo.provider,
    model: modelInfo.id,
    usage,
    timestamp: Date.now(),
  };
}

// ── NDJSON streaming parser ─────────────────────────────────────────────────

export async function* parseNdjsonStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<OllamaChatResponse> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        yield parseJsonPreservingUnsafeIntegers(trimmed) as OllamaChatResponse;
      } catch {
        log.warn(`Skipping malformed NDJSON line: ${trimmed.slice(0, 120)}`);
      }
    }
  }

  if (buffer.trim()) {
    try {
      yield parseJsonPreservingUnsafeIntegers(buffer.trim()) as OllamaChatResponse;
    } catch {
      log.warn(`Skipping malformed trailing data: ${buffer.trim().slice(0, 120)}`);
    }
  }
}

// ── Main StreamFn factory ───────────────────────────────────────────────────

function resolveOllamaChatUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  const normalizedBase = trimmed.replace(/\/v1$/i, "");
  const apiBase = normalizedBase || OLLAMA_NATIVE_BASE_URL;
  return `${apiBase}/api/chat`;
}

export function createOllamaStreamFn(baseUrl: string): StreamFn {
  const chatUrl = resolveOllamaChatUrl(baseUrl);
  log.info(`Ollama stream: baseUrl=${baseUrl} chatUrl=${chatUrl}`);

  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();

    const run = async () => {
      try {
        const ollamaMessages = convertToOllamaMessages(
          context.messages ?? [],
          context.systemPrompt,
        );

        const ollamaTools = extractOllamaTools(context.tools, model.contextWindow ?? undefined);

        // Ollama defaults to num_ctx=4096 which is too small for large
        // system prompts + many tool definitions. Use model's contextWindow,
        // but keep the fallback conservative for smaller-memory hosts.
        const ollamaOptions: Record<string, unknown> = {
          num_ctx: model.contextWindow ?? 32_768,
          // Limit GPU layers so the rest run on CPU; avoids 100% GPU locking up the system (CPU stuck at 500MHz).
          // 6 layers ≈ 70% CPU / 30% GPU for a 20-layer model. Env OLLAMA_NUM_GPU often not applied to runner.
          num_gpu: 6,
        };
        if (typeof options?.temperature === "number") {
          ollamaOptions.temperature = options.temperature;
        }
        if (typeof options?.maxTokens === "number") {
          ollamaOptions.num_predict = options.maxTokens;
        }

        const body: OllamaChatRequest = {
          model: model.id,
          messages: ollamaMessages,
          stream: true,
          ...(ollamaTools.length > 0 ? { tools: ollamaTools } : {}),
          options: ollamaOptions,
        };
        // GPT-OSS: first token can take minutes; "low" thinking gets response sooner (top-level think)
        if (model.id.toLowerCase().includes("gpt-oss")) {
          (body as unknown as Record<string, unknown>).think = "low";
        }
        const bodyJson = JSON.stringify(body);
        const bodyBytes = Buffer.byteLength(bodyJson, "utf8");
        const firstMsg = ollamaMessages[0];
        const lastMsg = ollamaMessages[ollamaMessages.length - 1];
        const bodyRec = body as unknown as Record<string, unknown>;
        const thinkRaw = bodyRec["think"];
        const thinkLog =
          thinkRaw === undefined || thinkRaw === null
            ? "none"
            : typeof thinkRaw === "string" ||
                typeof thinkRaw === "number" ||
                typeof thinkRaw === "boolean"
              ? String(thinkRaw)
              : JSON.stringify(thinkRaw);
        log.info(
          `Ollama request: model=${model.id} messages=${ollamaMessages.length} bodyBytes=${bodyBytes} num_ctx=${JSON.stringify(ollamaOptions.num_ctx)} num_gpu=${JSON.stringify(ollamaOptions.num_gpu)} think=${thinkLog} tools=${ollamaTools.length} ` +
            `firstMsg.role=${firstMsg?.role ?? "?"} lastMsg.role=${lastMsg?.role ?? "?"}`,
        );

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...options?.headers,
        };
        if (options?.apiKey) {
          headers.Authorization = `Bearer ${options.apiKey}`;
        }

        // Fail fast if Ollama doesn't respond (e.g. unreachable or overloaded)
        const fetchTimeoutMs = 300_000;
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () =>
            controller.abort(new Error(`Ollama did not respond within ${fetchTimeoutMs / 1000}s`)),
          fetchTimeoutMs,
        );
        if (options?.signal) {
          if (options.signal.aborted) {
            clearTimeout(timeoutId);
            controller.abort(options.signal.reason);
          } else {
            options.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timeoutId);
                controller.abort(options.signal!.reason);
              },
              { once: true },
            );
          }
        }
        const fetchSignal = controller.signal;

        let response: Response;
        try {
          response = await fetch(chatUrl, {
            method: "POST",
            headers,
            body: bodyJson,
            signal: fetchSignal,
          });
        } finally {
          clearTimeout(timeoutId);
        }

        log.info(`Ollama response: status=${response!.status} model=${model.id}`);

        if (!response.ok) {
          const errorText = await response.text().catch(() => "unknown error");
          // Log full error body so we can see exactly what Ollama returned (e.g. 500 message).
          log.warn(
            `Ollama API error: url=${chatUrl} status=${response.status} bodyLen=${errorText.length} body=${errorText.slice(0, 1500)}`,
          );
          throw new Error(`Ollama API error ${response.status}: ${errorText}`);
        }

        if (!response.body) {
          throw new Error("Ollama API returned empty response body");
        }

        const reader = response.body.getReader();

        // Upstream-style: buffer full response, single "done" with one text block (no streaming, no thinking UI).
        // Matches official openclaw/openclaw — no thinking leak possible. Set OPENCLAW_OLLAMA_UPSTREAM_STYLE=1 to use.
        const upstreamStyle =
          process.env.OPENCLAW_OLLAMA_UPSTREAM_STYLE === "1" ||
          process.env.OPENCLAW_OLLAMA_UPSTREAM_STYLE === "true";
        if (upstreamStyle) {
          let accumulatedContent = "";
          const accumulatedToolCalls: OllamaToolCall[] = [];
          let finalResponse: OllamaChatResponse | undefined;
          for await (const chunk of parseNdjsonStream(reader)) {
            if (chunk.message?.content) {
              accumulatedContent += chunk.message.content;
            } else if (chunk.message?.reasoning) {
              accumulatedContent += chunk.message.reasoning;
            } else if (typeof (chunk.message as { thinking?: string })?.thinking === "string") {
              accumulatedContent += (chunk.message as { thinking: string }).thinking;
            }
            if (chunk.message?.tool_calls) {
              accumulatedToolCalls.push(...chunk.message.tool_calls);
            }
            if (chunk.done) {
              finalResponse = chunk;
              break;
            }
          }
          if (!finalResponse) {
            throw new Error("Ollama API stream ended without a final response");
          }
          finalResponse.message.content = accumulatedContent;
          if (accumulatedToolCalls.length > 0) {
            finalResponse.message.tool_calls = accumulatedToolCalls;
          }
          const assistantMessage = buildAssistantMessage(finalResponse, {
            api: model.api,
            provider: model.provider,
            id: model.id,
          });
          const reason: Extract<StopReason, "stop" | "length" | "toolUse"> =
            assistantMessage.stopReason === "toolUse" ? "toolUse" : "stop";
          stream.push({ type: "done", reason, message: assistantMessage });
          return;
        }

        let accumulatedContent = "";
        let accumulatedReasoning = "";
        /** Reply-only: content with any leading reasoning stripped so it never leaks into the reply. */
        const stripReasoningFromContent = (content: string, reasoning: string): string => {
          const r = reasoning.trimEnd();
          if (!r || !content) {
            return content;
          }
          if (content.startsWith(r)) {
            return content.slice(r.length).trimStart();
          }
          return content;
        };
        let replyContent = "";
        const accumulatedToolCalls: OllamaToolCall[] = [];
        let finalResponse: OllamaChatResponse | undefined;

        const modelInfo = { api: model.api, provider: model.provider, id: model.id };
        const usage = {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        };
        const output: AssistantMessage = {
          role: "assistant",
          content: [],
          stopReason: "stop",
          api: modelInfo.api,
          provider: modelInfo.provider,
          model: modelInfo.id,
          usage: { ...usage },
          timestamp: Date.now(),
        };
        stream.push({ type: "start", partial: output });

        let hasPushedThinkingStart = false;
        let hasPushedThinkingEnd = false;
        let hasPushedTextStart = false;
        let prevReplyLength = 0;
        let firstChunkLogged = false;

        for await (const chunk of parseNdjsonStream(reader)) {
          if (!firstChunkLogged) {
            firstChunkLogged = true;
            const chunkPreview =
              typeof chunk === "object" && chunk !== null
                ? JSON.stringify(chunk).slice(0, 200)
                : String(chunk).slice(0, 200);
            log.info(`Ollama first chunk: model=${model.id} preview=${chunkPreview}`);
          }
          try {
            const msg = chunk.message;
            const reasoningDelta =
              (typeof msg?.reasoning === "string" ? msg.reasoning : "") +
              (typeof msg?.thinking === "string" ? msg.thinking : "");
            const contentDelta =
              typeof msg?.content === "string" ? msg.content : msg?.content === null ? "" : "";

            if (reasoningDelta) {
              accumulatedReasoning += reasoningDelta;
              if (!hasPushedThinkingStart) {
                hasPushedThinkingStart = true;
                output.content = [{ type: "thinking", thinking: accumulatedReasoning }];
                stream.push({ type: "thinking_start", contentIndex: 0, partial: output });
              } else {
                (output.content[0] as { type: "thinking"; thinking: string }).thinking =
                  accumulatedReasoning;
                stream.push({
                  type: "thinking_delta",
                  contentIndex: 0,
                  delta: reasoningDelta,
                  partial: output,
                });
              }
            }

            if (contentDelta) {
              if (hasPushedThinkingStart && !hasPushedThinkingEnd) {
                hasPushedThinkingEnd = true;
                (output.content[0] as { type: "thinking"; thinking: string }).thinking =
                  accumulatedReasoning;
                stream.push({
                  type: "thinking_end",
                  contentIndex: 0,
                  content: accumulatedReasoning,
                  partial: output,
                });
              }
              accumulatedContent += contentDelta;
              replyContent = stripReasoningFromContent(accumulatedContent, accumulatedReasoning);
              const textBlockIndex = hasPushedThinkingStart ? 1 : 0;
              const replyDelta = replyContent.slice(prevReplyLength);
              if (!hasPushedTextStart) {
                hasPushedTextStart = true;
                prevReplyLength = replyContent.length;
                if (textBlockIndex === 0) {
                  output.content = [{ type: "text", text: replyContent }];
                } else {
                  output.content[1] = { type: "text", text: replyContent };
                }
                stream.push({
                  type: "text_start",
                  contentIndex: textBlockIndex,
                  partial: output,
                });
              } else {
                (output.content[textBlockIndex] as { type: "text"; text: string }).text =
                  replyContent;
                prevReplyLength = replyContent.length;
                stream.push({
                  type: "text_delta",
                  contentIndex: textBlockIndex,
                  delta: replyDelta,
                  partial: output,
                });
              }
            }

            if (msg?.tool_calls?.length) {
              accumulatedToolCalls.push(...msg.tool_calls);
            }
          } catch (chunkErr) {
            log.warn(
              `Ollama stream chunk error (continuing): ${chunkErr instanceof Error ? chunkErr.message : String(chunkErr)}`,
            );
          }

          if (chunk.done) {
            finalResponse = chunk;
            break;
          }
        }

        if (!finalResponse) {
          throw new Error("Ollama API stream ended without a final response");
        }

        if (hasPushedThinkingStart && !hasPushedThinkingEnd) {
          hasPushedThinkingEnd = true;
          (output.content[0] as { type: "thinking"; thinking: string }).thinking =
            accumulatedReasoning;
          stream.push({
            type: "thinking_end",
            contentIndex: 0,
            content: accumulatedReasoning,
            partial: output,
          });
        }
        if (hasPushedTextStart) {
          replyContent = stripReasoningFromContent(accumulatedContent, accumulatedReasoning);
          const textBlockIndex = hasPushedThinkingStart ? 1 : 0;
          (output.content[textBlockIndex] as { type: "text"; text: string }).text = replyContent;
          stream.push({
            type: "text_end",
            contentIndex: textBlockIndex,
            content: replyContent,
            partial: output,
          });
        }

        // Reply is only the model's content stream—never mix in reasoning (thinking is a separate field).
        let finalContent =
          replyContent || stripReasoningFromContent(accumulatedContent, accumulatedReasoning);

        // Generic dedupe: (1) exact duplicate — same text twice; (2) "partial then full" — model echoes then restarts with common openings (greetings, Sure thing, Got it, etc.).
        const len = finalContent.length;
        if (len >= 2 && len % 2 === 0) {
          const half = len / 2;
          if (finalContent.slice(0, half) === finalContent.slice(half)) {
            finalContent = finalContent.slice(0, half);
          }
        }
        const restartPhrases =
          /\b(Hey\s*!?|Hi\s+there\s*!?|Hello\s*!?|Glad\s+you're|What\s+can\s+I\s+help|I\s+don't\s+have|Sure\s*,?\s*thing|Got\s+it|Okay,?|So,?)\b/gi;
        let lastRestart: RegExpExecArray | null = null;
        let restartM: RegExpExecArray | null;
        while ((restartM = restartPhrases.exec(finalContent)) !== null) {
          lastRestart = restartM;
        }
        if (lastRestart && lastRestart.index > 0) {
          const single = finalContent.slice(lastRestart.index);
          if (single.length > 0) {
            finalContent = single;
          }
        }

        finalResponse.message.content = finalContent;
        if (accumulatedToolCalls.length > 0) {
          finalResponse.message.tool_calls = accumulatedToolCalls;
        }

        // Build done message with thinking and text as separate blocks so the UI can show thinking (grey, collapsible) and reply separately.
        const modelInfoLocal = { api: model.api, provider: model.provider, id: model.id };
        const doneUsage: Usage = {
          input: finalResponse.prompt_eval_count ?? 0,
          output: finalResponse.eval_count ?? 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: (finalResponse.prompt_eval_count ?? 0) + (finalResponse.eval_count ?? 0),
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        };
        const hasToolCalls = accumulatedToolCalls.length > 0;
        const stopReason: Extract<StopReason, "stop" | "length" | "toolUse"> = hasToolCalls
          ? "toolUse"
          : "stop";
        const contentBlocks: Array<
          { type: "thinking"; thinking: string } | TextContent | ToolCall
        > = [];
        if (accumulatedReasoning.trim()) {
          contentBlocks.push({ type: "thinking", thinking: accumulatedReasoning.trim() });
        }
        if (finalContent) {
          contentBlocks.push({ type: "text", text: finalContent });
        }
        for (const tc of accumulatedToolCalls) {
          contentBlocks.push({
            type: "toolCall",
            id: `ollama_call_${randomUUID()}`,
            name: tc.function.name,
            arguments: tc.function.arguments,
          });
        }
        const assistantMessage: AssistantMessage = {
          role: "assistant",
          content: contentBlocks.length > 0 ? contentBlocks : [{ type: "text", text: "" }],
          stopReason,
          api: modelInfoLocal.api,
          provider: modelInfoLocal.provider,
          model: modelInfoLocal.id,
          usage: doneUsage,
          timestamp: Date.now(),
        };

        const reason: Extract<StopReason, "stop" | "length" | "toolUse"> =
          assistantMessage.stopReason === "toolUse" ? "toolUse" : "stop";

        stream.push({
          type: "done",
          reason,
          message: assistantMessage,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log.warn(`Ollama request failed: model=${model.id} error=${errorMessage}`);
        stream.push({
          type: "error",
          reason: "error",
          error: {
            role: "assistant" as const,
            content: [],
            stopReason: "error" as StopReason,
            errorMessage,
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            timestamp: Date.now(),
          },
        });
      } finally {
        stream.end();
      }
    };

    queueMicrotask(() => void run());
    return stream;
  };
}
