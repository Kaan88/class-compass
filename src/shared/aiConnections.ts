/**
 * AI connections for the in-app assistant (S19a, D-179): the kinds of connection, their limits and
 * what each kind needs. A connection is how the school (or, when the administrator allows it, one
 * teacher) reaches a model provider: a type, a display name, the models it may use and a sealed
 * secret. The chat itself is S19b; this file holds only what both sides need to agree on.
 */

/**
 * The connection types (owner decision 2026-11-11: all of them in the first build).
 * - `anthropic`, `openai`, `gemini`: a pasted API key for the provider's own API.
 * - `openrouter`: a pasted key, or "Connect OpenRouter" (OAuth with PKCE; the app receives a key).
 * - `openaiCompatible`: any base URL that speaks the OpenAI Chat Completions API (Mistral, Groq,
 *   Azure, a model on the school's own server), with an optional key. Administrators only.
 * - `chatgpt`: "Sign in with ChatGPT" (a teacher's ChatGPT plan). The slot exists; it stays off until
 *   OpenAI grants Class Compass access (server configuration), and nothing pretends it works.
 */
export const AI_CONNECTION_TYPES = ['anthropic', 'openai', 'gemini', 'openrouter', 'openaiCompatible', 'chatgpt'] as const;
export type AiConnectionType = (typeof AI_CONNECTION_TYPES)[number];

/** Types a teacher may add as a personal connection (no base URLs: only administrators enter addresses). */
export const PERSONAL_CONNECTION_TYPES = ['anthropic', 'openai', 'gemini', 'openrouter', 'chatgpt'] as const satisfies readonly AiConnectionType[];

/** Types that cannot work without a secret (an API key or a signed-in account). */
export const SECRET_REQUIRED: readonly AiConnectionType[] = ['anthropic', 'openai', 'gemini', 'openrouter', 'chatgpt'];
/** Types whose secret comes from a sign-in with the provider rather than a pasted key. */
export const OAUTH_TYPES: readonly AiConnectionType[] = ['openrouter', 'chatgpt'];
/** Types whose key is pasted (OpenRouter both ways). */
export const KEY_TYPES: readonly AiConnectionType[] = ['anthropic', 'openai', 'gemini', 'openrouter', 'openaiCompatible'];

/** Which wire format a type speaks (the adapters, S19a). */
export const WIRE_FORMAT: Record<AiConnectionType, 'anthropic' | 'openai' | 'gemini'> = {
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'gemini',
  openrouter: 'openai',
  openaiCompatible: 'openai',
  chatgpt: 'openai',
};

export const AI_CONNECTION_NAME_MAX = 60;
export const AI_MODEL_NAME_MAX = 120;
export const AI_MODELS_MAX = 20;
export const AI_BASE_URL_MAX = 300;
export const AI_KEY_MAX = 1000;
/** Upper bounds for the administrator's limits (a sanity check, not a recommendation). */
export const AI_MONTHLY_TOKENS_MAX = 1_000_000_000;
export const AI_DAILY_MESSAGES_MAX = 10_000;
/** Connections per scope: the school's, and each teacher's own. */
export const AI_SCHOOL_CONNECTIONS_MAX = 20;
export const AI_PERSONAL_CONNECTIONS_MAX = 5;

/** The tool "Test connection" offers the model; a working connection calls it. */
export const AI_TEST_TOOL = 'connection_check';
/** The word the test asks for (in the text reply and as the tool's argument). */
export const AI_TEST_WORD = 'ready';

/**
 * The reasons a request to a provider can fail, as the admin page shows them. Never the provider's
 * own message: it can echo part of a key.
 */
export const AI_FAILURES = ['KEY_REJECTED', 'MODEL_NOT_FOUND', 'RATE_LIMITED', 'PROVIDER_ERROR', 'UNREACHABLE', 'URL_NOT_ALLOWED', 'BAD_RESPONSE', 'TIMEOUT', 'NEEDS_KEY', 'NOT_AVAILABLE'] as const;
export type AiFailure = (typeof AI_FAILURES)[number];
