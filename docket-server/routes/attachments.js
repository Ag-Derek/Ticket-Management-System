const express = require('express');
const db = require('../db/connection');

const router = express.Router();

// GET /api/attachments/:id — streams the file back from disk (stored_path)
// under its original filename. res.download sets Content-Disposition from
// the filename argument (not the on-disk name, which has a random
// collision-avoidance prefix — see saveAttachmentFile) and infers
// Content-Type from its extension.
//
// stored_path itself is never sent to the client — it's a server
// filesystem path, not something the front end needs or should see.
router.get('/:id', (req, res) => {
  const row = db.prepare(
    'SELECT filename, stored_path FROM ticket_attachments WHERE id = ?'
  ).get(req.params.id);

  if (!row || !row.stored_path) {
    return res.status(404).json({ error: 'attachment not found' });
  }

  res.download(row.stored_path, row.filename, (err) => {
    // res.download calls back with an error if the file is missing on
    // disk (or any other stream error) — respond once, only if headers
    // haven't already gone out.
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'attachment file is missing on disk' });
    }
  });
});

module.exports = router;
