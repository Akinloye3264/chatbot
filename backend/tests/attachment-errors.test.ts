import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachmentFailure } from '../src/attachment-errors.js';

test('vision failures distinguish service problems from unreadable files', () => {
  assert.equal(attachmentFailure(true, 429).status, 429);
  assert.match(attachmentFailure(true, 429).error, /usage limit/);
  for (const status of [401, 403]) assert.match(attachmentFailure(true, status).error, /access was denied/);
  assert.match(attachmentFailure(true, 404).error, /model is unavailable/);
  assert.equal(attachmentFailure(true, undefined, true).status, 504);
  assert.equal(attachmentFailure(true, 413).status, 422);
  assert.match(attachmentFailure(true, undefined, false, true).error, /no description/);
  assert.match(attachmentFailure(true, 500).error, /does not mean your image has no text/);
  assert.equal(attachmentFailure(false).status, 422);
  assert.doesNotMatch(attachmentFailure(false).error, /Groq|API/);
});
