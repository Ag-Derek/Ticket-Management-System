// GET /api/audit-logs — admin-only, powers the admin console's Audit Logs
// tab. Filters + pagination rather than one big dump, since this table only
// grows.

const express = require('express');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/authenticate');
const { asyncHandler } = require('../utils/async-handler');

const router = express.Router();

router.get('/', requireAuth(['admin']), asyncHandler(async (req, res) => {
  const { actor_type, action, entity_type, from, to, q } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.page_size, 10) || 50));

  let where = 'WHERE 1=1';
  const params = [];

  if (actor_type) { params.push(actor_type); where += ` AND actor_type = $${params.length}`; }
  if (action) { params.push(action); where += ` AND action = $${params.length}`; }
  if (entity_type) { params.push(entity_type); where += ` AND entity_type = $${params.length}`; }
  if (from) { params.push(from); where += ` AND created_at >= $${params.length}`; }
  if (to) { params.push(to); where += ` AND created_at <= $${params.length}`; }
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (actor_name ILIKE $${params.length} OR action ILIKE $${params.length} OR entity_id ILIKE $${params.length})`;
  }

  const countResult = await db.query(`SELECT COUNT(*) AS n FROM audit_logs ${where}`, params);
  const total = Number(countResult.rows[0].n);

  const listParams = params.slice();
  listParams.push(pageSize);
  const limitIdx = listParams.length;
  listParams.push((page - 1) * pageSize);
  const offsetIdx = listParams.length;

  const result = await db.query(
    `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    listParams
  );

  res.json({ rows: result.rows, total, page, page_size: pageSize });
}));

// GET /api/audit-logs/actions — distinct action/actor_type/entity_type
// values seen so far, to populate the filter dropdowns without hardcoding
// the action list client-side (it grows as new actions get instrumented).
router.get('/facets', requireAuth(['admin']), asyncHandler(async (req, res) => {
  const [actions, actorTypes, entityTypes] = await Promise.all([
    db.query('SELECT DISTINCT action FROM audit_logs ORDER BY action'),
    db.query('SELECT DISTINCT actor_type FROM audit_logs WHERE actor_type IS NOT NULL ORDER BY actor_type'),
    db.query('SELECT DISTINCT entity_type FROM audit_logs WHERE entity_type IS NOT NULL ORDER BY entity_type')
  ]);
  res.json({
    actions: actions.rows.map((r) => r.action),
    actor_types: actorTypes.rows.map((r) => r.actor_type),
    entity_types: entityTypes.rows.map((r) => r.entity_type)
  });
}));

module.exports = router;
