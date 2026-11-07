/** Accounts (ACC-2, ACC-3, DAT-3): create with a one-time temporary password, edit, deactivate, reset, clear PIN. */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import * as Admin from '../../../shared/contracts/admin.ts';
import { call } from '../../lib/api.ts';
import { errorText } from '../../lib/errors.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { showToast } from '../../lib/toast.ts';
import { useRun } from '../../lib/useRun.ts';
import { useMe } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { ConfirmDestructive, DialogActions, Modal } from '../../ui/Dialog.tsx';
import { Alert } from '../../ui/Feedback.tsx';
import { Select, TextField } from '../../ui/Fields.tsx';
import { IconCheck, IconCopy, IconUserOff } from '../../ui/icons.tsx';
import { DataTable } from '../../ui/Layout.tsx';
import { ADMIN } from './Admin.tsx';

type AdminUser = z.infer<typeof Admin.AdminUser>;
const USERS = [...ADMIN, 'users'];

/** Shows a temporary password exactly once, with a copy button. */
function TempPasswordDialog({ value, onClose }: { value: { login: string; password: string } | null; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <Modal
      isOpen={value !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
      title={t('users.tempPasswordTitle')}
      dismissable={false}
    >
      <Alert kind="warning">{t('users.tempPasswordOnce', { login: value?.login ?? '' })}</Alert>
      <output className="cc-temp-password" data-testid="temp-password">
        {value?.password}
      </output>
      <DialogActions>
        <Button
          onPress={async () => {
            try {
              await navigator.clipboard.writeText(value?.password ?? '');
              setCopied(true);
            } catch {
              showToast({ message: t('users.copyFailed'), kind: 'error' });
            }
          }}
        >
          {copied ? <IconCheck /> : <IconCopy />}
          {copied ? t('users.copied') : t('users.copy')}
        </Button>
        <Button
          variant="primary"
          onPress={() => {
            setCopied(false);
            onClose();
          }}
        >
          {t('users.storedIt')}
        </Button>
      </DialogActions>
    </Modal>
  );
}

const LOCALE_ITEMS = (t: ReturnType<typeof useI18n>['t']) => [
  { id: 'en', label: t('language.en') },
  { id: 'tr', label: t('language.tr') },
];

function CreateUserDialog({ isOpen, onOpenChange, onCreated }: { isOpen: boolean; onOpenChange: (v: boolean) => void; onCreated: (login: string, password: string) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'teacher' | 'admin'>('teacher');
  const [locale, setLocale] = useState<'en' | 'tr' | ''>('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} title={t('users.create')}>
      <form
        className="cc-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (!locale) {
            setError(t('users.localeRequired'));
            return;
          }
          try {
            const r = await call(Admin.createUserByAdmin, { login, displayName: name, email: email.trim() || null, role, locale });
            void qc.invalidateQueries({ queryKey: USERS });
            setLogin('');
            setName('');
            setEmail('');
            setLocale('');
            onOpenChange(false);
            onCreated(r.user.login, r.temporaryPassword);
          } catch (err) {
            setError(errorText(t, err));
          }
        }}
      >
        <TextField label={t('users.login')} description={t('users.loginHint')} value={login} onChange={setLogin} isRequired autoFocus />
        <TextField label={t('users.displayName')} value={name} onChange={setName} isRequired />
        <TextField label={t('users.emailOptional')} type="email" value={email} onChange={setEmail} />
        <Select
          label={t('users.role')}
          value={role}
          onChange={(v) => setRole(v === 'admin' ? 'admin' : 'teacher')}
          items={[
            { id: 'teacher', label: t('role.teacher') },
            { id: 'admin', label: t('role.admin') },
          ]}
        />
        <Select label={t('users.locale')} description={t('users.localeHint')} value={locale} placeholder={t('users.localePick')} onChange={(v) => setLocale(v === 'tr' ? 'tr' : 'en')} items={LOCALE_ITEMS(t)} />
        {error ? <Alert>{error}</Alert> : null}
        <DialogActions>
          <Button onPress={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary">
            {t('users.create')}
          </Button>
        </DialogActions>
      </form>
    </Modal>
  );
}

function EditUserDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [locale, setLocale] = useState<'en' | 'tr'>('en');
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (user && loadedFor !== user.id) {
    setLoadedFor(user.id);
    setName(user.displayName);
    setEmail(user.email ?? '');
    setLocale(user.locale);
    setError(null);
  }
  return (
    <Modal
      isOpen={user !== null}
      onOpenChange={(o) => {
        if (!o) {
          setLoadedFor(null);
          onClose();
        }
      }}
      title={t('users.edit')}
    >
      <form
        className="cc-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!user) return;
          try {
            await call(Admin.updateUserByAdmin, { userId: user.id, displayName: name, email: email.trim() || null, locale });
            void qc.invalidateQueries({ queryKey: USERS });
            setLoadedFor(null);
            onClose();
          } catch (err) {
            setError(errorText(t, err));
          }
        }}
      >
        <TextField label={t('users.displayName')} value={name} onChange={setName} isRequired />
        <TextField label={t('users.emailOptional')} type="email" value={email} onChange={setEmail} />
        <Select label={t('users.locale')} description={t('users.localeEditHint')} value={locale} onChange={(v) => setLocale(v === 'tr' ? 'tr' : 'en')} items={LOCALE_ITEMS(t)} />
        {error ? <Alert>{error}</Alert> : null}
        <DialogActions>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary">
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Modal>
  );
}

