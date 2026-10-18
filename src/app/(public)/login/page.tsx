'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button, Icon, inputCls } from '@/components/ui';
import { api } from '@/lib/api';
import type { SessionUser } from '@/lib/types';

interface Me { user: SessionUser | null; setupRequired: boolean; demo: { email: string; password: string } | null }

function safeNext(raw: string | null): string {
  // Only allow same-site paths, never an absolute URL (open-redirect guard).
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/content';
}

function LoginForm() {
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [me, setMe] = useState<Me | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = localStorage.getItem('sb.theme');
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
    api<Me>('/api/auth/me').then((m) => {
      if (m.user) window.location.replace(next);
      else setMe(m);
    }).catch((e) => setErr((e as Error).message));
  }, [next]);

  const setup = !!me?.setupRequired;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', json: setup ? { email, password, name } : { email, password } });
      window.location.replace(next);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 font-sans text-text">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-[10px]">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-xl text-on-accent"><Icon name="ph-fill ph-paper-plane-tilt" /></div>
          <div className="text-xl font-bold tracking-[-.01em]">Social Blast</div>
        </div>
        <form onSubmit={submit} className="rounded-xl border border-border bg-bg p-6 shadow-card">
          <h1 className="m-0 text-lg font-bold">{setup ? 'Create the owner account' : 'Sign in'}</h1>
          <p className="mb-5 mt-1 text-[13px] text-muted">
            {setup ? 'No accounts exist yet. This first account becomes the workspace owner and platform operator.' : 'Use your workspace email and password.'}
          </p>
          <div className="flex flex-col gap-4">
            {setup && (
              <label className="flex flex-col gap-1 text-[13px] font-medium">Your name
                <input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls + ' h-10 px-3'} />
              </label>
            )}
            <label className="flex flex-col gap-1 text-[13px] font-medium">Email
              <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls + ' h-10 px-3'} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">Password
              <input required type="password" minLength={setup ? 10 : undefined} autoComplete={setup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls + ' h-10 px-3'} />
              {setup && <span className="text-xs font-normal text-muted">At least 10 characters.</span>}
            </label>
            {err && <p role="alert" className="m-0 text-[13px] text-danger-text"><Icon name="ph-fill ph-warning-circle" /> {err}</p>}
            {!setup && <Link href="/forgot" className="-mt-2 text-[13px] font-semibold">Forgot password?</Link>}
            <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!me}>{setup ? 'Create account' : 'Sign in'}</Button>
          </div>
        </form>
        {me?.demo && (
          <div className="mt-4 rounded-lg border border-border bg-bg p-4 text-[13px] text-muted">
            <div className="mb-1 font-semibold text-text">Demo workspace</div>
            <div>Email: <span className="font-mono text-text">{me.demo.email}</span></div>
            <div>Password: <span className="font-mono text-text">{me.demo.password}</span></div>
            <button type="button" onClick={() => { setEmail(me.demo!.email); setPassword(me.demo!.password); }} className="mt-2 cursor-pointer border-none bg-transparent p-0 font-sans text-[13px] font-semibold text-accent-text">Fill in demo login</button>
            <div className="mt-2 text-xs text-subtle">Shown only outside production.</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
