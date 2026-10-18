import { q } from './db';
import { hashPassword } from './password';

export const DEMO_EMAIL = 'rhea@agency.example';
export const DEMO_PASSWORD = process.env.SB_DEMO_PASSWORD || 'socialblast-demo';

/**
 * Outside production, make sure there is a demo owner so the seeded workspace
 * can be explored. In production nobody is created: the first visitor sets up
 * the owner account at /login.
 */
export async function ensureDemoUser(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && !process.env.SB_DEMO_PASSWORD) return;
  if (process.env.SB_SEED === 'false') return;
  if ((await q.count('SELECT COUNT(*) AS n FROM users')) > 0) return;
  await q.run('INSERT INTO users (id,email,name,password_hash,role,is_platform_admin,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',
    'u_demo_owner', DEMO_EMAIL, 'Rhea Alvarez', hashPassword(DEMO_PASSWORD), 'owner', 1, new Date().toISOString());
}
