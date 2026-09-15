// One-off migration: copies every row out of the old local SQLite database
// (docket.db) into the new Supabase Postgres database, preserving existing
// IDs (USR-2026-000001 etc.) so the frontend never has to change how it
// references a record.
//
// Run once, by hand, after DATABASE_URL is set in .env and the Postgres
// schema has been created (db/connection.js's ensureSchema() runs that
// automatically the first time the server boots against DATABASE_URL):
//   node db/migrate-to-postgres.js
//
// Safe to re-run against an EMPTY Postgres database only — it does not
// upsert, so re-running after a partial success will hit duplicate-key
// errors on whatever already made it across. If that happens, truncate
// the Postgres tables (or restore from an earlier state) and start over
// rather than trying to resume partway.
//
// better-sqlite3 is a devDependency only, used here and nowhere else —
// production no longer touches SQLite at all.

require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');
const pg = require('./connection');

const SQLITE_PATH = process.env.SQLITE_SOURCE_PATH || path.join(__dirname, '..', 'docket.db');

// Parent tables before the children that reference them.
const TABLES = ['users', 'agents', 'admins', 'auth_credentials', 'tickets', 'ticket_comments', 'ticket_attachments'];

// Columns whose table uses GENERATED ALWAYS AS IDENTITY in Postgres —
// inserting an explicit value for those needs OVERRIDING SYSTEM VALUE,
// and the underlying sequence needs resetting afterward so the next
// normal insert doesn't collide with a migrated id.
const IDENTITY_TABLES = new Set(['auth_credentials', 'ticket_comments', 'ticket_attachments']);

// SQLite stored these as naive "YYYY-MM-DD HH:MM:SS" text (always UTC,
// from datetime('now')). Postgres's timestamptz columns need an
// unambiguous value — append a 'Z' via ISO shape rather than relying on
// the connection's session timezone setting.
const TIMESTAMP_COLUMNS = new Set(['created_at', 'updated_at', 'last_login_at']);

function toIso(value) {
  if (value == null) return null;
  const s = String(value);
  if (/Z|[+-]\d\d:?\d\d$/.test(s)) return s; // already has an offset/Z
  return s.replace(' ', 'T') + 'Z';
}

async function migrateTable(sqlite, table) {
  const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
  if (!rows.length) {
    console.log(`- ${table}: 0 rows (nothing to migrate)`);
    return 0;
  }

  const columns = Object.keys(rows[0]);
  const overriding = IDENTITY_TABLES.has(table) ? 'OVERRIDING SYSTEM VALUE ' : '';

  for (const row of rows) {
    const values = columns.map((c) => (TIMESTAMP_COLUMNS.has(c) ? toIso(row[c]) : row[c]));
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    await pg.query(
      `INSERT INTO ${table} (${columns.join(', ')}) ${overriding}VALUES (${placeholders})`,
      values
    );
  }

  if (IDENTITY_TABLES.has(table)) {
    await pg.query(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT COALESCE(MAX(id), 1) FROM ${table}))`
    );
  }

  console.log(`- ${table}: migrated ${rows.length} row(s)`);
  return rows.length;
}

async function main() {
  console.log(`Reading from ${SQLITE_PATH}`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  await pg.ensureSchema();

  let total = 0;
  for (const table of TABLES) {
    total += await migrateTable(sqlite, table);
  }

  sqlite.close();
  await pg.end();
  console.log(`Done. ${total} row(s) migrated.`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
