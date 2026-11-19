const test = require('node:test');
const assert = require('node:assert/strict');
const {
  uploadIncomingAttachments,
  MAX_ATTACHMENTS_PER_REQUEST
} = require('../utils/attachment-storage');

// supabase-js talks to Storage through the global fetch, so swapping it out
// lets these tests see every upload attempt without a real bucket.
const realFetch = global.fetch;
let storageCalls;

test.beforeEach(() => {
  storageCalls = [];
  global.fetch = async (url, init) => {
    storageCalls.push({ url: String(url), method: init && init.method });
    return new Response(JSON.stringify({ Id: 'id', Key: 'key' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
});

test.afterEach(() => {
  global.fetch = realFetch;
});

const content = Buffer.from('hello').toString('base64');
const file = (filename) => ({ filename, content_base64: content, mime_type: 'text/plain' });

test('an entry with no content is rejected and nothing is uploaded', async () => {
  await assert.rejects(
    uploadIncomingAttachments('TKT-1', [file('ok.txt'), { filename: 'empty.txt' }]),
    /"empty\.txt" has no file content/
  );
  assert.equal(storageCalls.length, 0);
});

test('a bare filename string is rejected', async () => {
  await assert.rejects(uploadIncomingAttachments('TKT-1', ['notes.txt']), /not a valid file/);
  assert.equal(storageCalls.length, 0);
});

test('an entry with no filename is rejected', async () => {
  await assert.rejects(
    uploadIncomingAttachments('TKT-1', [{ filename: '  ', content_base64: content }]),
    /has no filename/
  );
  assert.equal(storageCalls.length, 0);
});

test('more than the per-request limit is rejected and nothing is uploaded', async () => {
  const files = Array.from({ length: MAX_ATTACHMENTS_PER_REQUEST + 1 }, (_, i) => file(`f${i}.txt`));
  await assert.rejects(uploadIncomingAttachments('TKT-1', files), /at most 5 files/);
  assert.equal(storageCalls.length, 0);
});

test('a disallowed file type is rejected and nothing is uploaded', async () => {
  for (const name of ['script.exe', 'page.html', 'noextension', 'archive.txt.zip']) {
    await assert.rejects(
      uploadIncomingAttachments('TKT-1', [file('ok.png'), file(name)]),
      /is not an allowed file type/,
      name
    );
  }
  assert.equal(storageCalls.length, 0);
});

test('a non-array attachment list is rejected', async () => {
  await assert.rejects(uploadIncomingAttachments('TKT-1', 'oops'), /must be a list/);
});

test('no attachment list means no attachments', async () => {
  assert.deepEqual(await uploadIncomingAttachments('TKT-1', undefined), []);
  assert.deepEqual(await uploadIncomingAttachments('TKT-1', []), []);
  assert.equal(storageCalls.length, 0);
});

test('valid files, up to the limit, are all uploaded', async () => {
  const names = ['a.pdf', 'b.PNG', 'c.jpeg', 'd.log', 'e.xlsx'];
  const result = await uploadIncomingAttachments('TKT-1', names.map(file));
  assert.equal(storageCalls.length, names.length);
  assert.deepEqual(result.map((r) => r.filename), names);
  for (const r of result) {
    assert.equal(r.size_bytes, 5);
    assert.equal(r.mime_type, 'text/plain');
    assert.match(r.stored_path, /^TKT-1\/[0-9a-f]{12}-/);
  }
});
