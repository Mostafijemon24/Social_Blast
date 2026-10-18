'use client';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { StatusTone } from '@/lib/types';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

export function Icon({ name, className, label }: { name: string; className?: string; label?: string }) {
  return <i className={cx(name, className)} aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined} />;
}

// ---------------------------------------------------------------- Badge
const TONE: Record<StatusTone, string> = {
  draft: 'text-status-draft-text bg-status-draft-bg',
  scheduled: 'text-status-scheduled-text bg-status-scheduled-bg',
  published: 'text-status-published-text bg-status-published-bg',
  failed: 'text-status-failed-text bg-status-failed-bg',
  pending: 'text-status-pending-text bg-status-pending-bg',
};

/** Maps any post/job status to one of the five badge tones. */
export function toneOf(status: string): StatusTone {
  if (status in TONE) return status as StatusTone;
  if (status === 'publishing') return 'scheduled';
  if (status === 'cancelled') return 'draft';
  return 'draft';
}

export function Badge({ tone, children, className }: { tone: StatusTone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center whitespace-nowrap rounded-pill px-[9px] py-[2px] text-[11px] font-medium leading-4', TONE[tone], className)}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- Buttons
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'link';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover border-none',
  secondary: 'bg-bg text-text border border-border hover:bg-surface',
  ghost: 'bg-transparent text-muted hover:text-text border-none',
  link: 'bg-transparent text-accent-text hover:text-accent-hover border-none px-0 h-auto',
};

export function Button({
  variant = 'secondary', size = 'md', loading, icon, children, className, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: string }) {
  const h = variant === 'link' ? '' : size === 'sm' ? 'h-[34px] px-[14px] text-[13px]' : size === 'lg' ? 'h-[42px] px-4 text-sm' : 'h-10 px-4 text-sm';
  return (
    <button
      type="button"
      aria-busy={loading || undefined}
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md font-semibold font-sans cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        BTN[variant], h, className,
      )}
    >
      {loading ? <Icon name="ph ph-circle-notch" className="animate-spin text-base" /> : icon ? <Icon name={icon} className="text-base" /> : null}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Card
export function Card({ children, className, as: As = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' }) {
  return <As className={cx('rounded-lg border border-border bg-bg shadow-card', className)}>{children}</As>;
}

// ---------------------------------------------------------------- Switch
export function Switch({ on, onChange, label, size = 'md', disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; size?: 'sm' | 'md'; disabled?: boolean }) {
  const track = size === 'md' ? 'w-11 h-6' : 'w-10 h-[22px]';
  const knob = size === 'md' ? 'w-5 h-5' : 'w-[18px] h-[18px]';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx('flex flex-none cursor-pointer rounded-pill border-none p-[2px] transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50', track, on ? 'justify-end bg-accent' : 'justify-start bg-surface-2')}
    >
      <span className={cx('block rounded-pill bg-white shadow-xs', knob)} />
    </button>
  );
}

// ---------------------------------------------------------------- Segmented / tabs
export function Segmented<T extends string>({ value, options, onChange, size = 'sm', label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md'; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex items-center gap-[3px] rounded-[9px] bg-surface-2 p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'cursor-pointer rounded-[7px] border-none px-3 font-sans text-[13px] font-semibold',
            size === 'sm' ? 'h-[30px]' : 'h-[34px] px-[14px]',
            value === o.value ? 'bg-bg text-text shadow-xs' : 'bg-transparent text-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function UnderlineTabs<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="mb-5 flex gap-2 overflow-x-auto border-b border-border">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            '-mb-px h-10 cursor-pointer whitespace-nowrap border-0 border-b-2 bg-transparent px-1 font-sans text-sm',
            value === o.value ? 'border-accent font-semibold text-text' : 'border-transparent font-medium text-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Overlays
function useOverlay(open: boolean, onClose: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0]!, last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => panel.current?.querySelector<HTMLElement>('[data-autofocus],button,input')?.focus(), 30);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); opener?.focus?.(); };
  }, [open, onClose]);
  return panel;
}

export function Modal({ open, onClose, labelledBy, width = 560, children }: { open: boolean; onClose: () => void; labelledBy: string; width?: number; children: ReactNode }) {
  const panel = useOverlay(open, onClose);
  if (!open) return null;
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex animate-sb-fade items-center justify-center bg-[rgba(16,24,40,.45)] p-6 max-sm:p-3">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
        style={{ width }}
        className="flex max-h-[88vh] max-w-full flex-col overflow-hidden rounded-xl bg-bg shadow-pop"
      >
        {children}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, labelledBy, children }: { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode }) {
  const panel = useOverlay(open, onClose);
  if (!open) return null;
  return (
    <div onClick={onClose} className="fixed inset-0 z-[60] flex animate-sb-fade justify-end bg-[rgba(16,24,40,.45)]">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
        className="flex h-screen w-[560px] max-w-full flex-col bg-bg shadow-pop"
      >
        {children}
      </div>
    </div>
  );
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Close" className="flex h-8 w-8 cursor-pointer items-center justify-center border-none bg-transparent text-xl text-muted hover:text-text">
      <Icon name="ph ph-x" />
    </button>
  );
}

// ---------------------------------------------------------------- States
export function EmptyState({ icon, title, body, action, compact }: { icon: string; title: string; body: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx('text-center', compact ? 'px-5 py-10 text-muted' : 'rounded-lg border border-border bg-bg px-5 py-16')}>
      <Icon name={icon} className={cx(compact ? 'text-[34px]' : 'text-[40px] text-muted', 'opacity-60')} />
      <h3 className={cx('m-0 font-semibold text-text', compact ? 'mt-[10px] text-sm' : 'mt-3 text-base')}>{title}</h3>
      <p className="mx-auto mt-1 mb-0 max-w-[360px] text-[13px] leading-5 text-muted">{body}</p>
      {action && <div className={compact ? 'mt-[14px]' : 'mt-4'}>{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-lg border border-danger-subtle bg-bg px-4 py-3 text-[13px] text-danger-text">
      <Icon name="ph-fill ph-warning-circle" className="text-lg" />
      <span className="flex-1">{message}</span>
      {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-sb-shim rounded-md bg-[linear-gradient(90deg,var(--color-surface),var(--color-surface-2),var(--color-surface))] bg-[length:200%_100%]', className)} />;
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-12" />)}
    </div>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx('m-0 text-[15px] font-semibold leading-[22px]', className)}>{children}</h2>;
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th scope="col" className={cx('px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[.03em] text-muted', className)}>{children}</th>;
}

export const inputCls = 'w-full rounded-md border border-border-input bg-bg font-sans text-sm text-text placeholder:text-subtle focus:border-accent';
