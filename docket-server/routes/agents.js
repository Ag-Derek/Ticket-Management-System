const express = require('express');
const db = require('../db/connection');
const { nextId } = require('../utils/ids');
const { signToken } = require('../middleware/authenticate');
const { recordAuditLog } = require('../utils/audit');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_CREATED_BY = ['seed', 'self-signup', 'admin'];

// GET /api/agents
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM agents ORDER BY full_name ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/agents error:', err);
    res.status(500).json({ error: 'failed to load agents' });
  }
});

// GET /api/agents/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM agents WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/agents/:id error:', err);
    res.status(500).json({ error: 'failed to load agent' });
  }
});

// POST /api/agents
// Two real callers with different rules, same endpoint:
//  1. Agent self-sign-in (agent-login.html) — any work email signs in as a
//     demo agent; find-or-create by email, created_by defaults to
//     'self-signup'.
//  2. Admin "add an agent" (admin-dashboard.html) — created_by: 'admin',
//     and a duplicate email is a hard error there (the admin form checks
//     first), not a silent return-existing like sign-in does.
//
// Same "no real credential, email is the whole identity" trust level as
// before — self-signup never had a password to check. A session token is
// minted on the way out so the client has something to send on its later
// requireAuth()-protected calls.
router.post('/', async (req, res) => {
  const { full_name, email, created_by } = req.body || {};
  const createdBy = VALID_CREATED_BY.includes(created_by) ? created_by : 'self-signup';

  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ error: 'full_name is required' });
  }
  if (!email || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'a valid email is required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const existingResult = await db.query('SELECT * FROM agents WHERE email = $1', [normalizedEmail]);
    const existing = existingResult.rows[0];

    if (existing) {
      if (createdBy === 'admin') {
        return res.status(409).json({ error: 'an agent with this email already exists' });
      }
      const token = signToken({ ownerType: 'agent', ownerId: existing.id });
      return res.status(200).json({ ...existing, returning: true, token });
    }

    const id = await nextId(db, 'agents', 'AGT');
    const insertResult = await db.query(
      'INSERT INTO agents (id, full_name, email, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [id, full_name.trim(), normalizedEmail, createdBy]
    );
    const token = signToken({ ownerType: 'agent', ownerId: id });

    recordAuditLog({
      actorType: createdBy === 'admin' ? 'admin' : 'agent',
      actorName: createdBy === 'admin' ? 'Admin console' : full_name.trim(),
      action: 'agent.created',
      entityType: 'agent',
      entityId: id,
      details: { email: normalizedEmail, created_by: createdBy }
    });

    res.status(201).json({ ...insertResult.rows[0], returning: false, token });
  } catch (err) {
    console.error('POST /api/agents error:', err);
    res.status(500).json({ error: 'failed to save agent' });
  }
});

// GET /api/agents/:id/tickets — tickets currently assigned to this agent
router.get('/:id/tickets', async (req, res) => {
  try {
    const agentResult = await db.query('SELECT id FROM agents WHERE id = $1', [req.params.id]);
    if (!agentResult.rows[0]) return res.status(404).json({ error: 'not found' });

    const ticketsResult = await db.query(
      'SELECT * FROM tickets WHERE assigned_agent_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(ticketsResult.rows);
  } catch (err) {
    console.error('GET /api/agents/:id/tickets error:', err);
    res.status(500).json({ error: 'failed to load tickets' });
  }
});

module.exports = router;
