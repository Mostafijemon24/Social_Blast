'use client';
import { useEffect, type ReactNode } from 'react';
import { Icon } from './ui';

/** Centered card used by the sign-in, forgot, invite and reset pages. */
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    try {
      const t = localStorage.getItem('sb.theme');
      if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
    } catch { /* storage unavailable */ }
  }, []);
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10 font-sans text-text">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-[10px]">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-xl text-on-accent"><Icon name="ph-fill ph-paper-plane-tilt" /></div>
          <div className="text-xl font-bold tracking-[-.01em]">Social Blast</div>
        </div>
        <div className="rounded-xl border border-border bg-bg p-6 shadow-card">
          <h1 className="m-0 text-lg font-bold">{title}</h1>
          {subtitle && <p className="mb-5 mt-1 text-[13px] text-muted">{subtitle}</p>}
          {children}
        </div>
        {footer}
      </div>
    </div>
  );
}

export function PasswordFields({ password, confirm, setPassword, setConfirm }: { password: string; confirm: string; setPassword: (v: string) => void; setConfirm: (v: string) => void }) {
  const cls = 'w-full rounded-md border border-border-input bg-bg font-sans text-sm text-text h-10 px-3';
  return (
    <>
      <label className="flex flex-col gap-1 text-[13px] font-medium">New password
        <input required type="password" minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={cls} />
        <span className="text-xs font-normal text-muted">At least 10 characters.</span>
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-medium">Confirm password
        <input required type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={cls} aria-invalid={!!confirm && confirm !== password} />
        {!!confirm && confirm !== password && <span className="text-xs font-normal text-danger-text">Passwords don&apos;t match.</span>}
      </label>
    </>
  );
}
