const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { PostgresRateLimitStore, deleteExpiredRateLimits } = require('../utils/rate-limit-store');

// A stand-in for the rate_limits table, so these tests need no database.
// Each query is matched on its SQL text and does what that statement does
// in Postgres. `clock.now` stands in for now() and can be moved forward.
// A short await before each query lets concurrent calls interleave.
function fakeDatabase() {
  const rows = new Map();
  const clock = { now: Date.now() };

  async function query(sql, params = []) {
    await new Promise((resolve) => setImmediate(resolve));
    const now = clock.now;
    if (/^INSERT INTO rate_limits/.test(sql.trim())) {
      const [key, windowMs] = params;
      const row = rows.get(key);
      if (!row || row.reset_at <= now) {
        rows.set(key, { hits: 1, reset_at: now + Number(windowMs) });
      } else {
        row.hits += 1;
      }
      const r = rows.get(key);
      return { rows: [{ hits: r.hits, reset_at: new Date(r.reset_at) }] };
    }
    if (/^SELECT hits, reset_at FROM rate_limits/.test(sql.trim())) {
      const r = rows.get(params[0]);
      return { rows: r && r.reset_at > now ? [{ hits: r.hits, reset_at: new Date(r.reset_at) }] : [] };
    }
    if (/^UPDATE rate_limits SET hits = GREATEST/.test(sql.trim())) {
      const r = rows.get(params[0]);
      if (r && r.reset_at > now) r.hits = Math.max(r.hits - 1, 0);
      return { rows: [] };
    }
    if (/^DELETE FROM rate_limits WHERE key/.test(sql.trim())) {
      rows.delete(params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (/^DELETE FROM rate_limits WHERE reset_at <= now\(\)/.test(sql.trim())) {
      let rowCount = 0;
      for (const [key, r] of rows) if (r.reset_at <= now) { rows.delete(key); rowCount++; }
      return { rows: [], rowCount };
    }
    throw new Error(`fake database got unexpected SQL: ${sql}`);
  }

  return { query, rows, clock };
}

function makeStore(db, prefix = 'test:', windowMs = 60 * 1000) {
  const store = new PostgresRateLimitStore({ prefix, db });
  store.init({ windowMs });
  return store;
}

// A one-route app behind a limiter using the store, for end-to-end checks.
async function listen(limiterOptions) {
  const app = express();
  app.set('trust proxy', false);
  app.post('/limited', rateLimit({ standardHeaders: 'draft-7', legacyHeaders: false, ...limiterOptions }), (req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/limited`;
  return { url, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('increment counts hits within a window and reports when it ends', async () => {
  const db = fakeDatabase();
  const store = makeStore(db, 'auth:', 15 * 60 * 1000);
  assert.equal((await store.increment('1.2.3.4')).totalHits, 1);
  const second = await store.increment('1.2.3.4');
  assert.equal(second.totalHits, 2);
  assert.equal(second.resetTime.getTime(), db.clock.now + 15 * 60 * 1000);
  assert.equal(db.rows.get('auth:1.2.3.4').hits, 2);
});

test('a hit after the window has ended starts a new window', async () => {
  const db = fakeDatabase();
  const store = makeStore(db, 'auth:', 1000);
  await store.increment('ip');
  await store.increment('ip');
  db.clock.now += 1000;
  const info = await store.increment('ip');
  assert.equal(info.totalHits, 1);
  assert.equal(info.resetTime.getTime(), db.clock.now + 1000);
});

test('concurrent hits are all counted', async () => {
  const db = fakeDatabase();
  const store = makeStore(db);
  const results = await Promise.all(Array.from({ length: 25 }, () => store.increment('ip')));
  assert.deepEqual(results.map((r) => r.totalHits).sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i + 1));
  assert.equal(db.rows.get('test:ip').hits, 25);
});

test('stores with different prefixes keep separate counts', async () => {
  const db = fakeDatabase();
  const auth = makeStore(db, 'auth:');
  const help = makeStore(db, 'account-help:');
  await auth.increment('ip');
  await auth.increment('ip');
  assert.equal((await help.increment('ip')).totalHits, 1);
  assert.equal((await auth.get('ip')).totalHits, 2);
});

test('counts live in the database, so a new store (a restart) keeps them', async () => {
  const db = fakeDatabase();
  await makeStore(db).increment('ip');
  await makeStore(db).increment('ip');
  assert.equal((await makeStore(db).get('ip')).totalHits, 2);
});

test('get, decrement and resetKey', async () => {
  const db = fakeDatabase();
  const store = makeStore(db, 'test:', 1000);
  assert.equal(await store.get('ip'), undefined);
  await store.increment('ip');
  await store.increment('ip');
  await store.decrement('ip');
  assert.equal((await store.get('ip')).totalHits, 1);
  await store.resetKey('ip');
  assert.equal(await store.get('ip'), undefined);
  await store.increment('ip');
  db.clock.now += 1000;
  assert.equal(await store.get('ip'), undefined, 'an ended window reads as no count');
});

test('deleteExpiredRateLimits removes only ended windows', async () => {
  const db = fakeDatabase();
  await makeStore(db, 'short:', 1000).increment('ip');
  await makeStore(db, 'long:', 60 * 1000).increment('ip');
  db.clock.now += 1000;
  assert.equal(await deleteExpiredRateLimits(db), 1);
  assert.deepEqual([...db.rows.keys()], ['long:ip']);
});

test('a store needs a prefix', () => {
  assert.throws(() => new PostgresRateLimitStore({ db: fakeDatabase() }), /prefix/);
});

test('a limiter on the store enforces its limit', async () => {
  const db = fakeDatabase();
  const { url, close } = await listen({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    store: new PostgresRateLimitStore({ prefix: 'account-help:', db }),
    passOnStoreError: true
  });
  try {
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await fetch(url, { method: 'POST' })).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
  } finally {
    await close();
  }
});

test('requests still get through when the store fails', async (t) => {
  const failing = { query: async () => { throw new Error('database unreachable'); } };
  t.mock.method(console, 'error', () => {});
  const { url, close } = await listen({
    windowMs: 60 * 1000,
    limit: 1,
    store: new PostgresRateLimitStore({ prefix: 'auth:', db: failing }),
    passOnStoreError: true
  });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await fetch(url, { method: 'POST' })).status, 200);
  } finally {
    await close();
  }
});
