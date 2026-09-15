const express = require('express');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/authenticate');

const router = express.Router();

// GET /api/admins/:id
// Only authenticated admins can retrieve an admin record.
router.get('/:id', requireAuth(['admin']), async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, email, full_name, created_at FROM admins WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/admins/:id error:', err);
    res.status(500).json({ error: 'failed to load admin' });
  }
});

module.exports = router;
