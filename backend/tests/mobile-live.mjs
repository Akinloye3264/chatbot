// Explicit live smoke test: sends synthetic files to the configured Groq account.
// Run from the repository root after building the backend.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { deflateSync } from 'node:zlib';

const server = spawn(process.execPath, ['backend/dist/server.js'], { env: { ...process.env, PORT: '3118' }, stdio: ['ignore', 'pipe', 'pipe'] });
const base = 'http://127.0.0.1:3118';
function pngChunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, bytes, checksum]);
}
function redImage() {
  const header = Buffer.alloc(13); header.writeUInt32BE(64, 0); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(64 * (1 + 64 * 3));
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) pixels[y * 193 + 1 + x * 3] = 255;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}
const attachment = (name, text) => ({ name, mimeType: 'text/plain', dataUrl: `data:text/plain;base64,${Buffer.from(text).toString('base64')}` });
const post = body => fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
async function chat(body) {
  const response = await post(body); assert.equal(response.status, 200);
  const wire = await response.text();
  const events = wire.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  assert.ok(!events.some(event => event.error), JSON.stringify(events.find(event => event.error)));
  assert.ok(events.some(event => event.done), 'Missing completion event');
  return events.map(event => event.delta ?? '').join('');
}
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Backend startup timed out')), 15000);
    server.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', () => { clearTimeout(timer); reject(new Error('Backend exited')); });
  });
  const health = await (await fetch(`${base}/health`)).json();
  assert.ok(health.configuredKeys >= 1); assert.equal(health.webAccess, true); assert.ok(health.visionModel);
  console.log('PASS backend configuration:', JSON.stringify(health));
  const uploads = await chat({ message: 'Return both secret words from the attached files in plain text.', attachments: [attachment('first.txt', 'The first secret word is APRICOT.\n' + ' '.repeat(110000)), attachment('second.txt', 'The second secret word is COBALT.')] });
  assert.match(uploads, /APRICOT/i); assert.match(uploads, /COBALT/i);
  console.log('PASS multiple uploads over 100 KB');
  const link = await chat({ message: 'Visit https://example.com and tell me its page title and purpose in one sentence. Include its source link.' });
  assert.match(link, /example/i); assert.match(link, /https:\/\/example\.com/i);
  console.log('PASS URL question and source link');
  const image = await chat({ message: 'What is the dominant color of this image? Answer briefly.', attachments: [{ name: 'color.png', mimeType: 'image/png', dataUrl: `data:image/png;base64,${redImage().toString('base64')}` }] });
  assert.match(image, /red/i); console.log('PASS image understanding without OCR text');
  assert.equal((await post({ attachments: Array(11).fill(attachment('test.txt', 'hello')) })).status, 400);
  assert.equal((await post({ attachments: [attachment('big.txt', 'x'.repeat(5 * 1024 * 1024 + 1))] })).status, 413);
  assert.equal((await post({ attachments: [attachment('empty.txt', '')] })).status, 400);
  console.log('PASS upload validation');
} finally { server.kill(); }
