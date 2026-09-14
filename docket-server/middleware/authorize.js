const db = require('../db/connection');

function getTicket(ticketId) {
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
}

// Authorization only — assumes requireAuth has already run and set
// req.actor. Fetches the ticket once and stashes it on req.ticket so
// downstream handlers don't need to re-query it.
function requireTicketAccess(options = {}) {
  const {
    allowCustomer = false,
    allowAssignedAgent = false,
    allowAdmin = false
  } = options;

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

    if (allowAdmin && actor.role === 'admin') {
      req.ticket = ticket;
      return next();
    }

    if (allowCustomer && actor.role === 'user' && ticket.user_id === actor.id) {
      req.ticket = ticket;
      return next();
    }

    if (allowAssignedAgent && actor.role === 'agent' && ticket.assigned_agent_id === actor.id) {
      req.ticket = ticket;
      return next();
    }

    return res.status(403).json({ error: 'Not authorized to access this ticket' });
  };
}

module.exports = { getTicket, requireTicketAccess };
