// Admin-only reporting: an aggregate summary for the Reports tab's stat
// cards, and a filtered export of either tickets or audit logs as
// CSV/PDF/Word — the QA-facing "download a report" flow.

const express = require('express');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/authenticate');
const { asyncHandler } = require('../utils/async-handler');
const { toCsv, toPdf, toDocx } = require('../utils/report-generators');

const router = express.Router();

const TICKET_COLUMNS = [
  { label: 'Ticket ID', value: 'id' },
  { label: 'Subject', value: 'subject' },
  { label: 'Category', value: 'category' },
  { label: 'Priority', value: 'priority' },
  { label: 'Status', value: 'status' },
  { label: 'Assigned team', value: 'assigned_team' },
  { label: 'Assigned agent', value: (r) => r.agent_name || 'Unassigned' },
  { label: 'Requester', value: 'requester_email' },
  { label: 'CSAT', value: (r) => (r.csat_rating != null ? r.csat_rating : '') },
  { label: 'Created', value: (r) => new Date(r.created_at).toLocaleString() },
  { label: 'Updated', value: (r) => new Date(r.updated_at).toLocaleString() }
];

const AUDIT_COLUMNS = [
  { label: 'Timestamp', value: (r) => new Date(r.created_at).toLocaleString() },
  { label: 'Actor', value: (r) => r.actor_name || r.actor_id || '—' },
  { label: 'Actor role', value: 'actor_type' },
  { label: 'Action', value: 'action' },
  { label: 'Entity type', value: 'entity_type' },
  { label: 'Entity ID', value: 'entity_id' },
  { label: 'Details', value: (r) => (r.details ? JSON.stringify(r.details) : '') }
];

// GET /api/reports/summary?from=&to=
router.get('/summary', requireAuth(['admin']), asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const params = [];
  let where = 'WHERE 1=1';
  if (from) { params.push(from); where += ` AND created_at >= $${params.length}`; }
  if (to) { params.push(to); where += ` AND created_at <= $${params.length}`; }

  const [total, byStatus, byCategory, byPriority, csat, resolution, byAgent] = await Promise.all([
    db.query(`SELECT COUNT(*) AS n FROM tickets ${where}`, params),
    db.query(`SELECT status, COUNT(*) AS n FROM tickets ${where} GROUP BY status ORDER BY status`, params),
    db.query(`SELECT category, COUNT(*) AS n FROM tickets ${where} GROUP BY category ORDER BY category`, params),
    db.query(`SELECT priority, COUNT(*) AS n FROM tickets ${where} GROUP BY priority ORDER BY priority`, params),
    db.query(
      `SELECT ROUND(AVG(csat_rating)::numeric, 2) AS avg_rating, COUNT(csat_rating) AS n
       FROM tickets ${where} AND csat_rating IS NOT NULL`,
      params
    ),
    db.query(
      `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600)::numeric, 1) AS avg_hours
       FROM tickets ${where} AND status IN ('Resolved', 'Closed')`,
      params
    ),
    db.query(
      `SELECT a.id, a.full_name,
              COUNT(t.id) FILTER (WHERE t.status NOT IN ('Resolved', 'Closed')) AS open_count,
              COUNT(t.id) FILTER (WHERE t.status IN ('Resolved', 'Closed')) AS resolved_count
       FROM agents a
       LEFT JOIN tickets t ON t.assigned_agent_id = a.id
       GROUP BY a.id, a.full_name
       ORDER BY a.full_name`
    )
  ]);

  res.json({
    total: Number(total.rows[0].n),
    by_status: byStatus.rows.map((r) => ({ status: r.status, count: Number(r.n) })),
    by_category: byCategory.rows.map((r) => ({ category: r.category, count: Number(r.n) })),
    by_priority: byPriority.rows.map((r) => ({ priority: r.priority, count: Number(r.n) })),
    csat: {
      average: csat.rows[0].avg_rating !== null ? Number(csat.rows[0].avg_rating) : null,
      responses: Number(csat.rows[0].n)
    },
    avg_resolution_hours: resolution.rows[0].avg_hours !== null ? Number(resolution.rows[0].avg_hours) : null,
    by_agent: byAgent.rows.map((r) => ({
      agent_id: r.id,
      agent_name: r.full_name,
      open_count: Number(r.open_count),
      resolved_count: Number(r.resolved_count)
    }))
  });
}));

// GET /api/reports/export?type=tickets|audit-logs&format=csv|pdf|docx&...filters
router.get('/export', requireAuth(['admin']), asyncHandler(async (req, res) => {
  const { type, format } = req.query;
  if (!['tickets', 'audit-logs'].includes(type)) {
    return res.status(400).json({ error: 'type must be "tickets" or "audit-logs"' });
  }
  if (!['csv', 'pdf', 'docx'].includes(format)) {
    return res.status(400).json({ error: 'format must be "csv", "pdf", or "docx"' });
  }

  let rows, columns, title;

  if (type === 'tickets') {
    const { from, to, status, category, priority, assigned_agent_id } = req.query;
    const params = [];
    let sql = `SELECT t.*, u.email AS requester_email, a.full_name AS agent_name
               FROM tickets t
               LEFT JOIN users u ON u.id = t.user_id
               LEFT JOIN agents a ON a.id = t.assigned_agent_id
               WHERE 1=1`;
    if (from) { params.push(from); sql += ` AND t.created_at >= $${params.length}`; }
    if (to) { params.push(to); sql += ` AND t.created_at <= $${params.length}`; }
    if (status) { params.push(status); sql += ` AND t.status = $${params.length}`; }
    if (category) { params.push(category); sql += ` AND t.category = $${params.length}`; }
    if (priority) { params.push(priority); sql += ` AND t.priority = $${params.length}`; }
    if (assigned_agent_id) { params.push(assigned_agent_id); sql += ` AND t.assigned_agent_id = $${params.length}`; }
    sql += ' ORDER BY t.created_at DESC';

    const result = await db.query(sql, params);
    rows = result.rows;
    columns = TICKET_COLUMNS;
    title = 'Ticket report';
  } else {
    const { from, to, actor_type, action, entity_type } = req.query;
    const params = [];
    let sql = 'SELECT * FROM audit_logs WHERE 1=1';
    if (from) { params.push(from); sql += ` AND created_at >= $${params.length}`; }
    if (to) { params.push(to); sql += ` AND created_at <= $${params.length}`; }
    if (actor_type) { params.push(actor_type); sql += ` AND actor_type = $${params.length}`; }
    if (action) { params.push(action); sql += ` AND action = $${params.length}`; }
    if (entity_type) { params.push(entity_type); sql += ` AND entity_type = $${params.length}`; }
    sql += ' ORDER BY created_at DESC';

    const result = await db.query(sql, params);
    rows = result.rows;
    columns = AUDIT_COLUMNS;
    title = 'Audit log report';
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = `${type}-report-${stamp}`;
  const subtitle = `Generated ${new Date().toLocaleString()}`;

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
    return res.send(toCsv(rows, columns));
  }

  if (format === 'pdf') {
    const buffer = await toPdf(title, rows, columns, subtitle);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
    return res.send(buffer);
  }

  const buffer = await toDocx(title, rows, columns, subtitle);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${baseName}.docx"`);
  res.send(buffer);
}));

module.exports = router;
