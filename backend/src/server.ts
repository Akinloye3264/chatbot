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
  reasoning_details?: unknown;
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

const apiKey = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_MODEL ?? 'nex-agi/nex-n2-pro:free';
const port = Number(process.env.PORT ?? 3001);
const clientUrl = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';

if (!apiKey) {
  throw new Error('Missing OPENROUTER_API_KEY in the environment.');
}

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey,
  defaultHeaders: {
    'HTTP-Referer': process.env.OPENROUTER_SITE_URL ?? 'http://localhost',
    'X-Title': process.env.OPENROUTER_APP_NAME ?? 'chatbot',
  },
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
    return {
      name,
      mimeType: attachment.mimeType,
      text: result.data.text.trim(),
    };
  }

  if (attachment.mimeType === 'application/pdf') {
    const result = await pdfParse(buffer);
    return {
      name,
      mimeType: attachment.mimeType,
      text: result.text.trim(),
    };
  }

  if (
    attachment.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return {
      name,
      mimeType: attachment.mimeType,
      text: result.value.trim(),
    };
  }

  if (attachment.mimeType.startsWith('text/') || attachment.mimeType === 'application/json') {
    return {
      name,
      mimeType: attachment.mimeType,
      text: buffer.toString('utf8').trim(),
    };
  }

  return {
    name,
    mimeType: attachment.mimeType,
    text: '',
  };
}

function buildAttachmentContext(attachments: ExtractedAttachment[]): string {
  const chunks = attachments
    .filter((attachment) => attachment.text.length > 0)
    .map((attachment, index) => {
      return [
        `Attachment ${index + 1}: ${attachment.name}`,
        `Type: ${attachment.mimeType}`,
        `Content:`,
        attachment.text,
      ].join('\n');
    });

  if (chunks.length === 0) {
    return '';
  }

  return [
    'The user attached files. Read the following extracted content carefully and use it as evidence:',
    ...chunks,
  ].join('\n\n');
}

function buildSystemPrompt(projectBrief?: string): string {
  const basePrompt = [
    'You are a senior product engineer, architect, and coding assistant.',
    'Handle complex projects by breaking them into phases, surfacing assumptions, and proposing a clear implementation plan before code when the task is large or ambiguous.',
    'If requirements are unclear, ask up to 3 targeted clarifying questions before proceeding.',
    'When the user asks for code, provide practical, production-ready implementation details.',
    'When relevant, mention risks, tradeoffs, and testing steps.',
    'Be concise for simple requests and more structured for complex projects.',
  ];

  if (!projectBrief?.trim()) {
    return basePrompt.join('\n');
  }

  return [
    ...basePrompt,
    '',
    'Project brief from the user:',
    projectBrief.trim(),
  ].join('\n');
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
    messages: [
      {
        role: 'system',
        content: buildSystemPrompt(projectBrief),
      },
    ],
  };

  conversation.messages[0] = {
    role: 'system',
    content: buildSystemPrompt(projectBrief),
  };

  const extractedAttachments = await Promise.all(attachments.map(extractAttachmentText));
  const attachmentContext = buildAttachmentContext(extractedAttachments);
  const userPrompt = [message, attachmentContext].filter(Boolean).join('\n\n');

  if (!userPrompt.trim()) {
    response.status(400).json({
      error:
        'No readable text could be extracted from the uploaded file. Try a clearer image, PDF, DOCX, or text document.',
    });
    return;
  }

  conversation.messages.push({
    role: 'user',
    content: userPrompt,
  });

  try {
    const apiResponse = await client.chat.completions.create({
      model,
      messages: conversation.messages,
      reasoning: { enabled: true },
    } as never);

    type ORChatMessage = (typeof apiResponse)['choices'][number]['message'] & {
      reasoning_details?: unknown;
    };

    const assistantMessage = apiResponse.choices[0]?.message as ORChatMessage | undefined;

    if (!assistantMessage) {
      throw new Error('OpenRouter returned no assistant message.');
    }

    conversation.messages.push({
      role: 'assistant',
      content: assistantMessage.content,
      reasoning_details: assistantMessage.reasoning_details,
    });

    conversations.set(conversationId, conversation);

    response.json({
      conversationId,
      reply: assistantMessage.content ?? '',
    });
  } catch (error) {
    conversation.messages.pop();
    conversations.set(conversationId, conversation);
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Request failed',
    });
  }
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
  console.log(`Allowed frontend origin: ${clientUrl}`);
  console.log(`Model: ${model}`);
});