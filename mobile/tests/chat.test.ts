import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachmentMime, createEventParser, MAX_FILE_BYTES, normalizeApiUrl, restoreConversations, validateAttachments } from '../src/chat';

test('stream parser handles arbitrary byte/chunk boundaries and CRLF', () => {
  const events: unknown[] = [];
  const parser = createEventParser(event => events.push(event));
  const wire = ': heartbeat\r\n\r\ndata: {"delta":"Bonjour 🌍"}\r\n\r\ndata: {"done":true}\r\n\r\n';
  const decoder = new TextDecoder();
  for (const byte of new TextEncoder().encode(wire)) parser.push(decoder.decode(Uint8Array.of(byte), { stream: true }));
  parser.push(decoder.decode()); parser.finish();
  assert.deepEqual(events, [{ delta: 'Bonjour 🌍' }, { done: true }]);
});
test('stream parser reports invalid data and accepts terminal frame without newline', () => {
  const events: unknown[] = [];
  const parser = createEventParser(event => events.push(event));
  parser.push('data: {"done":true}'); parser.finish();
  assert.deepEqual(events, [{ done: true }]);
  assert.throws(() => createEventParser(() => {}).push('data: invalid\n\n'), /unreadable/);
});
test('multiple file limits use actual bytes and reject empty and oversized files', () => {
  validateAttachments(Array.from({ length: 10 }, () => ({ name: 'a', size: 1024 })));
  assert.throws(() => validateAttachments(Array.from({ length: 11 }, () => ({ name: 'a', size: 1 }))), /10 files/);
  assert.throws(() => validateAttachments([{ name: 'a', size: MAX_FILE_BYTES + 1 }]), /5 MB/);
  assert.throws(() => validateAttachments(Array.from({ length: 5 }, () => ({ name: 'a', size: MAX_FILE_BYTES }))), /20 MB/);
  assert.throws(() => validateAttachments([{ name: 'empty', size: 0 }]), /empty/);
});
test('extension fallback handles phone file providers and refuses unsupported formats', () => {
  assert.equal(attachmentMime('NOTES.MD', 'application/octet-stream'), 'text/markdown');
  assert.equal(attachmentMime('report.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.throws(() => attachmentMime('old.doc', 'application/msword'), /use PDF/);
});
test('release URLs require HTTPS and never accept embedded credentials', () => {
  assert.equal(normalizeApiUrl(' https://example.com/ ', false), 'https://example.com');
  assert.equal(normalizeApiUrl('http://192.168.1.10:3001', true), 'http://192.168.1.10:3001');
  assert.throws(() => normalizeApiUrl('http://example.com', false), /HTTPS/);
  assert.throws(() => normalizeApiUrl('https://secret@example.com', true), /credentials/);
});
test('saved history filters corrupt records', () => {
  const valid = { id: '1', title: 'Chat', updatedAt: 1, messages: [{ id: '2', role: 'user', content: 'Hi' }] };
  assert.deepEqual(restoreConversations(JSON.stringify([null, {}, valid])), [valid]);
  assert.throws(() => restoreConversations('{}'), /Saved chats/);
});
