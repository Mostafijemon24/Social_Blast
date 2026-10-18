// Shared test set-up. Tests run on SQLite (in memory) by default, or on
// PostgreSQL when DATABASE_URL is set (see `npm run test:pg`).
export function testEnv(extra: Record<string, string> = {}) {
  if (!process.env.DATABASE_URL) process.env.SB_DB_PATH = ':memory:';
  process.env.SB_SEED = 'false';
  process.env.SB_DEMO_PASSWORD = '';
  Object.assign(process.env, extra);
}

const TABLES = ['boosts', 'post_metrics', 'engagement_events', 'media_variants', 'jobs', 'post_destinations', 'post_variants', 'posts', 'media', 'destinations', 'connections',
  'contacts', 'pages', 'keywords', 'crawls', 'activity', 'imports', 'automations', 'client_access', 'auth_tokens', 'sessions', 'oauth_states', 'emails', 'users', 'ai_usage', 'clients', 'kv', 'worker_heartbeats'];

export async function resetDb() {
  const { q } = await import('../src/server/db');
  for (const t of TABLES) await q.run(`DELETE FROM ${t}`);
}

export async function row(sql: string, ...a: (string | number | null)[]): Promise<Record<string, unknown>> {
  const { q } = await import('../src/server/db');
  return (await q.get(sql, ...a)) ?? {};
}
