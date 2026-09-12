import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import express from 'express';
import { generateImage } from '../src/images.js';

const app = express();
app.use(express.json());
app.post('/api/images', generateImage);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address() as { port: number };
const nativeFetch = globalThis.fetch;
const previousAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
const previousToken = process.env.CLOUDFLARE_API_TOKEN;
after(() => {
  globalThis.fetch = nativeFetch;
  if (previousAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = previousAccount;
  if (previousToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN; else process.env.CLOUDFLARE_API_TOKEN = previousToken;
  server.close();
});
const request = (prompt: unknown) => nativeFetch(`http://127.0.0.1:${address.port}/api/images`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });

test('image endpoint validates inputs, credentials, upstream responses and errors', async () => {
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(options?.headers && (options.headers as Record<string, string>).Authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(options?.body as string), { prompt: 'A blue bird', steps: 4 });
    return Response.json({ success: true, result: { image: '/9j/2Q==' } });
  };
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  assert.equal((await request('A blue bird')).status, 503);
  process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
  process.env.CLOUDFLARE_API_TOKEN = 'test-token';
  for (const prompt of ['', ' ', null, 42, 'a'.repeat(2049)]) assert.equal((await request(prompt)).status, 400);
  assert.equal(calls, 0);
  const success = await request(' A blue bird ');
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), { image: { dataUrl: 'data:image/jpeg;base64,/9j/2Q==', prompt: 'A blue bird' } });
  assert.equal(calls, 1);
  for (const status of [401, 403, 429, 500]) {
    globalThis.fetch = async () => Response.json({ success: false, errors: [{ message: 'secret-provider-detail' }] }, { status });
    const result = await request('A blue bird');
    assert.equal(result.status, status === 429 ? 429 : 502);
    assert.ok(!(await result.text()).includes('secret-provider-detail'));
  }
  globalThis.fetch = async () => Response.json({ success: true, result: {} });
  assert.equal((await request('A blue bird')).status, 502);
  globalThis.fetch = async () => { throw new Error('network failure'); };
  assert.equal((await request('A blue bird')).status, 502);
});
