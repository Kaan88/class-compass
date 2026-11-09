/** Kind words check (S13c, D-123): a core piece. The teacher page (own words, blocked-words notice). */
import { IconShield } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';
import { TextChecksPage } from './TextChecksPage.tsx';

export const textChecksClientManifest = defineClientModule({
  key: 'textChecks',
  policyKey: null,
  i18nNamespace: 'textCheck',
  teacherPages: [{ key: 'textChecks', path: 'text-checks', labelKey: 'teacher.textChecks', Icon: IconShield, order: 150, group: 'setup', setupTab: 'progress', Component: TextChecksPage }],
});
