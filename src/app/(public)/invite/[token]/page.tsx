'use client';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { AuthCard, PasswordFields } from '@/components/auth-card';
import { Button, inputCls } from '@/components/ui';
import { api } from '@/lib/api';

interface Invite { email: string; name: string; role: string; invitedBy: string }

export default function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ invite: Invite }>('/api/invites/accept', { headers: { 'x-token': token } })
      .then((r) => { setInvite(r.invite); setName(r.invite.name); })
      .catch((e) => setLoadErr((e as Error).message));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setErr('Passwords don’t match.'); return; }
    setBusy(true); setErr(null);
    try { await api('/api/invites/accept', { method: 'POST', json: { token, name, password } }); window.location.replace('/content'); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  if (loadErr) {
    return <AuthCard title="Invitation unavailable" subtitle={loadErr} footer={<p className="mt-4 text-center text-[13px]"><Link href="/login">Go to sign in</Link></p>}>{null}</AuthCard>;
  }
  return (
    <AuthCard title="Join the workspace" subtitle={invite ? <>{invite.invitedBy} invited <strong className="text-text">{invite.email}</strong> as <strong className="text-text">{invite.role}</strong>. Choose a password to finish.</> : 'Checking your invitation…'}>
      {invite && (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Your name
            <input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls + ' h-10 px-3'} />
          </label>
          <PasswordFields password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} />
          {err && <p role="alert" className="m-0 text-[13px] text-danger-text">{err}</p>}
          <Button type="submit" variant="primary" size="lg" loading={busy}>Accept and sign in</Button>
        </form>
      )}
    </AuthCard>
  );
}
