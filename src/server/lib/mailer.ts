import nodemailer from 'nodemailer';
import type { Config } from '../config.ts';
import type { AppDeps } from './context.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Outgoing mail. Injected through AppDeps so tests use a fake transport (D-015). */
export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

/**
 * SMTP transport options. Port 465 uses implicit TLS; any other port must upgrade with STARTTLS
 * (`requireTLS`), so an on-path attacker cannot strip STARTTLS and read the SMTP credentials or the
 * reset links. Certificate verification stays on (nodemailer default `rejectUnauthorized: true`).
 */
export function smtpTransportOptions(config: Config) {
  const secure = config.SMTP_PORT === 465;
  return {
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure,
    requireTLS: !secure,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' as const },
    ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } } : {}),
  };
}

/** Real SMTP mailer, created only when SMTP_HOST is configured. */
export function createSmtpMailer(config: Config): Mailer {
  const transport = nodemailer.createTransport(smtpTransportOptions(config));
  return {
    async send(msg) {
      await transport.sendMail({ from: config.SMTP_FROM || config.SMTP_USER, to: msg.to, subject: msg.subject, text: msg.text });
    },
  };
}

/** Email password reset is offered only when SMTP is configured and a mailer exists (D-015). */
export const emailResetEnabled = (deps: Pick<AppDeps, 'config' | 'mailer'>) => Boolean(deps.config.smtpEnabled && deps.mailer);
