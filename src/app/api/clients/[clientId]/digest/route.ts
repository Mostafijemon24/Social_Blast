import { route } from '@/server/http';
import { buildDigest } from '@/server/automations';
import { sendMail } from '@/server/mailer';

/** Preview the weekly digest (GET) or send a test copy to yourself (POST). */
export const GET = route<{ clientId: string }>(async (_r, p) => buildDigest(p.clientId));
export const POST = route<{ clientId: string }>(async (_r, p, user) => {
  const d = await buildDigest(p.clientId);
  return { delivery: await sendMail(user.email, `[Test] ${d.subject}`, d.text, d.html), to: user.email };
});
