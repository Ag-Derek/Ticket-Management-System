const express = require('express');
const db = require('../db/connection');
const { nextId } = require('../utils/ids');
const { signToken } = require('../middleware/authenticate');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/users
// Creates a new user profile, or — if a user with this email already
// exists — returns that existing record instead of erroring, so the
// front end can treat "sign up" and "returning visitor" the same way.
//
// Customers have no password of their own (same "email is the whole
// identity" trust level as agent self-signup — see agents.js), so a
// session token is minted and returned right here rather than requiring
// a separate POST /api/auth/login call the customer has no credentials
// for.
router.post('/', async (req, res) => {
  const { full_name, email, phone, department, organization } = req.body || {};

  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ error: 'full_name is required' });
  }
  if (!email || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'a valid email is required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const existingResult = await db.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    const existing = existingResult.rows[0];
    if (existing) {
      const token = signToken({ ownerType: 'user', ownerId: existing.id });
      return res.status(200).json({ ...existing, returning: true, token });
    }

    const id = await nextId(db, 'users', 'USR');
    const insertResult = await db.query(
      `INSERT INTO users (id, full_name, email, phone, department, organization)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, full_name.trim(), normalizedEmail, phone || null, department || null, organization || null]
    );
    const token = signToken({ ownerType: 'user', ownerId: id });
    res.status(201).json({ ...insertResult.rows[0], returning: false, token });
  } catch (err) {
    console.error('POST /api/users error:', err);
    res.status(500).json({ error: 'failed to save profile' });
  }
});

// GET /api/users/by-email/:email
router.get('/by-email/:email', async (req, res) => {
  const email = req.params.email.trim().toLowerCase();
  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/users/by-email error:', err);
    res.status(500).json({ error: 'failed to load user' });
  }
});

// GET /api/users/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/users/:id error:', err);
    res.status(500).json({ error: 'failed to load user' });
  }
});

// GET /api/users
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/users error:', err);
    res.status(500).json({ error: 'failed to load users' });
  }
});

module.exports = router;
