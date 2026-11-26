// WHERE clauses for GET /api/tickets and GET /api/tickets/stats. Kept apart
// from the route so the scoping and filter rules can be tested without a
// database. Conditions read tickets as alias `t` and users as alias `u`
// (search matches the requester's email), so every query that uses them must
// LEFT JOIN users u ON u.id = t.user_id.

// Sent as ?assigned_agent_id= by an admin to list tickets nobody owns. Agent
// ids look like AGT-000001, so it can't clash with a real one.
const UNASSIGNED = 'unassigned';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Escapes LIKE wildcards so a search for "50%" or "a_b" matches literally.
function likePattern(text) {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// Who the actor may see at all, whatever else they ask for:
// - a customer sees only their own tickets;
// - an agent sees only the tickets assigned to them;
// - an admin sees everything.
// user_id/assigned_agent_id in the query string can't widen this; for
// customers and agents they're ignored.
function scopeFor(actor) {
  if (actor.role === 'user') return { where: 'WHERE t.user_id = $1', params: [actor.id] };
  if (actor.role === 'agent') return { where: 'WHERE t.assigned_agent_id = $1', params: [actor.id] };
  return { where: 'WHERE 1=1', params: [] };
}

// The actor's scope plus the list filters from the query string:
//   status, category, priority  exact match
//   search                      ticket id, subject or requester email, any case
//   created_on=YYYY-MM-DD       created that day (UTC, as the client shows it)
//   user_id, assigned_agent_id  admins only; assigned_agent_id=unassigned
//                               means tickets with no assignee
// Returns { where, params } or { error } for a value that can't be used.
function buildTicketFilters(actor, query = {}) {
  const { where: scopeWhere, params } = scopeFor(actor);
  let where = scopeWhere;
  const add = (sql, value) => {
    params.push(value);
    where += ` AND ${sql.replace('?', `$${params.length}`)}`;
  };

  if (actor.role === 'admin') {
    if (query.user_id) add('t.user_id = ?', query.user_id);
    if (query.assigned_agent_id === UNASSIGNED) where += ' AND t.assigned_agent_id IS NULL';
    else if (query.assigned_agent_id) add('t.assigned_agent_id = ?', query.assigned_agent_id);
  }
  if (query.status) add('t.status = ?', query.status);
  if (query.category) add('t.category = ?', query.category);
  if (query.priority) add('t.priority = ?', query.priority);

  if (query.created_on) {
    // The round trip catches dates like 2026-02-31, which Date would roll
    // over into March but Postgres refuses.
    const day = DATE_RE.test(query.created_on) ? new Date(`${query.created_on}T00:00:00Z`) : null;
    if (!day || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== query.created_on) {
      return { error: 'created_on must be a date in YYYY-MM-DD form' };
    }
    add("(t.created_at AT TIME ZONE 'UTC')::date = ?::date", query.created_on);
  }

  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search) {
    if (search.length > 200) return { error: 'search must be 200 characters or fewer' };
    params.push(likePattern(search));
    const p = `$${params.length}`;
    where += ` AND (t.id ILIKE ${p} OR t.subject ILIKE ${p} OR u.email ILIKE ${p})`;
  }

  return { where, params };
}

module.exports = { buildTicketFilters, scopeFor, likePattern, UNASSIGNED };
