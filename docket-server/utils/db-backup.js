const path = require('path');
const fs = require('fs');
const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const db = require('../db/connection');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'attachments';
const BACKUP_PREFIX = '_db-backups';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Snapshots the live database via SQLite's own backup API — safe to run
// against a database under active WAL-mode writes, unlike copying the raw
// .db file directly, which can grab it mid-write or miss data still sitting
// in the -wal file. The result is uploaded to Supabase Storage, off the
// Render disk entirely, so a lost/corrupted disk (or an accidental wipe of
// DB_PATH) doesn't take the only copy of the data down with it.
async function backupDatabase() {
  const tmpPath = path.join(os.tmpdir(), `docket-backup-${Date.now()}.db`);
  await db.backup(tmpPath);
  const buffer = fs.readFileSync(tmpPath);
  fs.unlinkSync(tmpPath);

  const key = `${BACKUP_PREFIX}/docket-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
  const { error } = await supabase.storage.from(BUCKET).upload(key, buffer, { upsert: false });
  if (error) {
    throw new Error(`failed to upload backup: ${error.message}`);
  }

  return { key, sizeBytes: buffer.length };
}

async function listBackups() {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(BACKUP_PREFIX, { sortBy: { column: 'created_at', order: 'desc' } });
  if (error) {
    throw new Error(`failed to list backups: ${error.message}`);
  }
  return (data || [])
    .filter((f) => f.id) // Supabase list() can include a placeholder row for an empty prefix
    .map((f) => ({ name: f.name, sizeBytes: f.metadata && f.metadata.size, createdAt: f.created_at }));
}

// Fetches one backup's bytes back out of Storage so it can be restored
// (loaded into a fresh better-sqlite3 Database) or downloaded for offline
// safekeeping.
async function fetchBackup(name) {
  const { data, error } = await supabase.storage.from(BUCKET).download(`${BACKUP_PREFIX}/${name}`);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

module.exports = { backupDatabase, listBackups, fetchBackup };
