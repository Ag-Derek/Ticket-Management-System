// SLA targets and the rules for the SLA clock. The server is the single
// source of truth: tickets store an absolute due time (resolution_due_at),
// and the client only compares it against the clock.
//
// The rules:
// - The clock starts when the ticket is created and runs around the clock
//   (calendar time, not business hours).
// - The resolution clock pauses while the ticket is waiting on the
//   customer: in Waiting, and in Resolved while they decide whether to
//   confirm or reopen. Leaving a paused status (other than to Closed) pushes
//   resolution_due_at back by however long the pause lasted.
// - Reopening a resolved ticket starts a new resolution SLA: the due time is
//   reset to the full resolution target for its priority, from the reopen.
// - Resolution is met if the ticket was (most recently) resolved by its due
//   time.

// Minutes per target. The labels are what sla_summary shows; db/schema.sql's
// one-time backfill repeats these minute values, so keep the two in step.
const SLA_BY_PRIORITY = {
  Critical: { resolutionMinutes: 4 * 60, resolution: '4 hrs' },
  High: { resolutionMinutes: 8 * 60, resolution: '8 hrs' },
  Medium: { resolutionMinutes: 2 * 24 * 60, resolution: '2 days' },
  Low: { resolutionMinutes: 5 * 24 * 60, resolution: '5 days' }
};

const SLA_PAUSED_STATUSES = ['Waiting', 'Resolved'];

function slaFor(priority) {
  return SLA_BY_PRIORITY[priority] || SLA_BY_PRIORITY.Medium;
}

function slaSummary(priority) {
  const sla = slaFor(priority);
  return `${sla.resolution} resolution`;
}

// SQL CASE expression for whether a ticket's resolution SLA is 'met',
// 'breached' or 'pending', evaluated against now(). Reads the tickets table
// under alias `t`. A paused clock counts as if the pause ended right now, so
// a ticket can't breach while it's waiting on the customer, but one that was
// already late before the pause stays late.
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
  RESOLUTION_STATE_SQL
};
