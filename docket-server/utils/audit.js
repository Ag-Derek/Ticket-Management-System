// Writes one row to audit_logs. Best-effort by design: a failed audit write
// must never fail (or roll back) the action it's recording, so errors are
// logged and swallowed rather than thrown.
//
// Pass `client` when called from inside a db.withTransaction() block so the
// log lands in the same transaction as the change it describes; omit it to
// run against the shared pool.

const db = require('../db/connection');

async function recordAuditLog(entry, client) {
  const runner = client || db;
  const { actorType, actorId, actorName, action, entityType, entityId, details } = entry;
  try {
    await runner.query(
      `INSERT INTO audit_logs (actor_type, actor_id, actor_name, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        actorType || null,
        actorId || null,
        actorName || null,
        action,
        entityType || null,
        entityId || null,
        details ? JSON.stringify(details) : null
      ]
    );
  } catch (err) {
    console.error('Failed to record audit log:', action, err);
  }
}

// Looks up a display name for req.actor ({ role, id }) so audit entries
// read as "Nana Boateng did X" instead of just an opaque id. Best-effort,
// same as recordAuditLog — a lookup failure just means a blank name.
const ACTOR_TABLE_BY_ROLE = { user: 'users', agent: 'agents', admin: 'admins' };

async function resolveActorName(actor, client) {
  if (!actor || !actor.id) return null;
  const table = ACTOR_TABLE_BY_ROLE[actor.role];
  if (!table) return null;
  const runner = client || db;
  try {
    const result = await runner.query(`SELECT full_name FROM ${table} WHERE id = $1`, [actor.id]);
    return result.rows[0] ? result.rows[0].full_name : null;
  } catch (err) {
    console.error('Failed to resolve actor name for audit log:', err);
    return null;
  }
}

module.exports = { recordAuditLog, resolveActorName };
