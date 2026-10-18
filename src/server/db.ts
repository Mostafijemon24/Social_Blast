import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Data layer that runs on SQLite (default, single server) or PostgreSQL
 * (DATABASE_URL=postgres://…, for several web servers and workers).
 *
 * SQL is written once in a portable subset: `?` placeholders, ON CONFLICT,
 * TEXT timestamps (ISO-8601), INTEGER flags. Inside `tx()` every query in the
 * same async flow joins the transaction automatically.
 */
export type Param = string | number | null;
export type Row = Record<string, unknown>;

interface Driver {
  dialect: 'sqlite' | 'postgres';
  get(sql: string, params: Param[]): Promise<Row | undefined>;
  all(sql: string, params: Param[]): Promise<Row[]>;
  run(sql: string, params: Param[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: () => Promise<T>): Promise<T>;
  /** Fire-and-forget write outside any transaction (logs). */
  detached(sql: string, params: Param[]): Promise<void>;
  close(): Promise<void>;
}

const als = new AsyncLocalStorage<{ client?: unknown }>();

// ------------------------------------------------------------------ schema
const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  loc TEXT NOT NULL,
  initials TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  target_location TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  dests_label TEXT NOT NULL,
  last_sync TEXT,
  status TEXT NOT NULL CHECK (status IN ('connected','expired')),
  external_id TEXT,
  access_enc TEXT,
  refresh_enc TEXT,
  token_expires_at TEXT,
  scope TEXT
);
CREATE TABLE IF NOT EXISTS destinations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  meta TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ok','reauth','unsupported')),
  external_id TEXT,
  token_enc TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  seq BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image','video')),
  mime TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  storage_key TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'upload',
  prompt TEXT,
  alt TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media_variants (
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  PRIMARY KEY (media_id, platform)
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  brief TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  scheduled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  platforms TEXT NOT NULL DEFAULT '[]',
  source_pages TEXT NOT NULL DEFAULT '[]',
  tone TEXT NOT NULL DEFAULT 'friendly',
  media_url TEXT NOT NULL DEFAULT '',
  media_id TEXT,
  evergreen INTEGER NOT NULL DEFAULT 0,
  evergreen_source TEXT,
  approved_by TEXT
);
CREATE INDEX IF NOT EXISTS posts_client_sched ON posts(client_id, scheduled_at);
CREATE TABLE IF NOT EXISTS post_variants (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  caption TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  hashtags TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (post_id, platform)
);
CREATE TABLE IF NOT EXISTS post_destinations (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, destination_id)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('crawl','content','image','publish')),
  client_id TEXT,
  ref_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','running','retrying','succeeded','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  destination_id TEXT,
  next_attempt_at TEXT,
  last_error TEXT,
  external_id TEXT,
  external_url TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_type_status ON jobs(type, status);
