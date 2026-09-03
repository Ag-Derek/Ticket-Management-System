const express = require('express');
const db = require('../db/connection');
const { nextId } = require('../utils/ids');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/users
// Creates a new user profile, or — if a user with this email already
// exists — returns that existing record instead of erroring, so the
// front end can treat "sign up" and "returning visitor" the same way.
router.post('/', (req, res) => {
  const { full_name, email, phone, department, organization } = req.body || {};

  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ error: 'full_name is required' });
  }
  if (!email || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'a valid email is required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(200).json({ ...existing, returning: true });
  }

  const id = nextId(db, 'users', 'USR');
  db.prepare(
    `INSERT INTO users (id, full_name, email, phone, department, organization)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, full_name.trim(), normalizedEmail, phone || null, department || null, organization || null);

  const created = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.status(201).json({ ...created, returning: false });
});

// GET /api/users/by-email/:email
router.get('/by-email/:email', (req, res) => {
  const email = req.params.email.trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json(user);
});

// GET /api/users/:id
router.get('/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json(user);
});

// GET /api/users
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY created_at DESC').all());
});

module.exports = router;
