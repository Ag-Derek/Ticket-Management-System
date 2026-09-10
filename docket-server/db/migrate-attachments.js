// Adds the columns real file storage needs to the existing
// `ticket_attachments` table, which until now only stored a bare
// `filename` (chosen in the browser, never actually read or sent
// anywhere). SQLite has no "ADD COLUMN IF NOT EXISTS", so this checks
// PRAGMA table_info first rather than wrapping each ALTER in a try/catch —
// safe to call on every server boot.
function ensureAttachmentColumns(db) {
  const columns = db.prepare("PRAGMA table_info(ticket_attachments)").all().map((c) => c.name);

  if (!columns.includes('content_base64')) {
    db.exec('ALTER TABLE ticket_attachments ADD COLUMN content_base64 TEXT');
  }
  if (!columns.includes('mime_type')) {
    db.exec('ALTER TABLE ticket_attachments ADD COLUMN mime_type TEXT');
  }
  if (!columns.includes('size_bytes')) {
    db.exec('ALTER TABLE ticket_attachments ADD COLUMN size_bytes INTEGER');
  }
}

module.exports = { ensureAttachmentColumns };
