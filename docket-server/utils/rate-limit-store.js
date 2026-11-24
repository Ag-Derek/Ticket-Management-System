// An express-rate-limit store that keeps hit counts in the rate_limits
// table instead of process memory, so a restart or deploy doesn't reset
// them and every instance of the server shares one count per client.
//
// Each limiter gets its own store with its own key prefix, so two limiters
// never add to each other's counts. Times come from Postgres's now(), not
// this process's clock, so instances whose clocks differ still agree on
// when a window ends.

const defaultDb = require('../db/connection');

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

// One statement, so concurrent hits for the same key are all counted:
// Postgres locks the row for ON CONFLICT DO UPDATE, and each hit sees the
// previous one's result. A row whose window has ended starts over at 1
// with a new reset_at. The window length is passed in milliseconds.
const INCREMENT_SQL = `
  INSERT INTO rate_limits AS r (key, hits, reset_at)
  VALUES ($1, 1, now() + $2::double precision * interval '1 millisecond')
  ON CONFLICT (key) DO UPDATE SET
    hits     = CASE WHEN r.reset_at <= now() THEN 1 ELSE r.hits + 1 END,
    reset_at = CASE WHEN r.reset_at <= now() THEN EXCLUDED.reset_at ELSE r.reset_at END
  RETURNING hits, reset_at`;

class PostgresRateLimitStore {
  // prefix: kept apart per limiter, e.g. 'auth:'. db: anything with a
  // pg-style query(sql, params); the shared pool unless a test passes one.
  constructor({ prefix, db = defaultDb } = {}) {
    if (!prefix) throw new Error('PostgresRateLimitStore needs a key prefix');
    this.prefix = prefix;
    this.db = db;
    // Tells express-rate-limit the counts are shared, not per instance.
    this.localKeys = false;
    this.windowMs = undefined;
  }

  // Called by express-rate-limit with the limiter's options.
  init(options) {
    this.windowMs = options.windowMs;
  }

  async get(key) {
    const { rows } = await this.db.query(
      'SELECT hits, reset_at FROM rate_limits WHERE key = $1 AND reset_at > now()',
      [this.prefix + key]
    );
    return rows.length ? toInfo(rows[0]) : undefined;
  }

  async increment(key) {
    const { rows } = await this.db.query(INCREMENT_SQL, [this.prefix + key, this.windowMs]);
    return toInfo(rows[0]);
  }

  async decrement(key) {
    await this.db.query(
      'UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = $1 AND reset_at > now()',
      [this.prefix + key]
    );
  }

  async resetKey(key) {
    await this.db.query('DELETE FROM rate_limits WHERE key = $1', [this.prefix + key]);
  }
}

function toInfo(row) {
  return { totalHits: Number(row.hits), resetTime: new Date(row.reset_at) };
}

// Rows whose window has ended count for nothing; this stops the ones whose
// client never comes back from piling up. Covers every limiter at once.
async function deleteExpiredRateLimits(db = defaultDb) {
  const { rowCount } = await db.query('DELETE FROM rate_limits WHERE reset_at <= now()');
  return rowCount;
}

// Started by server.js once the database is set up, like the message
// reminders. unref() so it never keeps the process alive on its own.
function startRateLimitCleanup() {
  const sweep = () => deleteExpiredRateLimits()
    .catch((err) => console.error('[rate-limits] cleanup failed:', err));
  sweep();
  setInterval(sweep, CLEANUP_INTERVAL_MS).unref();
}

module.exports = { PostgresRateLimitStore, deleteExpiredRateLimits, startRateLimitCleanup };
