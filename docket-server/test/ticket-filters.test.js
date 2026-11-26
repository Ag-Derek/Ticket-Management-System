const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTicketFilters, likePattern } = require('../utils/ticket-filters');

const customer = { role: 'user', id: 'USR-000001' };
const agent = { role: 'agent', id: 'AGT-000001' };
const admin = { role: 'admin', id: 'ADM-000001' };

test('a customer is scoped to their own tickets, whatever the query asks', () => {
  const f = buildTicketFilters(customer, { user_id: 'USR-000002', assigned_agent_id: 'AGT-000009' });
  assert.equal(f.where, 'WHERE t.user_id = $1');
  assert.deepEqual(f.params, ['USR-000001']);
});

test('an agent is scoped to their assigned tickets, and cannot ask for unassigned ones', () => {
  const f = buildTicketFilters(agent, { assigned_agent_id: 'unassigned', user_id: 'USR-000002' });
  assert.equal(f.where, 'WHERE t.assigned_agent_id = $1');
  assert.deepEqual(f.params, ['AGT-000001']);
});

test('an admin sees everything, and can filter by assignee or for unassigned tickets', () => {
  assert.deepEqual(buildTicketFilters(admin, {}), { where: 'WHERE 1=1', params: [] });

  const byAgent = buildTicketFilters(admin, { assigned_agent_id: 'AGT-000002' });
  assert.equal(byAgent.where, 'WHERE 1=1 AND t.assigned_agent_id = $1');
  assert.deepEqual(byAgent.params, ['AGT-000002']);

  const unassigned = buildTicketFilters(admin, { assigned_agent_id: 'unassigned' });
  assert.equal(unassigned.where, 'WHERE 1=1 AND t.assigned_agent_id IS NULL');
  assert.deepEqual(unassigned.params, []);
});

test('status, category, priority and date filters number their parameters in order', () => {
  const f = buildTicketFilters(agent, {
    status: 'Waiting', category: 'Symphony', priority: 'High', created_on: '2026-11-26'
  });
  assert.equal(
    f.where,
    'WHERE t.assigned_agent_id = $1 AND t.status = $2 AND t.category = $3 AND t.priority = $4' +
      " AND (t.created_at AT TIME ZONE 'UTC')::date = $5::date"
  );
  assert.deepEqual(f.params, ['AGT-000001', 'Waiting', 'Symphony', 'High', '2026-11-26']);
});

test('search matches id, subject and requester email with one parameter', () => {
  const f = buildTicketFilters(admin, { status: 'Created', search: '  printer ' });
  assert.equal(
    f.where,
    'WHERE 1=1 AND t.status = $1 AND (t.id ILIKE $2 OR t.subject ILIKE $2 OR u.email ILIKE $2)'
  );
  assert.deepEqual(f.params, ['Created', '%printer%']);
});

test('a blank search adds nothing', () => {
  assert.deepEqual(buildTicketFilters(admin, { search: '   ' }), { where: 'WHERE 1=1', params: [] });
});

test('search escapes LIKE wildcards', () => {
  assert.equal(likePattern('50%_off\\'), '%50\\%\\_off\\\\%');
});

test('bad dates and overlong searches are refused', () => {
  assert.ok(buildTicketFilters(admin, { created_on: '26/11/2026' }).error);
  assert.ok(buildTicketFilters(admin, { created_on: '2026-13-45' }).error);
  assert.ok(buildTicketFilters(admin, { created_on: '2026-02-31' }).error);
  assert.ok(buildTicketFilters(admin, { created_on: ['2026-11-26', '2026-11-27'] }).error);
  assert.ok(buildTicketFilters(admin, { search: 'x'.repeat(201) }).error);
});
