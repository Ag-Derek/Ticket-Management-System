const db = require('../db/connection');

async function getTicket(ticketId) {
  const result = await db.query('SELECT * FROM tickets WHERE id = $1', [ticketId]);
  return result.rows[0] || null;
}

// Pure authorization check, no request/response involved — lets callers
// that don't have :ticketId as a route param (e.g. attachments.js, which
// has to resolve an attachment to its ticket first) reuse the exact same
// rule as requireTicketAccess below, instead of re-implementing it.
function canAccessTicket(actor, ticket, options = {}) {
  const {
    allowCustomer = false,
    allowAssignedAgent = false,
    allowAdmin = false
  } = options;

  if (!actor || !ticket) return false;
  if (allowAdmin && actor.role === 'admin') return true;
  if (allowCustomer && actor.role === 'user' && ticket.user_id === actor.id) return true;
  if (allowAssignedAgent && actor.role === 'agent' && ticket.assigned_agent_id === actor.id) return true;
  return false;
}

// Authorization only — assumes requireAuth has already run and set
// req.actor. Fetches the ticket once and stashes it on req.ticket so
// downstream handlers don't need to re-query it.
function requireTicketAccess(options = {}) {
  return async (req, res, next) => {
    const actor = req.actor;

    if (!actor) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const ticketId = req.params.ticketId || req.params.id;
    let ticket;
    try {
      ticket = await getTicket(ticketId);
    } catch (err) {
      // An async Express middleware that throws becomes an unhandled
      // rejection (Node terminates the process on those) instead of a
      // normal error response — catch and 500 like any other DB failure.
      console.error('requireTicketAccess: failed to load ticket', err);
      return res.status(500).json({ error: 'failed to load ticket' });
    }

    if (!ticket) {
      return res.status(404).json({ error: 'ticket not found' });
    }

    if (canAccessTicket(actor, ticket, options)) {
      req.ticket = ticket;
      return next();
    }

    return res.status(403).json({ error: 'Not authorized to access this ticket' });
  };
}

module.exports = { getTicket, requireTicketAccess, canAccessTicket };
