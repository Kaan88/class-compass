/**
 * Admin → AI tools → Assistant chat (S19b, D-180): the switch that lets teachers use the assistant (it
 * needs a ready school connection and the AI tools switch) and how long chats are kept after their last
 * message. Administrators see numbers only, never a chat.
 */
import { useQuery } from '@tanstack/react-query';
import '../../../shared/i18n/areas/assistantChat.ts';
import { ASSISTANT_RETENTION_DEFAULT_DAYS } from '../../../shared/assistantChat.ts';
import * as C from '../../../shared/contracts/assistantChat.ts';
import { call } from '../../lib/api.ts';
import { errorText } from '../../lib/errors.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { useRun } from '../../lib/useRun.ts';
import { Alert } from '../../ui/Feedback.tsx';
import { Select, Toggle } from '../../ui/Fields.tsx';

/** Below the connections' key, so every change to a school connection refreshes the readiness shown here. */
export const ASSISTANT_ADMIN_KEY = ['sensitive', 'ai-connections', 'admin', 'assistant-chat'] as const;
const RETENTION_CHOICES = [30, 90, 180, 365, 730] as const;

export function AssistantChatAdminSection() {
  const { t } = useI18n();
  const run = useRun();
  const q = useQuery({ queryKey: ASSISTANT_ADMIN_KEY, queryFn: () => call(C.assistantAdmin, {}) });
  const data = q.data;
  const save = (patch: { enabled?: boolean; retentionDays?: number }) => run(() => call(C.setAssistantAdmin, patch), { success: t('assistantChat.admin.saved'), invalidate: [ASSISTANT_ADMIN_KEY] });
  const days = data ? [...new Set([...RETENTION_CHOICES, data.retentionDays])].sort((a, b) => a - b) : [];
  return (
    <section className="cc-card cc-stack" aria-labelledby="assistant-admin-title" data-testid="assistant-chat-admin">
      <h2 id="assistant-admin-title" className="cc-h2">
        {t('assistantChat.admin.title')}
      </h2>
      <p className="cc-muted" style={{ margin: 0 }}>
        {t('assistantChat.admin.intro')}
      </p>
      {q.error ? <Alert>{errorText(t, q.error)}</Alert> : null}
      {data ? (
        <>
          <Toggle
            label={t('assistantChat.admin.enabled')}
            description={t('assistantChat.admin.enabledHint')}
            isSelected={data.enabled}
            isDisabled={!data.enabled && data.readyConnections === 0}
            onChange={(v) => void save({ enabled: v })}
          />
          {data.readyConnections === 0 ? <Alert kind="warning">{t('assistantChat.admin.needsConnection')}</Alert> : null}
          {data.enabled && !data.aiToolsEnabled ? <Alert kind="warning">{t('assistantChat.admin.needsAiTools')}</Alert> : null}
          <Select
            label={t('assistantChat.admin.retention')}
            value={String(data.retentionDays)}
            onChange={(v) => void save({ retentionDays: Number(v) })}
            items={days.map((d) => ({ id: String(d), label: t(d === ASSISTANT_RETENTION_DEFAULT_DAYS ? 'assistantChat.admin.retentionYear' : 'assistantChat.admin.retentionDays', { days: d }) }))}
          />
          <p className="cc-muted" style={{ margin: 0 }} data-testid="assistant-admin-counts">
            {t('assistantChat.admin.counts', { chats: data.chats, teachers: data.teachers })}
          </p>
        </>
      ) : null}
    </section>
  );
}
