import { config } from 'dotenv';
import cors from 'cors';
import express from 'express';
import mammoth from 'mammoth';
import OpenAI from 'openai';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pdfParse from 'pdf-parse';
import Tesseract from 'tesseract.js';

const backendEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
config({ path: backendEnvPath });

type ChatRole = 'system' | 'user' | 'assistant';

type ChatMessage = {
  role: ChatRole;
  content: string | null;
};

type ConversationState = {
  messages: ChatMessage[];
};

type ApiRequestBody = {
  conversationId?: string;
  message?: string;
  projectBrief?: string;
  attachments?: AttachmentInput[];
};

type AttachmentInput = {
  name?: string;
  mimeType: string;
  dataUrl: string;
};

type ExtractedAttachment = {
  name: string;
  mimeType: string;
  text: string;
};

const apiKey = process.env.GROQ_API_KEY;
const model = process.env.GROQ_MODEL ?? 'groq/compound';
const port = Number(process.env.PORT ?? 3001);
const clientUrl = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';

if (!apiKey) {
  throw new Error('Missing GROQ_API_KEY in backend/.env.');
}

const client = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey,
});

const conversations = new Map<string, ConversationState>();
const app = express();

app.use(
  cors({
    origin: clientUrl,
  })
);
app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({ ok: true, model });
});

function dataUrlToBuffer(dataUrl: string): Buffer {
  const commaIndex = dataUrl.indexOf(',');
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  return Buffer.from(base64, 'base64');
}

async function extractAttachmentText(attachment: AttachmentInput): Promise<ExtractedAttachment> {
  const name = attachment.name ?? 'attachment';
  const buffer = dataUrlToBuffer(attachment.dataUrl);

  if (attachment.mimeType.startsWith('image/')) {
    const result = await Tesseract.recognize(buffer, 'eng');
    return { name, mimeType: attachment.mimeType, text: result.data.text.trim() };
  }

  if (attachment.mimeType === 'application/pdf') {
    const result = await pdfParse(buffer);
    return { name, mimeType: attachment.mimeType, text: result.text.trim() };
  }

  if (attachment.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer });
    return { name, mimeType: attachment.mimeType, text: result.value.trim() };
  }

  if (attachment.mimeType.startsWith('text/') || attachment.mimeType === 'application/json') {
    return { name, mimeType: attachment.mimeType, text: buffer.toString('utf8').trim() };
  }

  return { name, mimeType: attachment.mimeType, text: '' };
}

function buildAttachmentContext(attachments: ExtractedAttachment[]): string {
  const chunks = attachments
    .filter((a) => a.text.length > 0)
    .map((a, i) =>
      [`Attachment ${i + 1}: ${a.name}`, `Type: ${a.mimeType}`, `Content:`, a.text].join('\n')
    );

  if (chunks.length === 0) return '';

  return [
    'The user attached files. Read the following extracted content carefully and use it as evidence:',
    ...chunks,
  ].join('\n\n');
}

function buildSystemPrompt(): string {
  return [
    'You are a helpful, knowledgeable general-purpose AI assistant.',
    'Answer questions from all areas, including everyday life, education, writing, technology, science, business, and creative work.',
    'Respond naturally and directly to what the user asks. Do not assume the user wants code or turn ordinary questions into programming tutorials.',
    'Keep simple answers concise. Add structure or detail only when it genuinely makes the answer easier to understand.',
    'Avoid decorative formatting, excessive headings, long disclaimers, unnecessary examples, and repeated offers for more help.',
    'If current or live information is unavailable, say so briefly and give the most useful answer possible without inventing facts.',
    'Ask a clarifying question only when the missing information prevents a useful answer.',
  ].join('\n');
}

function sendEvent(response: express.Response, payload: Record<string, unknown>) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

app.post('/api/chat', async (request, response) => {
  const body = request.body as ApiRequestBody;
  const conversationId = body.conversationId?.trim() || crypto.randomUUID();
  const message = body.message?.trim();
  const projectBrief = body.projectBrief?.trim();
  const attachments = body.attachments ?? [];

  if (!message && attachments.length === 0) {
    response.status(400).json({ error: 'message is required' });
    return;
  }

  const conversation = conversations.get(conversationId) ?? {
    messages: [{ role: 'system' as ChatRole, content: buildSystemPrompt() }],
  };

  conversation.messages[0] = {
    role: 'system',
    content: buildSystemPrompt(),
  };

  const extractedAttachments = await Promise.all(attachments.map(extractAttachmentText));
  const attachmentContext = buildAttachmentContext(extractedAttachments);
  const userPrompt = [message, attachmentContext].filter(Boolean).join('\n\n');

  if (!userPrompt.trim()) {
    response.status(400).json({
      error: 'No readable text could be extracted from the uploaded file.',
    });
    return;
  }

  conversation.messages.push({ role: 'user', content: userPrompt });

  // Switch to SSE streaming
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();

  let fullContent = '';

  try {
    const stream = await client.chat.completions.create({
      model,
      messages: conversation.messages,
      stream: true,
    } as Parameters<typeof client.chat.completions.create>[0] & { stream: true });

    for await (const chunk of stream) {
      const delta = (chunk.choices?.[0]?.delta as { content?: string } | undefined)?.content ?? '';
      if (delta) {
        fullContent += delta;
        sendEvent(response, { delta });
      }
    }

    conversation.messages.push({ role: 'assistant', content: fullContent });
    conversations.set(conversationId, conversation);

    sendEvent(response, { done: true, conversationId });
    response.end();
  } catch (error) {
    conversation.messages.pop();
    conversations.set(conversationId, conversation);

    const message = error instanceof Error ? error.message : 'Request failed';

    if (response.headersSent) {
      sendEvent(response, { error: message });
      response.end();
    } else {
      response.status(500).json({ error: message });
    }
  }
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
  console.log(`Allowed frontend origin: ${clientUrl}`);
  console.log(`Model: ${model}`);
});
