'use client';
import { useState } from 'react';
import { useApp } from './app-context';
import { Button, CloseButton, Modal, inputCls } from './ui';
import { api } from '@/lib/api';
import type { Client } from '@/lib/types';

const TZS = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'Europe/London', 'Asia/Dhaka', 'Asia/Singapore', 'Australia/Sydney'];

export function AddClientModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { reloadClients, setClientId, toast } = useApp();
  const [name, setName] = useState('');
  const [loc, setLoc] = useState('');
  const [website, setWebsite] = useState('');
  const [tz, setTz] = useState('America/Chicago');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const { client } = await api<{ client: Client }>('/api/clients', { method: 'POST', json: { name, loc, website, timezone: tz } });
      await reloadClients();
      setClientId(client.id);
      toast(`${client.name} added. Connect accounts in Settings, then crawl the website.`, 'success');
      setName(''); setLoc(''); setWebsite('');
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="add-client-title" width={480}>
      <form onSubmit={submit} className="flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-5 py-[18px]">
          <div><h2 id="add-client-title" className="m-0 text-base font-bold">Add client</h2><p className="m-0 text-[13px] text-muted">Each client keeps its own websites, accounts and content.</p></div>
          <CloseButton onClick={onClose} />
        </div>
        <div className="flex flex-col gap-4 p-5">
          <label className="flex flex-col gap-1 text-[13px] font-medium">Business name
            <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls + ' h-10 px-3'} aria-invalid={!!err && !name} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Primary location <span className="font-normal text-muted">Entered by you — never auto-detected.</span>
            <input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="City, State" className={inputCls + ' h-10 px-3'} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Website URL
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="example.com" className={inputCls + ' h-10 px-3'} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">Timezone
            <select value={tz} onChange={(e) => setTz(e.target.value)} className={inputCls + ' h-10 px-3'}>{TZS.map((t) => <option key={t}>{t}</option>)}</select>
          </label>
          {err && <p role="alert" className="m-0 text-[13px] text-danger-text">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-[14px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Add client</Button>
        </div>
      </form>
    </Modal>
  );
}
