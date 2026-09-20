import assert from 'node:assert/strict';
import test from 'node:test';

import { downloadEndpoint, downloadProjectTarget, filenameFromDisposition } from './download.js';

function browserHarness(t) {
  const previousDocument = globalThis.document;
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  const appended = [];
  const anchor = { style: {}, clickCount: 0, removeCount: 0, click() { this.clickCount += 1; }, remove() { this.removeCount += 1; } };
  globalThis.document = { body: { appendChild(value) { appended.push(value); } }, createElement() { return anchor; } };
  URL.createObjectURL = (blob) => { assert.ok(blob instanceof Blob); return 'blob:download'; };
  let revoked;
  URL.revokeObjectURL = (value) => { revoked = value; };
  t.after(() => { globalThis.document = previousDocument; URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL; });
  return { anchor, appended, revoked: () => revoked };
}

test('uses authenticated public endpoints for every target kind', () => {
  assert.equal(downloadEndpoint('project id', { kind: 'file', id: 'file/id' }), '/projects/v1/projects/project%20id/files/file%2Fid/download');
  assert.equal(downloadEndpoint('p', { kind: 'directory', id: 'd' }), '/projects/v1/projects/p/directories/d/download');
  assert.equal(downloadEndpoint('p', { kind: 'project', id: 'ignored' }), '/projects/v1/projects/p/download');
});

test('honors UTF-8 attachment filenames and cleans up the Blob URL', async (t) => {
  const browser = browserHarness(t);
  let request;
  const response = new Response(new Blob(['zip bytes'], { type: 'application/zip' }), { headers: { 'Content-Disposition': "attachment; filename=report.zip; filename*=UTF-8''r%C3%A9sum%C3%A9.zip" } });
  const result = await downloadProjectTarget('p', { kind: 'directory', id: 'd', name: 'fallback' }, { fetcher: async (...args) => { request = args; return response; } });
  assert.equal(request[0], '/projects/v1/projects/p/directories/d/download');
  assert.deepEqual(request[1], { method: 'GET', signal: undefined });
  assert.equal(result.filename, 'résumé.zip');
  assert.equal(browser.anchor.download, 'résumé.zip');
  assert.equal(browser.anchor.clickCount, 1);
  assert.equal(browser.anchor.removeCount, 1);
  assert.deepEqual(browser.appended, [browser.anchor]);
  assert.equal(browser.revoked(), 'blob:download');
});

test('preserves server errors for retry feedback and never creates a Blob URL', async (t) => {
  const browser = browserHarness(t);
  await assert.rejects(
    () => downloadProjectTarget('p', { kind: 'file', id: 'f', name: 'main.tex' }, { fetcher: async () => new Response(JSON.stringify({ error: 'File content not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }) }),
    /File content not found/,
  );
  assert.equal(browser.appended.length, 0);
  assert.equal(browser.revoked(), undefined);
});

test('sanitizes a malformed disposition filename while retaining a safe fallback', () => {
  assert.equal(filenameFromDisposition('attachment; filename="../bad\\name"', 'report.zip'), 'badname');
  assert.equal(filenameFromDisposition("attachment; filename*=UTF-8''%ZZ", 'report.zip'), 'report.zip');
});
