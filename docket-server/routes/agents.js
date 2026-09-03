const express = require('express');
const db = require('../db/connection');
const { nextId } = require('../utils/ids');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_CREATED_BY = ['seed', 'self-signup', 'admin'];

// GET /api/agents
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM agents ORDER BY full_name ASC').all());
});

// GET /api/agents/:id
router.get('/:id', (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'not found' });
  res.json(agent);
});

// POST /api/agents
// Two real callers with different rules, same endpoint:
//  1. Agent self-sign-in (agent-login.html) — any work email signs in as a
//     demo agent; find-or-create by email, created_by defaults to
//     'self-signup'.
//  2. Admin "add an agent" (admin-dashboard.html) — created_by: 'admin',
//     and a duplicate email is a hard error there (the admin form checks
//     first), not a silent return-existing like sign-in does.
router.post('/', (req, res) => {
  const { full_name, email, created_by } = req.body || {};
  const createdBy = VALID_CREATED_BY.includes(created_by) ? created_by : 'self-signup';

  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ error: 'full_name is required' });
  }
  if (!email || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'a valid email is required' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT * FROM agents WHERE email = ?').get(normalizedEmail);

  if (existing) {
    if (createdBy === 'admin') {
      return res.status(409).json({ error: 'an agent with this email already exists' });
    }
    return res.status(200).json({ ...existing, returning: true });
  }

  const id = nextId(db, 'agents', 'AGT');
  db.prepare('INSERT INTO agents (id, full_name, email, created_by) VALUES (?, ?, ?, ?)')
    .run(id, full_name.trim(), normalizedEmail, createdBy);

  const created = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  res.status(201).json({ ...created, returning: false });
});

// GET /api/agents/:id/tickets — tickets currently assigned to this agent
router.get('/:id/tickets', (req, res) => {
  const agent = db.prepare('SELECT id FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'not found' });

  const tickets = db
    .prepare('SELECT * FROM tickets WHERE assigned_agent_id = ? ORDER BY created_at DESC')
    .all(req.params.id);
  res.json(tickets);
});

module.exports = router;
