'use client';
import { useEffect, useState } from 'react';
import { Badge, Button, CloseButton, Icon, Modal, cx, inputCls } from './ui';
import { platformSpec } from '@/lib/platforms';
import { addDays, zonedDateKey, zonedToUtc } from '@/lib/time';
import type { Client, Destination } from '@/lib/types';

export interface PickerResult { destinationIds: string[]; scheduledAt?: string }

/**
 * Unified destination picker (components.md). Disabled rows keep their reason
 * visible as text, never just a tooltip.
 */
export function DestinationPicker({
  open, onClose, client, destinations, selected, mode, onConfirm, busy, error,
}: {
  open: boolean;
  onClose: () => void;
  client: Client;
  destinations: Destination[];
  selected: string[];
  mode: 'select' | 'schedule';
  onConfirm: (r: PickerResult) => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [sel, setSel] = useState<string[]>(selected);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');

  useEffect(() => {
    if (!open) return;
    setSel(selected.filter((id) => { const d = destinations.find((x) => x.id === id); return d?.kind === 'ok' && d.enabled; }));
    setDate(addDays(zonedDateKey(new Date(), client.timezone), 1));
    setTime('09:00');
  }, [open, selected, destinations, client.timezone]);

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const usable = destinations.filter((d) => d.kind === 'ok' && d.enabled);
  const allOn = usable.length > 0 && usable.every((d) => sel.includes(d.id));

  return (
    <Modal open={open} onClose={onClose} labelledBy="picker-title">
      <div className="flex items-center justify-between border-b border-border px-5 py-[18px]">
        <div>
          <h2 id="picker-title" className="m-0 text-base font-bold">{mode === 'schedule' ? 'Schedule post' : 'Choose destinations'}</h2>
          <p className="m-0 text-[13px] text-muted">{client.name} · select the exact pages, profiles and locations to publish to.</p>
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {destinations.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-muted">No connected accounts for this client yet. Connect one in Settings.</div>
        ) : (
          <>
            <div className="flex justify-end px-3 pb-1 pt-2">
              <button type="button" onClick={() => setSel(allOn ? [] : usable.map((d) => d.id))} className="cursor-pointer border-none bg-transparent font-sans text-xs font-semibold text-accent-text">{allOn ? 'Deselect all' : 'Select all available'}</button>
            </div>
            <div role="group" aria-label="Destinations">
              {destinations.map((d) => {
                const checked = sel.includes(d.id);
                const disabled = d.kind !== 'ok' || !d.enabled;
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-disabled={disabled}
                    onClick={() => !disabled && toggle(d.id)}
                    className={cx('flex w-full items-center gap-3 rounded-[10px] border-none p-3 text-left font-sans text-text', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer', checked ? 'bg-accent-subtle' : 'bg-transparent hover:bg-surface')}
                  >
                    <Icon name={checked ? 'ph-fill ph-check-square' : 'ph ph-square'} className={cx('text-xl', checked ? 'text-accent' : 'text-subtle')} />
                    <div className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-md bg-surface-2 text-lg text-muted"><Icon name={platformSpec(d.platform).icon} /></div>
                    <div className="min-w-0 flex-1"><div className="text-sm font-medium">{d.name}</div><div className="text-xs font-normal text-muted">{platformSpec(d.platform).label} · {d.meta}</div></div>
                    {disabled && <Badge tone={d.kind === 'reauth' ? 'pending' : 'draft'}>{d.kind === 'reauth' ? 'Reconnect' : d.kind === 'unsupported' ? 'Unsupported' : 'Off — turn on in Settings'}</Badge>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
      {mode === 'schedule' && (
        <div className="flex flex-wrap items-end gap-3 border-t border-border px-5 py-3">
          <label className="flex flex-col gap-1 text-xs font-semibold">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls + ' h-9 px-2 font-normal'} /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold">Time<input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls + ' h-9 px-2 font-normal'} /></label>
          <div className="pb-2 text-xs text-muted"><Icon name="ph ph-clock" /> {client.timezone}</div>
        </div>
      )}
      {error && <div role="alert" className="border-t border-border bg-danger-subtle px-5 py-2 text-[13px] text-danger-text">{error}</div>}
      <div className="flex items-center justify-between border-t border-border px-5 py-[14px]">
        <div className="text-[13px] text-muted" aria-live="polite">{sel.length} selected</div>
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={mode === 'schedule' && (!sel.length || !date)}
            onClick={() => onConfirm({ destinationIds: sel, scheduledAt: mode === 'schedule' ? zonedToUtc(date, time, client.timezone) : undefined })}
          >
            {mode === 'schedule' ? 'Schedule' : 'Confirm destinations'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
