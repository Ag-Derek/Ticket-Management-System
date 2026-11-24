const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const mfa = require('../utils/mfa');

// routes/auth.js takes createChallenge when it loads, so stub it before
// requiring the router. A correct password returns this challenge.
const CHALLENGE = { mfaRequired: true, challengeId: 'test-challenge' };
test.mock.method(mfa, 'createChallenge', async () => CHALLENGE);
const authRouter = require('../routes/auth');

const PASSWORD = 'correct-horse-battery';
const HASH = bcrypt.hashSync(PASSWORD, 4);

// The same email as an admin and an agent, plus an admin with no password.
// As in the real app, only admins have passwords: agents sign in by code.
const ACCOUNTS = {
  admins: [
    { id: 'ADM-1', email: 'shared@example.com', full_name: 'Shared Admin' },
    { id: 'ADM-2', email: 'nopass@example.com', full_name: 'No Password' }
  ],
  agents: [{ id: 'AGT-1', email: 'shared@example.com', full_name: 'Shared Agent' }],
  users: []
};
const CREDENTIALS = [
  { owner_type: 'admin', owner_id: 'ADM-1', auth_provider: 'local', password_hash: HASH }
];

async function fakeQuery(sql, params = []) {
  const lookup = sql.match(/^SELECT id, email, full_name FROM (\w+) WHERE lower\(email\)/);
  if (lookup) return { rows: ACCOUNTS[lookup[1]].filter((a) => a.email === params[0]) };
  if (/FROM auth_credentials/.test(sql)) {
    return { rows: CREDENTIALS.filter((c) => c.owner_type === params[0] && c.owner_id === params[1]) };
  }
  return { rows: [] }; // audit log writes
}

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test.beforeEach((t) => {
  t.mock.method(db, 'query', fakeQuery);
});

function login(body) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

test('login without a role returns 400', async () => {
  const res = await login({ email: 'shared@example.com', password: PASSWORD });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /role is required/);
  assert.equal(body.roles, undefined);
});

test('login with an invalid role returns 400', async () => {
  const res = await login({ email: 'shared@example.com', password: PASSWORD, role: 'superuser' });
  assert.equal(res.status, 400);
});

test('an email on two account types never lists them', async () => {
  for (const role of ['admin', 'agent']) {
    const res = await login({ email: 'shared@example.com', password: 'wrong', role });
    assert.equal(res.status, 401, role);
    assert.deepEqual(await res.json(), { error: 'Invalid email or password' }, role);
  }
});

test('wrong email and wrong password get the same 401 for every role', async () => {
  for (const role of ['admin', 'agent', 'user']) {
    const unknown = await login({ email: 'nobody@example.com', password: PASSWORD, role });
    const wrong = await login({ email: 'shared@example.com', password: 'wrong', role });
    assert.equal(unknown.status, 401, role);
    assert.equal(wrong.status, 401, role);
    assert.deepEqual(await unknown.json(), await wrong.json(), role);
  }
});

test('every failure runs one bcrypt compare, so timing matches', async (t) => {
  const compare = t.mock.method(bcrypt, 'compare');
  const cases = [
    { email: 'nobody@example.com', password: PASSWORD, role: 'admin' }, // no account
    { email: 'nopass@example.com', password: PASSWORD, role: 'admin' }, // no credentials
    { email: 'shared@example.com', password: 'wrong', role: 'admin' } // wrong password
  ];
  for (const body of cases) {
    const before = compare.mock.callCount();
    const res = await login(body);
    assert.equal(res.status, 401, body.email);
    assert.equal(compare.mock.callCount() - before, 1, body.email);
  }
});

test('admin login with the right password still starts MFA', async () => {
  const res = await login({ email: ' Shared@Example.com ', password: PASSWORD, role: 'admin' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), CHALLENGE);
  const call = mfa.createChallenge.mock.calls.at(-1);
  assert.equal(call.arguments[0].ownerType, 'admin');
  assert.equal(call.arguments[0].ownerId, 'ADM-1');
});
