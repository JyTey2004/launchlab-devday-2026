import test from 'node:test';
import assert from 'node:assert/strict';
import { repositorySnapshot } from '../src/repos.mjs';
const sha = 'a'.repeat(40);
const manifest = {
  name: 'Test fixture',
  description: 'Only a test fixture',
  adapter: 'static',
  entry: 'index.html',
  files: ['index.html'],
  chainId: 1952,
};
const file = (content) => ({
  type: 'file',
  encoding: 'base64',
  size: Buffer.byteLength(content),
  content: Buffer.from(content).toString('base64'),
});
test('GitHub adapter resolves a ref once and pins every file to the returned commit', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(String(url));
    const value = String(url).includes('/commits/')
      ? { sha }
      : String(url).includes('/launchlab.json?')
        ? file(JSON.stringify(manifest))
        : file('<!doctype html><title>Fixture</title>');
    return new Response(JSON.stringify(value), { status: 200 });
  });
  const snapshot = await repositorySnapshot(
    'https://github.com/example/fixture',
    'feature/experiment',
  );
  assert.equal(snapshot.commitSha, sha);
  assert.equal(snapshot.digest.length, 64);
  assert.ok(requests[0].endsWith('/commits/feature%2Fexperiment'));
  assert.ok(requests.slice(1).every((url) => url.endsWith(`?ref=${sha}`)));
});
test('GitHub manifest traversal is rejected before reading any listed asset', async (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return new Response(
      JSON.stringify(
        requests === 1
          ? { sha }
          : file(JSON.stringify({ ...manifest, files: ['index.html', '../secret.txt'] })),
      ),
    );
  });
  await assert.rejects(() => repositorySnapshot('https://github.com/example/fixture'));
  assert.equal(requests, 2);
});
test('GitHub unavailable and oversized files fail without a fabricated report', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 404 }));
  await assert.rejects(() => repositorySnapshot('https://github.com/example/missing'), /HTTP 404/);
  t.mock.restoreAll();
  t.mock.method(
    globalThis,
    'fetch',
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes('/commits/')
            ? { sha }
            : { ...file(JSON.stringify(manifest)), size: 300000 },
        ),
      ),
  );
  await assert.rejects(() => repositorySnapshot('https://github.com/example/large'), /oversized/);
});
