'use client';
import { useRef, useState } from 'react';
import { useApp } from '../app-context';
import { Badge, Button, Card, ErrorState, Icon, Loading, SectionTitle, Th, cx } from '../ui';
import { api, useApi } from '@/lib/api';
import { platformIcon, platformSpec } from '@/lib/platforms';
import type { ImportBatch } from '@/lib/types';

const PREVIEW_ROWS = 6;

export function BulkImport() {
  const { client, version, bump, toast } = useApp();
  const url = client ? `/api/clients/${client.id}/imports/latest` : null;
  const { data, error, loading, reload, setData } = useApi<{ import: ImportBatch | null }>(url, version);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [committing, setCommitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!client) return null;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Loading rows={6} />;

  const imp = data?.import ?? null;
  const rows = imp?.rows ?? [];
  const counts = {
    total: rows.length,
    valid: rows.filter((r) => r.result === 'ok').length,
    errors: rows.filter((r) => r.result === 'error').length,
    review: rows.filter((r) => r.result === 'warn').length,
  };
  const shown = showAll ? rows : rows.slice(0, PREVIEW_ROWS);

  async function upload(file: File) {
    setUploading(true);
    setUploadErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const out = await api<{ import: ImportBatch; unknownColumns: string[] }>(`/api/clients/${client!.id}/imports`, { method: 'POST', body: fd });
      setData({ import: out.import });
      setShowAll(false);
      toast(`${file.name}: ${out.import.rows.length} rows checked.${out.unknownColumns.length ? ` Ignored unknown columns: ${out.unknownColumns.join(', ')}.` : ''}`, 'success');
    } catch (e) {
      setUploadErr((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function commit() {
    if (!imp) return;
    setCommitting(true);
    try {
      const out = await api<{ import: ImportBatch }>(`/api/imports/${imp.id}/commit`, { method: 'POST' });
      setData({ import: out.import });
      bump();
      toast(`${out.import.committedCount} posts queued for content generation and approval.`, 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-5 max-lg:grid-cols-1">
      <div className="flex flex-col gap-4">
        <Card className="flex items-center gap-4 p-5 max-sm:flex-col max-sm:items-start">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-[10px] bg-accent-subtle text-[22px] text-accent-text"><Icon name="ph ph-download-simple" /></div>
          <div className="flex-1"><SectionTitle>1 · Download a template</SectionTitle><div className="text-[13px] text-muted">Pre-built columns for topics, platforms, destinations, dates &amp; timezone. Includes a sample row and instructions sheet.</div></div>
          <div className="flex gap-2">
            <a href="/api/templates/bulk?format=csv" download className="flex h-10 items-center gap-[7px] rounded-md border border-border bg-bg px-[14px] text-[13px] font-semibold text-text hover:bg-surface hover:text-text"><Icon name="ph ph-file-csv" /> CSV</a>
            <a href="/api/templates/bulk?format=xlsx" download className="flex h-10 items-center gap-[7px] rounded-md border border-border bg-bg px-[14px] text-[13px] font-semibold text-text hover:bg-surface hover:text-text"><Icon name="ph ph-file-xls" /> Excel</a>
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle className="mb-3">2 · Upload your file</SectionTitle>
          <label
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void upload(f); }}
            className={cx('block cursor-pointer rounded-lg border-[1.5px] border-dashed p-7 text-center', drag ? 'border-accent bg-accent-subtle' : uploadErr ? 'border-danger bg-surface' : 'border-border-input bg-surface')}
          >
            <input ref={fileRef} type="file" accept=".csv,.xlsx" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
            <Icon name={uploading ? 'ph ph-circle-notch animate-spin' : 'ph ph-cloud-arrow-up'} className="text-[34px] text-muted" />
            <div className="mt-2 font-semibold">{uploading ? 'Checking rows…' : <>Drop CSV or Excel here, or <span className="text-accent-text">browse</span></>}</div>
            <div className="mt-1 text-xs font-normal text-muted">.csv, .xlsx up to 10 MB · 500 rows max</div>
          </label>
          {uploadErr && <p role="alert" className="mb-0 mt-3 text-[13px] text-danger-text"><Icon name="ph-fill ph-warning-circle" /> {uploadErr}</p>}
          {imp && (
            <div className="mt-3 flex items-center gap-[10px] rounded-md border border-border bg-surface px-3 py-[10px]">
              <Icon name={imp.filename.endsWith('.csv') ? 'ph-fill ph-file-csv' : 'ph-fill ph-file-xls'} className="text-xl text-success" />
              <div className="flex-1"><div className="text-[13px] font-medium">{imp.filename}</div><div className="text-[11px] text-muted">{rows.length} rows · columns auto-mapped</div></div>
              <Badge tone={imp.status === 'committed' ? 'scheduled' : 'published'}>{imp.status === 'committed' ? 'Imported' : 'Parsed'}</Badge>
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <SectionTitle>3 · Validation preview</SectionTitle>
            {imp && counts.errors + counts.review > 0 && <a href={`/api/imports/${imp.id}/report`} className="text-[13px] font-semibold"><Icon name="ph ph-download-simple" /> Error report</a>}
          </div>
          {!imp ? (
            <div className="px-5 py-10 text-center text-[13px] text-muted">Upload a file to check every row before anything is scheduled.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr className="bg-surface"><Th className="py-[10px]">Row</Th><Th className="py-[10px]">Topic</Th><Th className="py-[10px]">Platform</Th><Th className="py-[10px]">Schedule</Th><Th className="py-[10px]">Result</Th></tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.row} className={cx('border-t border-border', r.result === 'error' ? 'bg-danger-subtle' : r.result === 'warn' ? 'bg-warning-subtle' : 'bg-transparent')}>
                      <td className="px-4 py-3 font-mono text-xs text-muted">{r.row}</td>
                      <td className="px-4 py-3"><div className="text-[13px] font-medium">{r.topic}</div>{r.msg && <div className={cx('text-[11px]', r.result === 'error' ? 'text-danger-text' : 'text-warning-text')}>{r.msg}</div>}</td>
                      <td className="px-4 py-3 text-base text-muted"><Icon name={platformIcon(r.platform)} label={r.platform ? platformSpec(r.platform).label : 'Unknown platform'} /></td>
                      <td className="px-4 py-3 text-[13px] text-muted">{r.when}</td>
                      <td className="px-4 py-3"><Badge tone={r.result === 'ok' ? 'published' : r.result === 'error' ? 'failed' : 'pending'}>{r.result === 'ok' ? 'Valid' : r.result === 'error' ? 'Error' : 'Review'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > PREVIEW_ROWS && (
                <div className="border-t border-border p-3 text-center"><Button size="sm" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Show fewer rows' : `Show all ${rows.length} rows`}</Button></div>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="sticky top-[88px] flex flex-col gap-4 max-lg:static">
        <Card className="p-[18px]">
          <SectionTitle className="mb-[14px]">Import summary</SectionTitle>
          {[
            { icon: 'ph ph-rows', color: 'text-muted', label: 'Total rows', value: counts.total },
            { icon: 'ph-fill ph-check-circle', color: 'text-success', label: 'Valid', value: counts.valid },
            { icon: 'ph-fill ph-x-circle', color: 'text-danger', label: 'Errors', value: counts.errors },
            { icon: 'ph-fill ph-warning-circle', color: 'text-warning-text', label: 'Needs review', value: counts.review },
          ].map((s) => (
            <div key={s.label} className="flex items-center justify-between py-[7px]">
              <span className="flex items-center gap-2 text-[13px] text-muted"><Icon name={s.icon} className={s.color} /> {s.label}</span>
              <span className="text-[15px] font-bold">{imp ? s.value : '—'}</span>
            </div>
          ))}
          <Button variant="primary" size="lg" className="mt-[14px] w-full" loading={committing} disabled={!imp || imp.status === 'committed' || counts.valid === 0} onClick={commit}>
            {imp?.status === 'committed' ? `Imported ${imp.committedCount} rows` : `Import ${counts.valid} valid rows`}
          </Button>
          <div className="mt-[10px] text-center text-[11px] text-subtle">Invalid rows are never discarded silently — fix and re-upload, or download the error report.</div>
        </Card>
        <Card className="p-[18px]">
          <div className="mb-2 text-[13px] font-semibold">Processing</div>
          <div className="text-xs font-normal leading-[18px] text-muted">Valid rows run as background jobs — content &amp; image generation, then scheduling. You can close the browser; progress and per-row status stay in <strong className="text-text">Import history</strong>.</div>
        </Card>
      </div>
    </div>
  );
}
