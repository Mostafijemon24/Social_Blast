'use client';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { AuthCard, PasswordFields } from '@/components/auth-card';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';

export default function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [email, setEmail] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ email: string }>('/api/auth/reset', { headers: { 'x-token': token } })
      .then((r) => setEmail(r.email))
      .catch((e) => setLoadErr((e as Error).message));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setErr('Passwords don’t match.'); return; }
    setBusy(true); setErr(null);
    try { await api('/api/auth/reset', { method: 'POST', json: { token, password } }); window.location.replace('/content'); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  if (loadErr) {
    return <AuthCard title="Link unavailable" subtitle={loadErr} footer={<p className="mt-4 text-center text-[13px]"><Link href="/forgot">Request a new link</Link></p>}>{null}</AuthCard>;
  }
  return (
    <AuthCard title="Choose a new password" subtitle={email ? <>For <strong className="text-text">{email}</strong>. You&apos;ll be signed out on every other device.</> : 'Checking your link…'}>
      {email && (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <PasswordFields password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} />
          {err && <p role="alert" className="m-0 text-[13px] text-danger-text">{err}</p>}
          <Button type="submit" variant="primary" size="lg" loading={busy}>Save password and sign in</Button>
        </form>
      )}
    </AuthCard>
  );
}
