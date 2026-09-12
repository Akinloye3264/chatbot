import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size?: number;
};

type ReplyOptions = {
  imageReading: 'auto' | 'text' | 'full';
  format: 'plain' | 'markdown';
  answersOnly: boolean;
  explanation: boolean;
  related: boolean;
  findSource: boolean;
};

const defaultOptions: ReplyOptions = {
  imageReading: 'auto',
  format: 'markdown',
  answersOnly: false,
  explanation: false,
  related: false,
  findSource: false,
};

function getOptions(value?: Partial<ReplyOptions>): ReplyOptions {
  return {
    imageReading: value?.imageReading === 'text' || value?.imageReading === 'full' ? value.imageReading : 'auto',
    format: value?.format === 'plain' ? 'plain' : 'markdown',
    answersOnly: value?.answersOnly === true,
    explanation: value?.explanation === true,
    related: value?.related === true,
    findSource: value?.findSource === true,
  };
}

function isImageMimeType(mimeType: string) {
  return mimeType.startsWith('image/');
}

function getAttachmentKind(mimeType: string) {
  if (mimeType.startsWith('image/')) return 'Image';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'DOCX';
  if (mimeType === 'text/plain') return 'Text';
  return 'File';
}

type UiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
  image?: { dataUrl: string; prompt: string };
};

type ConversationState = {
  id: string;
  title: string;
  messages: UiMessage[];
  preferences?: Partial<ReplyOptions>;
  createdAt: number;
  updatedAt: number;
};

type PersistedState = {
  activeConversationId: string;
  conversations: ConversationState[];
  serverUrl?: string;
};

const DEFAULT_API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const STORAGE_KEY = 'chatbot-state';
const DEFAULT_NEW_CHAT_TITLE = 'New chat';

function makeId() { return crypto.randomUUID(); }

function createConversation(): ConversationState {
  const now = Date.now();
  return { id: makeId(), title: DEFAULT_NEW_CHAT_TITLE, messages: [], createdAt: now, updatedAt: now };
}

function normalizeConversation(raw: Partial<ConversationState> | null | undefined): ConversationState | null {
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.messages)) return null;
  const messages = raw.messages.filter((m): m is UiMessage =>
    typeof m?.id === 'string' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
  );
  return {
    id: raw.id,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : DEFAULT_NEW_CHAT_TITLE,
    messages,
    preferences: raw.preferences,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

function loadState(): PersistedState & { serverUrl: string } {
  const fallback = createConversation();
  const base = { activeConversationId: fallback.id, conversations: [fallback], serverUrl: DEFAULT_API_URL };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (Array.isArray(parsed.conversations)) {
      const conversations = parsed.conversations
        .map(normalizeConversation)
        .filter((c): c is ConversationState => c !== null);
      if (!conversations.length) return base;
      const activeConversationId =
        typeof parsed.activeConversationId === 'string' &&
        conversations.some(c => c.id === parsed.activeConversationId)
          ? parsed.activeConversationId
          : conversations[0].id;
      return {
        activeConversationId,
        conversations,
        serverUrl: typeof parsed.serverUrl === 'string' ? parsed.serverUrl : DEFAULT_API_URL,
      };
    }
  } catch { /* ignore */ }
  return base;
}

