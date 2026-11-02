const test = require('node:test');
const assert = require('node:assert/strict');
const { slaFor, slaSummary } = require('../utils/sla');

test('slaFor returns the resolution target for each priority', () => {
  assert.deepEqual(slaFor('Critical'), { resolutionMinutes: 4 * 60, resolution: '4 hrs' });
  assert.deepEqual(slaFor('High'), { resolutionMinutes: 8 * 60, resolution: '8 hrs' });
  assert.deepEqual(slaFor('Medium'), { resolutionMinutes: 2 * 24 * 60, resolution: '2 days' });
  assert.deepEqual(slaFor('Low'), { resolutionMinutes: 5 * 24 * 60, resolution: '5 days' });
});

test('slaFor falls back to Medium for an unknown or missing priority', () => {
  const medium = slaFor('Medium');
  assert.deepEqual(slaFor('Urgent'), medium);
  assert.deepEqual(slaFor('critical'), medium);
  assert.deepEqual(slaFor(undefined), medium);
  assert.deepEqual(slaFor(null), medium);
});

test('slaSummary describes the resolution target', () => {
  assert.equal(slaSummary('Critical'), '4 hrs resolution');
  assert.equal(slaSummary('High'), '8 hrs resolution');
  assert.equal(slaSummary('Medium'), '2 days resolution');
  assert.equal(slaSummary('Low'), '5 days resolution');
  assert.equal(slaSummary('Urgent'), '2 days resolution');
});
