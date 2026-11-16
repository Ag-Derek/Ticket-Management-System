const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db/connection');
const { seed } = require('../db/seed');

// Sets ADMIN_EMAIL / ADMIN_PASSWORD for one test and puts the originals back
// afterwards. Mocks made with t.mock are restored automatically.
function withAdminEnv(t, { email, password }) {
  const previous = { ADMIN_EMAIL: process.env.ADMIN_EMAIL, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD };
  const set = (name, value) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  set('ADMIN_EMAIL', email);
  set('ADMIN_PASSWORD', password);
  t.after(() => {
    set('ADMIN_EMAIL', previous.ADMIN_EMAIL);
    set('ADMIN_PASSWORD', previous.ADMIN_PASSWORD);
  });
}

test('missing ADMIN_EMAIL skips all admin queries without failing startup', async (t) => {
  withAdminEnv(t, { email: undefined, password: undefined });
  const ensureSchema = t.mock.method(db, 'ensureSchema', async () => {});
  const query = t.mock.method(db, 'query', async () => { throw new Error('unexpected admin query'); });
  const warn = t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});

  await seed();

  assert.equal(ensureSchema.mock.callCount(), 1);
  assert.equal(query.mock.callCount(), 0);
  assert.match(warn.mock.calls[0].arguments[0], /ADMIN_EMAIL is not set/);
});

test('blank ADMIN_EMAIL is treated as missing', async (t) => {
  withAdminEnv(t, { email: '   ', password: undefined });
  t.mock.method(db, 'ensureSchema', async () => {});
  const query = t.mock.method(db, 'query', async () => { throw new Error('unexpected admin query'); });
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});

  await seed();

  assert.equal(query.mock.callCount(), 0);
});

test('configured ADMIN_EMAIL is trimmed, normalized, and seeded', async (t) => {
  withAdminEnv(t, { email: '  Admin@Example.org  ', password: undefined });
  const ensureSchema = t.mock.method(db, 'ensureSchema', async () => {});
  // The second query checks for an existing password; one row means it has one.
  const query = t.mock.method(db, 'query', async () => ({ rows: [{}] }));
  t.mock.method(console, 'log', () => {});

  await seed();

  assert.equal(ensureSchema.mock.callCount(), 1);
  assert.equal(query.mock.callCount(), 2);
  assert.deepEqual(query.mock.calls[0].arguments[1], [
    'ADM-2026-000001', 'admin@example.org', 'System Administrator'
  ]);
});
