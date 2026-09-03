const express = require('express');
const db = require('../db/connection');
const { nextId } = require('../utils/ids');

const router = express.Router();

const VALID_CATEGORIES = ['Network', 'Application', 'Hardware', 'Access & Identity'];
const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

// Pulled directly from app.js's teamByCategory / slaByPriority — the server
// is now the single source of truth for these, so the client no longer
// needs (or should keep) its own copies once it's wired to this API.
const TEAM_BY_CATEGORY = {
  Network: 'Network Support',
  Application: 'Application Support',
  Hardware: 'Infrastructure',
  'Access & Identity': 'Access & Identity'
};

const SLA_BY_PRIORITY = {
  Critical: { response: '15 min', resolution: '4 hrs' },
  High: { response: '30 min', resolution: '8 hrs' },
  Medium: { response: '4 hrs', resolution: '2 days' },
  Low: { response: '1 day', resolution: '5 days' }
};

function slaSummary(priority) {
  const sla = SLA_BY_PRIORITY[priority] || SLA_BY_PRIORITY.Medium;
  return `${sla.response} response / ${sla.resolution} resolution`;
}

// Matches app.js's STATUS_TRANSITIONS exactly:
// - No entry for 'Created' — a ticket must be assigned before any status
//   move is available (see /:id/assign).
// - Resolved -> Closed/Reopened are the *customer's* moves (confirm fix /
//   reopen on the portal), not an agent action, but they're still just
//   ordinary entries in the same graph.
const STATUS_TRANSITIONS = {
  Created: [],
  Assigned: ['In Progress'],
  'In Progress': ['Waiting', 'Escalated', 'Resolved'],
  Waiting: ['In Progress'],
  Escalated: ['In Progress'],
  Reopened: ['In Progress'],
  Resolved: ['Closed', 'Reopened'],
  Closed: []
};

function canTransition(from, to) {
  return (STATUS_TRANSITIONS[from] || []).includes(to);
}

// Customer-visible attachment count: creation-time attachments always
// count; chat attachments only count if they were posted on a public
// comment — matches bumpTicketFileCount's "only bump on public" rule in
// app.js, so an internal note's attachment doesn't show up to the customer.
function attachmentCount(ticketId) {
  return db.prepare(
    `SELECT COUNT(*) AS n FROM ticket_attachments ta
     LEFT JOIN ticket_comments tc ON ta.comment_id = tc.id
     WHERE ta.ticket_id = ? AND (ta.comment_id IS NULL OR tc.visibility = 'public')`
  ).get(ticketId).n;
}

function ticketWithComments(id) {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  if (!ticket) return null;
  const comments = db
    .prepare('SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at ASC')
    .all(id);
  return { ...ticket, attachment_count: attachmentCount(id), comments };
}

// POST /api/tickets
// body: { user_id, subject, description, category, priority, affected_service?, attachments?: [filename,...] }
router.post('/', (req, res) => {
  const { user_id, subject, description, category, priority, affected_service, attachments } = req.body || {};

  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  if (!subject || !subject.trim()) return res.status(400).json({ error: 'subject is required' });
  if (!description || !description.trim()) return res.status(400).json({ error: 'description is required' });
  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
  }
  if (!VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `priority must be one of: ${VALID_PRIORITIES.join(', ')}` });
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'user_id does not exist' });

  const id = nextId(db, 'tickets', 'TKT');
  const team = TEAM_BY_CATEGORY[category];
  const sla = slaSummary(priority);

  const insertTicket = db.transaction(() => {
    db.prepare(
      `INSERT INTO tickets
         (id, user_id, subject, description, category, priority, status,
          affected_service, assigned_team, sla_summary)
       VALUES (?, ?, ?, ?, ?, ?, 'Created', ?, ?, ?)`
    ).run(id, user_id, subject.trim(), description.trim(), category, priority, affected_service || null, team, sla);

    if (Array.isArray(attachments)) {
      const insertAttachment = db.prepare(
        'INSERT INTO ticket_attachments (ticket_id, filename) VALUES (?, ?)'
      );
      attachments.forEach((filename) => {
        if (filename && String(filename).trim()) insertAttachment.run(id, String(filename).trim());
      });
    }
  });
  insertTicket();

  res.status(201).json(ticketWithComments(id));
});

