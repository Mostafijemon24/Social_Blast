'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from './app-context';
import { AddClientModal } from './add-client';
import { GenerateWizard } from './wizard';
import { Button, Icon, Segmented, cx } from './ui';
import { useApi } from '@/lib/api';
import { initials } from '@/lib/format';

const NAV = [
  { href: '/overview', label: 'Overview', icon: 'ph ph-gauge' },
  { href: '/content', label: 'Content', icon: 'ph ph-pen-nib', count: true },
  { href: '/calendar', label: 'Calendar', icon: 'ph ph-calendar-dots' },
  { href: '/automations', label: 'Automations', icon: 'ph ph-robot' },
  { href: '/contacts', label: 'Contacts', icon: 'ph ph-address-book' },
  { href: '/settings', label: 'Settings', icon: 'ph ph-gear-six' },
];

function titles(path: string, clientName: string): [string, string] {
  const map: Record<string, [string, string]> = {
    '/overview': ['Overview', 'Your workspace at a glance'],
    '/content': ['Content', 'AI Content Studio · ' + clientName],
    '/calendar': ['Calendar', 'Scheduled publishing · ' + clientName],
    '/automations': ['Automations', 'Evergreen & engagement'],
    '/contacts': ['Contacts', 'Leads & conversations'],
    '/settings': ['Settings', 'Connections & workspace'],
    '/website': ['Website Intelligence', 'Knowledge library · ' + clientName],
    '/admin': ['Super Admin', 'Platform operations'],
  };
  return map['/' + path.split('/')[1]] ?? map['/overview']!;
}

