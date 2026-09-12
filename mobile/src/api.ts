import { fetch } from 'expo/fetch';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { Attachment, createEventParser, normalizeApiUrl, validateAttachments } from './chat';
import type { ReplyOptions } from './preferences';

export function removeGeneratedImage(uri: string) {
  if (Platform.OS === 'web') return;
  // Only remove files created by this feature inside this app's document directory.
  const prefix = `${Paths.document.uri.replace(/\/$/, '')}/generated-`;
  if (!uri.startsWith(prefix) || !/^[\w-]+\.jpg$/.test(uri.slice(prefix.length))) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}

export async function generateImage(url: string, prompt: string, imageId: string, signal: AbortSignal) {
  const response = await fetch(`${normalizeApiUrl(url, __DEV__)}/api/images`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }), signal,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? (response.status === 404 ? 'Deploy the updated backend to enable image generation.' : 'Image generation failed. Please retry.'));
  const dataUrl = body?.image?.dataUrl;
  if (typeof dataUrl !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw new Error('The server returned an unreadable image.');
  if (signal.aborted) throw new Error('Request stopped.');
  // Keep large image bytes out of native AsyncStorage; persist a document URI instead.
  if (Platform.OS === 'web') return { uri: dataUrl, prompt };
  const file = new File(Paths.document, `generated-${imageId}.jpg`);
  try {
    file.write(Uint8Array.from(atob(dataUrl.split(',')[1]), character => character.charCodeAt(0)));
  } catch {
    if (file.exists) file.delete();
    throw new Error('The image could not be saved. Free some device storage and retry.');
  }
  return { uri: file.uri, prompt };
}

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
  preferences?: ReplyOptions;
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
    body: JSON.stringify({ conversationId: options.conversationId, message: options.message, attachments, preferences: options.preferences }),
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `The server returned error ${response.status}.`);
  }
  if (!response.body) throw new Error('The server did not return a response stream.');
  const reader = response.body.getReader();
  const cancelReader = () => { void reader.cancel().catch(() => undefined); };
  options.signal.addEventListener('abort', cancelReader, { once: true });
  const decoder = new TextDecoder();
  let completed = false;
  let receivedText = false;
  const parser = createEventParser(event => {
    if (event.error) throw new Error(event.error);
    if (options.signal.aborted) throw new Error('Request stopped.');
    if (typeof event.delta === 'string') {
      if (event.delta.trim()) receivedText = true;
      options.onDelta(event.delta);
    }
    if (event.done) completed = true;
  });
  try {
    if (options.signal.aborted) throw new Error('Request stopped.');
    while (!completed) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.finish();
    if (!completed) throw new Error('Connection interrupted before the reply finished. Please try again.');
    if (!receivedText) throw new Error('The server returned an empty reply. Please retry.');
  } finally {
    options.signal.removeEventListener('abort', cancelReader);
    // Cancellation cleanup must not hold the composer locked on a stalled transport.
    void reader.cancel().catch(() => undefined).finally(() => reader.releaseLock()).catch(() => undefined);
  }
}
