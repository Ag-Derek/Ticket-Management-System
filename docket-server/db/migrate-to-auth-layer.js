// Migrates a database created under the pre-auth-layer schema:
//
//   1. admins.password_hash -> auth_credentials (owner_type = 'admin')
//      then dropped from admins, so admins stops holding credentials
//      directly and auth_credentials becomes the one place every
//      actor's login lives.
//   2. ticket_attachments gets the "belongs to a ticket XOR a comment"
//      CHECK constraint. SQLite has no ALTER TABLE ADD CONSTRAINT, so
//      this rebuilds the table (new table with the constraint, copy
//      rows, drop old, rename) — the standard SQLite pattern for
//      constraint changes, same idea as migrate-attachments.js already
//      uses PRAGMA table_info to stay idempotent.
//
// Safe to call on every server boot: each step first checks whether it's
// already been done and skips if so.
//
// Any existing row that violates the new attachment constraint (both
// ticket_id and comment_id null, or both set) is left in a
// '_ticket_attachments_orphaned' table instead of silently dropped, and
// logged so it can be reviewed by hand.

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

function tableSql(db, table) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return row ? row.sql : null;
}

function migrateAdminCredentials(db) {
  if (!hasColumn(db, 'admins', 'password_hash')) {
    return; // already migrated
  }

  const run = db.transaction(() => {
    const admins = db.prepare('SELECT id, password_hash FROM admins').all();
    const insertCred = db.prepare(
      `INSERT OR IGNORE INTO auth_credentials
         (owner_type, owner_id, auth_provider, password_hash, created_at, updated_at)
       VALUES ('admin', ?, 'local', ?, datetime('now'), datetime('now'))`
    );
    admins.forEach((a) => insertCred.run(a.id, a.password_hash));

    // SQLite (3.35+, bundled with modern better-sqlite3) supports DROP
    // COLUMN directly — no table rebuild needed for this one.
    db.exec('ALTER TABLE admins DROP COLUMN password_hash');
  });
  run();

  console.log(`Moved ${db.prepare('SELECT COUNT(*) AS n FROM auth_credentials WHERE owner_type = ?').get('admin').n} admin credential(s) into auth_credentials.`);
}

function ensureAttachmentConstraint(db) {
  const sql = tableSql(db, 'ticket_attachments');
  if (sql && sql.includes('CHECK')) {
    return; // constraint already present
  }

  const run = db.transaction(() => {
    db.exec(`
      CREATE TABLE ticket_attachments_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id     TEXT REFERENCES tickets(id),
        comment_id    INTEGER REFERENCES ticket_comments(id),
        filename      TEXT NOT NULL,
        stored_path   TEXT,
        mime_type     TEXT,
        size_bytes    INTEGER,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (
          (ticket_id IS NOT NULL AND comment_id IS NULL) OR
          (ticket_id IS NULL AND comment_id IS NOT NULL)
        )
      )
    `);

    const columns = db.prepare('PRAGMA table_info(ticket_attachments)').all().map((c) => c.name);
    const hasMime = columns.includes('mime_type');
    const hasSize = columns.includes('size_bytes');

    const rows = db.prepare('SELECT * FROM ticket_attachments').all();
    const valid = rows.filter((r) => (r.ticket_id != null) !== (r.comment_id != null));
    const orphaned = rows.filter((r) => (r.ticket_id != null) === (r.comment_id != null));

    const insert = db.prepare(`
      INSERT INTO ticket_attachments_new
        (id, ticket_id, comment_id, filename, stored_path, mime_type, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    valid.forEach((r) => insert.run(
      r.id, r.ticket_id, r.comment_id, r.filename, r.stored_path,
      hasMime ? r.mime_type : null, hasSize ? r.size_bytes : null, r.created_at
    ));

    db.exec('DROP TABLE ticket_attachments');
    db.exec('ALTER TABLE ticket_attachments_new RENAME TO ticket_attachments');
    db.exec('CREATE INDEX IF NOT EXISTS idx_attachments_ticket ON ticket_attachments(ticket_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_attachments_comment ON ticket_attachments(comment_id)');

    if (orphaned.length) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS _ticket_attachments_orphaned (
          id INTEGER, ticket_id TEXT, comment_id INTEGER, filename TEXT,
          stored_path TEXT, mime_type TEXT, size_bytes INTEGER, created_at TEXT,
          moved_at TEXT DEFAULT (datetime('now'))
        )
      `);
      const insertOrphan = db.prepare(`
        INSERT INTO _ticket_attachments_orphaned
          (id, ticket_id, comment_id, filename, stored_path, mime_type, size_bytes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      orphaned.forEach((r) => insertOrphan.run(
        r.id, r.ticket_id, r.comment_id, r.filename, r.stored_path,
        hasMime ? r.mime_type : null, hasSize ? r.size_bytes : null, r.created_at
      ));
      console.log(
        `${orphaned.length} attachment row(s) violated the new ticket/comment constraint ` +
        `(both null or both set) and were moved to _ticket_attachments_orphaned for review.`
      );
    }
  });
  run();

  console.log('ticket_attachments now enforces: belongs to a ticket XOR a comment.');
}

function migrateToAuthLayer(db) {
  // auth_credentials itself is created by schema.sql (CREATE TABLE IF NOT
  // EXISTS), which connection.js already runs before this is called.
  migrateAdminCredentials(db);
  ensureAttachmentConstraint(db);
}

module.exports = { migrateToAuthLayer };
