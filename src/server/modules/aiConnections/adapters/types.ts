/**
 * The provider-neutral chat format (S19a, D-179) that the assistant's agent loop (S19b) speaks. Each
 * adapter translates it to one wire format (Anthropic Messages, OpenAI Chat Completions, Gemini
 * generateContent) and translates the streamed reply back into `ChatEvent`s. Tools are described once,
 * from the existing MCP tool definitions (`tools.ts`), and translated per adapter (Anthropic tools,
 * OpenAI function calling, Gemini function declarations).
 */
import crypto from 'node:crypto';
import type { NetPolicy } from '../urlSafety.ts';

/** A tool the model may call: the MCP tool's name, description and input JSON Schema. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** A JSON Schema object (`type: 'object'`). */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  /**
   * The provider's id for the call. When the provider sends none (Gemini may not), the adapter makes
   * one up that is unique across the conversation (`newCallId`) and sets `generatedId`, so it is used
   * only to pair the result with the call here and is never sent back to the provider.
   */
  id: string;
  generatedId?: true;
  name: string;
  arguments: Record<string, unknown>;
  /** The model sent arguments that were not a JSON object; `arguments` is then `{}`. */
  invalidArguments?: true;
  /** Opaque provider data that must travel back with the call (Gemini's thought signature). */
  signature?: string;
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: ToolCall[];
      /**
       * The model's hidden reasoning for this message, held in the agent's run memory only (never stored,
       * shown or logged; D-203). The OpenAI adapter sends it back (`reasoning_content`, or `reasoning` on OpenRouter) on a message
       * with tool calls when the target asks for it (`ProviderTarget.sendReasoning`).
       */
      reasoning?: string;
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

export type StopReason = 'end' | 'toolUse' | 'length' | 'other';

/**
 * What a streamed reply yields: text as it arrives, the model's hidden reasoning as it arrives (never
 * shown; counted for the token estimate and, for some providers, sent back during the same run), each
 * complete tool call, the token usage as soon as the provider reports it (possibly several times, each
 * one the total so far: a consumer keeps the last one and records it once, so a reply cut short still
 * counts what it used), then `done` last.
 */
export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'toolCall'; call: ToolCall }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; stop: StopReason };

/** Where and how an adapter sends its request (resolved from a connection by `provider.ts`). */
export interface ProviderTarget {
  /** Without a trailing slash, e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  policy: NetPolicy;
  /** The key or access token; null for an OpenAI-compatible server without one. */
  secret: string | null;
  /** OpenAI's own API wants `max_completion_tokens`; compatible servers and OpenRouter take `max_tokens`. */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  /**
   * Send an assistant message's reasoning back in this field when it made tool calls (D-203):
   * `reasoning_content` for OpenAI-compatible servers (DeepSeek requires it in a tool loop),
   * `reasoning` for OpenRouter (its assistant-message field). Unset: never sent back.
   */
  sendReasoning?: ReasoningField;
}

/** The assistant-message field a provider takes its own reasoning back in (D-203). */
export type ReasoningField = 'reasoning_content' | 'reasoning';

export interface StreamRequest {
  target: ProviderTarget;
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
  signal?: AbortSignal | undefined;
  /** The total limit of the request (default `AI_TOTAL_TIMEOUT_MS`); the Test button sets a short one. */
  timeoutMs?: number | undefined;
}

export type Adapter = (req: StreamRequest) => AsyncGenerator<ChatEvent>;

/** Parses tool arguments sent as a JSON string (OpenAI) or an object (Anthropic, Gemini). */
export function parseArguments(raw: unknown): { args: Record<string, unknown>; invalid: boolean } {
  let v = raw;
  if (typeof raw === 'string') {
    if (raw.trim() === '') return { args: {}, invalid: false };
    try {
      v = JSON.parse(raw);
    } catch {
      return { args: {}, invalid: true };
    }
  }
  if (v === undefined || v === null) return { args: {}, invalid: false };
  if (typeof v !== 'object' || Array.isArray(v)) return { args: {}, invalid: true };
  return { args: v as Record<string, unknown>, invalid: false };
}

/** The longest tool call id OpenAI accepts (a chat may move to an OpenAI connection). */
export const MAX_CALL_ID_LENGTH = 40;

/** A tool call id for a provider that sent none: unique across turns, so an agent loop can key on it; at most 40 characters. */
export const newCallId = () => `cc_call_${crypto.randomUUID().replace(/-/gu, '')}`;

/** A tool call; `id` null means the provider sent none (a unique one is made and marked `generatedId`). */
export const toolCall = (id: string | null, name: string, raw: unknown, signature?: string): ToolCall => {
  const { args, invalid } = parseArguments(raw);
  return {
    id: id ?? newCallId(),
    ...(id === null ? { generatedId: true as const } : {}),
    name,
    arguments: args,
    ...(invalid ? { invalidArguments: true as const } : {}),
    ...(signature ? { signature } : {}),
  };
};
