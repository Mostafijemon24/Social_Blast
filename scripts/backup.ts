/**
 * Makes a backup now: `SB_BACKUP_DIR=/var/backups/socialblast npm run backup`
 * Uses the same settings as the app (DATABASE_URL or SB_DB_PATH, SB_UPLOAD_DIR,
 * SB_BACKUP_S3_BUCKET…). Exit code 1 when it fails, so cron can report it.
 */
async function main() {
  process.env.SB_SEED = 'false';
  const { runBackup } = await import('../src/server/backup');
  const { closeDb } = await import('../src/server/db');
  const r = await runBackup();
  await closeDb();
  if (!r.ok) { console.error(`Backup failed: ${r.error}`); process.exit(1); }
  for (const f of r.files) console.log(`${f.name}  ${(f.bytes / 1024).toFixed(0)} KB`);
  console.log(`Backup saved to ${process.env.SB_BACKUP_DIR}`);
}
main().catch((e) => { console.error(`Backup failed: ${(e as Error).message}`); process.exit(1); });
