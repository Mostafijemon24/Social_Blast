import 'server-only';
import ExcelJS from 'exceljs';
import { TEMPLATE_COLUMNS, SAMPLE_ROW } from '@/lib/bulk';

/** Reads the first worksheet as a table of strings (header row first). */
export async function readXlsx(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  // exceljs' types expect its own Buffer flavour.
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets.find((w) => w.name.toLowerCase() !== 'instructions') ?? wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let i = 1; i <= ws.columnCount; i++) {
      const v = row.getCell(i).value;
      let s = '';
      if (v instanceof Date) s = v.toISOString().slice(0, 10);
      else if (v && typeof v === 'object' && 'text' in v) s = String((v as { text: unknown }).text);
      else if (v && typeof v === 'object' && 'result' in v) s = String((v as { result: unknown }).result ?? '');
      else if (v != null) s = String(v);
      cells.push(s);
    }
    out.push(cells);
  });
  return out.filter((r) => r.some((c) => c.trim()));
}

export async function writeTemplateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Social Blast';
  const ws = wb.addWorksheet('Posts', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: Math.max(16, c.header.length + 4) }));
  ws.getRow(1).font = { bold: true };
  // xlsx cells are typed strings, so no formula escaping is needed here (unlike CSV).
  ws.addRow(Object.fromEntries(TEMPLATE_COLUMNS.map((c) => [c.key, SAMPLE_ROW[c.key] ?? ''])));
  // Keep date/time columns as text so Excel doesn't reformat them.
  for (const key of ['date', 'time']) ws.getColumn(key).numFmt = '@';

  const info = wb.addWorksheet('Instructions');
  info.columns = [{ header: 'Column', key: 'h', width: 28 }, { header: 'Required', key: 'r', width: 14 }, { header: 'What to enter', key: 'n', width: 90 }];
  info.getRow(1).font = { bold: true };
  for (const c of TEMPLATE_COLUMNS) info.addRow({ h: c.header, r: c.required === 'yes' ? 'Required' : c.required === 'platform' ? 'Per platform' : 'Optional', n: c.note });
  info.addRow({});
  info.addRow({ h: 'Notes', n: 'Row 2 of the Posts sheet is a sample — replace it. Invalid rows are never dropped silently: the preview lists each problem with its row number.' });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
