/**
 * The assistant chat in the teacher area (S19b, D-180). Every endpoint is `teacher` (PIN-gated in
 * classroom mode) except the administrator's settings; a chat belongs to its owner only (another
 * account's chat is a 404). Texts come back with real names: with the student-data switch off the
 * provider saw pseudonyms, and the server maps them back on the way to the browser. None of these
 * endpoints is an AI tool (no `mcp` exposure): no AI tool can read chats.
 *
 * A message starts a run on the server; its events stream from `/runs/:runId/events` (Server-Sent
 * Events carrying the answer's text, D-180 refines D-134). A change the model asks for waits as a
 * `pending` tool call until the teacher answers its card: the answer is only Yes or No, the arguments
 * stay on the server.
 */
import { z } from 'zod';
import {
  ASSISTANT_MESSAGE_MAX,
  ASSISTANT_RETENTION_MAX_DAYS,
  ASSISTANT_RETENTION_MIN_DAYS,
  ASSISTANT_RUN_ENDS,
  ASSISTANT_SEARCH_MAX,
  ASSISTANT_TITLE_MAX,
  ASSISTANT_UNAVAILABLE,
} from '../assistantChat.ts';
import { AiConnectionTypeSchema } from './aiConnections.ts';
import { endpoint, Empty, Ok } from './define.ts';
import { Id } from './school.ts';

const ModelName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[\w.:/@+-]+$/u);

/** A connection the teacher may choose in the chat (ready, allowed), with its models. */
export const AssistantConnectionOption = z.object({
  id: z.string(),
  name: z.string(),
  type: AiConnectionTypeSchema,
  scope: z.enum(['school', 'personal']),
  models: z.array(z.object({ name: z.string(), tools: z.boolean().nullable() })),
});

export const AssistantStatus = z.object({
  available: z.boolean(),
  unavailable: z.enum(ASSISTANT_UNAVAILABLE).nullable(),
  /** The school sends student names (student-data switch on); otherwise the provider sees "Student N". */
  studentNames: z.boolean(),
  connections: z.array(AssistantConnectionOption),
  defaultConnectionId: z.string().nullable(),
  defaultModel: z.string().nullable(),
  retentionDays: z.number().int(),
});
export type AssistantStatus = z.infer<typeof AssistantStatus>;

export const AssistantChatSummary = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  lastMessageAt: z.number(),
  archived: z.boolean(),
  connectionId: z.string().nullable(),
  model: z.string().nullable(),
});
export type AssistantChatSummary = z.infer<typeof AssistantChatSummary>;

/** One line of "what will change" on a confirmation card: an argument the model sent, with real names. */
export const AssistantChangeLine = z.object({ key: z.string(), value: z.string() });

export const ASSISTANT_CALL_STATES = ['auto', 'pending', 'approved', 'declined', 'refused', 'expired'] as const;
export const AssistantCallView = z.object({
  id: z.string(),
  tool: z.string(),
  readOnly: z.boolean(),
  state: z.enum(ASSISTANT_CALL_STATES),
  /** What the call was about, for the activity line ("3-A English", a student's name). */
  target: z.string().nullable(),
  /** Only for changes: what will (or would) change. */
  changes: z.array(AssistantChangeLine),
  /** The tool ran and failed (null: it has not run). */
  failed: z.boolean().nullable(),
});
export type AssistantCallView = z.infer<typeof AssistantCallView>;

export const AssistantMessageView = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  createdAt: z.number(),
  status: z.enum(['complete', 'cancelled', 'error']),
  errorCode: z.string().nullable(),
  calls: z.array(AssistantCallView),
});
export type AssistantMessageView = z.infer<typeof AssistantMessageView>;

export const AssistantChatDetail = z.object({
  chat: AssistantChatSummary,
  messages: z.array(AssistantMessageView),
  /** An answer is being written now (the page reconnects to it). */
  runId: z.string().nullable(),
  /** The earlier part of the chat was summarised for the model (it still shows here in full). */
  compacted: z.boolean(),
});
export type AssistantChatDetail = z.infer<typeof AssistantChatDetail>;

/** What a run streams (one Server-Sent Event each; every event has the run's next `seq`). */
export const AssistantRunEvent = z.discriminatedUnion('type', [
  /** More of the answer's text (real names already put back). */
  z.object({ type: z.literal('text'), seq: z.number().int(), messageId: z.string(), text: z.string() }),
  z.object({ type: z.literal('tool'), seq: z.number().int(), messageId: z.string(), call: AssistantCallView }),
  z.object({ type: z.literal('end'), seq: z.number().int(), end: z.enum(ASSISTANT_RUN_ENDS), reason: z.string().nullable() }),
]);
export type AssistantRunEvent = z.infer<typeof AssistantRunEvent>;

