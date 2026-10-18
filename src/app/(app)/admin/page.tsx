'use client';
import { useState } from 'react';
import { useApp } from '@/components/app-context';
import { Badge, Card, ErrorState, Icon, Loading, SectionTitle, cx } from '@/components/ui';
import { relativeTime } from '@/lib/time';
import { useApi } from '@/lib/api';
import { money } from '@/lib/format';

interface Q { value: number; health: string; tone: 'success' | 'warning' }
interface Admin {
  queues: { crawl: Q; content: Q; replies: Q; publish: Q };
  usage: { name: string; usedCents: number; budgetCents: number }[];
  logs: { at: string; level: string; msg: string }[];
  emails: { id: string; to: string; subject: string; body: string; status: 'sent' | 'outbox' | 'failed'; error: string | null; createdAt: string }[];
  emailConfigured: boolean;
  system: { database: string; storage: string; worker: string };
  health: {
    status: 'ok' | 'degraded' | 'down';
    problems: string[];
    workers: { id: string; host: string; lastBeat: string; ageSec: number; alive: boolean }[];
    backup: { at: string; ok: boolean; error?: string } | null;
    alerts: { email: boolean; webhook: boolean };
  };
}

export default function AdminPage() {
  const { version } = useApp();
  const { data, error, loading, reload } = useApi<Admin>('/api/admin/overview', version);
  const [openEmail, setOpenEmail] = useState<string | null>(null);

  const banner = (
    <div className="mb-5 flex items-center gap-[10px] rounded-[10px] border border-warning-subtle bg-warning-subtle px-4 py-3">
      <Icon name="ph-fill ph-shield-warning" className="text-xl text-warning-text" />
      <div className="text-[13px] text-warning-text"><strong>Developer-controlled.</strong> This panel is isolated from the customer dashboard and requires platform-operator permissions.</div>
    </div>
  );
  if (error) return <div className="animate-sb-fade">{banner}<ErrorState message={error} onRetry={reload} /></div>;
  if (loading && !data) return <div>{banner}<Loading rows={4} /></div>;
  if (!data) return null;

  const queues: [string, string, Q][] = [
    ['ph ph-globe', 'Crawl jobs', data.queues.crawl],
    ['ph ph-sparkle', 'Content jobs', data.queues.content],
    ['ph ph-chat-circle-dots', 'Comment replies', data.queues.replies],
    ['ph ph-paper-plane-tilt', 'Publish jobs', data.queues.publish],
  ];
  const levelColor = (l: string) => (l === 'ERROR' ? 'text-danger-text' : l === 'WARN' ? 'text-warning-text' : 'text-muted');

  return (
    <div className="animate-sb-fade">
      {banner}
      <div className="mb-5 grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
        {queues.map(([icon, label, q]) => (
          <Card key={label} className="p-[18px]">
            <div className="flex items-center gap-2 text-[13px] text-muted"><Icon name={icon} /> {label}</div>
            <div className="mb-[2px] mt-[6px] text-[26px] font-bold leading-8">{q.value}</div>
            <div className={cx('flex items-center gap-[6px] text-xs font-normal', q.tone === 'success' ? 'text-success-text' : 'text-warning-text')}><Icon name="ph-fill ph-circle" className="text-[8px]" /> {q.health}</div>
          </Card>
        ))}
      </div>
      <Card className="mb-4 p-[18px]">
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>System health</SectionTitle>
          <span className={cx('rounded-pill px-3 py-1 text-xs font-semibold', data.health.status === 'ok' ? 'bg-success-subtle text-success-text' : data.health.status === 'degraded' ? 'bg-warning-subtle text-warning-text' : 'bg-danger-subtle text-danger-text')}>
            {data.health.status === 'ok' ? 'All good' : data.health.status === 'degraded' ? 'Needs attention' : 'Down'}
          </span>
        </div>
        {data.health.problems.length > 0 && (
          <ul className="m-0 mb-3 list-none p-0">
            {data.health.problems.map((p) => <li key={p} className="flex gap-2 py-1 text-[13px] text-danger-text"><Icon name="ph ph-warning-circle" className="mt-[2px]" /> {p}</li>)}
          </ul>
        )}
        <div className="grid grid-cols-3 gap-4 text-[13px] max-lg:grid-cols-1">
          <div>
            <div className="mb-1 font-medium">Workers</div>
            {data.health.workers.length === 0 ? <div className="text-muted">None has checked in</div> : data.health.workers.map((w) => (
              <div key={w.id} className="flex items-center gap-2 text-xs"><Icon name="ph-fill ph-circle" className={cx('text-[8px]', w.alive ? 'text-success' : 'text-danger')} /> {w.id} · {w.ageSec < 120 ? `${w.ageSec}s ago` : `${Math.round(w.ageSec / 60)} min ago`}</div>
            ))}
          </div>
          <div>
            <div className="mb-1 font-medium">Last backup</div>
            <div className="text-xs text-muted">{data.health.backup ? `${new Date(data.health.backup.at).toLocaleString()} · ${data.health.backup.ok ? 'OK' : `failed: ${data.health.backup.error}`}` : 'No backup yet (set SB_BACKUP_DIR)'}</div>
          </div>
          <div>
            <div className="mb-1 font-medium">Alerts</div>
            <div className="text-xs text-muted">{data.health.alerts.email || data.health.alerts.webhook ? [data.health.alerts.email && 'email', data.health.alerts.webhook && 'chat webhook'].filter(Boolean).join(' + ') : 'Off — set SB_ALERT_EMAIL or SB_ALERT_WEBHOOK_URL'}</div>
          </div>
        </div>
      </Card>
      <div className="mb-4 text-xs text-muted">
        Database: <strong className="text-text">{data.system.database === 'postgres' ? 'PostgreSQL' : 'SQLite (single server)'}</strong> · Files: <strong className="text-text">{data.system.storage === 's3' ? 'S3 bucket' : 'this server’s disk'}</strong> · Worker: <strong className="text-text">{data.system.worker}</strong>
      </div>
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <Card className="p-[18px]">
          <SectionTitle className="mb-3">AI provider usage</SectionTitle>
          {data.usage.map((u) => {
            const pct = Math.round((u.usedCents / Math.max(1, u.budgetCents)) * 100);
            return (
              <div key={u.name} className="mb-[14px]">
                <div className="mb-[5px] flex justify-between text-[13px]"><span className="font-medium">{u.name}</span><span className="text-muted">{money(u.usedCents)} / {money(u.budgetCents)}</span></div>
                <div className="h-2 overflow-hidden rounded-pill bg-surface-2" role="progressbar" aria-label={`${u.name} budget used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                  <div className={cx('h-full', pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-accent')} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              </div>
            );
          })}
        </Card>
        <Card className="p-[18px]">
          <SectionTitle className="mb-3">System logs</SectionTitle>
          <div className="max-h-[260px] overflow-y-auto font-mono text-xs leading-[19px]">
            {data.logs.map((l, i) => (
              <div key={i} className="flex gap-2 py-[3px]">
                <span className="text-subtle">{new Date(l.at).toLocaleTimeString('en-GB', { hour12: false })}</span>
                <span className={cx('font-semibold', levelColor(l.level))}>{l.level}</span>
                <span className="flex-1 break-all text-muted">{l.msg}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card className="mt-4 p-[18px]">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle>Email outbox</SectionTitle>
          <span className="text-xs text-muted">{data.emailConfigured ? 'SMTP configured — emails are delivered' : 'SMTP not configured — emails are held here, not delivered'}</span>
        </div>
        {data.emails.length === 0 ? <p className="m-0 text-[13px] text-muted">No emails yet. Invitations and password resets appear here.</p> : (
          <ul className="m-0 list-none p-0">
            {data.emails.map((e) => (
              <li key={e.id} className="border-t border-border py-2 first:border-t-0">
                <button type="button" aria-expanded={openEmail === e.id} onClick={() => setOpenEmail(openEmail === e.id ? null : e.id)} className="flex w-full cursor-pointer items-center gap-3 border-none bg-transparent p-0 text-left font-sans text-text">
                  <Badge tone={e.status === 'sent' ? 'published' : e.status === 'failed' ? 'failed' : 'pending'}>{e.status === 'outbox' ? 'held' : e.status}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[13px]"><strong>{e.subject}</strong> <span className="text-muted">→ {e.to}</span></span>
                  <span className="text-xs text-muted">{relativeTime(e.createdAt)}</span>
                </button>
                {openEmail === e.id && (
                  <pre className="mb-0 mt-2 whitespace-pre-wrap break-all rounded-md bg-surface p-3 font-mono text-xs text-muted">{e.error ? `Error: ${e.error}\n\n` : ''}{e.body || 'Delivered — body not kept for sent emails.'}</pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
