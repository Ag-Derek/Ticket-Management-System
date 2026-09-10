const express = require('express');
const db = require('../db/connection');

const router = express.Router();

// GET /api/attachments/:id — streams the stored file back with its
// original filename and mime type. 404s both for ids that don't exist and
// for attachments written before this feature existed (filename only, no
// content_base64 to serve).
router.get('/:id', (req, res) => {
  const row = db.prepare(
    'SELECT filename, mime_type, content_base64 FROM ticket_attachments WHERE id = ?'
  ).get(req.params.id);

  if (!row || !row.content_base64) {
    return res.status(404).json({ error: 'attachment not found' });
  }

  const buffer = Buffer.from(row.content_base64, 'base64');
  res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="' + String(row.filename).replace(/"/g, '') + '"'
  );
  res.send(buffer);
});

module.exports = router;
