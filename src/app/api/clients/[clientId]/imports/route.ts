import { route } from '@/server/http';
import { ApiError, createImport, getClient, listDestinations } from '@/server/repo';
import { parseCsv } from '@/lib/csv';
import { validateRows } from '@/lib/bulk';
import { readXlsx } from '@/server/xlsx';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 500;

export const POST = route<{ clientId: string }>(async (req, p) => {
  const client = await getClient(p.clientId);
  const form = await req.formData().catch(() => { throw new ApiError(400, 'Upload a file as multipart/form-data'); });
  const file = form.get('file');
  if (!(file instanceof File)) throw new ApiError(400, 'No file uploaded');
  if (file.size > MAX_BYTES) throw new ApiError(413, 'File is larger than 10 MB');
  const name = file.name.toLowerCase();
  let table: string[][];
  if (name.endsWith('.csv')) table = parseCsv(await file.text());
  else if (name.endsWith('.xlsx')) table = await readXlsx(Buffer.from(await file.arrayBuffer()));
  else throw new ApiError(415, 'Upload a .csv or .xlsx file');
  if (table.length < 2) throw new ApiError(400, 'The file has no data rows');
  if (table.length - 1 > MAX_ROWS) throw new ApiError(400, `Too many rows (${table.length - 1}). The limit is ${MAX_ROWS}.`);
  const { rows, unknownColumns, missingColumns } = validateRows(table, await listDestinations(client.id), client.timezone);
  if (missingColumns.length) throw new ApiError(400, `Missing required columns: ${missingColumns.join(', ')}. Download the template to see the expected headers.`);
  return { import: await createImport(client.id, file.name, rows), unknownColumns };
});
