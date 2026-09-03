const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');

const router = express.Router();

// POST /api/admins/login  { email, password }
// Replaces the old client-side plaintext string check with a real
// bcrypt.compare() against the hash seed.js stores.
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email.trim().toLowerCase());

  // Same generic error whether the email doesn't exist or the password is
  // wrong — don't reveal which one it was.
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }

  const { password_hash, ...safeAdmin } = admin;
  res.json(safeAdmin);
});

// GET /api/admins/:id  (no password_hash in the response)
router.get('/:id', (req, res) => {
  const admin = db.prepare('SELECT id, email, full_name, created_at FROM admins WHERE id = ?').get(req.params.id);
  if (!admin) return res.status(404).json({ error: 'not found' });
  res.json(admin);
});

module.exports = router;