CREATE TABLE IF NOT EXISTS post_metrics (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  reach INTEGER,
  impressions INTEGER,
  fetched_at TEXT NOT NULL,
  error TEXT
);
CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  descr TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  supported INTEGER NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  stat1 TEXT NOT NULL, stat1_label TEXT NOT NULL,
  stat2 TEXT NOT NULL, stat2_label TEXT NOT NULL,
  last_run_at TEXT,
  last_status TEXT
);
CREATE TABLE IF NOT EXISTS engagement_events (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  destination_id TEXT,
  comment_id TEXT NOT NULL UNIQUE,
  media_id TEXT,
  author_id TEXT,
  author_name TEXT,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','replied','skipped','failed','handoff')),
  detail TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  platform TEXT NOT NULL,
  campaign TEXT NOT NULL,
  tag TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  external_id TEXT
);
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('included','excluded','error')),
  error TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  meta_description TEXT,
  h1 TEXT,
  headings TEXT NOT NULL DEFAULT '[]',
  body_text TEXT NOT NULL DEFAULT '',
  content_hash TEXT,
  crawled_at TEXT,
  status_code INTEGER,
  changed INTEGER NOT NULL DEFAULT 0,
  locations TEXT NOT NULL DEFAULT '[]',
  UNIQUE (client_id, url)
);
CREATE TABLE IF NOT EXISTS keywords (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('primary','secondary','optional')),
  source TEXT NOT NULL DEFAULT 'user',
  seq BIGINT NOT NULL DEFAULT 0,
  UNIQUE (client_id, text)
);
CREATE TABLE IF NOT EXISTS crawls (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  site TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'done',
  started_at TEXT,
  discovered INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  requested_by TEXT,
  seq BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('parsed','committed')),
  rows TEXT NOT NULL,
  committed_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  used_cents INTEGER NOT NULL,
  budget_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
  is_platform_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  all_clients INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS client_access (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, client_id)
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('invite','reset')),
  email TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  payload TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS auth_tokens_email ON auth_tokens(kind, email);
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','outbox','failed')),
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  verifier TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS boosts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL,
  job_id TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  ad_account TEXT NOT NULL,
  campaign_id TEXT,
  adset_id TEXT,
  ad_id TEXT,
  budget_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL CHECK (status IN ('paused','active','failed')),
  error TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  ends_at TEXT
);
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  pid INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  beat_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('INFO','WARN','ERROR')),
  msg TEXT NOT NULL
);
`;

/** Columns added after the first SQLite release; old SQLite files get them on start-up. */
const ADDED_COLUMNS: Record<string, Record<string, string>> = {
  users: { all_clients: 'INTEGER NOT NULL DEFAULT 1' },
  jobs: { destination_id: 'TEXT', next_attempt_at: 'TEXT', last_error: 'TEXT', external_id: 'TEXT', external_url: 'TEXT', updated_at: 'TEXT' },
  pages: { meta_description: 'TEXT', h1: 'TEXT', headings: "TEXT NOT NULL DEFAULT '[]'", body_text: "TEXT NOT NULL DEFAULT ''", content_hash: 'TEXT', crawled_at: 'TEXT', status_code: 'INTEGER', changed: 'INTEGER NOT NULL DEFAULT 0', locations: "TEXT NOT NULL DEFAULT '[]'" },
  crawls: { status: "TEXT NOT NULL DEFAULT 'done'", started_at: 'TEXT', discovered: 'INTEGER NOT NULL DEFAULT 0', processed: 'INTEGER NOT NULL DEFAULT 0', failed: 'INTEGER NOT NULL DEFAULT 0', error: 'TEXT', requested_by: 'TEXT', seq: 'BIGINT NOT NULL DEFAULT 0' },
  connections: { external_id: 'TEXT', access_enc: 'TEXT', refresh_enc: 'TEXT', token_expires_at: 'TEXT', scope: 'TEXT' },
  destinations: { external_id: 'TEXT', token_enc: 'TEXT', enabled: 'INTEGER NOT NULL DEFAULT 1', seq: 'BIGINT NOT NULL DEFAULT 0' },
  posts: { media_url: "TEXT NOT NULL DEFAULT ''", media_id: 'TEXT', evergreen: 'INTEGER NOT NULL DEFAULT 0', evergreen_source: 'TEXT', approved_by: 'TEXT' },
  keywords: { source: "TEXT NOT NULL DEFAULT 'user'", seq: 'BIGINT NOT NULL DEFAULT 0' },
  automations: { last_run_at: 'TEXT', last_status: 'TEXT' },
  contacts: { external_id: 'TEXT' },
};

// ------------------------------------------------------------------ SQLite driver
async function sqliteDriver(): Promise<Driver> {
  const { DatabaseSync } = await import('node:sqlite');
  const file = process.env.SB_DB_PATH || path.join(process.cwd(), 'data', 'social-blast.db');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  // One connection, so a transaction must keep other async flows out until it ends.
  let active: Promise<void> | null = null;
  const gate = async () => { while (active && !als.getStore()) await active; };
  const norm = (params: Param[]) => params.map((p) => (p === undefined ? null : p));
  const d: Driver = {
    dialect: 'sqlite',
    async get(sql, params) { await gate(); return db.prepare(sql).get(...norm(params)) as Row | undefined; },
    async all(sql, params) { await gate(); return db.prepare(sql).all(...norm(params)) as Row[]; },
    async run(sql, params) { await gate(); return { changes: Number(db.prepare(sql).run(...norm(params)).changes) }; },
    async exec(sql) { await gate(); db.exec(sql); },
    async detached(sql, params) { try { db.prepare(sql).run(...norm(params)); } catch { /* logging must never break a request */ } },
    async tx(fn) {
      if (als.getStore()) return fn(); // nested: join the outer transaction
      while (active) await active;
      let release!: () => void;
      active = new Promise<void>((r) => { release = r; });
      db.exec('BEGIN');
      try {
        const out = await als.run({}, fn);
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        active = null;
        release();
      }
    },
    async close() { db.close(); },
  };
  return d;
}

// ------------------------------------------------------------------ PostgreSQL driver
/** `?` placeholders → `$1, $2…`, skipping quoted strings. */
export function toPgParams(sql: string): string {
  let out = '';
  let n = 0;
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    if (quote) { out += c; if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; out += c; continue; }
    out += c === '?' ? `$${++n}` : c;
  }
  return out;
}

function pgSchema(sql: string): string {
  return sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'BIGSERIAL PRIMARY KEY');
}

async function pgDriver(url: string): Promise<Driver> {
  const { Pool, types } = await import('pg');
  // COUNT/SUM come back as bigint/numeric strings; our values fit in a JS number.
  types.setTypeParser(20, (v: string) => Number(v));
  types.setTypeParser(1700, (v: string) => Number(v));
  const pool = new Pool({ connectionString: url, max: Number(process.env.SB_DB_POOL || 10), ssl: process.env.SB_DB_SSL === 'true' ? { rejectUnauthorized: process.env.SB_DB_SSL_STRICT !== 'false' } : undefined });
  type C = { query: (s: string, p?: unknown[]) => Promise<{ rows: Row[]; rowCount: number | null }> };
  const conn = (): C => (als.getStore()?.client as C | undefined) ?? (pool as unknown as C);
  return {
    dialect: 'postgres',
    async get(sql, params) { return (await conn().query(toPgParams(sql), params)).rows[0]; },
    async all(sql, params) { return (await conn().query(toPgParams(sql), params)).rows; },
    async run(sql, params) { return { changes: (await conn().query(toPgParams(sql), params)).rowCount ?? 0 }; },
    async exec(sql) { await conn().query(sql); },
    async detached(sql, params) { try { await pool.query(toPgParams(sql), params); } catch { /* ignore */ } },
    async tx(fn) {
      if (als.getStore()) return fn();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await als.run({ client }, fn);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); },
  };
}

// ------------------------------------------------------------------ setup
declare global {
  var __sbDriver: Promise<Driver> | undefined;
}

async function migrateSqlite(d: Driver) {
  for (const [table, cols] of Object.entries(ADDED_COLUMNS)) {
    const have = (await d.all(`PRAGMA table_info(${table})`, [])).map((c) => String(c.name));
    for (const [name, def] of Object.entries(cols)) if (!have.includes(name)) await d.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
  // Keep the original insertion order for rows created before `seq` existed.
  for (const t of ['destinations', 'keywords', 'crawls']) await d.exec(`UPDATE ${t} SET seq = rowid WHERE seq = 0`);
  await upgradeRows(d);
}

async function migratePg(d: Driver) {
  for (const [table, cols] of Object.entries(ADDED_COLUMNS)) {
    for (const [name, def] of Object.entries(cols)) await d.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${def}`);
  }
  await upgradeRows(d);
}

