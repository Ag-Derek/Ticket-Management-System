// SLA targets and the rules for the SLA clock. The server is the single
// source of truth: tickets store absolute due times (first_response_due_at,
// resolution_due_at), and the client only compares them against the clock.
//
// The rules:
// - Both clocks start when the ticket is created and run around the clock
//   (calendar time, not business hours).
// - First response is met by the first public reply from an agent or admin
//   (internal notes don't count, since the customer never sees them), or by
//   resolving the ticket, whichever comes first.
// - The resolution clock pauses while the ticket is waiting on the
//   customer: in Waiting, and in Resolved while they decide whether to
//   confirm or reopen. Leaving a paused status (other than to Closed) pushes
//   resolution_due_at back by however long the pause lasted. The response
//   clock never pauses.
// - Resolution is met if the ticket was (most recently) resolved by its due
//   time.

// Minutes per target. The labels are what sla_summary shows; db/schema.sql's
// one-time backfill repeats these minute values, so keep the two in step.
const SLA_BY_PRIORITY = {
  Critical: { responseMinutes: 15, resolutionMinutes: 4 * 60, response: '15 min', resolution: '4 hrs' },
  High: { responseMinutes: 30, resolutionMinutes: 8 * 60, response: '30 min', resolution: '8 hrs' },
  Medium: { responseMinutes: 4 * 60, resolutionMinutes: 2 * 24 * 60, response: '4 hrs', resolution: '2 days' },
  Low: { responseMinutes: 24 * 60, resolutionMinutes: 5 * 24 * 60, response: '1 day', resolution: '5 days' }
};

const SLA_PAUSED_STATUSES = ['Waiting', 'Resolved'];

function slaFor(priority) {
  return SLA_BY_PRIORITY[priority] || SLA_BY_PRIORITY.Medium;
}

function slaSummary(priority) {
  const sla = slaFor(priority);
  return `${sla.response} response / ${sla.resolution} resolution`;
}

// SQL CASE expressions for whether a ticket's response / resolution SLA is
// 'met', 'breached' or 'pending', evaluated against now(). Reads the tickets
// table under alias `t`. A paused resolution clock counts as if the pause
// ended right now, so a ticket can't breach while it's waiting on the
// customer, but one that was already late before the pause stays late.
const RESPONSE_STATE_SQL = `
  CASE
    WHEN t.first_response_due_at IS NULL THEN NULL
    WHEN t.first_responded_at IS NOT NULL
      THEN CASE WHEN t.first_responded_at <= t.first_response_due_at THEN 'met' ELSE 'breached' END
    WHEN now() > t.first_response_due_at THEN 'breached'
    ELSE 'pending'
  END`;

const RESOLUTION_STATE_SQL = `
  CASE
    WHEN t.resolution_due_at IS NULL THEN NULL
    WHEN t.resolved_at IS NOT NULL AND t.status IN ('Resolved', 'Closed')
      THEN CASE WHEN t.resolved_at <= t.resolution_due_at THEN 'met' ELSE 'breached' END
    WHEN now() > t.resolution_due_at + COALESCE(now() - t.sla_paused_at, interval '0') THEN 'breached'
    ELSE 'pending'
  END`;

module.exports = {
  SLA_BY_PRIORITY,
  SLA_PAUSED_STATUSES,
  slaFor,
  slaSummary,
  RESPONSE_STATE_SQL,
  RESOLUTION_STATE_SQL
};
