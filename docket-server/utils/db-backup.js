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

// Order matters on restore: children (referencing a FK) after their
// parents. ticket_attachments references both tickets and ticket_comments;
// ticket_reads references tickets. audit_logs, account_help_requests and
// app_settings have no FKs.
//
// Deliberately left out: mfa_challenges and password_reset_tokens. Both
// hold short-lived codes/links that are expired long before a restore
// would ever happen, so there's nothing worth bringing back.
const TABLES = [
  'users', 'agents', 'admins', 'auth_credentials',
  'tickets', 'ticket_comments', 'ticket_attachments', 'ticket_reads',
  'audit_logs', 'account_help_requests', 'app_settings'
];

// Tables whose id is GENERATED ALWAYS AS IDENTITY. Restoring them needs
// OVERRIDING SYSTEM VALUE to keep the original ids (comments, attachments
// and read markers point at them), and their sequences moved past the
// restored ids afterwards so the next insert doesn't collide.
const IDENTITY_TABLES = new Set([
  'auth_credentials', 'ticket_comments', 'ticket_attachments', 'audit_logs', 'account_help_requests'
]);

// Postgres has no single-file binary snapshot the way better-sqlite3's
// db.backup() did — the database itself is managed by Supabase, not a
// file this app owns. Instead, this dumps every table's rows as JSON and
// uploads that to Supabase Storage: an application-level backup that's
// restorable with a plain INSERT loop (see restoreBackup below), and
// still lives off the Render disk entirely.
async function backupDatabase() {
  const dump = { createdAt: new Date().toISOString(), tables: {} };
  for (const table of TABLES) {
    const result = await db.query(`SELECT * FROM ${table}`);
    dump.tables[table] = result.rows;
  }

  const buffer = Buffer.from(JSON.stringify(dump), 'utf8');
  const key = `${BACKUP_PREFIX}/docket-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const { error } = await supabase.storage.from(BUCKET).upload(key, buffer, {
    upsert: false,
    contentType: 'application/json'
  });
  if (error) {
    throw new Error(`failed to upload backup: ${error.message}`);
  }

  const rowCounts = Object.fromEntries(TABLES.map((t) => [t, dump.tables[t].length]));
  return { key, sizeBytes: buffer.length, rowCounts };
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

// Fetches one backup's raw JSON bytes back out of Storage, for download
// or restore.
async function fetchBackup(name) {
  const { data, error } = await supabase.storage.from(BUCKET).download(`${BACKUP_PREFIX}/${name}`);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

// Restores a JSON dump produced by backupDatabase(). Deliberately not
// wired to any route — a restore is destructive (TRUNCATE) and rare
// enough to run by hand (node -e) rather than exposing it over HTTP.
async function restoreBackup(name) {
  const buffer = await fetchBackup(name);
  if (!buffer) throw new Error(`backup "${name}" not found`);
  const dump = JSON.parse(buffer.toString('utf8'));

  // Only the tables this backup actually contains. A backup taken before
  // audit_logs etc. were included must not wipe those tables on restore.
  // (TRUNCATE ... CASCADE on tickets still empties ticket_reads, since its
  // rows can't outlive the tickets they point at.)
  const tables = TABLES.filter((t) => Array.isArray(dump.tables[t]));

  await db.withTransaction(async (client) => {
    // Reverse order for TRUNCATE so a FK doesn't block dropping a parent
    // before its children are already gone; CASCADE handles it anyway,
    // but this keeps the intent explicit.
    for (const table of [...tables].reverse()) {
      await client.query(`TRUNCATE TABLE ${table} CASCADE`);
    }
    for (const table of tables) {
      const overriding = IDENTITY_TABLES.has(table) ? 'OVERRIDING SYSTEM VALUE' : '';
      for (const row of dump.tables[table]) {
        const columns = Object.keys(row);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        // JSONB values come back from the dump as parsed objects; pg would
        // send an array as a Postgres array, so stringify them explicitly.
        const values = columns.map((c) => (row[c] !== null && typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c]));
        await client.query(
          `INSERT INTO ${table} (${columns.join(', ')}) ${overriding} VALUES (${placeholders})`,
          values
        );
      }
      if (IDENTITY_TABLES.has(table)) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${table}`
        );
      }
    }
  });
}

module.exports = { backupDatabase, listBackups, fetchBackup, restoreBackup };
