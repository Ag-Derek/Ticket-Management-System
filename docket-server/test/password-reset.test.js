const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { completeReset, PasswordResetError } = require('../utils/password-reset');

// A tiny in-memory stand-in for the tables completeReset touches, so these
// tests need no database. Each query is matched on its SQL text.
function fakeDatabase({ tokens }) {
  const state = {
    tokens,
    passwordHash: 'old-hash',
    tokenVersion: 0
  };
  const live = (t) => t.used_at === null && t.expires_at > Date.now();

  async function query(sql, params = []) {
    if (/^SELECT 1 FROM password_reset_tokens/.test(sql.trim())) {
      return { rows: state.tokens.filter((t) => t.token_hash === params[0] && live(t)).map(() => ({ '?column?': 1 })) };
    }
    if (/^UPDATE password_reset_tokens SET used_at/.test(sql.trim())) {
      const t = state.tokens.find((x) => x.token_hash === params[0] && live(x));
      if (!t) return { rows: [] };
      t.used_at = Date.now();
      return { rows: [{ owner_type: t.owner_type, owner_id: t.owner_id }] };
    }
    if (/^UPDATE auth_credentials/.test(sql.trim())) {
      state.passwordHash = params[0];
      return { rows: [{ id: 1 }] };
    }
    if (/^UPDATE password_reset_tokens SET expires_at/.test(sql.trim())) {
      for (const t of state.tokens) if (t.used_at === null) t.expires_at = Date.now();
      return { rows: [] };
    }
    if (/SET token_version = token_version \+ 1/.test(sql)) {
      state.tokenVersion += 1;
      return { rows: [] };
    }
    if (/^SELECT id, email, full_name FROM admins/.test(sql.trim())) {
      return { rows: [{ id: params[0], email: 'admin@example.com', full_name: 'Admin' }] };
    }
    throw new Error(`unexpected query: ${sql}`);
  }

  return { state, query };
}

function tokenRow(token, overrides = {}) {
  return {
    token_hash: crypto.createHash('sha256').update(token).digest('hex'),
    owner_type: 'admin',
    owner_id: 7,
    used_at: null,
    expires_at: Date.now() + 30 * 60 * 1000,
    ...overrides
  };
}

function install(t, fake) {
  t.mock.method(db, 'query', fake.query);
  t.mock.method(db, 'withTransaction', (fn) => fn({ query: fake.query }));
  return t.mock.method(bcrypt, 'hash');
}

async function assertInvalidLink(promise) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof PasswordResetError);
    assert.equal(err.status, 400);
    assert.equal(err.message, 'This reset link is invalid or has expired.');
    return true;
  });
}

test('an unknown reset link returns 400 without hashing the password', async (t) => {
  const fake = fakeDatabase({ tokens: [tokenRow('real-token')] });
  const hash = install(t, fake);
  await assertInvalidLink(completeReset('wrong-token', 'new-password-123'));
  assert.equal(hash.mock.callCount(), 0);
  assert.equal(fake.state.passwordHash, 'old-hash');
});

test('an expired reset link returns 400 without hashing the password', async (t) => {
  const fake = fakeDatabase({ tokens: [tokenRow('old-token', { expires_at: Date.now() - 1000 })] });
  const hash = install(t, fake);
  await assertInvalidLink(completeReset('old-token', 'new-password-123'));
  assert.equal(hash.mock.callCount(), 0);
});

test('a valid link resets the password and ends existing sessions; reusing it fails', async (t) => {
  const fake = fakeDatabase({ tokens: [tokenRow('good-token')] });
  const hash = install(t, fake);

  const owner = await completeReset('good-token', 'new-password-123');
  assert.deepEqual(owner, { ownerType: 'admin', id: 7, email: 'admin@example.com', full_name: 'Admin' });
  assert.equal(hash.mock.callCount(), 1);
  assert.equal(fake.state.tokenVersion, 1);

  const hashAfterReset = fake.state.passwordHash;
  await assertInvalidLink(completeReset('good-token', 'another-password-456'));
  assert.equal(hash.mock.callCount(), 1);
  assert.equal(fake.state.passwordHash, hashAfterReset);

  // Checked last: bcrypt.compare calls bcrypt.hash internally.
  assert.ok(await bcrypt.compare('new-password-123', fake.state.passwordHash));
});

test('two concurrent submissions of one link: only the first claim succeeds', async (t) => {
  const fake = fakeDatabase({ tokens: [tokenRow('race-token')] });
  install(t, fake);

  // Both pass the read-only check before either claims the token.
  const results = await Promise.allSettled([
    completeReset('race-token', 'first-password-1'),
    completeReset('race-token', 'second-password-2')
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.status, 400);
  assert.equal(fake.state.tokenVersion, 1);
});
