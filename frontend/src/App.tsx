import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

function isImageMimeType(mimeType: string) {
  return mimeType.startsWith('image/');
}

function getAttachmentKind(mimeType: string) {
  if (mimeType.startsWith('image/')) {
    return 'Image';
  }

  if (mimeType === 'application/pdf') {
    return 'PDF';
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return 'DOCX';
  }

  if (mimeType === 'text/plain') {
    return 'Text';
  }

  return 'File';
}

type UiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
};

type PersistedState = {
  activeConversationId: string;
  conversations: ConversationState[];
};

type ConversationState = {
  id: string;
  title: string;
  projectBrief: string;
  messages: UiMessage[];
  createdAt: number;
  updatedAt: number;
};


const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const STORAGE_KEY = 'chatbot-state';
const DEFAULT_PROJECT_BRIEF =
  'Build a production-ready chatbot experience. For complex requests, reason in steps, identify assumptions, and propose a clear implementation plan before coding.';
const DEFAULT_GREETING = 'Ask me anything. I am here for your need.';
const DEFAULT_NEW_CHAT_TITLE = 'New chat';

function makeId() {
  return crypto.randomUUID();
}

function createConversation(overrides: Partial<ConversationState> = {}): ConversationState {
  const now = Date.now();
  return {
    id: overrides.id ?? makeId(),
    title: overrides.title ?? DEFAULT_NEW_CHAT_TITLE,
    projectBrief: overrides.projectBrief ?? DEFAULT_PROJECT_BRIEF,
    messages:
      overrides.messages ?? [
        {
          id: makeId(),
          role: 'assistant',
          content: DEFAULT_GREETING,
        },
      ],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function normalizeConversation(raw: Partial<ConversationState> | null | undefined): ConversationState | null {
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.messages)) {
    return null;
  }

  const messages = raw.messages.filter((message): message is UiMessage => {
    return (
      typeof message?.id === 'string' &&
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string'
    );
  });

  if (messages.length === 0) {
    messages.push({
      id: makeId(),
      role: 'assistant',
      content: DEFAULT_GREETING,
    });
  }

  return {
    id: raw.id,
    title: typeof raw.title === 'string' && raw.title.trim().length > 0 ? raw.title : DEFAULT_NEW_CHAT_TITLE,
    projectBrief:
      typeof raw.projectBrief === 'string' && raw.projectBrief.trim().length > 0
        ? raw.projectBrief
        : DEFAULT_PROJECT_BRIEF,
    messages,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

function loadState(): PersistedState {
  const fallbackConversation = createConversation();
  const fallback: PersistedState = {
    activeConversationId: fallbackConversation.id,
    conversations: [fallbackConversation],
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedState> & {
      conversationId?: string;
      messages?: UiMessage[];
      projectBrief?: string;
    };

    if (Array.isArray(parsed.conversations)) {
      const conversations = parsed.conversations
        .map((conversation) => normalizeConversation(conversation))
        .filter((conversation): conversation is ConversationState => conversation !== null);

      if (conversations.length === 0) {
        return fallback;
      }

      const activeConversationId =
        typeof parsed.activeConversationId === 'string' &&
        conversations.some((conversation) => conversation.id === parsed.activeConversationId)
          ? parsed.activeConversationId
          : conversations[0].id;

      return { activeConversationId, conversations };
    }

    if (typeof parsed.conversationId === 'string' && Array.isArray(parsed.messages)) {
      const legacyConversation = normalizeConversation({
        id: parsed.conversationId,
        title: DEFAULT_NEW_CHAT_TITLE,
        projectBrief:
          typeof parsed.projectBrief === 'string' && parsed.projectBrief.trim().length > 0
            ? parsed.projectBrief
            : DEFAULT_PROJECT_BRIEF,
        messages: parsed.messages,
      });

      if (legacyConversation) {
        return {
          activeConversationId: legacyConversation.id,
          conversations: [legacyConversation],
        };
      }
    }

    return fallback;
  } catch {
    return fallback;
  }
}

function buildConversationTitle(messageText: string, attachments: ChatAttachment[]) {
  const sourceText =
    messageText.trim().length > 0
      ? messageText.trim().replace(/\s+/g, ' ')
      : attachments[0]?.name ?? DEFAULT_NEW_CHAT_TITLE;

  if (sourceText.length <= 32) {
    return sourceText;
  }

  return `${sourceText.slice(0, 32).trimEnd()}...`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

const initialState = loadState();

export default function App() {
  const [activeConversationId, setActiveConversationId] = useState(initialState.activeConversationId);
  const [conversations, setConversations] = useState<ConversationState[]>(initialState.conversations);
  const [input, setInput] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeConversation = useMemo(() => {
    return conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0] ?? null;
  }, [activeConversationId, conversations]);

  const sortedConversations = useMemo(() => {
    return [...conversations].sort((left, right) => right.updatedAt - left.updatedAt);
  }, [conversations]);

  const messages = activeConversation?.messages ?? [];
  const projectBrief = activeConversation?.projectBrief ?? DEFAULT_PROJECT_BRIEF;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeConversationId, conversations }));
  }, [activeConversationId, conversations]);

  useEffect(() => {
    if (!activeConversation && conversations.length > 0) {
      setActiveConversationId(conversations[0].id);
    }
  }, [activeConversation, conversations]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  const canSend = useMemo(
    () => (input.trim().length > 0 || pendingAttachments.length > 0) && !isLoading,
    [input, pendingAttachments.length, isLoading]
  );

  async function sendMessage(messageText: string, attachments: ChatAttachment[]) {
    const trimmed = messageText.trim();
    if ((!trimmed && attachments.length === 0) || isLoading) {
      return;
    }

    if (!activeConversation) {
      return;
    }

    const conversationId = activeConversation.id;
    const conversationProjectBrief = activeConversation.projectBrief;
    const nextTitle =
      activeConversation.title === DEFAULT_NEW_CHAT_TITLE
        ? buildConversationTitle(trimmed, attachments)
        : activeConversation.title;

    const userMessage: UiMessage = {
      id: makeId(),
      role: 'user',
      content: trimmed || '[image attachment]',
      attachments,
    };

    setConversations((current) =>
      current.map((conv) => {
        if (conv.id !== conversationId) return conv;
        return {
          ...conv,
          title: nextTitle,
          messages: [...conv.messages, userMessage],
          updatedAt: Date.now(),
        };
      })
    );
    setInput('');
    setPendingAttachments([]);
    setIsLoading(true);
    setError(null);

    const assistantMessageId = makeId();

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          message: trimmed,
          projectBrief: conversationProjectBrief,
          attachments: attachments.map((a) => ({
            name: a.name,
            mimeType: a.mimeType,
            dataUrl: a.dataUrl,
          })),
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Request failed');
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Add empty assistant message — content will fill in as tokens stream
      setConversations((current) =>
        current.map((conv) => {
          if (conv.id !== conversationId) return conv;
          return {
            ...conv,
            messages: [
              ...conv.messages,
              { id: assistantMessageId, role: 'assistant' as const, content: '' },
            ],
            updatedAt: Date.now(),
          };
        })
      );

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalConversationId = conversationId;

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let parsed: { delta?: string; done?: boolean; conversationId?: string; error?: string };
          try {
            parsed = JSON.parse(raw) as typeof parsed;
          } catch {
            continue;
          }

          if (parsed.error) {
            throw new Error(parsed.error);
          }

          if (parsed.done) {
            finalConversationId = parsed.conversationId ?? conversationId;
            break outer;
          }

          if (parsed.delta) {
            setConversations((current) =>
              current.map((conv) => {
                if (conv.id !== conversationId) return conv;
                return {
                  ...conv,
                  messages: conv.messages.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: msg.content + parsed.delta }
                      : msg
                  ),
                  updatedAt: Date.now(),
                };
              })
            );
          }
        }
      }

      setActiveConversationId(finalConversationId);
      if (finalConversationId !== conversationId) {
        setConversations((current) =>
          current.map((conv) =>
            conv.id === conversationId ? { ...conv, id: finalConversationId } : conv
          )
        );
      }
    } catch (caughtError) {
      // Remove the placeholder assistant message on error
      setConversations((current) =>
        current.map((conv) => {
          if (conv.id !== conversationId) return conv;
          return {
            ...conv,
            messages: conv.messages.filter((msg) => msg.id !== assistantMessageId),
          };
        })
      );
      setError(caughtError instanceof Error ? caughtError.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendMessage(input, pendingAttachments);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input, pendingAttachments);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    const allowedFiles = files.filter((file) => {
      return (
        file.type.startsWith('image/') ||
        file.type === 'application/pdf' ||
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.type === 'text/plain' ||
        file.type === 'application/json' ||
        file.name.endsWith('.md') ||
        file.name.endsWith('.csv')
      );
    });

    const filesToRead = allowedFiles.length > 0 ? allowedFiles : files;
    const nextAttachments = await Promise.all(
      filesToRead.map(async (file) => ({
        id: makeId(),
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataUrl: await fileToDataUrl(file),
      }))
    );

    setPendingAttachments((current) => [...current, ...nextAttachments]);
    event.target.value = '';
  }

  function removeAttachment(id: string) {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function startNewChat() {
    const nextConversation = createConversation({ projectBrief });
    setConversations((current) => [nextConversation, ...current]);
    setActiveConversationId(nextConversation.id);
    setInput('');
    setPendingAttachments([]);
    setError(null);
    setSidebarOpen(false);
  }

  function selectConversation(conversationId: string) {
    if (conversationId !== activeConversationId) {
      setActiveConversationId(conversationId);
      setInput('');
      setPendingAttachments([]);
      setError(null);
    }
    setSidebarOpen(false);
  }

  return (
    <main className="shell">
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <section className={`hero sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div className="eyebrow">JAY N2 Pro</div>
        <h1>Persistent chat with image and document support.</h1>

        <div className="hero-actions">
          <button type="button" onClick={startNewChat} className="secondary-button">
            New chat
          </button>
        </div>

        <div className="conversation-section">
          <div className="conversation-section-header">
            <span className="label">Chats</span>
            <span className="conversation-count">{sortedConversations.length}</span>
          </div>
          <div className="conversation-list" role="list" aria-label="Chat history">
            {sortedConversations.map((conversation) => {
              const isActive = conversation.id === activeConversationId;

              return (
                <button
                  key={conversation.id}
                  type="button"
                  className={`conversation-item${isActive ? ' active' : ''}`}
                  onClick={() => selectConversation(conversation.id)}
                  aria-pressed={isActive}
                >
                  <span className="conversation-item-title">{conversation.title}</span>
                </button>
              );
            })}
          </div>
        </div>

      </section>

      <section className="chat-panel">
        <header className="chat-header">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle sidebar"
            aria-expanded={sidebarOpen}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <rect y="2" width="18" height="2" rx="1" fill="currentColor" />
              <rect y="8" width="18" height="2" rx="1" fill="currentColor" />
              <rect y="14" width="18" height="2" rx="1" fill="currentColor" />
            </svg>
          </button>

          <div className="chat-header-title">
            <span className="label">Conversation</span>
            <strong>{activeConversation?.title ?? DEFAULT_NEW_CHAT_TITLE}</strong>
          </div>

          <div className={`connection-dot ${isLoading ? 'busy' : 'ready'}`}>
            {isLoading ? 'Thinking' : 'Ready'}
          </div>
        </header>

        <div ref={listRef} className="messages" aria-live="polite">
          {messages.map((message) => (
            <article key={message.id} className={`bubble bubble-${message.role}`}>
              <p>{message.content}</p>
              {message.attachments?.length ? (
                <div className="attachment-grid">
                  {message.attachments.map((attachment) => (
                    <figure key={attachment.id} className="attachment-card">
                      {isImageMimeType(attachment.mimeType) ? (
                        <img src={attachment.dataUrl} alt={attachment.name} />
                      ) : (
                        <div className="attachment-file">
                          <div className="attachment-file-kind">
                            {getAttachmentKind(attachment.mimeType)}
                          </div>
                          <div className="attachment-file-name">{attachment.name}</div>
                        </div>
                      )}
                      <figcaption>{attachment.name}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
          {isLoading && messages[messages.length - 1]?.role !== 'assistant' ? (
            <article className="bubble bubble-assistant">
              <p>Generating response...</p>
            </article>
          ) : null}
        </div>

        <form onSubmit={handleSubmit} className="composer">
          <label className="sr-only" htmlFor="message">
            Message
          </label>
          <textarea
            id="message"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the model something or add images..."
            rows={3}
          />

          {pendingAttachments.length ? (
            <div className="attachment-grid pending-grid">
              {pendingAttachments.map((attachment) => (
                <figure key={attachment.id} className="attachment-card pending-card">
                  <button
                    type="button"
                    className="attachment-remove"
                    onClick={() => removeAttachment(attachment.id)}
                    aria-label={`Remove ${attachment.name}`}
                  >
                    ×
                  </button>
                  {isImageMimeType(attachment.mimeType) ? (
                    <img src={attachment.dataUrl} alt={attachment.name} />
                  ) : (
                    <div className="attachment-file">
                      <div className="attachment-file-kind">{getAttachmentKind(attachment.mimeType)}</div>
                      <div className="attachment-file-name">{attachment.name}</div>
                    </div>
                  )}
                  <figcaption>{attachment.name}</figcaption>
                </figure>
              ))}
            </div>
          ) : null}

          <div className="composer-footer">
            <div className="composer-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf,.doc,.docx,.txt,.md,.csv,application/json"
                multiple
                className="file-input"
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="secondary-button"
              >
                Add image or document
              </button>
            </div>
            <div className="help-text">
              <span className="help-hint">Press Enter to send. Shift+Enter for a new line.</span>
              {error ? <span className="error-text"> {error}</span> : null}
            </div>
            <button type="submit" disabled={!canSend} className="send-button">
              Send
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
