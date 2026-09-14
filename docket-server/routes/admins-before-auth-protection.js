const express = require('express');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/authenticate');

const router = express.Router();

// GET /api/admins/:id
// Only authenticated admins can retrieve an admin record.
router.get('/:id', requireAuth(['admin']), (req, res) => {
  const admin = db
    .prepare(
      'SELECT id, email, full_name, created_at FROM admins WHERE id = ?'
    )
    .get(req.params.id);

  if (!admin) {
    return res.status(404).json({ error: 'not found' });
  }

  res.json(admin);
});

module.exports = router;
