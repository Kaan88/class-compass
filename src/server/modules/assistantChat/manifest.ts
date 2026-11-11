/**
 * The assistant chat in the teacher area (S19b, D-180): chats kept on the server for their owner, the
 * agent loop over the AI tools layer (D-160, D-161) and the connections (D-179), confirmation before
 * any change, pseudonyms to the provider while the student-data switch is off, retention and erasure.
 * (The key `assistant` is the classroom assistant rota.)
 */
import { defineServerModule } from '../manifest.ts';
import { registerAssistantChatRoutes } from './routes.ts';

export const assistantChatManifest = defineServerModule({ key: 'assistantChat', policyKey: null, routes: registerAssistantChatRoutes });
