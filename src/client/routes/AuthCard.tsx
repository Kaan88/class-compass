/** The card that frames the sign-in, reset, invite and email-link screens. */
import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import { Mascot, ThemeDecoration } from '../ui/Mascot.tsx';

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <main className="cc-page" style={{ maxWidth: '32rem', position: 'relative' }}>
      <div className="cc-card cc-stack" style={{ position: 'relative', overflow: 'hidden', marginTop: '3rem' }}>
        <ThemeDecoration size={160} />
        <div className="cc-row">
          <Mascot size={72} />
          <div>
            <p className="cc-muted" style={{ margin: 0, fontWeight: 700 }}>
              {t('app.name')}
            </p>
            <h1 className="cc-h1">{title}</h1>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
