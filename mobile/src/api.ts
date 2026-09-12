import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { Attachment, createEventParser, normalizeApiUrl, validateAttachments } from './chat';

export async function checkServer(value: string) {
  const url = normalizeApiUrl(value, __DEV__);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${url}/health`, { signal: controller.signal });
    const health = await response.json();
    if (!response.ok || health.ok !== true) throw new Error('This URL is not a healthy JAY AI backend.');
    return url;
  } finally { clearTimeout(timer); }
}

export async function streamChat(options: {
  url: string; conversationId: string; message: string; attachments: Attachment[];
  signal: AbortSignal; onDelta: (delta: string) => void;
}) {
  validateAttachments(options.attachments);
  const attachments = [];
  // Read sequentially to limit peak memory use on smaller phones.
  for (const attachment of options.attachments) {
    if (options.signal.aborted) throw new Error('Request stopped.');
    const file = new File(attachment.uri);
    const data = await file.base64();
    attachments.push({ name: attachment.name, mimeType: attachment.mimeType, dataUrl: `data:${attachment.mimeType};base64,${data}` });
  }
  const response = await fetch(`${normalizeApiUrl(options.url, __DEV__)}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ conversationId: options.conversationId, message: options.message, attachments }),
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `The server returned error ${response.status}.`);
  }
  if (!response.body) throw new Error('The server did not return a response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let completed = false;
  const parser = createEventParser(event => {
    if (event.error) throw new Error(event.error);
    if (typeof event.delta === 'string') options.onDelta(event.delta);
    if (event.done) completed = true;
  });
  try {
    while (!completed) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.finish();
    if (!completed) throw new Error('Connection interrupted before the reply finished. Please try again.');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
