// Admin-only reporting: an aggregate summary for the Reports tab's stat
// cards, and a filtered export of either tickets or audit logs as
// CSV/PDF/Word — the QA-facing "download a report" flow.

const express = require('express');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/authenticate');
const { asyncHandler } = require('../utils/async-handler');
const { toCsv, toPdf, toDocx } = require('../utils/report-generators');
const { RESPONSE_STATE_SQL, RESOLUTION_STATE_SQL } = require('../utils/sla');

const router = express.Router();

const SLA_STATE_LABELS = { met: 'Met', breached: 'Breached', pending: 'In progress' };

function fmtDate(value) {
  return value ? new Date(value).toLocaleString() : '';
}

// met / (met + breached) as a whole percentage — tickets whose clock is
// still running don't count either way yet. null when nothing has an
// outcome in the range.
function compliancePct(met, breached) {
  return met + breached ? Math.round((met / (met + breached)) * 100) : null;
}

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
  // Free text that can run to a paragraph — fine in a spreadsheet, but the
  // PDF/Word tables give every column the same narrow width, so it's
  // CSV-only (see the csvOnly filter in /export).
  { label: 'CSAT feedback', value: (r) => r.csat_comment || '', csvOnly: true },
  { label: 'Created', value: (r) => new Date(r.created_at).toLocaleString() },
  { label: 'Resolved', value: (r) => (r.resolved_at ? new Date(r.resolved_at).toLocaleString() : '') },
  { label: 'Closed', value: (r) => (r.closed_at ? new Date(r.closed_at).toLocaleString() : '') },
  // The SLA outcomes fit every format; the raw timestamps behind them are
  // CSV-only, same reasoning as CSAT feedback.
  { label: 'Response SLA', value: (r) => SLA_STATE_LABELS[r.response_sla_state] || '' },
  { label: 'Resolution SLA', value: (r) => SLA_STATE_LABELS[r.resolution_sla_state] || '' },
  { label: 'Response due', value: (r) => fmtDate(r.first_response_due_at), csvOnly: true },
  { label: 'First response', value: (r) => fmtDate(r.first_responded_at), csvOnly: true },
  { label: 'Resolution due', value: (r) => fmtDate(r.resolution_due_at), csvOnly: true }
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

  const [total, byStatus, byCategory, byPriority, csat, resolution, byAgent, sla] = await Promise.all([
    db.query(`SELECT COUNT(*) AS n FROM tickets ${where}`, params),
    db.query(`SELECT status, COUNT(*) AS n FROM tickets ${where} GROUP BY status ORDER BY status`, params),
    db.query(`SELECT category, COUNT(*) AS n FROM tickets ${where} GROUP BY category ORDER BY category`, params),
    db.query(`SELECT priority, COUNT(*) AS n FROM tickets ${where} GROUP BY priority ORDER BY priority`, params),
    db.query(
      `SELECT ROUND(AVG(csat_rating)::numeric, 2) AS avg_rating, COUNT(csat_rating) AS n
       FROM tickets ${where} AND csat_rating IS NOT NULL`,
      params
    ),
    // Creation to (latest) resolution. resolved_at is only set while a
    // ticket is Resolved or Closed — a Reopened ticket drops out until it's
    // resolved again.
    db.query(
      `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600)::numeric, 1) AS avg_hours
       FROM tickets ${where} AND resolved_at IS NOT NULL`,
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
    ),
    // SLA outcomes per priority; the overall figures are summed from these
    // below. open_breached is tickets still open right now with a blown
    // resolution SLA: the ones that need attention today.
    db.query(
      `SELECT priority,
              COUNT(*) FILTER (WHERE rs = 'met')::int AS response_met,
              COUNT(*) FILTER (WHERE rs = 'breached')::int AS response_breached,
              COUNT(*) FILTER (WHERE rs = 'pending')::int AS response_pending,
              COUNT(*) FILTER (WHERE res = 'met')::int AS resolution_met,
              COUNT(*) FILTER (WHERE res = 'breached')::int AS resolution_breached,
              COUNT(*) FILTER (WHERE res = 'pending')::int AS resolution_pending,
              COUNT(*) FILTER (WHERE res = 'breached' AND status NOT IN ('Resolved', 'Closed'))::int AS open_breached
       FROM (
         SELECT t.priority, t.status, ${RESPONSE_STATE_SQL} AS rs, ${RESOLUTION_STATE_SQL} AS res
         FROM tickets t ${where}
       ) s
       GROUP BY priority
       ORDER BY CASE priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 WHEN 'Low' THEN 4 ELSE 5 END`,
      params
    )
  ]);

  const slaTotals = sla.rows.reduce((acc, r) => {
    for (const k of Object.keys(acc)) acc[k] += r[k];
    return acc;
  }, {
    response_met: 0, response_breached: 0, response_pending: 0,
    resolution_met: 0, resolution_breached: 0, resolution_pending: 0, open_breached: 0
  });

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
    })),
    sla: {
      response: {
        met: slaTotals.response_met,
        breached: slaTotals.response_breached,
        pending: slaTotals.response_pending,
        compliance_pct: compliancePct(slaTotals.response_met, slaTotals.response_breached)
      },
      resolution: {
        met: slaTotals.resolution_met,
        breached: slaTotals.resolution_breached,
        pending: slaTotals.resolution_pending,
        compliance_pct: compliancePct(slaTotals.resolution_met, slaTotals.resolution_breached)
      },
      open_breached: slaTotals.open_breached,
      by_priority: sla.rows.map((r) => ({
        priority: r.priority,
        response_compliance_pct: compliancePct(r.response_met, r.response_breached),
        resolution_compliance_pct: compliancePct(r.resolution_met, r.resolution_breached),
        response_breached: r.response_breached,
        resolution_breached: r.resolution_breached
      }))
    }
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
    let sql = `SELECT t.*, u.email AS requester_email, a.full_name AS agent_name,
                      ${RESPONSE_STATE_SQL} AS response_sla_state,
                      ${RESOLUTION_STATE_SQL} AS resolution_sla_state
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

  columns = columns.filter((c) => !c.csvOnly);

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
