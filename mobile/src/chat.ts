export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export type Attachment = { id: string; name: string; mimeType: string; size: number; uri: string };
export type GeneratedImage = { uri: string; prompt: string };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; image?: GeneratedImage; attachments?: Pick<Attachment, 'id' | 'name' | 'mimeType' | 'size'>[]; failed?: boolean };
export type Conversation = { id: string; title: string; messages: Message[]; updatedAt: number };
export type ChatEvent = { delta?: string; done?: boolean; conversationId?: string; error?: string };

export function attachmentMime(name: string, supplied?: string | null): string {
  const types: Record<string, string> = {
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
    pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp',
  };
  const mime = types[name.split('.').pop()?.toLowerCase() ?? ''] ?? supplied ?? '';
  if (!mime.startsWith('text/') && !Object.values(types).includes(mime)) {
    throw new Error(`${name}: use PDF, DOCX, text, Markdown, CSV, JSON, PNG, or JPEG. For HEIC photos, use Photos.`);
  }
  return mime;
}

export function validateAttachments(files: Pick<Attachment, 'name' | 'size'>[]) {
  if (files.length > MAX_FILES) throw new Error('You can attach up to 10 files per message.');
  for (const file of files) {
    if (!Number.isFinite(file.size) || file.size <= 0) throw new Error(`${file.name} is empty or could not be read.`);
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} exceeds the 5 MB file limit.`);
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) throw new Error('Keep the combined attachments under 20 MB.');
}

export function normalizeApiUrl(value: string, allowLocalHttp: boolean): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid backend URL, such as https://api.example.com.'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('Use a server URL without credentials, query parameters, or a fragment.');
  if (url.protocol !== 'https:' && !(allowLocalHttp && url.protocol === 'http:')) throw new Error('Use an HTTPS backend URL.');
  return url.toString().replace(/\/+$/, '');
}

// SSE boundaries and UTF-8 characters may span multiple network chunks.
export function createEventParser(onEvent: (event: ChatEvent) => void) {
  let buffer = '';
  function consume(final: boolean) {
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      parse(frame);
    }
    if (final && buffer.trim()) { parse(buffer); buffer = ''; }
  }
  function parse(frame: string) {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    let event: ChatEvent;
    try { event = JSON.parse(data); } catch { throw new Error('The server returned an unreadable response.'); }
    if (!event || typeof event !== 'object') throw new Error('The server returned an invalid response.');
    onEvent(event);
  }
  return {
    push(chunk: string) { buffer += chunk; buffer = buffer.replace(/\r\n/g, '\n'); consume(false); },
    finish() { consume(true); },
  };
}

export function restoreConversations(raw: string | null): Conversation[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Saved chats could not be loaded.');
  return parsed.filter((chat): chat is Conversation => Boolean(chat && typeof chat.id === 'string' && typeof chat.title === 'string' && typeof chat.updatedAt === 'number' && Array.isArray(chat.messages) && chat.messages.every((m: Message) => m && typeof m.id === 'string' && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && (!m.attachments || (Array.isArray(m.attachments) && m.attachments.every(a => a && typeof a.id === 'string' && typeof a.name === 'string'))))));
}