// GET /api/tickets?user_id=...&assigned_agent_id=...&status=...
router.get('/', (req, res) => {
  const { user_id, assigned_agent_id, status } = req.query;
  let sql = 'SELECT * FROM tickets WHERE 1=1';
  const params = [];

  if (user_id) { sql += ' AND user_id = ?'; params.push(user_id); }
  if (assigned_agent_id) { sql += ' AND assigned_agent_id = ?'; params.push(assigned_agent_id); }
  if (status) { sql += ' AND status = ?'; params.push(status); }

  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map((t) => ({ ...t, attachment_count: attachmentCount(t.id) })));
});

// GET /api/tickets/:id  (includes comments + attachment_count)
router.get('/:id', (req, res) => {
  const ticket = ticketWithComments(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'not found' });
  res.json(ticket);
});

// PATCH /api/tickets/:id/assign
// body: { assigned_agent_id }  — pass null/omit to unassign.
// Mirrors app.js's reassign handler: claiming an unassigned Created ticket
// bumps it to Assigned; sending it back to Unassigned resets it to Created
// (unless it's Resolved/Closed, which stays put either way).
router.patch('/:id/assign', (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'not found' });

  const assignedAgentId = req.body && req.body.assigned_agent_id ? req.body.assigned_agent_id : null;

  if (assignedAgentId) {
    const agent = db.prepare('SELECT id FROM agents WHERE id = ?').get(assignedAgentId);
    if (!agent) return res.status(404).json({ error: 'assigned_agent_id does not exist' });
  }

  let newStatus = ticket.status;
  if (assignedAgentId) {
    if (ticket.status === 'Created') newStatus = 'Assigned';
  } else if (ticket.status !== 'Resolved' && ticket.status !== 'Closed') {
    newStatus = 'Created';
  }

  db.prepare(
    `UPDATE tickets SET assigned_agent_id = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(assignedAgentId, newStatus, req.params.id);

  res.json(ticketWithComments(req.params.id));
});

// PATCH /api/tickets/:id/status
// body: { status, resolution_summary?, escalated_to?, escalation_reason? }
// Resolving requires resolution_summary; escalating requires both
// escalated_to and escalation_reason — same hard requirements app.js's
// resolve/escalate panels enforce client-side.
router.patch('/:id/status', (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'not found' });

  const { status, resolution_summary, escalated_to, escalation_reason } = req.body || {};
  if (!status || !canTransition(ticket.status, status)) {
    return res.status(400).json({
      error: `cannot move ticket from "${ticket.status}" to "${status}"`,
      allowed_next_states: STATUS_TRANSITIONS[ticket.status] || []
    });
  }

  if (status === 'Resolved' && (!resolution_summary || !resolution_summary.trim())) {
    return res.status(400).json({ error: 'resolution_summary is required to resolve a ticket' });
  }
  if (status === 'Escalated' && (!escalated_to || !escalation_reason || !escalation_reason.trim())) {
    return res.status(400).json({ error: 'escalated_to and escalation_reason are both required to escalate a ticket' });
  }

  db.prepare(
    `UPDATE tickets
     SET status = ?,
         resolution_summary = COALESCE(?, resolution_summary),
         escalated_to = COALESCE(?, escalated_to),
         escalation_reason = COALESCE(?, escalation_reason),
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(status, resolution_summary || null, escalated_to || null, escalation_reason || null, req.params.id);

  res.json(ticketWithComments(req.params.id));
});

// PATCH /api/tickets/:id/csat  { csat_rating (1-5), csat_comment? }
// Only valid once a ticket is Closed and not already rated — mirrors the
// portal's csatPanel/csatDone toggle.
router.patch('/:id/csat', (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'not found' });

  if (ticket.status !== 'Closed') {
    return res.status(400).json({ error: 'ticket must be Closed before it can be rated' });
  }
  if (ticket.csat_rating != null) {
    return res.status(400).json({ error: 'ticket has already been rated' });
  }

  const rating = Number(req.body && req.body.csat_rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'csat_rating must be an integer 1-5' });
  }
  const comment = (req.body && req.body.csat_comment) || null;

  db.prepare(
    `UPDATE tickets SET csat_rating = ?, csat_comment = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(rating, comment, req.params.id);

  res.json(ticketWithComments(req.params.id));
});

module.exports = router;
