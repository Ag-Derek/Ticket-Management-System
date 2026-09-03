// Single shared better-sqlite3 connection.
// better-sqlite3 is synchronous by design — no async/await needed for queries,
// which keeps route handlers simple. The trade-off is that a slow query blocks
// the event loop, which is a non-issue at this scale (local dev / small team).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'docket.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Apply schema on every startup — all statements use CREATE TABLE IF NOT
// EXISTS, so this is safe to re-run and doubles as a lightweight migration
// for anyone who pulls a fresh copy of the repo without the .db file.
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

module.exports = db;
