const express = require('express');
const db = require('../db/connection');

// mergeParams so this router can read :ticketId from the parent
// tickets router it's mounted under (see server.js).
const router = express.Router({ mergeParams: true });

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
  const withFiles = comments.map((c) => ({
    ...c,
    files: db.prepare('SELECT filename FROM ticket_attachments WHERE comment_id = ?').all(c.id).map((r) => r.filename)
  }));
  res.json(withFiles);
});

// POST /api/tickets/:ticketId/comments
// { author_type: 'customer'|'agent'|'admin', author_name, visibility?: 'public'|'internal', body, files?: [filename,...] }
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
  const hasFiles = Array.isArray(files) && files.filter((f) => f && String(f).trim()).length > 0;
  if ((!body || !body.trim()) && !hasFiles) {
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

    if (hasFiles) {
      const insertAttachment = db.prepare(
        'INSERT INTO ticket_attachments (ticket_id, comment_id, filename) VALUES (?, ?, ?)'
      );
      files.forEach((filename) => {
        if (filename && String(filename).trim()) {
          insertAttachment.run(req.params.ticketId, result.lastInsertRowid, String(filename).trim());
        }
      });
    }

    db.prepare(`UPDATE tickets SET updated_at = datetime('now') WHERE id = ?`).run(req.params.ticketId);
    return result.lastInsertRowid;
  })();

  const created = db.prepare('SELECT * FROM ticket_comments WHERE id = ?').get(commentId);
  const createdFiles = db.prepare('SELECT filename FROM ticket_attachments WHERE comment_id = ?').all(commentId).map((r) => r.filename);
  res.status(201).json({ ...created, files: createdFiles });
});

module.exports = router;
