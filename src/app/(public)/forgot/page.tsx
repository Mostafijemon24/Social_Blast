'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AuthCard } from '@/components/auth-card';
import { Button, Icon, inputCls } from '@/components/ui';
import { api } from '@/lib/api';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await api('/api/auth/forgot', { method: 'POST', json: { email } }); setSent(true); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle={sent ? undefined : 'Enter your account email and we’ll send you a link to choose a new password.'}
      footer={<p className="mt-4 text-center text-[13px]"><Link href="/login">Back to sign in</Link></p>}
    >
      {sent ? (
        <div role="status" className="mt-3 flex gap-3 text-[13px] leading-5">
          <Icon name="ph-fill ph-envelope-simple" className="mt-[2px] text-xl text-accent" />
          <div>If an account exists for <strong>{email}</strong>, a reset link is on its way. It expires in 60 minutes.<br />
            <span className="text-muted">No email? Check spam, or ask a workspace admin to send you a reset link from Settings → Team.</span></div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Email
            <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls + ' h-10 px-3'} />
          </label>
          {err && <p role="alert" className="m-0 text-[13px] text-danger-text">{err}</p>}
          <Button type="submit" variant="primary" size="lg" loading={busy}>Send reset link</Button>
        </form>
      )}
    </AuthCard>
  );
}
