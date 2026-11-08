/**
 * Accounts (ACC-2, ACC-3, DAT-3): create with a single-use invite link (S13b, D-108) or a one-time
 * temporary password, edit, deactivate, reset, clear PIN; new or revoked invites; the sign-in method.
 */
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
import { QrCode } from '../teacher/StudentLinks.tsx';
import { ADMIN } from './Admin.tsx';

type AdminUser = z.infer<typeof Admin.AdminUser>;
type Invite = z.infer<typeof Admin.InviteOut> & { name: string };
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

/** Shows a new invite link once: copy, QR code, whether it was emailed, and when it expires. */
function InviteDialog({ value, onClose }: { value: Invite | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const until = value ? new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(value.expiresAt) : '';
  return (
    <Modal isOpen={value !== null} onOpenChange={(open) => !open && onClose()} title={t('users.inviteTitle')} dismissable={false}>
      <Alert kind={value?.emailed ? 'success' : 'warning'}>{value?.emailed ? t('users.inviteEmailed', { name: value.name }) : t('users.inviteNotEmailed', { name: value?.name ?? '' })}</Alert>
      <p className="cc-muted">{t('users.inviteExpires', { when: until })}</p>
      <output className="cc-invite-link" data-testid="invite-link">
        {value?.link}
      </output>
      {value ? (
        <div className="cc-invite-qr">
          <QrCode text={value.link} label={t('users.inviteQr', { name: value.name })} />
        </div>
      ) : null}
      <DialogActions>
        <Button
          onPress={async () => {
            try {
              await navigator.clipboard.writeText(value?.link ?? '');
              showToast({ message: t('users.copied'), kind: 'success' });
            } catch {
              showToast({ message: t('users.copyLinkFailed'), kind: 'error' });
            }
          }}
        >
          <IconCopy />
          {t('users.copyLink')}
        </Button>
        <Button variant="primary" onPress={onClose}>
          {t('users.inviteDone')}
        </Button>
      </DialogActions>
    </Modal>
  );
}

const LOCALE_ITEMS = (t: ReturnType<typeof useI18n>['t']) => [
  { id: 'en', label: t('language.en') },
  { id: 'tr', label: t('language.tr') },
];

function CreateUserDialog({ isOpen, onOpenChange, onCreated }: { isOpen: boolean; onOpenChange: (v: boolean) => void; onCreated: (r: z.infer<typeof Admin.createUserByAdmin.output>) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'teacher' | 'admin'>('teacher');
  // Required, visible choice, preselected to English (owner decision ACCOUNT CREATION, D-102).
  const [locale, setLocale] = useState<'en' | 'tr'>('en');
  const [setup, setSetup] = useState<'invite' | 'temporary_password'>('invite');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} title={t('users.create')}>
      <form
        className="cc-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            const r = await call(Admin.createUserByAdmin, { login, displayName: name, email: email.trim() || null, role, locale, setup });
            void qc.invalidateQueries({ queryKey: USERS });
            setLogin('');
            setName('');
            setEmail('');
            setLocale('en');
            setSetup('invite');
            onOpenChange(false);
            onCreated(r);
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
        <Select label={t('users.locale')} description={t('users.localeHint')} value={locale} onChange={(v) => setLocale(v === 'tr' ? 'tr' : 'en')} items={LOCALE_ITEMS(t)} />
        <Select
          label={t('users.setup')}
          description={setup === 'invite' ? t('users.setupInviteHint') : t('users.setupTempHint')}
          value={setup}
          onChange={(v) => setSetup(v === 'temporary_password' ? 'temporary_password' : 'invite')}
          items={[
            { id: 'invite', label: t('users.setupInvite') },
            { id: 'temporary_password', label: t('users.setupTemp') },
          ]}
        />
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
  const [invite, setInvite] = useState<Invite | null>(null);
  const [revoking, setRevoking] = useState<AdminUser | null>(null);
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
        stack
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
                {/* One status: an account whose invite is still open is not "Active" yet. */}
                {u.active && u.invitePending ? (
                  <span className="cc-chip cc-chip--warning">{t('users.invitePending')}</span>
                ) : u.active ? (
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
                {u.role === 'teacher' || u.hasPin ? <span className="cc-chip">{u.hasPin ? t('users.pinSet') : t('users.pinNotSet')}</span> : null}
                {u.mustChangePassword ? <span className="cc-chip cc-chip--warning">{t('users.mustChange')}</span> : null}
                {!u.active && u.invitePending ? <span className="cc-chip cc-chip--warning">{t('users.invitePending')}</span> : null}
                <span className="cc-chip">{u.signInMethod === 'email_link' ? t('users.methodEmail') : t('users.methodPassword')}</span>
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
                {u.id !== me?.id && u.active ? (
                  <Button
                    size="small"
                    onPress={async () => {
                      const r = await run(() => call(Admin.inviteUser, { userId: u.id }), { invalidate: [USERS] });
                      if (r) setInvite({ ...r.invite, name: u.displayName });
                    }}
                  >
                    {t('users.newInvite')}
                  </Button>
                ) : null}
                {u.invitePending ? (
                  <Button size="small" onPress={() => setRevoking(u)}>
                    {t('users.revokeInvite')}
                  </Button>
                ) : null}
                {u.hasPin ? (
                  <Button size="small" onPress={() => setClearingPin(u)}>
                    {t('users.clearPin')}
                  </Button>
                ) : null}
                {u.id === me?.id ? null : u.active ? (
                  <Button size="small" variant="danger-outline" onPress={() => setDeactivating(u)}>
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
      <CreateUserDialog
        isOpen={creating}
        onOpenChange={setCreating}
        onCreated={(r) => {
          if (r.invite) setInvite({ ...r.invite, name: r.user.displayName });
          else if (r.temporaryPassword) setTemp({ login: r.user.login, password: r.temporaryPassword });
        }}
      />
      <InviteDialog value={invite} onClose={() => setInvite(null)} />
      <Modal isOpen={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)} title={t('users.revokeInvite')}>
        <p>{t('users.revokeExplain', { name: revoking?.displayName ?? '' })}</p>
        <DialogActions>
          <Button onPress={() => setRevoking(null)}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            onPress={async () => {
              const u = revoking!;
              await run(() => call(Admin.revokeUserInvite, { userId: u.id }), { success: t('users.inviteRevoked'), invalidate: [USERS] });
              setRevoking(null);
            }}
          >
            {t('users.revokeInvite')}
          </Button>
        </DialogActions>
      </Modal>
      <TempPasswordDialog value={temp} onClose={() => setTemp(null)} />
      <EditUserDialog user={editing} onClose={() => setEditing(null)} />
      <Modal isOpen={resetting !== null} onOpenChange={(o) => !o && setResetting(null)} title={t('users.resetPassword')}>
        <p>{t(resetting?.signInMethod === 'email_link' ? 'users.resetExplainEmail' : 'users.resetExplain', { name: resetting?.displayName ?? '' })}</p>
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