const ChatId = z.object({ chatId: Id });
const Choice = { connectionId: Id.nullable().optional(), model: ModelName.nullable().optional() };

export const assistantStatus = endpoint({ method: 'GET', path: '/api/teacher/assistant-chat', access: 'teacher', input: Empty, output: AssistantStatus });
export const listAssistantChats = endpoint({
  method: 'GET',
  path: '/api/teacher/assistant-chat/chats',
  access: 'teacher',
  input: z.object({ q: z.string().max(ASSISTANT_SEARCH_MAX).optional(), archived: z.enum(['true', 'false']).optional() }),
  output: z.object({ chats: z.array(AssistantChatSummary) }),
});
export const createAssistantChat = endpoint({ method: 'POST', path: '/api/teacher/assistant-chat/chats', access: 'teacher', input: z.object(Choice), output: AssistantChatSummary });
export const getAssistantChat = endpoint({ method: 'GET', path: '/api/teacher/assistant-chat/chats/:chatId', access: 'teacher', input: ChatId, output: AssistantChatDetail });
export const updateAssistantChat = endpoint({
  method: 'PATCH',
  path: '/api/teacher/assistant-chat/chats/:chatId',
  access: 'teacher',
  input: z.object({ chatId: Id, title: z.string().trim().min(1).max(ASSISTANT_TITLE_MAX).optional(), archived: z.boolean().optional(), ...Choice }),
  output: AssistantChatSummary,
});
export const deleteAssistantChat = endpoint({ method: 'DELETE', path: '/api/teacher/assistant-chat/chats/:chatId', access: 'teacher', input: ChatId, output: Ok });
export const sendAssistantMessage = endpoint({
  method: 'POST',
  path: '/api/teacher/assistant-chat/chats/:chatId/messages',
  access: 'teacher',
  input: z.object({ chatId: Id, text: z.string().trim().min(1).max(ASSISTANT_MESSAGE_MAX), ...Choice }),
  output: z.object({ runId: z.string(), messageId: z.string() }),
});
/**
 * The teacher's answer to one confirmation card. Only Yes or No: the change itself (the tool and its
 * arguments) is the one the server holds for this chat, message and call; a second answer is refused.
 */
export const answerAssistantCall = endpoint({
  method: 'POST',
  path: '/api/teacher/assistant-chat/chats/:chatId/messages/:messageId/calls/:callId',
  access: 'teacher',
  input: z.object({ chatId: Id, messageId: Id, callId: z.string().min(1).max(200), approve: z.boolean() }),
  output: z.object({ runId: z.string().nullable() }),
});
export const cancelAssistantRun = endpoint({ method: 'POST', path: '/api/teacher/assistant-chat/runs/:runId/cancel', access: 'teacher', input: z.object({ runId: Id }), output: Ok });
/** Raw route: `text/event-stream` of `AssistantRunEvent`s after `after`; ends with the `end` event. */
export const assistantRunEvents = endpoint({
  method: 'GET',
  path: '/api/teacher/assistant-chat/runs/:runId/events',
  access: 'teacher',
  input: z.object({ runId: Id, after: z.coerce.number().int().min(0).optional() }),
  output: z.unknown(),
});
/** Raw route: the teacher's own chats as a JSON file (their data export, D-180). */
export const exportAssistantChats = endpoint({ method: 'GET', path: '/api/teacher/assistant-chat/export', access: 'teacher', input: Empty, output: z.unknown() });

// ---------------------------------------------------------------- administrators
export const AssistantAdmin = z.object({
  enabled: z.boolean(),
  retentionDays: z.number().int(),
  /** The school's AI tools switch (the chat needs it, D-180). */
  aiToolsEnabled: z.boolean(),
  /** School connections that can be used now (the chat needs at least one). */
  readyConnections: z.number().int(),
  /** How many chats exist and how many teachers have one: numbers only, never content. */
  chats: z.number().int(),
  teachers: z.number().int(),
});
export type AssistantAdmin = z.infer<typeof AssistantAdmin>;
export const assistantAdmin = endpoint({ method: 'GET', path: '/api/admin/assistant-chat', access: 'admin', input: Empty, output: AssistantAdmin });
export const setAssistantAdmin = endpoint({
  method: 'PUT',
  path: '/api/admin/assistant-chat',
  access: 'admin',
  input: z.object({ enabled: z.boolean().optional(), retentionDays: z.number().int().min(ASSISTANT_RETENTION_MIN_DAYS).max(ASSISTANT_RETENTION_MAX_DAYS).optional() }),
  output: AssistantAdmin,
});
