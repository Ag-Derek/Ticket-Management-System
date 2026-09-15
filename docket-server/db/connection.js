// Single shared better-sqlite3 connection.
// better-sqlite3 is synchronous by design — no async/await needed for queries,
// which keeps route handlers simple. The trade-off is that a slow query blocks
// the event loop, which is a non-issue at this scale (local dev / small team).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Render's filesystem is ephemeral outside a mounted persistent disk —
// every redeploy/restart rebuilds it from the build output, wiping a plain
// file inside the app directory. DB_PATH lets production point this at the
// same persistent disk already mounted for attachments (e.g.
// /data/docket.db), while local dev keeps the old repo-relative default.
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'docket.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Apply schema on every startup — all statements use CREATE TABLE IF NOT
// EXISTS, so this is safe to re-run and doubles as a lightweight migration
// for anyone who pulls a fresh copy of the repo without the .db file.
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

// Both migrations below are idempotent (they check current state before
// doing anything), so it's safe to run them on every boot rather than
// tracking a separate "have I migrated" flag.
const { ensureAttachmentColumns } = require('./migrate-attachments');
ensureAttachmentColumns(db);

const { migrateToAuthLayer } = require('./migrate-to-auth-layer');
migrateToAuthLayer(db);

module.exports = db;