function navCls(active: boolean) {
  return cx(
    'my-[2px] flex w-full cursor-pointer items-center gap-[11px] rounded-[9px] border-none px-3 py-[9px] font-sans text-sm',
    active ? 'bg-accent-subtle font-semibold text-accent-text shadow-[inset_2px_0_0_var(--color-accent)] hover:text-accent-text' : 'bg-transparent font-medium text-muted hover:bg-surface-2 hover:text-text',
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { client, clients, setClientId, theme, toggleTheme, emptyPreview, version, user, signOut } = useApp();
  const path = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const { data } = useApi<{ contentCount: number }>(client ? `/api/clients/${client.id}/overview` : null, version);
  const count = emptyPreview ? 0 : data?.contentCount ?? 0;

  return (
    <aside className="sticky top-0 flex h-screen w-[264px] flex-none flex-col border-r border-border bg-surface">
      <div className="flex h-[60px] items-center gap-[10px] border-b border-border px-5">
        <div className="flex h-[30px] w-[30px] items-center justify-center rounded-md bg-accent text-[17px] text-on-accent"><Icon name="ph-fill ph-paper-plane-tilt" /></div>
        <div className="text-base font-bold tracking-[-.01em]">Social Blast</div>
      </div>

      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        aria-haspopup="listbox"
        aria-label={`Active client: ${client?.name ?? 'loading'}. Switch client`}
        className="m-3 flex cursor-pointer items-center gap-[10px] rounded-[10px] border border-border bg-bg px-3 py-[10px] text-left text-text"
      >
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-accent-subtle text-xs font-bold text-accent-text">{client?.initials ?? '··'}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{client?.name ?? 'Loading…'}</div>
          <div className="text-xs font-normal text-muted">{client?.loc ?? ' '}</div>
        </div>
        <Icon name="ph ph-caret-up-down" className="text-base text-muted" />
      </button>

      {menuOpen && (
        <div role="listbox" aria-label="Clients" className="mx-3 -mt-1 mb-2 animate-sb-fade-fast overflow-hidden rounded-[10px] border border-border bg-bg shadow-pop">
          {clients.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={c.id === client?.id}
              onClick={() => { setClientId(c.id); setMenuOpen(false); router.replace(path); /* drop ?post= from another client */ }}
              className={cx('flex w-full cursor-pointer items-center gap-[10px] border-none px-3 py-[9px] font-sans text-text', c.id === client?.id ? 'bg-accent-subtle' : 'bg-transparent hover:bg-surface')}
            >
              <div className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] bg-accent-subtle text-[11px] font-bold text-accent-text">{c.initials}</div>
              <div className="flex-1 text-left"><div className="text-[13px] font-semibold leading-[18px]">{c.name}</div><div className="text-[11px] leading-4 text-muted">{c.accounts} accounts</div></div>
              {c.id === client?.id && <Icon name="ph ph-check" className="text-base text-accent-text" />}
            </button>
          ))}
          <button type="button" onClick={() => { setMenuOpen(false); setAddOpen(true); }} className="flex w-full cursor-pointer items-center gap-2 border-0 border-t border-border bg-transparent px-3 py-[10px] font-sans text-[13px] font-semibold text-accent-text">
            <Icon name="ph ph-plus" /> Add client
          </button>
        </div>
      )}
      <AddClientModal open={addOpen} onClose={() => setAddOpen(false)} />

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-1">
        {NAV.map((n) => {
          const active = path.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={navCls(active)}>
              <Icon name={n.icon} className="text-[19px]" />
              <span className="flex-1 text-left">{n.label}</span>
              {n.count && count > 0 && <span className="rounded-pill bg-surface-2 px-[7px] py-px text-[11px] font-semibold text-muted">{count}<span className="sr-only"> in progress</span></span>}
            </Link>
          );
        })}
        <div className="mx-2 mb-[6px] mt-4 text-[11px] font-semibold uppercase tracking-[.04em] text-subtle">Workspace</div>
        <Link href="/website" onClick={onNavigate} aria-current={path.startsWith('/website') ? 'page' : undefined} className={navCls(path.startsWith('/website'))}>
          <Icon name="ph ph-globe-hemisphere-west" className="text-[19px]" /><span className="flex-1 text-left">Website Intelligence</span>
        </Link>
        {user?.isPlatformAdmin && (
          <Link href="/admin" onClick={onNavigate} aria-current={path.startsWith('/admin') ? 'page' : undefined} className={navCls(path.startsWith('/admin'))}>
            <Icon name="ph ph-shield-check" className="text-[19px]" /><span className="flex-1 text-left">Super Admin</span>
            <span className="rounded-pill bg-warning-subtle px-[6px] py-[2px] text-[10px] font-bold leading-3 text-warning-text">DEV</span>
          </Link>
        )}
      </nav>

      <div className="flex items-center gap-[10px] border-t border-border p-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-pill bg-surface-2 text-xs font-semibold text-muted">{user ? initials(user.name) : '··'}</div>
        <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold leading-[18px]">{user?.name ?? '\u00a0'}</div><div className="text-[11px] capitalize leading-4 text-muted">{user ? `${user.role}${user.isPlatformAdmin ? ' · operator' : ''}` : '\u00a0'}</div></div>
        <button type="button" onClick={signOut} title="Sign out" aria-label="Sign out" className="flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-md border border-border bg-bg text-[17px] text-muted hover:text-text">
          <Icon name="ph ph-sign-out" />
        </button>
        <button type="button" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme" className="flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-md border border-border bg-bg text-[17px] text-muted">
          <Icon name={theme === 'dark' ? 'ph ph-sun' : 'ph ph-moon'} />
        </button>
      </div>
    </aside>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[80] flex w-[380px] max-w-[calc(100vw-32px)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'danger' ? 'alert' : 'status'}
          className="pointer-events-auto flex animate-sb-fade items-start gap-[10px] rounded-lg border border-border bg-bg px-4 py-3 shadow-pop"
        >
          <Icon
            name={t.tone === 'success' ? 'ph-fill ph-check-circle' : t.tone === 'danger' ? 'ph-fill ph-warning-circle' : 'ph-fill ph-info'}
            className={cx('mt-[2px] text-lg', t.tone === 'success' ? 'text-success' : t.tone === 'danger' ? 'text-danger' : 'text-accent')}
          />
          <div className="flex-1 text-[13px] leading-5">{t.text}</div>
          <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="cursor-pointer border-none bg-transparent text-muted"><Icon name="ph ph-x" /></button>
        </div>
      ))}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { client, emptyPreview, setEmptyPreview, openWizard } = useApp();
  const path = usePathname();
  const [mobileNav, setMobileNav] = useState(false);
  const [pageTitle, pageSub] = titles(path, client?.name ?? '');
  useEffect(() => setMobileNav(false), [path]);

  return (
    <div className="flex min-h-screen bg-bg font-sans text-text">
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="max-lg:hidden"><Sidebar /></div>
      {mobileNav && (
        <div className="fixed inset-0 z-[70] flex bg-[rgba(16,24,40,.45)] lg:hidden" onClick={() => setMobileNav(false)}>
          <div onClick={(e) => e.stopPropagation()} className="animate-sb-fade-fast"><Sidebar onNavigate={() => setMobileNav(false)} /></div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[5] flex h-[60px] flex-none items-center gap-4 border-b border-border bg-bg px-6 max-sm:gap-2 max-sm:px-4">
          <button type="button" aria-label="Open menu" onClick={() => setMobileNav(true)} className="hidden h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border bg-bg text-lg text-muted max-lg:flex">
            <Icon name="ph ph-list" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="m-0 truncate text-base font-bold leading-6 tracking-[-.01em]">{pageTitle}</h1>
            <div className="truncate text-xs font-normal text-muted">{pageSub}</div>
          </div>
          <div className="max-md:hidden">
            <Segmented
              label="Data preview"
              value={emptyPreview ? 'empty' : 'demo'}
              onChange={(v) => setEmptyPreview(v === 'empty')}
              options={[{ value: 'demo', label: 'Demo data' }, { value: 'empty', label: 'Empty' }]}
            />
          </div>
          <Button variant="primary" icon="ph ph-sparkle" onClick={openWizard} className="max-sm:px-3">
            <span className="max-sm:sr-only">Generate posts</span>
          </Button>
        </header>

        <main id="main" className="w-full max-w-[1400px] flex-1 overflow-y-auto px-8 py-7 max-md:px-4 max-md:py-5">
          {client ? children : null}
        </main>
      </div>

      <GenerateWizard />
      <Toasts />
    </div>
  );
}
