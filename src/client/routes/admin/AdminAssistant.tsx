/**
 * Admin → Assistant (S27d, D-196): the same Assistant page as the teacher's, for administrator accounts
 * (their own private chats, the administrator tools, theme drafts). Loaded only when opened, with the
 * page's own chunk, stylesheet and strings.
 */
import { useSearch } from '@tanstack/react-router';
import AssistantChatPage from '../../modules/assistantChat/AssistantChatPage.tsx';

export function AdminAssistantPage() {
  const search = useSearch({ strict: false }) as { chat?: string };
  return <AssistantChatPage area="admin" search={search.chat ? { chat: search.chat } : {}} />;
}
