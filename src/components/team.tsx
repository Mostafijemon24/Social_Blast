'use client';
import { useState } from 'react';
import { useApp } from './app-context';
import { Badge, Button, Card, CloseButton, ErrorState, Icon, Loading, Modal, SectionTitle, Th, cx, inputCls } from './ui';
import { api, useApi } from '@/lib/api';
import { relativeTime } from '@/lib/time';
import type { Client, Role, SessionUser } from '@/lib/types';

type TeamUser = SessionUser & { createdAt: string; lastLoginAt: string | null; clientIds: string[] };
interface Invite { id: string; email: string; name: string; role: Role; allClients: boolean; clientIds: string[]; createdAt: string; expiresAt: string }
interface TeamData { users: TeamUser[]; invites: Invite[]; emailConfigured: boolean }
type Delivery = { delivery: 'sent' | 'outbox' | 'failed'; link: string | null };

const ROLES: { value: Role; label: string; desc: string }[] = [
  { value: 'owner', label: 'Owner', desc: 'Everything, including other owners' },
  { value: 'admin', label: 'Admin', desc: 'All clients, connections and team' },
  { value: 'editor', label: 'Editor', desc: 'Create, edit and schedule content' },
  { value: 'viewer', label: 'Viewer', desc: 'Read only' },
];
const fullAccess = (r: Role) => r === 'owner' || r === 'admin';

/** "All clients" or a checklist. Owners and admins always see every client. */
function ClientAccess({ role, all, ids, clients, onChange }: { role: Role; all: boolean; ids: string[]; clients: Client[]; onChange: (all: boolean, ids: string[]) => void }) {
  if (fullAccess(role)) return <p className="m-0 text-[13px] text-muted">{role === 'owner' ? 'Owners' : 'Admins'} can see every client.</p>;
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-2 text-[13px] font-medium">Client access</legend>
      <label className="mb-2 flex cursor-pointer items-center gap-2 text-[13px]">
        <input type="checkbox" checked={all} onChange={(e) => onChange(e.target.checked, ids)} className="h-4 w-4 accent-[var(--color-accent)]" />
        All clients, including ones added later
      </label>
      {!all && (
        <div className="flex flex-col gap-1 rounded-md border border-border p-2">
          {clients.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-[13px] hover:bg-surface">
              <input type="checkbox" checked={ids.includes(c.id)} onChange={(e) => onChange(false, e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id))} className="h-4 w-4 accent-[var(--color-accent)]" />
              <span className="flex-1">{c.name}</span><span className="text-xs text-muted">{c.loc}</span>
            </label>
          ))}
          {ids.length === 0 && <span className="px-1 text-xs text-danger-text">Pick at least one client.</span>}
        </div>
      )}
    </fieldset>
  );
}

function accessLabel(role: Role, all: boolean, ids: string[], clients: Client[]): string {
  if (fullAccess(role) || all) return 'All clients';
  const names = ids.map((id) => clients.find((c) => c.id === id)?.name).filter(Boolean);
  return names.length ? names.join(', ') : 'No clients';
}

/** Shows a link to copy when email couldn't be sent. */
function LinkNotice({ result, onClose, what }: { result: Delivery; onClose: () => void; what: string }) {
  const [copied, setCopied] = useState(false);
  if (!result.link) return null;
  return (
    <div role="status" className="mb-4 rounded-lg border border-warning-subtle bg-warning-subtle p-4 text-[13px] text-warning-text">
      <div className="mb-2 flex items-start gap-2">
        <Icon name="ph-fill ph-envelope-simple-open" className="mt-[2px] text-lg" />
        <div className="flex-1">
          <strong>{result.delivery === 'failed' ? 'The email failed to send.' : 'Email isn’t set up on this server, so nothing was emailed.'}</strong> Send this {what} link to them yourself (it works once):
        </div>
        <button type="button" aria-label="Dismiss" onClick={onClose} className="cursor-pointer border-none bg-transparent text-warning-text"><Icon name="ph ph-x" /></button>
      </div>
      <div className="flex gap-2">
        <input readOnly value={result.link} onFocus={(e) => e.target.select()} className={inputCls + ' h-9 flex-1 px-2 font-mono text-xs'} aria-label={`${what} link`} />
        <Button size="sm" className="h-9" onClick={() => { void navigator.clipboard.writeText(result.link!); setCopied(true); }}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
    </div>
  );
}

