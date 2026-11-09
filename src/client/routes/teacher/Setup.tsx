/**
 * The Class setup hub (S14e3, D-156): one tile on the teacher menu leads here; the pages a teacher sets
 * up once and changes now and then are tiles under three tabs (classes and students, lesson tools,
 * achievements and kind words). The tab is in the address (`?tab=`), so Back returns to it. Pages of
 * modules that are off in all of the teacher's class+subjects are left out; their old addresses still
 * work (they show an empty state).
 */
import { Link, useNavigate } from '@tanstack/react-router';
import { useI18n } from '../../lib/i18n.tsx';
import { setupPages } from '../../modules/registry.ts';
import { SETUP_TABS, type SetupTab, type TeacherPageSearch } from '../../modules/types.ts';
import { Tabs } from '../../ui/Tabs.tsx';
import { useMenuContexts } from './Teacher.tsx';

const isTab = (v: string | undefined): v is SetupTab => (SETUP_TABS as readonly string[]).includes(v ?? '');

export function SetupHub({ search }: { search: TeacherPageSearch }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const contexts = useMenuContexts();
  const tab: SetupTab = isTab(search.tab) ? search.tab : 'classes';
  return (
    <main className="cc-page cc-stack" data-testid="setup-hub">
      <h1 className="cc-h1">{t('teacher.setup')}</h1>
      <p className="cc-muted">{t('teacher.setupHint')}</p>
      <Tabs
        label={t('teacher.setupTabs')}
        selectedKey={tab}
        onSelectionChange={(k) => void navigate({ to: '/teacher/$page', params: { page: 'setup' }, search: { tab: k }, replace: true })}
        items={SETUP_TABS.map((id) => ({
          id,
          label: t(`teacher.setupTab.${id}`),
          content: (
            <div className="cc-menu-grid">
              {setupPages(contexts, id).map((p) => (
                <Link key={p.key} to="/teacher/$page" params={{ page: p.path }} className="cc-menu-tile">
                  <p.Icon />
                  {t(p.labelKey)}
                </Link>
              ))}
            </div>
          ),
        }))}
      />
    </main>
  );
}
