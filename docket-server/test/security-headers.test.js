const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const clientDirectory = join(__dirname, '..', '..', 'client');
// Normalized so the line-anchored checks also pass on a CRLF (Windows) checkout.
const headers = readFileSync(join(clientDirectory, '_headers'), 'utf8').replace(/\r\n/g, '\n');
const app = readFileSync(join(clientDirectory, 'app.js'), 'utf8');

// Splits a CSP header value into { directive: [sources...] } so each rule can
// be compared exactly instead of by substring (a substring check would let
// "script-src 'self' https:" pass as "script-src 'self'").
function parsePolicy(policy) {
  const directives = {};
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    assert.ok(!(name in directives), `CSP directive ${name} is declared twice`);
    directives[name] = sources;
  }
  return directives;
}

test('Netlify sends security headers for every frontend path', () => {
  assert.match(headers, /^\/\*\s*$/m);
  assert.match(headers, /^  X-Frame-Options: DENY$/m);
  assert.match(headers, /^  X-Content-Type-Options: nosniff$/m);
  assert.match(headers, /^  Referrer-Policy: strict-origin-when-cross-origin$/m);
  assert.match(headers, /^  Permissions-Policy: geolocation=\(\), camera=\(\), microphone=\(\)$/m);
  assert.match(headers, /^  Cross-Origin-Opener-Policy: same-origin$/m);
});

test('CSP permits exactly the app dependencies and local attachment previews', () => {
  const policy = headers.match(/^  Content-Security-Policy: (.+)$/m)?.[1];
  assert.ok(policy, 'Content-Security-Policy header is required');
  const directives = parsePolicy(policy);

  const apiOrigin = app.match(/'https:\/\/ticket-management-system-[^']+onrender\.com'/)?.[0].slice(1, -1);
  assert.ok(apiOrigin, 'Could not determine the API host from client/app.js');

  assert.deepEqual(directives, {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'blob:'],
    'media-src': ["'self'", 'blob:'],
    'frame-src': ['blob:'],
    'connect-src': ["'self'", apiOrigin],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  });
});

test('CSP never allows wildcard or scheme-wide sources for scripts, defaults or connections', () => {
  const policy = headers.match(/^  Content-Security-Policy: (.+)$/m)?.[1];
  const directives = parsePolicy(policy);
  const unsafe = new Set(['*', 'http:', 'https:', 'data:', 'blob:', "'unsafe-inline'", "'unsafe-eval'"]);

  for (const name of ['default-src', 'script-src', 'connect-src']) {
    for (const source of directives[name]) {
      assert.ok(!unsafe.has(source) && !source.includes('*'), `${name} must not allow ${source}`);
    }
  }
});
