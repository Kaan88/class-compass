/**
 * AI connections for the in-app assistant (S19a, D-179). Administrators manage the school's
 * connections on Admin → AI tools; when they allow it, a teacher adds personal connections on the
 * Profile that only they use. A key is sent once (create or replace) and never returned: responses say
 * only whether a secret is stored. Usage is counts and tokens, never chat content. None of these
 * endpoints is an AI tool (no `mcp` exposure): connections and keys never reach a model.
 */
import { z } from 'zod';
import {
  AI_BASE_URL_MAX,
  AI_CONNECTION_NAME_MAX,
  AI_CONNECTION_TYPES,
  AI_DAILY_MESSAGES_MAX,
  AI_FAILURES,
  AI_KEY_MAX,
  AI_MODEL_NAME_MAX,
  AI_MODELS_MAX,
  AI_MONTHLY_TOKENS_MAX,
  PERSONAL_CONNECTION_TYPES,
} from '../aiConnections.ts';
import { endpoint, Empty, Ok } from './define.ts';
import { Id } from './school.ts';

export const AiConnectionTypeSchema = z.enum(AI_CONNECTION_TYPES);
export const AiFailureSchema = z.enum(AI_FAILURES);

/** One allowed model and what the last "Test connection" found (null: never tested). */
export const AiModelView = z.object({
  name: z.string(),
  testedAt: z.number().nullable(),
  text: z.boolean().nullable(),
  tools: z.boolean().nullable(),
});
export type AiModelView = z.infer<typeof AiModelView>;

export const AiUsage = z.object({
  /** This calendar month in the school's timezone. */
  monthMessages: z.number().int(),
  monthInputTokens: z.number().int(),
  monthOutputTokens: z.number().int(),
  /** Today, for the viewer (teachers) or everyone (administrators). */
  todayMessages: z.number().int(),
});
export type AiUsage = z.infer<typeof AiUsage>;

export const AI_CONNECTION_STATUSES = ['ready', 'needsKey', 'notAvailable', 'overBudget', 'paused'] as const;

