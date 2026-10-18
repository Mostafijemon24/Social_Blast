'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from './app-context';
import { Button, CloseButton, Drawer, Icon, Switch, inputCls } from './ui';
import { api } from '@/lib/api';
import type { Automation, BoostConfig, CommentDmConfig, DigestConfig, EvergreenConfig } from '@/lib/types';

function Step({ n, title, desc, children }: { n?: number; title: string; desc?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        {n && <span className="flex h-[22px] w-[22px] items-center justify-center rounded-pill bg-accent text-xs font-bold text-on-accent">{n}</span>}
        <h3 className="m-0 text-[15px] font-semibold">{title}</h3>
      </div>
      {desc && <p className={'mb-3 mt-0 text-[13px] text-muted ' + (n ? 'ml-[30px]' : '')}>{desc}</p>}
      <div className={n ? 'ml-[30px]' : ''}>{children}</div>
    </div>
  );
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function RuleDrawer({ automation, onClose, onSaved }: { automation: Automation | null; onClose: () => void; onSaved: (a: Automation) => void }) {
  const { client, toast } = useApp();
  const [cfg, setCfg] = useState<Record<string, unknown>>({});
  const [kwInput, setKwInput] = useState('');
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [accounts, setAccounts] = useState<{ id: string; name: string; currency: string; active: boolean }[] | null>(null);
  const [accountsErr, setAccountsErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (automation) { setCfg(structuredClone(automation.config) as Record<string, unknown>); setErr(null); setKwInput(''); }
    if (automation?.kind === 'auto_boost' && client) {
      setAccounts(null); setAccountsErr(null);
      api<{ accounts: { id: string; name: string; currency: string; active: boolean }[] }>(`/api/clients/${client.id}/ad-accounts`)
        .then((r) => setAccounts(r.accounts)).catch((e: Error) => setAccountsErr(e.message));
    }
  }, [automation, client]);

  if (!automation || !client) return null;
  const set = (patch: Record<string, unknown>) => setCfg((c) => ({ ...c, ...patch }));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const out = await api<{ automation: Automation }>(`/api/automations/${automation!.id}`, { method: 'PATCH', json: { config: cfg } });
      toast(`${automation!.name} rule saved.`, 'success');
      onSaved(out.automation);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const out = await api<{ delivery: string; to: string }>(`/api/clients/${client!.id}/digest`, { method: 'POST' });
      toast(out.delivery === 'sent' ? `Test digest sent to ${out.to}.` : out.delivery === 'outbox' ? 'Saved to the email outbox (no mail server set).' : 'Sending failed — check the mail server settings.', out.delivery === 'failed' ? 'danger' : 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setTesting(false);
    }
  }

  let body: ReactNode = null;
  let subtitle = '';
  if (automation.kind === 'comment_dm') {
    subtitle = 'comment-triggered reply & DM';
    const c = cfg as unknown as CommentDmConfig;
    const keywords = c.keywords ?? [];
    const addKw = () => {
      const t = kwInput.trim();
      if (!t) return;
      if (!keywords.includes(t)) set({ keywords: [...keywords, t] });
      setKwInput('');
    };
    const sg = c.safeguards ?? { once: true, window: true, handoff: true };
    body = (
      <>
        <div className="flex items-center gap-[10px] rounded-[10px] bg-accent-subtle px-[14px] py-3">
          <Icon name="ph ph-info" className="text-lg text-accent-text" />
          <div className="flex-1 text-xs font-normal text-accent-text">Supported on Instagram &amp; Facebook where the Messaging API and account type permit. LinkedIn &amp; X don&apos;t allow this — those destinations are disabled.</div>
        </div>

        <Step n={1} title="Trigger — keywords" desc="Fires when a comment on a connected post matches one of these words.">
          <div className="mb-2 flex flex-wrap gap-[6px]">
            {keywords.map((k) => (
              <span key={k} className="inline-flex items-center gap-[6px] rounded-pill bg-accent-subtle px-[10px] py-[5px] text-[13px] font-medium text-accent-text">
                {k}
                <button type="button" aria-label={`Remove ${k}`} onClick={() => set({ keywords: keywords.filter((x) => x !== k) })} className="flex cursor-pointer border-none bg-transparent p-0 text-[13px] text-accent-text"><Icon name="ph ph-x" /></button>
              </span>
            ))}
            {keywords.length === 0 && <span className="text-[13px] text-muted">No keywords yet.</span>}
          </div>
          <div className="flex items-center gap-2 max-sm:flex-wrap">
            <input aria-label="New keyword" value={kwInput} onChange={(e) => setKwInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKw(); } }} placeholder="Add a keyword…" className={inputCls + ' h-[38px] flex-1 px-3'} />
            <Button onClick={addKw} className="h-[38px] px-[14px] text-[13px]">Add</Button>
            <select aria-label="Match type" value={c.match} onChange={(e) => set({ match: e.target.value })} className={inputCls + ' h-[38px] !w-auto px-[10px] text-[13px]'}><option value="contains">Contains</option><option value="exact">Exact</option></select>
          </div>
        </Step>

        <Step n={2} title="Public comment reply" desc="Posted as a visible reply to the comment. Keep it short and human.">
          <textarea aria-label="Public comment reply" rows={2} maxLength={500} value={c.commentReply} onChange={(e) => set({ commentReply: e.target.value })} className={inputCls + ' resize-y px-3 py-[10px] leading-5'} />
        </Step>

        <Step n={3} title="Direct message" desc="Sent privately to the commenter with your offer, link or booking info.">
          <textarea aria-label="Direct message" rows={4} maxLength={1000} value={c.dm} onChange={(e) => set({ dm: e.target.value })} className={inputCls + ' resize-y px-3 py-[10px] leading-5'} />
        </Step>

        <Step n={4} title="Lead capture" desc="Each responder is saved to Contacts with this tag and the post's campaign.">
          <div className="flex flex-wrap items-center gap-[10px]">
            <select aria-label="Lead tag" value={c.tag} onChange={(e) => set({ tag: e.target.value })} className={inputCls + ' h-[38px] !w-auto px-3'}>{['Warm lead', 'New', 'Contacted', 'Qualified'].map((t) => <option key={t}>{t}</option>)}</select>
            <span className="text-[13px] text-muted">→ saved to <strong className="text-text">Contacts</strong></span>
          </div>
        </Step>

        <Step title="Safeguards">
          <div className="flex flex-col gap-[14px]">
            {([
              ['once', 'Reply only once per user', 'Never send a duplicate reply or DM to the same person on a post'],
              ['window', 'Respect the platform messaging window', 'Only DM within the time window the API allows after a user interacts'],
              ['handoff', 'Hand off uncertain cases to a human', 'If intent is unclear, route to Contacts instead of auto-replying'],
            ] as const).map(([k, label, desc]) => (
              <div key={k} className="flex items-start gap-3">
                <Switch size="sm" on={!!sg[k]} onChange={(v) => set({ safeguards: { ...sg, [k]: v } })} label={label} />
                <div className="flex-1"><div className="text-sm font-medium">{label}</div><div className="text-xs font-normal text-muted">{desc}</div></div>
              </div>
            ))}
          </div>
        </Step>

        <Step title="Test preview">
          <div className="overflow-hidden rounded-[10px] border border-border">
            <div className="flex gap-[10px] bg-surface p-3">
              <div className="flex h-7 w-7 flex-none items-center justify-center rounded-pill bg-surface-2 text-xs font-semibold text-muted">ML</div>
              <div><div className="text-xs font-semibold">Marcus Lee <span className="font-normal text-muted">commented</span></div><div className="mt-[2px] text-[13px]">What&apos;s the {keywords[0] ?? 'price'}?</div></div>
            </div>
            <div className="flex gap-[10px] border-t border-border p-3">
              <div className="flex h-7 w-7 flex-none items-center justify-center rounded-pill bg-accent-subtle text-[11px] font-bold text-accent-text">{client.initials}</div>
              <div className="flex-1"><div className="text-xs font-semibold text-success-text"><Icon name="ph-fill ph-check-circle" /> Auto-reply</div><div className="mt-[2px] text-[13px] text-muted">{c.commentReply || '—'}</div></div>
            </div>
            <div className="flex gap-[10px] border-t border-border bg-accent-subtle p-3">
              <Icon name="ph ph-paper-plane-tilt" className="mt-[2px] text-base text-accent-text" />
              <div className="flex-1"><div className="text-xs font-semibold text-accent-text">DM sent</div><div className="mt-[2px] whitespace-pre-wrap text-[13px] text-accent-text">{c.dm || '—'}</div></div>
            </div>
          </div>
          <p className="mb-0 mt-2 text-xs text-subtle">Preview only — nothing is sent from here.</p>
        </Step>
      </>
    );
  } else if (automation.kind === 'evergreen') {
    subtitle = 'controlled re-publishing of approved content';
    const c = cfg as unknown as EvergreenConfig;
    body = (
      <>
        <Step n={1} title="Frequency" desc="At most one re-post a day, and never more than this per week, so feeds don't fill with repeats.">
          <label className="flex items-center gap-2 text-[13px]">Max posts per week
            <input type="number" min={1} max={14} value={c.maxPerWeek} onChange={(e) => set({ maxPerWeek: Number(e.target.value) })} className={inputCls + ' h-9 !w-20 px-2'} />
          </label>
        </Step>
        <Step n={2} title="Allowed days">
          <div className="flex flex-wrap gap-[6px]">
            {DAYS.map((d) => {
              const on = (c.days ?? []).includes(d);
              return <button key={d} type="button" aria-pressed={on} onClick={() => set({ days: on ? c.days.filter((x) => x !== d) : [...(c.days ?? []), d] })} className={'h-8 cursor-pointer rounded-pill border px-3 font-sans text-[13px] font-medium ' + (on ? 'border-transparent bg-accent-subtle text-accent-text' : 'border-border bg-bg text-muted')}>{d}</button>;
            })}
          </div>
        </Step>
        <Step n={3} title="Reuse rules" desc="A post is only re-posted when it (and its last re-post) went out at least this many days ago. Posts with the most likes and comments go first.">
          <label className="flex items-center gap-2 text-[13px]">Minimum days before reuse
            <input type="number" min={7} max={365} value={c.minReuseDays} onChange={(e) => set({ minReuseDays: Number(e.target.value) })} className={inputCls + ' h-9 !w-20 px-2'} />
          </label>
        </Step>
        <Step title="Review">
          <div className="flex items-start gap-3">
            <Switch size="sm" on={!!c.requireReview} onChange={(v) => set({ requireReview: v })} label="Require approval before each re-post" />
            <div className="flex-1"><div className="text-sm font-medium">Require approval before each re-post</div><div className="text-xs font-normal text-muted">On: each re-post waits in All content → Pending until an admin approves it. Off: it is scheduled for 10:00 automatically when it passes the checks.</div></div>
          </div>
        </Step>
      </>
    );
  } else if (automation.kind === 'auto_boost') {
    subtitle = 'paid promotion of top Facebook & Instagram posts';
    const c = cfg as unknown as BoostConfig;
    const cur = accounts?.find((a) => a.id === c.adAccountId)?.currency ?? '';
    const money = (k: keyof BoostConfig, label: string) => (
      <label className="flex items-center gap-2 text-[13px]">{label}
        <input type="number" min={1} step="0.01" value={Number(c[k] ?? 0) / 100} onChange={(e) => set({ [k]: Math.round(Number(e.target.value) * 100) })} className={inputCls + ' h-9 !w-24 px-2'} /> {cur}
      </label>
    );
    const numIn = (k: keyof BoostConfig, label: string, min: number, max: number) => (
      <label className="flex items-center gap-2 text-[13px]">{label}
        <input type="number" min={min} max={max} value={Number(c[k] ?? 0)} onChange={(e) => set({ [k]: Number(e.target.value) })} className={inputCls + ' h-9 !w-20 px-2'} />
      </label>
    );
    body = (
      <>
        <div className="rounded-md bg-warning-subtle px-3 py-2 text-[13px] text-warning-text"><Icon name="ph ph-warning" /> This spends real money from the ad account. Keep &quot;Create ads paused&quot; on until you trust the settings.</div>
        <Step n={1} title="Ad account" desc="Meta ad account that pays for boosts. Budgets are in its currency.">
          {accountsErr ? <p className="m-0 text-[13px] text-danger-text">{accountsErr}</p> : !accounts ? <p className="m-0 text-[13px] text-muted">Loading ad accounts…</p> : (
            <select aria-label="Ad account" value={c.adAccountId ?? ''} onChange={(e) => set({ adAccountId: e.target.value })} className={inputCls + ' h-[38px] px-3'}>
              <option value="">Choose…</option>
              {accounts.map((a) => <option key={a.id} value={a.id} disabled={!a.active}>{a.name} · {a.currency}{a.active ? '' : ' (inactive)'}</option>)}
            </select>
          )}
        </Step>
        <Step n={2} title="Which posts" desc="Once a day the best Facebook or Instagram post from the last 7 days is boosted, if it has enough likes, comments and shares.">
          {numIn('minEngagement', 'Minimum interactions', 0, 100000)}
        </Step>
        <Step n={3} title="Budget">
          <div className="flex flex-col gap-2">
            {money('dailyBudgetCents', 'Daily budget')}
            {numIn('days', 'Days per boost', 1, 30)}
            {money('monthlyCapCents', 'Monthly cap')}
            {numIn('maxPerWeek', 'Boosts per week', 1, 14)}
            <div className="text-xs text-muted">One boost costs up to {((c.dailyBudgetCents ?? 0) * (c.days ?? 0) / 100).toFixed(2)} {cur}. Nothing is created once the month&apos;s planned spend would pass the cap.</div>
          </div>
        </Step>
        <Step n={4} title="Audience">
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-[13px]">Countries
              <input value={(c.countries ?? []).join(', ')} onChange={(e) => set({ countries: e.target.value.toUpperCase().split(/[,\s]+/).filter(Boolean) })} placeholder="US, CA" className={inputCls + ' h-9 !w-40 px-2'} />
            </label>
            <div className="flex gap-4">{numIn('ageMin', 'Age from', 13, 65)}{numIn('ageMax', 'to', 18, 65)}</div>
          </div>
        </Step>
        <Step title="Safety">
          <div className="flex items-start gap-3">
            <Switch size="sm" on={c.startPaused !== false} onChange={(v) => set({ startPaused: v })} label="Create ads paused" />
            <div className="flex-1"><div className="text-sm font-medium">Create ads paused</div><div className="text-xs font-normal text-muted">On: the ad is built but doesn&apos;t spend until someone switches it on in Meta Ads Manager. Off: it starts within minutes.</div></div>
          </div>
        </Step>
      </>
    );
  } else if (automation.kind === 'digest') {
    subtitle = 'weekly performance email';
    const c = cfg as unknown as DigestConfig;
    const recipients = c.recipients ?? [];
    const add = () => {
      const t = recipient.trim();
      if (!/^\S+@\S+\.\S+$/.test(t)) { setErr('Enter a valid email address.'); return; }
      if (!recipients.includes(t)) set({ recipients: [...recipients, t] });
      setRecipient(''); setErr(null);
    };
    body = (
      <>
        <Step n={1} title="Recipients">
          <ul className="m-0 mb-2 flex list-none flex-col gap-1 p-0">
            {recipients.map((r) => (
              <li key={r} className="flex items-center justify-between rounded-md bg-surface px-3 py-2 text-[13px]">{r}
                <button type="button" aria-label={`Remove ${r}`} onClick={() => set({ recipients: recipients.filter((x) => x !== r) })} className="cursor-pointer border-none bg-transparent text-muted"><Icon name="ph ph-x" /></button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input aria-label="Recipient email" type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="name@example.com" className={inputCls + ' h-[38px] flex-1 px-3'} />
            <Button onClick={add} className="h-[38px] text-[13px]">Add</Button>
          </div>
        </Step>
        <Step n={2} title="Send day" desc="Sent from 08:00 in the client's time zone, covering the last 7 days.">
          <select aria-label="Send day" value={c.sendDay} onChange={(e) => set({ sendDay: e.target.value })} className={inputCls + ' h-[38px] !w-auto px-3'}>{DAYS.map((d) => <option key={d}>{d}</option>)}</select>
        </Step>
        <Step title="Try it">
          <Button size="sm" icon="ph ph-paper-plane-tilt" loading={testing} onClick={sendTest}>Send a test to me</Button>
          <p className="mb-0 mt-2 text-xs text-subtle">Uses this week&apos;s real numbers. Without a mail server the email waits in Super Admin → Email outbox.</p>
        </Step>
      </>
    );
  }

  return (
    <Drawer open={!!automation} onClose={onClose} labelledBy="rule-title">
      <div className="flex flex-none items-center justify-between border-b border-border px-[22px] py-[18px]">
        <div><h2 id="rule-title" className="m-0 text-[17px] font-bold">{automation.name}</h2><div className="text-[13px] text-muted">{client.name} · {subtitle}</div></div>
        <CloseButton onClick={onClose} />
      </div>
      <div className="flex flex-1 flex-col gap-[22px] overflow-y-auto p-[22px]">{body}</div>
      {err && <div role="alert" className="border-t border-border bg-danger-subtle px-[22px] py-2 text-[13px] text-danger-text">{err}</div>}
      <div className="flex flex-none items-center justify-between border-t border-border px-[22px] py-[14px]">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={save} className="px-[18px]">Save rule</Button>
      </div>
    </Drawer>
  );
}
