import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { log, q, uid } from './db';
import { ApiError } from './errors';

/**
 * Sends email over SMTP when SMTP_HOST is set. Otherwise the message is kept
 * in the outbox (Super Admin → Email outbox) and the caller gets status
 * "outbox" so it can show the link to the admin instead. Nothing pretends to
 * have been delivered.
 */
export type MailStatus = 'sent' | 'outbox' | 'failed';

export function smtpConfigured(): boolean {
  return !!process.env.SMTP_HOST;
}

let transport: Transporter | null = null;
function smtp(): Transporter {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<MailStatus> {
  const id = uid('em');
  const now = new Date().toISOString();
  let status: MailStatus = 'outbox';
  let error: string | null = null;
  if (smtpConfigured()) {
    try {
      await smtp().sendMail({ from: process.env.SMTP_FROM || 'Social Blast <no-reply@localhost>', to, subject, text, html });
      status = 'sent';
    } catch (e) {
      status = 'failed';
      error = (e as Error).message.slice(0, 300);
      void log('ERROR', `email.failed id=${id} reason=${error}`);
    }
  }
  await q.run('INSERT INTO emails (id,to_addr,subject,body,status,error,created_at) VALUES (?,?,?,?,?,?,?)', id, to, subject, text, status, error, now);
  void log('INFO', `email.${status} id=${id} subject="${subject}"`);
  return status;
}

/**
 * Base URL for links in emails. APP_URL is required in production so a forged
 * Host header can't redirect reset links to an attacker's site.
 */
export function appUrl(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') throw new ApiError(500, 'Set APP_URL on the server (e.g. https://app.example.com) so email links point to the right address.');
  return new URL(req.url).origin;
}

export async function recentEmails(limit = 20) {
  return (await q.all('SELECT * FROM emails ORDER BY created_at DESC LIMIT ?', limit)).map((r) => ({
    id: String(r.id), to: String(r.to_addr), subject: String(r.subject), body: String(r.body), status: String(r.status) as MailStatus, error: (r.error as string) ?? null, createdAt: String(r.created_at),
  }));
}
