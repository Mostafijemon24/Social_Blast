import { route } from '@/server/http';
import { TEMPLATE_COLUMNS, SAMPLE_ROW } from '@/lib/bulk';
import { toCsv } from '@/lib/csv';
import { writeTemplateXlsx } from '@/server/xlsx';

export const GET = route(async (req) => {
  const format = new URL(req.url).searchParams.get('format') ?? 'csv';
  if (format === 'xlsx') {
    const buf = await writeTemplateXlsx();
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="social-blast-bulk-template.xlsx"',
      },
    });
  }
  const csv = toCsv([TEMPLATE_COLUMNS.map((c) => c.header), TEMPLATE_COLUMNS.map((c) => SAMPLE_ROW[c.key] ?? '')]);
  return new Response('﻿' + csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="social-blast-bulk-template.csv"' },
  });
});
