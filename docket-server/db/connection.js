// Shared Postgres connection pool (Supabase). Replaces the old
// better-sqlite3 file — the app is now stateless with respect to Render's
// filesystem, so a redeploy/restart can no longer wipe ticket data the way
// a plain SQLite file on an unmounted disk could.
//
// Queries are async (pg.Pool.query returns a Promise), unlike
// better-sqlite3's synchronous API — every route/middleware that touches
// the database is `async` now and uses `$1, $2, ...` placeholders instead
// of `?`.

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL must be set');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Supabase's Postgres requires TLS; rejectUnauthorized: false avoids
  // needing its CA bundle installed locally/on Render. The connection
  // itself is still encrypted — this only skips verifying the certificate
  // chain, standard practice for connecting to Supabase from app code.
  ssl: { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  // A background/idle client emitting an error (e.g. the connection was
  // dropped) would otherwise crash the whole process as an uncaught
  // exception — log it and let the pool reconnect on the next query.
  console.error('Unexpected Postgres pool error:', err);
});

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Applies schema.sql on boot — every statement uses CREATE TABLE/INDEX IF
// NOT EXISTS, so this is safe to re-run and doubles as the migration path
// for a fresh database. pool.query() with no parameters uses Postgres's
// simple query protocol, which (unlike a parameterized query) allows
// multiple semicolon-separated statements in one call.
async function ensureSchema() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await pool.query(schema);
}

// Runs `fn` against a single checked-out client inside BEGIN/COMMIT —
// unlike better-sqlite3's synchronous db.transaction(), a Postgres
// transaction needs one dedicated connection for its whole lifetime
// rather than pool.query()'s "any connection, per call" default, or two
// statements in the "same transaction" could actually land on different
// connections. Rolls back and rethrows on any failure inside `fn`.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = pool;
module.exports.ensureSchema = ensureSchema;
module.exports.withTransaction = withTransaction;