export function UsersPage() {
  const { t } = useI18n();
  const me = useMe();
  const run = useRun();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: USERS, queryFn: () => call(Admin.listUsers, {}) });
  const [creating, setCreating] = useState(false);
  const [temp, setTemp] = useState<{ login: string; password: string } | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [deactivating, setDeactivating] = useState<AdminUser | null>(null);
  const [clearingPin, setClearingPin] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: USERS });
  return (
    <main className="cc-page cc-stack">
      <div className="cc-row">
        <h1 className="cc-h1" style={{ marginRight: 'auto' }}>
          {t('admin.users')}
        </h1>
        <Button variant="primary" onPress={() => setCreating(true)}>
          {t('users.create')}
        </Button>
      </div>
      <DataTable
        caption={t('users.caption')}
        rows={users.data?.users ?? []}
        rowKey={(u) => u.id}
        emptyText={users.isLoading ? t('common.loading') : t('users.none')}
        columns={[
          {
            key: 'name',
            header: t('users.displayName'),
            sortValue: (u) => u.displayName,
            render: (u) => (
              <div>
                <div style={{ fontWeight: 700 }}>{u.displayName}</div>
                <div className="cc-muted">{u.login}</div>
              </div>
            ),
          },
          { key: 'role', header: t('users.role'), sortValue: (u) => u.role, render: (u) => t(u.role === 'admin' ? 'role.admin' : 'role.teacher') },
          {
            key: 'status',
            header: t('users.status'),
            render: (u) => (
              <div className="cc-row" style={{ gap: '0.3rem' }}>
                {u.active ? (
                  <span className="cc-chip cc-chip--success">
                    <IconCheck />
                    {t('users.active')}
                  </span>
                ) : (
                  <span className="cc-chip cc-chip--danger">
                    <IconUserOff />
                    {t('users.deactivated')}
                  </span>
                )}
                {u.role === 'teacher' ? <span className="cc-chip">{u.hasPin ? t('users.pinSet') : t('users.pinNotSet')}</span> : null}
                {u.mustChangePassword ? <span className="cc-chip cc-chip--warning">{t('users.mustChange')}</span> : null}
              </div>
            ),
          },
          {
            key: 'actions',
            header: t('common.actions'),
            render: (u) => (
              <div className="cc-row" style={{ gap: '0.4rem' }}>
                <Button size="small" onPress={() => setEditing(u)}>
                  {t('common.edit')}
                </Button>
                {u.id !== me?.id ? (
                  <Button size="small" onPress={() => setResetting(u)}>
                    {t('users.resetPassword')}
                  </Button>
                ) : null}
                {u.hasPin ? (
                  <Button size="small" onPress={() => setClearingPin(u)}>
                    {t('users.clearPin')}
                  </Button>
                ) : null}
                {u.id === me?.id ? null : u.active ? (
                  <Button size="small" variant="danger" onPress={() => setDeactivating(u)}>
                    {t('users.deactivate')}
                  </Button>
                ) : (
                  <Button size="small" onPress={() => void run(() => call(Admin.reactivateUser, { userId: u.id }), { success: t('users.reactivated'), invalidate: [USERS] })}>
                    {t('users.reactivate')}
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      <CreateUserDialog isOpen={creating} onOpenChange={setCreating} onCreated={(login, password) => setTemp({ login, password })} />
      <TempPasswordDialog value={temp} onClose={() => setTemp(null)} />
      <EditUserDialog user={editing} onClose={() => setEditing(null)} />
      <Modal isOpen={resetting !== null} onOpenChange={(o) => !o && setResetting(null)} title={t('users.resetPassword')}>
        <p>{t('users.resetExplain', { name: resetting?.displayName ?? '' })}</p>
        <DialogActions>
          <Button onPress={() => setResetting(null)}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            onPress={async () => {
              const u = resetting!;
              const r = await run(() => call(Admin.resetUserPassword, { userId: u.id }), { invalidate: [USERS] });
              setResetting(null);
              if (r) setTemp({ login: u.login, password: r.temporaryPassword });
            }}
          >
            {t('users.resetPassword')}
          </Button>
        </DialogActions>
      </Modal>
      <ConfirmDestructive
        isOpen={deactivating !== null}
        onOpenChange={(o) => !o && setDeactivating(null)}
        title={t('users.deactivate')}
        description={t('users.deactivateExplain', { name: deactivating?.displayName ?? '' })}
        confirmText={deactivating?.login ?? ''}
        actionLabel={t('users.deactivate')}
        onConfirm={async () => {
          await call(Admin.deactivateUser, { userId: deactivating!.id });
          await invalidate();
          showToast({ message: t('users.deactivatedToast'), kind: 'success' });
        }}
      />
      <ConfirmDestructive
        isOpen={clearingPin !== null}
        onOpenChange={(o) => !o && setClearingPin(null)}
        title={t('users.clearPin')}
        description={t('users.clearPinExplain', { name: clearingPin?.displayName ?? '' })}
        confirmText={clearingPin?.login ?? ''}
        actionLabel={t('users.clearPin')}
        onConfirm={async () => {
          await call(Admin.clearUserPin, { userId: clearingPin!.id });
          await invalidate();
          showToast({ message: t('users.pinCleared'), kind: 'success' });
        }}
      />
    </main>
  );
}
