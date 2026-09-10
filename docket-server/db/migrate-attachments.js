// `ticket_attachments` already ships with `id`, `stored_path`, and
// `filename` in schema.sql — stored_path was reserved for this feature
// from the start, just unused until now. This only needs to add the two
// columns that were never there: mime_type and size_bytes. SQLite has no
// "ADD COLUMN IF NOT EXISTS", so this checks PRAGMA table_info first
// rather than wrapping each ALTER in a try/catch — safe to call on every
// server boot.
function ensureAttachmentColumns(db) {
  const columns = db.prepare("PRAGMA table_info(ticket_attachments)").all().map((c) => c.name);

  if (!columns.includes('mime_type')) {
    db.exec('ALTER TABLE ticket_attachments ADD COLUMN mime_type TEXT');
  }
  if (!columns.includes('size_bytes')) {
    db.exec('ALTER TABLE ticket_attachments ADD COLUMN size_bytes INTEGER');
  }
}

module.exports = { ensureAttachmentColumns };