/** Team members, roles, client access, invitations and password resets (Settings). Admins and owners only. */
export function TeamSection() {
  const { user, clients, toast } = useApp();
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const { data, error, loading, reload } = useApi<TeamData>(isAdmin ? '/api/users' : null);
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<'invite' | 'password'>('invite');
  const blank = { name: '', email: '', password: '', role: 'editor' as Role, allClients: true, clientIds: [] as string[] };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<(Delivery & { what: string }) | null>(null);
  const [editing, setEditing] = useState<TeamUser | null>(null);
  const [edit, setEdit] = useState({ allClients: true, clientIds: [] as string[] });

  if (!user) return null;
  if (!isAdmin) {
    return (
      <div className="mt-8">
        <SectionTitle className="mb-3">Team</SectionTitle>
        <p className="text-[13px] text-muted">You&apos;re signed in as <strong className="text-text">{user.name}</strong> ({user.role}). Ask an admin to change team members, roles or client access.</p>
      </div>
    );
  }

  const showDelivery = (r: Delivery, what: string, sentMsg: string) => {
    if (r.delivery === 'sent') toast(sentMsg, 'success');
    else setNotice({ ...r, what });
  };

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!fullAccess(form.role) && !form.allClients && form.clientIds.length === 0) { setErr('Pick at least one client.'); return; }
    setBusy(true); setErr(null);
    try {
      if (mode === 'invite') {
        const r = await api<Delivery>('/api/invites', { method: 'POST', json: { email: form.email, name: form.name, role: form.role, allClients: form.allClients, clientIds: form.clientIds } });
        showDelivery(r, 'invitation', `Invitation emailed to ${form.email}.`);
      } else {
        await api('/api/users', { method: 'POST', json: form });
        toast(`${form.name} added as ${form.role}. Share the password with them privately.`, 'success');
      }
      setForm(blank);
      setAdding(false);
      reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast(ok, 'success'); reload(); } catch (e) { toast((e as Error).message, 'danger'); }
  };
  const changeRole = (u: TeamUser, role: Role) => act(() => api(`/api/users/${u.id}`, { method: 'PATCH', json: { role } }), `${u.name} is now ${role}.`);
  const remove = (u: TeamUser) => window.confirm(`Remove ${u.name}? They will be signed out immediately.`) && act(() => api(`/api/users/${u.id}`, { method: 'DELETE' }), `${u.name} removed.`);
  const sendReset = (u: TeamUser) => act(async () => showDelivery(await api<Delivery>(`/api/users/${u.id}/reset`, { method: 'POST' }), 'password reset', `Reset link emailed to ${u.email}.`));
  const resend = (i: Invite) => act(async () => showDelivery(await api<Delivery>(`/api/invites/${i.id}/resend`, { method: 'POST' }), 'invitation', `Invitation re-sent to ${i.email}.`));
  const revoke = (i: Invite) => window.confirm(`Cancel the invitation for ${i.email}? The link will stop working.`) && act(() => api(`/api/invites/${i.id}`, { method: 'DELETE' }), 'Invitation cancelled.');
  async function saveAccess() {
    if (!editing) return;
    if (!edit.allClients && edit.clientIds.length === 0) { toast('Pick at least one client.', 'danger'); return; }
    await act(() => api(`/api/users/${editing.id}`, { method: 'PATCH', json: edit }), `Client access updated for ${editing.name}.`);
    setEditing(null);
  }

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <div><SectionTitle>Team</SectionTitle>{data && !data.emailConfigured && <p className="m-0 text-xs text-muted">Email isn&apos;t configured (SMTP_HOST), so invite and reset links are shown here for you to share.</p>}</div>
        <Button size="sm" icon={adding ? 'ph ph-x' : 'ph ph-user-plus'} onClick={() => { setAdding((a) => !a); setErr(null); }}>{adding ? 'Cancel' : 'Add member'}</Button>
      </div>

      {notice && <LinkNotice result={notice} what={notice.what} onClose={() => setNotice(null)} />}

      {adding && (
        <Card className="mb-4 p-5">
          <div role="radiogroup" aria-label="How to add" className="mb-4 flex gap-2">
            {([['invite', 'ph ph-envelope-simple', 'Send email invite'], ['password', 'ph ph-key', 'Set a password now']] as const).map(([m, icon, label]) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                className={cx('flex h-9 cursor-pointer items-center gap-2 rounded-pill border px-3 font-sans text-[13px] font-medium', mode === m ? 'border-transparent bg-accent-subtle text-accent-text' : 'border-border bg-bg text-muted')}>
                <Icon name={icon} /> {label}
              </button>
            ))}
          </div>
          <form onSubmit={add} className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <label className="flex flex-col gap-1 text-[13px] font-medium">Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls + ' h-10 px-3'} /></label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">Email<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls + ' h-10 px-3'} /></label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">Role
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} className={inputCls + ' h-10 px-3'}>
                {ROLES.filter((r) => r.value !== 'owner' || user.role === 'owner').map((r) => <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>)}
              </select>
            </label>
            {mode === 'password'
              ? <label className="flex flex-col gap-1 text-[13px] font-medium">Temporary password<input required minLength={10} type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputCls + ' h-10 px-3'} /></label>
              : <p className="m-0 self-end text-xs text-muted">They get a link to choose their own password. It expires in 7 days.</p>}
            <div className="col-span-full">
              <ClientAccess role={form.role} all={form.allClients} ids={form.clientIds} clients={clients} onChange={(allClients, clientIds) => setForm({ ...form, allClients, clientIds })} />
            </div>
            {err && <p role="alert" className="col-span-full m-0 text-[13px] text-danger-text">{err}</p>}
            <div className="col-span-full flex justify-end"><Button type="submit" variant="primary" loading={busy}>{mode === 'invite' ? 'Send invite' : 'Add member'}</Button></div>
          </form>
        </Card>
      )}

      {error ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <Loading rows={3} /> : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr className="bg-surface"><Th>Member</Th><Th>Role</Th><Th>Clients</Th><Th>Last sign-in</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
              <tbody>
                {data?.users.map((u) => (
                  <tr key={u.id} className="border-t border-border align-top">
                    <td className="px-4 py-[14px]"><div className="text-sm font-medium">{u.name}{u.id === user.id && <span className="text-muted"> (you)</span>}</div><div className="text-xs text-muted">{u.email}</div></td>
                    <td className="px-4 py-[14px]">
                      {u.id === user.id ? <Badge tone="scheduled">{u.role}</Badge> : (
                        <select aria-label={`Role for ${u.name}`} value={u.role} onChange={(e) => changeRole(u, e.target.value as Role)} className={inputCls + ' h-9 !w-auto px-2 text-[13px]'}>
                          {ROLES.filter((r) => r.value !== 'owner' || user.role === 'owner' || u.role === 'owner').map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      )}
                      {u.isPlatformAdmin && <div className="mt-1 text-[11px] text-warning-text">operator</div>}
                    </td>
                    <td className="max-w-[260px] px-4 py-[14px] text-[13px]">
                      <div className={fullAccess(u.role) || u.allClients ? 'text-muted' : ''}>{accessLabel(u.role, u.allClients, u.clientIds, clients)}</div>
                      {!fullAccess(u.role) && <button type="button" onClick={() => { setEditing(u); setEdit({ allClients: u.allClients, clientIds: u.clientIds }); }} className="mt-1 cursor-pointer border-none bg-transparent p-0 font-sans text-xs font-semibold text-accent-text">Edit access</button>}
                    </td>
                    <td className="px-4 py-[14px] text-[13px] text-muted">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'Never'}</td>
                    <td className="whitespace-nowrap px-4 py-[14px] text-right">
                      {u.id !== user.id && (u.role !== 'owner' || user.role === 'owner') && (
                        <span className="inline-flex gap-3">
                          <Button variant="link" className="text-[13px]" onClick={() => sendReset(u)}>Send reset link</Button>
                          <Button variant="link" className="text-[13px] !text-danger-text" onClick={() => remove(u)}>Remove</Button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {data && data.invites.length > 0 && (
            <>
              <h3 className="mb-2 mt-5 text-[13px] font-semibold text-muted">Pending invitations</h3>
              <Card className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead><tr className="bg-surface"><Th>Invited</Th><Th>Role</Th><Th>Clients</Th><Th>Expires</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
                  <tbody>
                    {data.invites.map((i) => (
                      <tr key={i.id} className="border-t border-border">
                        <td className="px-4 py-3"><div className="text-sm font-medium">{i.name}</div><div className="text-xs text-muted">{i.email}</div></td>
                        <td className="px-4 py-3"><Badge tone="pending">{i.role}</Badge></td>
                        <td className="px-4 py-3 text-[13px] text-muted">{accessLabel(i.role, i.allClients, i.clientIds, clients)}</td>
                        <td className="px-4 py-3 text-[13px] text-muted">{relativeTime(i.expiresAt)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <span className="inline-flex gap-3">
                            <Button variant="link" className="text-[13px]" onClick={() => resend(i)}>Resend</Button>
                            <Button variant="link" className="text-[13px] !text-danger-text" onClick={() => revoke(i)}>Cancel</Button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          )}
        </>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} labelledBy="access-title" width={460}>
        {editing && (
          <>
            <div className="flex items-center justify-between border-b border-border px-5 py-[18px]">
              <div><h2 id="access-title" className="m-0 text-base font-bold">Client access</h2><p className="m-0 text-[13px] text-muted">{editing.name} · {editing.role}</p></div>
              <CloseButton onClick={() => setEditing(null)} />
            </div>
            <div className="p-5">
              <ClientAccess role={editing.role} all={edit.allClients} ids={edit.clientIds} clients={clients} onChange={(allClients, clientIds) => setEdit({ allClients, clientIds })} />
              <p className="mb-0 mt-3 text-xs text-muted">They won&apos;t see other clients anywhere — lists, calendar, totals or search.</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-[14px]">
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" onClick={saveAccess}>Save access</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