function buildTitle(text: string, attachments: ChatAttachment[]) {
  const src = text.trim() || attachments[0]?.name || DEFAULT_NEW_CHAT_TITLE;
  return src.length <= 40 ? src : `${src.slice(0, 40).trimEnd()}...`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read file.'));
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
  const [isReadingFiles, setIsReadingFiles] = useState(false);
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverUrl, setServerUrl] = useState(initialState.serverUrl);
  const [serverDraft, setServerDraft] = useState(initialState.serverUrl);
  const [serverNotice, setServerNotice] = useState('');
  const [checkingServer, setCheckingServer] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeConversation = useMemo(
    () => conversations.find(c => c.id === activeConversationId) ?? conversations[0] ?? null,
    [activeConversationId, conversations]
  );
  const sortedConversations = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations]
  );
  const messages = activeConversation?.messages ?? [];
  const preferences = getOptions(activeConversation?.preferences);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeConversationId, conversations, serverUrl }));
    } catch { setError('Browser storage is full. Recent changes may not survive a reload.'); }
  }, [activeConversationId, conversations, serverUrl]);

  useEffect(() => {
    if (!activeConversation && conversations.length > 0) setActiveConversationId(conversations[0].id);
  }, [activeConversation, conversations]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  const canSend = useMemo(
    () => (input.trim().length > 0 || pendingAttachments.length > 0) && !isLoading && !isReadingFiles,
    [input, pendingAttachments.length, isLoading, isReadingFiles]
  );

  function updatePreferences(patch: Partial<ReplyOptions>) {
    if (!activeConversation) return;
    const id = activeConversation.id;
    setConversations(prev => prev.map(c =>
      c.id === id ? { ...c, preferences: { ...getOptions(c.preferences), ...patch } } : c
    ));
  }

  async function sendMessage(messageText: string, attachments: ChatAttachment[]) {
    const trimmed = messageText.trim();
    if ((!trimmed && attachments.length === 0) || isLoading || isReadingFiles || !activeConversation) return;

    if (imageMode) {
      if (!trimmed || trimmed.length > 2048 || attachments.length) {
        setError('Describe your image using 1–2048 characters, without attachments.');
        return;
      }
    }

    const conversationId = activeConversation.id;
    const nextTitle = activeConversation.title === DEFAULT_NEW_CHAT_TITLE
      ? buildTitle(trimmed, attachments)
      : activeConversation.title;

    const userMessage: UiMessage = {
      id: makeId(),
      role: 'user',
      content: trimmed || '[file attachments]',
      attachments,
    };
    const assistantMessageId = makeId();

    setConversations(prev => prev.map(c => c.id !== conversationId ? c : {
      ...c,
      title: nextTitle,
      messages: [...c.messages, userMessage, { id: assistantMessageId, role: 'assistant' as const, content: '' }],
      updatedAt: Date.now(),
    }));
    setInput('');
    setPendingAttachments([]);
    setIsLoading(true);
    setActiveReplyId(assistantMessageId);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (imageMode) {
        const response = await fetch(`${serverUrl}/api/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: trimmed }),
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null) as { image?: { dataUrl?: string }; error?: string } | null;
        if (!response.ok) throw new Error(body?.error ?? (response.status === 404 ? 'Deploy the updated backend to enable image generation.' : 'Image generation failed.'));
        const dataUrl = body?.image?.dataUrl;
        if (typeof dataUrl !== 'string') throw new Error('The server returned an unreadable image.');
        setConversations(prev => prev.map(c => c.id !== conversationId ? c : {
          ...c,
          messages: c.messages.map(m => m.id === assistantMessageId
            ? { ...m, content: 'Generated image', image: { dataUrl, prompt: trimmed } }
            : m),
        }));
        return;
      }

      const response = await fetch(`${serverUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          message: trimmed,
          preferences,
          attachments: attachments.map(a => ({ name: a.name, mimeType: a.mimeType, dataUrl: a.dataUrl })),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Request failed');
      }
      if (!response.body) throw new Error('No response body');

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
          try { parsed = JSON.parse(raw) as typeof parsed; } catch { continue; }
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.done) { finalConversationId = parsed.conversationId ?? conversationId; break outer; }
          if (parsed.delta) {
            setConversations(prev => prev.map(c => c.id !== conversationId ? c : {
              ...c,
              messages: c.messages.map(m => m.id === assistantMessageId
                ? { ...m, content: m.content + parsed.delta }
                : m),
              updatedAt: Date.now(),
            }));
          }
        }
      }

      setActiveConversationId(finalConversationId);
      if (finalConversationId !== conversationId) {
        setConversations(prev => prev.map(c => c.id === conversationId ? { ...c, id: finalConversationId } : c));
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Stopped by user — keep whatever was streamed, just stop
        return;
      }
      // Remove both user and assistant placeholder, restore draft for retry
      setConversations(prev => prev.map(c => c.id !== conversationId ? c : {
        ...c,
        messages: c.messages.filter(m => m.id !== userMessage.id && m.id !== assistantMessageId),
      }));
      setInput(trimmed);
      setPendingAttachments(attachments);
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      abortRef.current = null;
      setIsLoading(false);
      setActiveReplyId(null);
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
    if (!files.length) return;
    event.currentTarget.value = '';
    setError(null);
    setIsReadingFiles(true);
    try {
      if (files.length + pendingAttachments.length > 10) throw new Error('Attach at most 10 files per message.');
      if (files.some(f => f.size > 5 * 1024 * 1024)) throw new Error('Each file must be 5 MB or smaller.');
      const totalExisting = pendingAttachments.reduce((s, f) => s + (f.size ?? 0), 0);
      if (files.reduce((s, f) => s + f.size, 0) + totalExisting > 20 * 1024 * 1024) throw new Error('Attachments must total 20 MB or less.');
      const types: Record<string, string> = { txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
      const next = await Promise.all(files.map(async file => {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        const mimeType = types[ext] ?? file.type;
        if (!mimeType.startsWith('image/') && !mimeType.startsWith('text/') && !Object.values(types).includes(mimeType))
          throw new Error('Unsupported file: ' + file.name);
        return { id: makeId(), name: file.name, mimeType, size: file.size, dataUrl: await fileToDataUrl(file) };
      }));
      setPendingAttachments(prev => [...prev, ...next]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read files.');
    } finally { setIsReadingFiles(false); }
  }

  function removeAttachment(id: string) {
    setPendingAttachments(prev => prev.filter(a => a.id !== id));
  }

  function startNewChat() {
    const next = createConversation();
    setConversations(prev => [next, ...prev]);
    setActiveConversationId(next.id);
    setInput(''); setPendingAttachments([]); setError(null); setImageMode(false); setSidebarOpen(false);
  }

  function selectConversation(id: string) {
    if (id !== activeConversationId) {
      setActiveConversationId(id);
      setInput(''); setPendingAttachments([]); setError(null); setImageMode(false);
    }
    setSidebarOpen(false);
  }

  function deleteConversation(id: string) {
    if (!window.confirm('Delete this conversation?')) return;
    const remaining = conversations.filter(c => c.id !== id);
    if (!remaining.length) {
      const fresh = createConversation();
      setConversations([fresh]);
      setActiveConversationId(fresh.id);
    } else {
      setConversations(remaining);
      if (activeConversationId === id) setActiveConversationId(remaining[0].id);
    }
  }

  function retryMessage(messageId: string) {
    if (isLoading || !activeConversation) return;
    const idx = activeConversation.messages.findIndex(m => m.id === messageId);
    const original = activeConversation.messages.slice(0, idx).reverse().find(m => m.role === 'user');
    if (!original) return;
    setInput(original.content);
    if (original.attachments?.length) setError('Please attach the original files again before retrying.');
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Copied to clipboard.');
      setTimeout(() => setNotice(null), 2500);
    } catch { setError('Could not copy text.'); }
  }

  async function checkServer() {
    setCheckingServer(true);
    setServerNotice('Connecting…');
    try {
      const url = serverDraft.replace(/\/$/, '');
      const res = await fetch(`${url}/health`);
      const health = await res.json();
      if (!res.ok || health.ok !== true) throw new Error('Not a healthy JAY AI backend.');
      setServerUrl(url);
      setServerDraft(url);
      setServerNotice('Connected. Your server is ready.');
    } catch { setServerNotice('Could not connect. Check the URL and try again.'); }
    finally { setCheckingServer(false); }
  }

  const suggestions = [
    ['💡', 'Think it through', 'Help me think through an idea.'],
    ['📄', 'Make sense of a file', 'Summarize the files I attach and highlight the main points.'],
    ['✏️', 'Find the right words', 'Help me write something clearly and naturally.'],
  ];

  return (
    <main className="shell">
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      {/* ── Sidebar ── */}
      <section className={`hero sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div className="eyebrow">JAY AI</div>
        <h1>Your general-purpose AI assistant.</h1>
        <div className="hero-actions">
          <button type="button" onClick={startNewChat} className="secondary-button">New chat</button>
        </div>
        <div className="conversation-section">
          <div className="conversation-section-header">
            <span className="label">Chats</span>
            <span className="conversation-count">{sortedConversations.length}</span>
          </div>
          <div className="conversation-list" role="list" aria-label="Chat history">
            {sortedConversations.map(conv => (
              <div key={conv.id} className={`conversation-item${conv.id === activeConversationId ? ' active' : ''}`}>
                <button
                  type="button"
                  className="conversation-item-btn"
                  onClick={() => selectConversation(conv.id)}
                  aria-pressed={conv.id === activeConversationId}
                >
                  <span className="conversation-item-title">{conv.title}</span>
                  <span className="conversation-item-date">
                    {new Date(conv.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                </button>
                <button
                  type="button"
                  className="conversation-delete"
                  onClick={() => deleteConversation(conv.id)}
                  aria-label={`Delete ${conv.title}`}
                  title="Delete"
                >×</button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Chat panel ── */}
      <section className="chat-panel">
        <header className="chat-header">
          <button type="button" className="sidebar-toggle" onClick={() => setSidebarOpen(v => !v)} aria-label="Toggle sidebar" aria-expanded={sidebarOpen}>
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
          <div className="header-actions">
            <button type="button" className="icon-button" onClick={() => setOptionsOpen(true)} title="Conversation options" aria-label="Conversation options">⚙</button>
            <button type="button" className="icon-button" onClick={() => { setServerDraft(serverUrl); setServerNotice(''); setSettingsOpen(true); }} title="Connection settings" aria-label="Connection settings">🔗</button>
            <div className={`connection-dot ${isLoading ? 'busy' : 'ready'}`}>{isLoading ? 'Thinking' : 'Ready'}</div>
          </div>
        </header>

        <div ref={listRef} className="messages" aria-live="polite">
          {messages.length === 0 && (
            <div className="welcome">
              <div className="welcome-icon">✨</div>
              <h2 className="welcome-title">A fresh thought starts here.</h2>
              <p className="welcome-text">Ask a question, work through an idea, or bring a few files along.</p>
              <div className="suggestions">
                {suggestions.map(([icon, label, prompt]) => (
                  <button key={label} type="button" className="suggestion" onClick={() => setInput(prompt)}>
                    <span>{icon}</span>
                    <span className="suggestion-label">{label}</span>
                    <span className="suggestion-arrow">→</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(message => (
            <article key={message.id} className={`bubble bubble-${message.role}`}>
              {message.role === 'assistant' && <div className="reply-label">JAY AI</div>}

              {message.image && (
                <img src={message.image.dataUrl} alt={`Generated: ${message.image.prompt}`} className="generated-image" />
              )}

              {message.role === 'assistant' ? (
                message.content ? (
                  <div className="formatted-response">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                      a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
                      img: () => null,
                    }}>{message.content}</ReactMarkdown>
                  </div>
                ) : isLoading && message.id === activeReplyId ? (
                  <p className="thinking">{imageMode ? 'Creating image…' : 'Thinking…'}</p>
                ) : !message.image ? (
                  <div>
                    <p className="muted-text">This reply was interrupted or returned empty.</p>
                    <button type="button" className="inline-action" onClick={() => retryMessage(message.id)}>Retry message</button>
                  </div>
                ) : null
              ) : (
                message.content ? <p>{message.content}</p> : null
              )}

              {message.attachments?.length ? (
                <div className="attachment-grid">
                  {message.attachments.map(att => (
                    <figure key={att.id} className="attachment-card">
                      {isImageMimeType(att.mimeType) ? (
                        <img src={att.dataUrl} alt={att.name} />
                      ) : (
                        <div className="attachment-file">
                          <div className="attachment-file-kind">{getAttachmentKind(att.mimeType)}</div>
                          <div className="attachment-file-name">{att.name}</div>
                        </div>
                      )}
                      <figcaption>{att.name}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}

              {message.content && message.id !== activeReplyId && (
                <button type="button" className="inline-action copy-action" onClick={() => void copyText(message.content)} aria-label="Copy">
                  📋 Copy
                </button>
              )}
            </article>
          ))}
        </div>

        {/* ── Composer ── */}
        <form onSubmit={handleSubmit} className="composer">
          <div className="mode-tabs">
            {(['Chat', 'Create image'] as const).map((label, i) => (
              <button
                key={label}
                type="button"
                className={`mode-tab${imageMode === Boolean(i) ? ' active' : ''}`}
                disabled={isLoading || (i === 1 && pendingAttachments.length > 0)}
                onClick={() => { setImageMode(Boolean(i)); setError(null); }}
              >
                {i === 0 ? '💬' : '🎨'} {label}
              </button>
            ))}
          </div>

          {imageMode && <p className="mode-hint">Describe an image to create. Up to 2,048 characters.</p>}

          {notice && (
            <div className="notice-bar" onClick={() => setNotice(null)}>{notice}</div>
          )}

          <label className="sr-only" htmlFor="message">Message</label>
          <textarea
            id="message"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={imageMode ? 'Describe the image you want to create…' : 'Ask something or attach files…'}
            rows={3}
          />

          {pendingAttachments.length > 0 && (
            <div className="attachment-grid pending-grid">
              {pendingAttachments.map(att => (
                <figure key={att.id} className="attachment-card pending-card">
                  <button type="button" className="attachment-remove" onClick={() => removeAttachment(att.id)} aria-label={`Remove ${att.name}`}>×</button>
                  {isImageMimeType(att.mimeType) ? (
                    <img src={att.dataUrl} alt={att.name} />
                  ) : (
                    <div className="attachment-file">
                      <div className="attachment-file-kind">{getAttachmentKind(att.mimeType)}</div>
                      <div className="attachment-file-name">{att.name}</div>
                    </div>
                  )}
                  <figcaption>{att.name}</figcaption>
                </figure>
              ))}
            </div>
          )}

          <div className="composer-footer">
            <div className="composer-actions">
              {!imageMode && (
                <>
                  <input ref={fileInputRef} type="file" accept="image/*,application/pdf,.docx,.txt,.md,.csv,application/json" disabled={isLoading || isReadingFiles} multiple className="file-input" onChange={handleFileChange} />
                  <button type="button" disabled={isLoading || isReadingFiles} onClick={() => fileInputRef.current?.click()} className="secondary-button">
                    {isReadingFiles ? 'Reading…' : `📎 Files (${pendingAttachments.length}/10)`}
                  </button>
                </>
              )}
            </div>
            <div className="help-text">
              {!imageMode && <span className="help-hint">Up to 10 files, 5 MB each. Enter to send.</span>}
              {error && <span className="error-text"> {error}</span>}
            </div>
            {isLoading ? (
              <button type="button" className="stop-button" onClick={() => abortRef.current?.abort()}>⏹ Stop</button>
            ) : (
              <button type="submit" disabled={!canSend} className="send-button">Send</button>
            )}
          </div>
        </form>
      </section>

      {/* ── Options modal ── */}
      {optionsOpen && (
        <div className="modal-overlay" onClick={() => setOptionsOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Conversation options</span>
              <button type="button" className="modal-close" onClick={() => setOptionsOpen(false)}>×</button>
            </div>
            <p className="modal-desc">These preferences are remembered for this chat.</p>

            <div className="pref-section">
              <div className="pref-label">Read images</div>
              {([['auto', 'Auto — answer my request'], ['text', 'Just text — transcribe only'], ['full', 'Description + text']] as const).map(([value, label]) => (
                <button key={value} type="button" className={`pref-option${preferences.imageReading === value ? ' selected' : ''}`} onClick={() => updatePreferences({ imageReading: value })}>
                  {preferences.imageReading === value ? '● ' : '○ '}{label}
                </button>
              ))}
            </div>

            <div className="pref-section">
              <div className="pref-label">Reply format</div>
              {(['plain', 'markdown'] as const).map(fmt => (
                <button key={fmt} type="button" className={`pref-option${preferences.format === fmt ? ' selected' : ''}`} onClick={() => updatePreferences({ format: fmt })}>
                  {preferences.format === fmt ? '● ' : '○ '}{fmt === 'plain' ? 'Plain text' : 'Markdown'}
                </button>
              ))}
            </div>

            <div className="pref-section">
              {([['answersOnly', 'Answers only'], ['explanation', 'Optional explanation'], ['related', 'Related suggestions'], ['findSource', 'Find full screenshot source']] as const).map(([key, label]) => (
                <label key={key} className="pref-toggle">
                  <span>{label}</span>
                  <input type="checkbox" checked={preferences[key]} onChange={e => updatePreferences({ [key]: e.target.checked })} />
                </label>
              ))}
            </div>

            <button type="button" className="secondary-button full-width" onClick={() => { if (activeConversation) void copyText(activeConversation.messages.map(m => `${m.role === 'user' ? 'You' : 'JAY AI'}:\n${m.content}`).join('\n\n')); setOptionsOpen(false); }}>
              📋 Copy conversation
            </button>
          </div>
        </div>
      )}

      {/* ── Settings modal ── */}
      {settingsOpen && (
        <div className="modal-overlay" onClick={() => !checkingServer && setSettingsOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Connection</span>
              <button type="button" className="modal-close" disabled={checkingServer} onClick={() => setSettingsOpen(false)}>×</button>
            </div>
            <p className="modal-desc">Change this only if your server address changes.</p>
            <label className="pref-label" htmlFor="server-url">Server address</label>
            <input
              id="server-url"
              type="url"
              className="server-input"
              value={serverDraft}
              onChange={e => setServerDraft(e.target.value)}
              disabled={checkingServer}
              autoCapitalize="none"
              autoCorrect="off"
            />
            <button type="button" className="send-button full-width" disabled={checkingServer} onClick={() => void checkServer()}>
              {checkingServer ? 'Connecting…' : 'Test connection & save'}
            </button>
            {serverNotice && <p className="modal-desc">{serverNotice}</p>}
          </div>
        </div>
      )}
    </main>
  );
}
