import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withAbort } from '../src/requests';

test('stop releases a request even when its transport never settles', async () => {
  const controller = new AbortController();
  const pending = withAbort(new Promise(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(pending, /Request stopped/);
});

test('late transport failures are handled after cancellation', async () => {
  const controller = new AbortController();
  let fail!: (error: Error) => void;
  const pending = withAbort(new Promise((_, reject) => { fail = reject; }), controller.signal);
  controller.abort();
  await assert.rejects(pending, /Request stopped/);
  fail(new Error('Late network failure'));
  await new Promise(resolve => setTimeout(resolve, 0));
});

test('completed and already cancelled requests settle correctly', async () => {
  const controller = new AbortController();
  assert.equal(await withAbort(Promise.resolve('done'), controller.signal), 'done');
  controller.abort();
  await assert.rejects(withAbort(Promise.resolve('late'), controller.signal), /Request stopped/);
});
