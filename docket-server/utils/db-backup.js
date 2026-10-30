const db = require('../db/connection');

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

// Restorable, but no longer written to new backups. It only holds the seeded
// admin's password hash, and db/seed.js recreates that from ADMIN_PASSWORD,
// so a backup has no need to carry a credential. It stays in TABLES so older
// backups that do contain it can still be restored.
const NOT_BACKED_UP = new Set(['auth_credentials']);

// Tables whose id is GENERATED ALWAYS AS IDENTITY. Restoring them needs
// OVERRIDING SYSTEM VALUE to keep the original ids (comments, attachments
// and read markers point at them), and their sequences moved past the
// restored ids afterwards so the next insert doesn't collide.
const IDENTITY_TABLES = new Set([
  'auth_credentials', 'ticket_comments', 'ticket_attachments', 'audit_logs', 'account_help_requests'
]);

// Every table is read inside one REPEATABLE READ transaction so they all
// describe the same moment. Read separately, a comment on a ticket created
// mid-backup could be saved without its ticket, and that one row would fail
// the foreign key and abort the whole restore.
async function snapshotDatabase() {
  return db.withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const dump = { createdAt: new Date().toISOString(), tables: {} };
    for (const table of TABLES.filter((t) => !NOT_BACKED_UP.has(t))) {
      const result = await client.query(`SELECT * FROM ${table}`);
      dump.tables[table] = result.rows;
    }
    return dump;
  });
}

function rowCounts(dump) {
  return Object.fromEntries(Object.entries(dump.tables).map(([table, rows]) => [table, rows.length]));
}

// Restores a dump produced by snapshotDatabase(). Destructive (TRUNCATE) and
// rare enough to only ever be run by hand — see scripts/backup.js.
async function restoreDump(dump) {
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

module.exports = { snapshotDatabase, restoreDump, rowCounts };
