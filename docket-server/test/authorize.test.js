const test = require('node:test');
const assert = require('node:assert/strict');
const { canAccessTicket } = require('../middleware/authorize');

const ALL = { allowCustomer: true, allowAssignedAgent: true, allowAdmin: true };

const ticket = { id: 'TKT-2026-000001', user_id: 'USR-2026-000001', assigned_agent_id: 'AGT-2026-000001' };
const unassigned = { ...ticket, assigned_agent_id: null };

const owner = { role: 'user', id: 'USR-2026-000001' };
const otherCustomer = { role: 'user', id: 'USR-2026-000002' };
const assignedAgent = { role: 'agent', id: 'AGT-2026-000001' };
const otherAgent = { role: 'agent', id: 'AGT-2026-000002' };
const admin = { role: 'admin', id: 'ADM-2026-000001' };

test('the customer who owns the ticket can access it', () => {
  assert.equal(canAccessTicket(owner, ticket, ALL), true);
});

test('another customer cannot access the ticket', () => {
  assert.equal(canAccessTicket(otherCustomer, ticket, ALL), false);
});

test('the assigned agent can access the ticket', () => {
  assert.equal(canAccessTicket(assignedAgent, ticket, ALL), true);
});

test('an agent not assigned to the ticket cannot access it', () => {
  assert.equal(canAccessTicket(otherAgent, ticket, ALL), false);
  assert.equal(canAccessTicket(otherAgent, unassigned, ALL), false);
  assert.equal(canAccessTicket(assignedAgent, unassigned, ALL), false);
});

test('an admin can access any ticket', () => {
  assert.equal(canAccessTicket(admin, ticket, ALL), true);
  assert.equal(canAccessTicket(admin, unassigned, ALL), true);
});

test('a missing actor or ticket is denied', () => {
  assert.equal(canAccessTicket(null, ticket, ALL), false);
  assert.equal(canAccessTicket(undefined, ticket, ALL), false);
  assert.equal(canAccessTicket(owner, null, ALL), false);
  assert.equal(canAccessTicket(admin, undefined, ALL), false);
});

test('each role is denied unless its option allows it', () => {
  assert.equal(canAccessTicket(owner, ticket), false);
  assert.equal(canAccessTicket(assignedAgent, ticket), false);
  assert.equal(canAccessTicket(admin, ticket), false);

  const customerOnly = { allowCustomer: true };
  assert.equal(canAccessTicket(owner, ticket, customerOnly), true);
  assert.equal(canAccessTicket(assignedAgent, ticket, customerOnly), false);
  assert.equal(canAccessTicket(admin, ticket, customerOnly), false);
});

test('an unknown role is denied', () => {
  assert.equal(canAccessTicket({ role: 'guest', id: 'USR-2026-000001' }, ticket, ALL), false);
});
