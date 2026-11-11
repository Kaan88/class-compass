/**
 * The assistant chat (S19b, D-180): one "Today" page in the teacher area (inside the PIN gate), never on
 * the classroom board or the student page. The page and its strings are loaded only when it is opened
 * (the menu label is in the staff dictionary, D-182).
 */
import { lazy, Suspense } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { IconChat } from '../../ui/icons.tsx';
import { defineClientModule, type TeacherPageSearch } from '../types.ts';

const Page = lazy(() => import('./AssistantChatPage.tsx'));

function AssistantChatRoute({ search }: { search: TeacherPageSearch }) {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <main className="cc-page">
          <p className="cc-muted" role="status">
            {t('common.loading')}
          </p>
        </main>
      }
    >
      <Page search={search} />
    </Suspense>
  );
}

export const assistantChatClientManifest = defineClientModule({
  key: 'assistantChat',
  policyKey: null,
  i18nNamespace: 'assistantChat',
  teacherPages: [{ key: 'assistantChat', path: 'ai-assistant', labelKey: 'assistantChat.title', Icon: IconChat, order: 130, group: 'today', Component: AssistantChatRoute }],
});