/** A connection as its manager sees it: never the secret, nor any part of it. */
export const AiConnectionView = z.object({
  id: z.string(),
  type: AiConnectionTypeSchema,
  name: z.string(),
  scope: z.enum(['school', 'personal']),
  /** Only for `openaiCompatible`. */
  baseUrl: z.string().nullable(),
  /** The administrator marked the address as on this server or the school's network. */
  localNetwork: z.boolean(),
  models: z.array(AiModelView),
  /** A key or a signed-in account is stored (sealed). */
  hasSecret: z.boolean(),
  secretSetAt: z.number().nullable(),
  /** How the secret was set: pasted, or from a sign-in with the provider. */
  secretSource: z.enum(['pasted', 'oauth']).nullable(),
  monthlyTokenBudget: z.number().int().nullable(),
  dailyMessageLimit: z.number().int().nullable(),
  enabled: z.boolean(),
  status: z.enum(AI_CONNECTION_STATUSES),
  usage: AiUsage,
  kvkkConfirmedAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type AiConnectionView = z.infer<typeof AiConnectionView>;

export const AiConnectionSettings = z.object({
  defaultConnectionId: z.string().nullable(),
  defaultModel: z.string().nullable(),
  /** "Teachers may add their own connection" (owner decision: off by default). */
  teacherConnectionsAllowed: z.boolean(),
});
export type AiConnectionSettings = z.infer<typeof AiConnectionSettings>;

export const AiConnectionsAdmin = z.object({
  connections: z.array(AiConnectionView),
  settings: AiConnectionSettings,
  /** "Sign in with ChatGPT" is switched on in the server's configuration (only after OpenAI granted access). */
  chatgptAvailable: z.boolean(),
  /** Teachers' own connections are private to them: administrators see how many there are, nothing else. */
  personalConnections: z.number().int(),
});
export type AiConnectionsAdmin = z.infer<typeof AiConnectionsAdmin>;

const Name = z.string().trim().min(1).max(AI_CONNECTION_NAME_MAX);
const ModelName = z
  .string()
  .trim()
  .min(1)
  .max(AI_MODEL_NAME_MAX)
  .regex(/^[\w.:/@+-]+$/u);
const Models = z.array(ModelName).min(1).max(AI_MODELS_MAX);
const ApiKey = z
  .string()
  .trim()
  .min(8)
  .max(AI_KEY_MAX)
  .regex(/^[\x21-\x7e]+$/u);
const MonthlyBudget = z.number().int().min(1).max(AI_MONTHLY_TOKENS_MAX).nullable();
const DailyLimit = z.number().int().min(1).max(AI_DAILY_MESSAGES_MAX).nullable();
const BaseUrl = z.string().trim().min(1).max(AI_BASE_URL_MAX);

export const CreateAiConnectionInput = z.object({
  type: AiConnectionTypeSchema,
  name: Name,
  models: Models,
  baseUrl: BaseUrl.optional(),
  localNetwork: z.boolean().default(false),
  /** Sent once; sealed at rest; never returned. Body field name redacted in the server log. */
  apiKey: ApiKey.optional(),
  monthlyTokenBudget: MonthlyBudget.default(null),
  dailyMessageLimit: DailyLimit.default(null),
  /** "This provider is a data processor for the school (KVKK)": must be ticked. */
  kvkkConfirmed: z.literal(true),
});

export const UpdateAiConnectionInput = z.object({
  connectionId: Id,
  name: Name.optional(),
  models: Models.optional(),
  baseUrl: BaseUrl.optional(),
  localNetwork: z.boolean().optional(),
  /** Replaces the stored key. */
  apiKey: ApiKey.optional(),
  /** Removes the stored key (or the signed-in account). */
  removeSecret: z.literal(true).optional(),
  monthlyTokenBudget: MonthlyBudget.optional(),
  dailyMessageLimit: DailyLimit.optional(),
  enabled: z.boolean().optional(),
});

export const AiTestResult = z.object({
  ok: z.boolean(),
  /** The model answered with text. */
  text: z.boolean(),
  /** The model called the test tool with the right argument (the assistant's tools will work). */
  tools: z.boolean(),
  failure: AiFailureSchema.nullable(),
  /** The HTTP status the provider answered with, when that is the failure. */
  httpStatus: z.number().int().nullable(),
  ms: z.number().int(),
});
export type AiTestResult = z.infer<typeof AiTestResult>;

const ConnId = z.object({ connectionId: Id });
const TestInput = z.object({ connectionId: Id, model: ModelName });
/** Where the browser goes to sign in with the provider (OpenRouter, ChatGPT when available). */
const OAuthStart = z.object({ authorizeUrl: z.string() });

// ---------------------------------------------------------------- administrators (school connections)
export const aiConnectionsAdmin = endpoint({ method: 'GET', path: '/api/admin/ai-connections', access: 'admin', input: Empty, output: AiConnectionsAdmin });
export const createAiConnection = endpoint({ method: 'POST', path: '/api/admin/ai-connections', access: 'admin', input: CreateAiConnectionInput, output: AiConnectionView });
export const updateAiConnection = endpoint({ method: 'PATCH', path: '/api/admin/ai-connections/:connectionId', access: 'admin', input: UpdateAiConnectionInput, output: AiConnectionView });
export const deleteAiConnection = endpoint({ method: 'DELETE', path: '/api/admin/ai-connections/:connectionId', access: 'admin', input: ConnId, output: Ok });
export const testAiConnection = endpoint({ method: 'POST', path: '/api/admin/ai-connections/:connectionId/test', access: 'admin', input: TestInput, output: AiTestResult });
export const startAiConnectionOAuth = endpoint({ method: 'POST', path: '/api/admin/ai-connections/:connectionId/oauth', access: 'admin', input: ConnId, output: OAuthStart });
export const setAiConnectionSettings = endpoint({
  method: 'PUT',
  path: '/api/admin/ai-connection-settings',
  access: 'admin',
  input: z.object({
    /** The school default: a school connection and one of its models (both null to clear). */
    defaultConnectionId: Id.nullable().optional(),
    defaultModel: ModelName.nullable().optional(),
    teacherConnectionsAllowed: z.boolean().optional(),
  }),
  output: AiConnectionSettings,
});

// ---------------------------------------------------------------- teachers (own connections, when allowed)
export const OwnAiConnections = z.object({
  /** The administrator allows teachers' own connections. */
  allowed: z.boolean(),
  connections: z.array(AiConnectionView),
  /** What the assistant uses when the teacher has chosen nothing (S19b). */
  schoolDefault: z.object({ name: z.string(), type: AiConnectionTypeSchema, model: z.string() }).nullable(),
  chatgptAvailable: z.boolean(),
});
export type OwnAiConnections = z.infer<typeof OwnAiConnections>;

export const CreateOwnAiConnectionInput = CreateAiConnectionInput.omit({ baseUrl: true, localNetwork: true }).extend({ type: z.enum(PERSONAL_CONNECTION_TYPES) });
export const UpdateOwnAiConnectionInput = UpdateAiConnectionInput.omit({ baseUrl: true, localNetwork: true });

export const ownAiConnections = endpoint({ method: 'GET', path: '/api/teacher/ai-connections', access: 'teacher', input: Empty, output: OwnAiConnections });
export const createOwnAiConnection = endpoint({ method: 'POST', path: '/api/teacher/ai-connections', access: 'teacher', input: CreateOwnAiConnectionInput, output: AiConnectionView });
export const updateOwnAiConnection = endpoint({ method: 'PATCH', path: '/api/teacher/ai-connections/:connectionId', access: 'teacher', input: UpdateOwnAiConnectionInput, output: AiConnectionView });
export const deleteOwnAiConnection = endpoint({ method: 'DELETE', path: '/api/teacher/ai-connections/:connectionId', access: 'teacher', input: ConnId, output: Ok });
export const testOwnAiConnection = endpoint({ method: 'POST', path: '/api/teacher/ai-connections/:connectionId/test', access: 'teacher', input: TestInput, output: AiTestResult });
export const startOwnAiConnectionOAuth = endpoint({ method: 'POST', path: '/api/teacher/ai-connections/:connectionId/oauth', access: 'teacher', input: ConnId, output: OAuthStart });

// ---------------------------------------------------------------- the sign-in's return (both roles)
/**
 * The provider sends the browser back to `/ai-connections/return?state=…&code=…` on our own origin;
 * that page posts both here after a button press. `state` names a single-use, 10-minute request bound
 * to the account that started it; the PKCE verifier never leaves the server.
 */
export const finishAiConnectionOAuth = endpoint({
  method: 'POST',
  path: '/api/account/ai-connections/oauth/finish',
  access: 'account',
  input: z.object({ state: z.string().min(16).max(200), code: z.string().min(1).max(2000) }),
  output: z.object({ connectionId: z.string(), scope: z.enum(['school', 'personal']), name: z.string() }),
});