/** Data fixes for databases created by older versions (safe to run every start). */
async function upgradeRows(d: Driver) {
  // Auto-boost used to be a placeholder; it is a real automation now.
  await d.run(`UPDATE automations SET supported = 1, descr = ?, config = ?, stat1 = '0', stat1_label = 'boosts this month', stat2 = '$0', stat2_label = 'planned spend (mo)'
    WHERE kind = 'auto_boost' AND supported = 0`, [BOOST_DESC, JSON.stringify(BOOST_DEFAULTS)]);
}

export const BOOST_DESC = 'Promotes your best Facebook & Instagram posts with a capped Meta ads budget';
export const BOOST_DEFAULTS = { adAccountId: '', dailyBudgetCents: 500, days: 3, minEngagement: 20, monthlyCapCents: 5000, maxPerWeek: 1, countries: ['US'], ageMin: 18, ageMax: 65, startPaused: true };

async function open(): Promise<Driver> {
  const url = process.env.DATABASE_URL;
  const d = url && /^postgres(ql)?:\/\//.test(url) ? await pgDriver(url) : await sqliteDriver();
  if (d.dialect === 'postgres') {
    // Serialise schema set-up when several servers start at once.
    await d.tx(async () => {
      await d.exec('SELECT pg_advisory_xact_lock(424242)');
      await d.exec(pgSchema(SCHEMA));
      await migratePg(d);
    });
  } else {
    await d.exec(SCHEMA);
    await migrateSqlite(d);
  }
  return d;
}

