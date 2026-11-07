/**
 * One on/off option of a module's class+subject config (SX `config`, D-069), e.g. the counters'
 * reminder boxes on student cards or upper-case names on the group screen (S13a). Writes the whole
 * config back with the changed field (the module switch is kept as it is).
 */
import { useQuery } from '@tanstack/react-query';
import * as School from '../../shared/contracts/school.ts';
import { call } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { SENSITIVE } from '../lib/queryClient.ts';
import { useRun } from '../lib/useRun.ts';
import { Toggle } from './Fields.tsx';

export function ModuleConfigToggle({
  contextId,
  module,
  field,
  defaultValue,
  label,
  description,
}: {
  contextId: string;
  module: School.ContextModule;
  field: string;
  defaultValue: boolean;
  label: string;
  description?: string;
}) {
  const { t } = useI18n();
  const run = useRun();
  const key = [SENSITIVE, 'teacher', 'modules', contextId];
  const q = useQuery({ queryKey: key, queryFn: () => call(School.getContextModules, { contextId }) });
  const m = q.data?.modules.find((x) => x.module === module);
  if (!m) return null;
  const value = typeof m.config?.[field] === 'boolean' ? (m.config[field] as boolean) : defaultValue;
  return (
    <Toggle
      label={label}
      description={description}
      isSelected={value}
      onChange={(v) =>
        void run(() => call(School.setContextModule, { contextId, module, enabled: m.enabled, config: { ...(m.config ?? {}), [field]: v } }), {
          success: t('save.saved'),
          invalidate: [key, ['classroom', 'lesson']],
        })
      }
    />
  );
}
