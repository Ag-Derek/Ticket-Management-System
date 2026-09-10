const express = require('express');
const db = require('../db/connection');
const { ensureAttachmentColumns } = require('../db/migrate-attachments');
const { saveAttachmentFile } = require('../utils/attachment-storage');

// mergeParams so this router can read :ticketId from the parent
// tickets router it's mounted under (see server.js).
const router = express.Router({ mergeParams: true });

// Safe to call on every boot — see migrate-attachments.js for why. Also
// called from tickets.js; either one running first is fine, it's a no-op
// once the columns exist.
ensureAttachmentColumns(db);

// GET /api/tickets/:ticketId/comments?visibility=public|internal
router.get('/', (req, res) => {
  const ticket = db.prepare('SELECT id FROM tickets WHERE id = ?').get(req.params.ticketId);
  if (!ticket) return res.status(404).json({ error: 'ticket not found' });

  const { visibility } = req.query;
  let sql = 'SELECT * FROM ticket_comments WHERE ticket_id = ?';
  const params = [req.params.ticketId];

  if (visibility) {
    sql += ' AND visibility = ?';
    params.push(visibility);
  }
  sql += ' ORDER BY created_at ASC';

  const comments = db.prepare(sql).all(...params);
  // Files carry an id (so the client can build a download link) and
  // filename only — stored_path is a server filesystem path and never
  // goes to the client.
  const withFiles = comments.map((c) => ({
    ...c,
    files: db.prepare('SELECT id, filename FROM ticket_attachments WHERE comment_id = ?').all(c.id)
  }));
  res.json(withFiles);
});

// Validates one incoming attachment payload and — if it carries content —
// writes it to disk immediately. Same contract as tickets.js's
// normalizeIncomingAttachment (kept as a separate copy here since these
// two routers don't currently share a utils file for the validation
// shape, only for the actual disk-write logic in attachment-storage.js).
function normalizeIncomingAttachment(ticketId, a) {
  if (!a) return null;
  if (typeof a === 'string') {
    const filename = a.trim();
    return filename ? { filename, mime_type: null, size_bytes: null, stored_path: null } : null;
  }
  const filename = a.filename && String(a.filename).trim();
  if (!filename) return null;
  if (!a.content_base64) {
    return { filename, mime_type: a.mime_type || null, size_bytes: null, stored_path: null };
  }
  const { storedPath, sizeBytes } = saveAttachmentFile(ticketId, filename, a.content_base64);
  return { filename, mime_type: a.mime_type || null, size_bytes: sizeBytes, stored_path: storedPath };
}

// POST /api/tickets/:ticketId/comments
// { author_type: 'customer'|'agent'|'admin', author_name, visibility?: 'public'|'internal', body,
//   files?: [{ filename, content_base64, mime_type? }, ...] }
// A message needs text or at least one file — matches the chat composer,
// which blocks sending an empty message with no attachment.
router.post('/', (req, res) => {
  const ticket = db.prepare('SELECT id FROM tickets WHERE id = ?').get(req.params.ticketId);
  if (!ticket) return res.status(404).json({ error: 'ticket not found' });

  const { author_type, author_name, visibility, body, files } = req.body || {};

  if (!['customer', 'agent', 'admin'].includes(author_type)) {
    return res.status(400).json({ error: "author_type must be 'customer', 'agent', or 'admin'" });
  }
  if (!author_name || !author_name.trim()) {
    return res.status(400).json({ error: 'author_name is required' });
  }

  // Files are written to disk before the comment row exists — same
  // fail-before-creating-anything ordering as ticket creation.
  let normalizedFiles;
  try {
    normalizedFiles = Array.isArray(files)
      ? files.map((f) => normalizeIncomingAttachment(req.params.ticketId, f)).filter(Boolean)
      : [];
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if ((!body || !body.trim()) && !normalizedFiles.length) {
    return res.status(400).json({ error: 'a message needs body text or at least one file' });
  }
  const vis = visibility || 'public';
  if (!['public', 'internal'].includes(vis)) {
    return res.status(400).json({ error: "visibility must be 'public' or 'internal'" });
  }
  // Only agents/admins can post internal notes — matches the chat's
  // visibility toggle, which is hidden entirely for the customer role.
  if (author_type === 'customer' && vis === 'internal') {
    return res.status(400).json({ error: 'customer comments cannot be marked internal' });
  }

  const commentId = db.transaction(() => {
    const result = db.prepare(
      `INSERT INTO ticket_comments (ticket_id, author_type, author_name, visibility, body)
       VALUES (?, ?, ?, ?, ?)`
    ).run(req.params.ticketId, author_type, author_name.trim(), vis, (body || '').trim());

    if (normalizedFiles.length) {
      const insertAttachment = db.prepare(
        `INSERT INTO ticket_attachments (ticket_id, comment_id, filename, mime_type, size_bytes, stored_path)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      normalizedFiles.forEach((f) => {
        insertAttachment.run(req.params.ticketId, result.lastInsertRowid, f.filename, f.mime_type, f.size_bytes, f.stored_path);
      });
    }

    db.prepare(`UPDATE tickets SET updated_at = datetime('now') WHERE id = ?`).run(req.params.ticketId);
    return result.lastInsertRowid;
  })();

  const created = db.prepare('SELECT * FROM ticket_comments WHERE id = ?').get(commentId);
  const createdFiles = db.prepare('SELECT id, filename FROM ticket_attachments WHERE comment_id = ?').all(commentId);
  res.status(201).json({ ...created, files: createdFiles });
});

module.exports = router;
