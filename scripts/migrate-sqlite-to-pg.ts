/**
 * Copies everything from the SQLite database into PostgreSQL.
 *
 *   SQLITE_PATH=data/social-blast.db DATABASE_URL=postgres://user:pass@host/db npm run db:to-postgres
 *
 * Options:
 *   --force   PostgreSQL already has data: delete it first and copy again
 *   --media   also copy uploaded files from SB_UPLOAD_DIR (default data/uploads) into S3
 *             storage (needs SB_STORAGE=s3 and the S3_* settings)
 *   --dry-run only show what would be copied
 *
 * Stop the app first so nothing changes while copying. The SQLite file is only
 * read, never changed, so you can go back to it if anything looks wrong.
 */
import fs from 'node:fs';
import path from 'node:path';

// Tables in parent → child order, so foreign keys are satisfied while inserting.
const TABLES = [
  'clients', 'users', 'connections', 'destinations', 'media', 'media_variants', 'posts', 'post_variants', 'post_destinations',
  'jobs', 'post_metrics', 'automations', 'engagement_events', 'contacts', 'pages', 'keywords', 'crawls', 'activity', 'imports',
  'ai_usage', 'sessions', 'client_access', 'auth_tokens', 'emails', 'oauth_states', 'boosts', 'kv', 'logs',
];
const ORDERED = ['destinations', 'keywords', 'crawls']; // keep insertion order through the `seq` column
const BATCH = 200;

type Row = Record<string, unknown>;

function arg(name: string) { return process.argv.includes(name); }

async function main() {
  const sqlitePath = path.resolve(process.env.SQLITE_PATH || process.env.SB_DB_PATH || 'data/social-blast.db');
  const url = process.env.DATABASE_URL;
  if (!url || !/^postgres(ql)?:\/\//.test(url)) throw new Error('Set DATABASE_URL=postgres://… for the target database');
  if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite file not found: ${sqlitePath} (set SQLITE_PATH)`);
  const force = arg('--force');
  const dry = arg('--dry-run');

  const { DatabaseSync } = await import('node:sqlite');
  const src = new DatabaseSync(sqlitePath, { readOnly: true });
  const srcTables = new Set((src.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name));

  // Opening the app's data layer creates the PostgreSQL tables. No demo data.
  process.env.SB_SEED = 'false';
  delete process.env.SB_DB_PATH;
  const { q, tx, closeDb } = await import('../src/server/db');

  const existing = (await q.count('SELECT COUNT(*) AS n FROM clients')) + (await q.count('SELECT COUNT(*) AS n FROM users'));
  if (existing && !force) throw new Error('PostgreSQL already has clients or users. Run again with --force to replace them.');

  const pgCols = async (t: string) => (await q.all<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?`, t)).map((r) => r.column_name);

  const plan: { table: string; rows: Row[]; cols: string[] }[] = [];
  for (const t of TABLES) {
    if (!srcTables.has(t)) { plan.push({ table: t, rows: [], cols: [] }); continue; }
    const have = (src.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    const target = await pgCols(t);
    const cols = have.filter((c) => target.includes(c));
    let rows = src.prepare(`SELECT rowid AS __rowid, * FROM ${t}`).all() as Row[];
    if (ORDERED.includes(t) && target.includes('seq')) {
      if (!cols.includes('seq')) cols.push('seq');
      rows = rows.map((r) => ({ ...r, seq: Number(r.seq ?? 0) || Number(r.__rowid) }));
    }
    plan.push({ table: t, rows, cols });
  }
  const unknown = [...srcTables].filter((t) => !TABLES.includes(t) && !t.startsWith('sqlite_'));
  if (unknown.length) console.warn(`Skipping unknown SQLite tables: ${unknown.join(', ')}`);

  for (const p of plan) console.log(`${p.table.padEnd(18)} ${String(p.rows.length).padStart(7)} rows`);
  if (dry) { console.log('Dry run: nothing copied.'); await closeDb(); return; }

  await tx(async () => {
    if (existing) for (const t of [...TABLES].reverse()) await q.run(`DELETE FROM ${t}`);
    for (const p of plan) {
      for (let i = 0; i < p.rows.length; i += BATCH) {
        const chunk = p.rows.slice(i, i + BATCH);
        const values = chunk.map(() => `(${p.cols.map(() => '?').join(',')})`).join(',');
        const params = chunk.flatMap((r) => p.cols.map((c) => (r[c] === undefined ? null : (r[c] as string | number | null))));
        await q.run(`INSERT INTO ${p.table} (${p.cols.join(',')}) VALUES ${values}`, ...params);
      }
    }
    // logs.id is an auto-number: continue after the copied ids.
    await q.run(`SELECT setval(pg_get_serial_sequence('logs', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM logs), 1))`);
  });

  // Check every table arrived complete.
  let ok = true;
  for (const p of plan) {
    const n = await q.count(`SELECT COUNT(*) AS n FROM ${p.table}`);
    if (n !== p.rows.length) { ok = false; console.error(`MISMATCH ${p.table}: SQLite ${p.rows.length}, PostgreSQL ${n}`); }
  }
  if (!ok) throw new Error('Row counts differ — see above. PostgreSQL may be incomplete; fix and run again with --force.');
  console.log('Database copied and verified.');

  if (arg('--media')) {
    const { storage, storageKind } = await import('../src/server/storage');
    if (storageKind() !== 's3') throw new Error('--media needs SB_STORAGE=s3 and S3_BUCKET (files are copied from the local folder into S3)');
    const dir = path.resolve(process.env.SB_UPLOAD_DIR || 'data/uploads');
    const keys = [
      ...(src.prepare('SELECT storage_key, mime FROM media').all() as { storage_key: string; mime: string }[]).map((r) => [r.storage_key, r.mime] as const),
      ...(src.prepare('SELECT storage_key FROM media_variants').all() as { storage_key: string }[]).map((r) => [r.storage_key, 'image/jpeg'] as const),
    ];
    let copied = 0, missing = 0;
    for (const [key, mime] of new Map(keys)) {
      const f = path.join(dir, key);
      if (!fs.existsSync(f)) { missing++; continue; }
      await storage().put(key, fs.readFileSync(f), mime);
      copied++;
    }
    console.log(`Media: ${copied} files copied to S3${missing ? `, ${missing} missing on disk` : ''}.`);
  }
  src.close();
  await closeDb();
  console.log('Done. Start the app with DATABASE_URL set.');
}

main().catch((e) => { console.error(`Error: ${(e as Error).message}`); process.exit(1); });
