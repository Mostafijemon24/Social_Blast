import { route } from '@/server/http';
import { getImport } from '@/server/repo';
import { toCsv } from '@/lib/csv';
import { platformSpec } from '@/lib/platforms';

/** Downloadable validation report: every row that is not valid, with the reason. */
export const GET = route<{ id: string }>(async (_r, p) => {
  const imp = await getImport(p.id);
  const rows = imp.rows.filter((r) => r.result !== 'ok');
  const csv = toCsv([
    ['Row', 'Topic', 'Platform', 'Schedule', 'Result', 'Problem'],
    ...rows.map((r) => [r.row, r.topic, r.platform ? platformSpec(r.platform).label : '', r.when, r.result === 'error' ? 'Error' : 'Needs review', r.msg]),
  ]);
  const name = imp.filename.replace(/\.(csv|xlsx)$/i, '') + '-errors.csv';
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` } });
}, { owns: 'import' });
