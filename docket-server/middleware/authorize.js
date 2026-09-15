const db = require('../db/connection');

function getTicket(ticketId) {
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
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
  return (req, res, next) => {
    const actor = req.actor;

    if (!actor) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const ticketId = req.params.ticketId || req.params.id;
    const ticket = getTicket(ticketId);

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
