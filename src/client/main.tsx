import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Auth from '../shared/contracts/auth.ts';
import { ApiError, call } from './lib/api.ts';
import { I18nProvider, useI18n } from './lib/i18n.tsx';
import './styles/app.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } } });

function LoginPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const me = await call(Auth.login, { login: String(f.get('login')), password: String(f.get('password')) });
      qc.setQueryData(['me'], me);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'RATE_LIMITED' ? t('auth.tooMany') : t('auth.incorrect'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto mt-24 max-w-md rounded-[var(--cc-radius)] bg-[var(--cc-surface)] p-8 shadow">
      <h1 className="mb-6 text-3xl font-bold">{t('app.name')}</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 font-semibold">
          {t('auth.login')}
          <input name="login" autoComplete="username" required className="min-h-[var(--cc-touch)] rounded-lg border-2 border-[var(--cc-border)] px-3" />
        </label>
        <label className="flex flex-col gap-1 font-semibold">
          {t('auth.password')}
          <input name="password" type="password" autoComplete="current-password" required className="min-h-[var(--cc-touch)] rounded-lg border-2 border-[var(--cc-border)] px-3" />
        </label>
        {error && (
          <p role="alert" className="font-semibold text-[var(--cc-danger)]">
            ⚠ {error}
          </p>
        )}
        <button disabled={busy} className="min-h-[var(--cc-touch)] rounded-lg bg-[var(--cc-accent)] text-lg font-bold text-[var(--cc-accent-text)]">
          {t('auth.signIn')}
        </button>
      </form>
    </main>
  );
}

function Shell() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => call(Auth.me, {}).catch(() => null) });
  if (me.isLoading) return null;
  const locale = me.data?.locale ?? 'en';
  document.documentElement.lang = locale;
  document.documentElement.style.setProperty('--cc-text-scale', String((me.data?.textScale ?? 100) / 100));
  return (
    <I18nProvider locale={locale}>
      {me.data ? <Home name={me.data.displayName} /> : <LoginPage />}
    </I18nProvider>
  );
}

function Home({ name }: { name: string }) {
  const { t } = useI18n();
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold">{t('home.welcome', { name })}</h1>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  </StrictMode>,
);