let readyPromise: Promise<void> | null = null;
async function driver(): Promise<Driver> {
  globalThis.__sbDriver ??= open();
  const d = await globalThis.__sbDriver;
  // Seed / demo user once per process, after the schema exists.
  readyPromise ??= (async () => {
    const { seed } = await import('./seed');
    const { ensureDemoUser } = await import('./bootstrap');
    await duringSetup(async () => {
      const c = await d.get('SELECT COUNT(*) AS n FROM clients', []);
      if (Number(c?.n ?? 0) === 0 && process.env.SB_SEED !== 'false') await seed();
      await ensureDemoUser();
    });
  })();
  if (!seeding.getStore()) await readyPromise;
  return d;
}

/** Lets the seed and bootstrap run queries while `ready` is still pending. */
const seeding = new AsyncLocalStorage<boolean>();
export function duringSetup<T>(fn: () => Promise<T>): Promise<T> {
  return seeding.run(true, fn);
}

export const q = {
  async get<T = Row>(sql: string, ...params: Param[]): Promise<T | undefined> { return (await driver()).get(sql, params) as Promise<T | undefined>; },
  async all<T = Row>(sql: string, ...params: Param[]): Promise<T[]> { return (await driver()).all(sql, params) as Promise<T[]>; },
  async run(sql: string, ...params: Param[]): Promise<{ changes: number }> { return (await driver()).run(sql, params); },
  async exec(sql: string): Promise<void> { return (await driver()).exec(sql); },
  async count(sql: string, ...params: Param[]): Promise<number> { return Number((await (await driver()).get(sql, params))?.n ?? 0); },
};

export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  return (await driver()).tx(fn);
}

export async function dialect(): Promise<'sqlite' | 'postgres'> {
  return (await driver()).dialect;
}

/** Closes the connection (tests and the standalone worker on shutdown). */
export async function closeDb(): Promise<void> {
  if (!globalThis.__sbDriver) return;
  const d = await globalThis.__sbDriver;
  globalThis.__sbDriver = undefined;
  readyPromise = null;
  await d.close();
}

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

let seqCounter = 0;
/** Monotonic ordering value for rows that need insertion order (both databases). */
export function nextSeq(): number {
  return Date.now() * 1000 + (seqCounter++ % 1000);
}

/** Never throws and never joins the caller's transaction. */
export function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string): Promise<void> {
  return (async () => {
    try {
      globalThis.__sbDriver ??= open();
      const d = await globalThis.__sbDriver;
      await d.detached('INSERT INTO logs (at, level, msg) VALUES (?, ?, ?)', [new Date().toISOString(), level, msg]);
    } catch { /* ignore */ }
  })();
}
