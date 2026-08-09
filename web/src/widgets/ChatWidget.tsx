import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * FlowChatWidget – a self-contained, Shadow-DOM-isolated floating chat widget.
 *
 * Features:
 *  - Floating bubble (four positions)
 *  - Shadow DOM for style isolation
 *  - light / dark / auto theme
 *  - Custom greeting on first open
 *  - autoOpen support
 *  - Lazy loading of chat content (greeting + interface only load when opened)
 *  - Rate limiting (per-minute cap + minimum interval)
 *  - PostMessage API for host ↔ widget communication
 *  - Streaming responses via Server-Sent Events
 *
 * @example
 * <ChatWidget
 *   botId="my-store"
 *   apiKey="pk_..."
 *   apiUrl="https://api.flowchat.app/api/v1"
 *   greeting="Hi! How can I help?"
 *   theme="auto"
 *   color="#3b82f6"
 *   position="bottom-right"
 *   autoOpen={false}
 * />
 */

export interface ChatWidgetConfig {
  /** Bot slug or bot ID (identifies the bot on the backend). */
  botId: string;
  /** Publishable API key (pk_…). Optional but recommended for rate limiting. */
  apiKey?: string;
  /** Base URL of the FlowChat API. */
  apiUrl?: string;
  /** Where the bubble sits on screen. */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  /** Color scheme. */
  theme?: 'light' | 'dark' | 'auto';
  /** Custom greeting shown when the chat opens for the first time. */
  greeting?: string;
  /** Primary accent color (button bg, send icon, …). */
  color?: string;
  /** Auto-open on mount? */
  autoOpen?: boolean;
  /** Bot avatar image URL. */
  avatarUrl?: string;
  /** Display name shown in the chat header. */
  botName?: string;
  /** Max messages allowed per minute (rate limiting). */
  maxMessagesPerMinute?: number;
  /** Minimum milliseconds between user sends. */
  minIntervalMs?: number;
}

export type MessageRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  isError?: boolean;
}

export interface FlowChatWidgetEvent {
  type:
    | 'flowchat:ready'
    | 'flowchat:open'
    | 'flowchat:close'
    | 'flowchat:message'
    | 'flowchat:error';
  detail?: Record<string, unknown>;
}

const POSITION_STYLES: Record<string, CSSProperties> = {
  'bottom-right': { bottom: '16px', right: '16px' },
  'bottom-left': { bottom: '16px', left: '16px' },
  'top-right': { top: '16px', right: '16px' },
  'top-left': { top: '16px', left: '16px' },
};

// ─── CSS ────────────────────────────────────────────────────────────────────

const buildCSS = (cfg: ChatWidgetConfig): string => {
  const isLight =
    cfg.theme === 'light' ||
    (cfg.theme === 'auto' &&
      typeof window !== 'undefined' &&
      !window.matchMedia('(prefers-color-scheme: dark)').matches);

  const bg = isLight ? '#ffffff' : '#1a1a1a';
  const fg = isLight ? '#1a1a1a' : '#f0f0f0';
  const border = isLight ? '#e5e7eb' : '#374151';
  const inputBg = isLight ? '#f9fafb' : '#2a2a2a';
  const userMsgBg = isLight ? '#eff6ff' : '#2a2a4a';
  const accent = cfg.color || '#3b82f6';

  return `:host {
  --fc-bg: ${bg};
  --fc-fg: ${fg};
  --fc-border: ${border};
  --fc-accent: ${accent};
  --fc-input-bg: ${inputBg};
  --fc-user-msg: ${userMsgBg};
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, sans-serif; font-size: 14px; line-height: 1.5; }
.fc-widget { position: relative; display: flex; flex-direction: column; align-items: flex-end; pointer-events: auto; }
.fc-bubble { width: 56px; height: 56px; border-radius: 50%; border: none; background: var(--fc-accent); color: #fff; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: inline-flex; align-items: center; justify-content: center; transition: all 0.2s ease; overflow: hidden; }
.fc-bubble:hover { transform: scale(1.05); box-shadow: 0 6px 20px rgba(0,0,0,0.25); }
.fc-bubble:active { transform: scale(0.97); }
.fc-bubble-img { width: 24px; height: 24px; object-fit: contain; }
.fc-chat { width: 380px; max-width: calc(100vw - 40px); height: 520px; max-height: calc(100vh - 40px); background: var(--fc-bg); border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: none; flex-direction: column; overflow: hidden; }
.fc-chat.fc-open { display: flex; }
.fc-header { padding: 14px 16px; border-bottom: 1px solid var(--fc-border); display: flex; align-items: center; gap: 10px; }
.fc-avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex-shrink: 0; background: var(--fc-accent); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 16px; }
.fc-name { font-weight: 600; flex: 1; }
.fc-close { background: none; border: none; color: var(--fc-fg); opacity: 0.6; cursor: pointer; padding: 6px; border-radius: 6px; transition: opacity 0.2s; }
.fc-close:hover { opacity: 1; }
.fc-messages { flex: 1; padding: 14px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.fc-messages:empty { display: flex; align-items: center; justify-content: center; opacity: 0.4; }
.fc-msg { max-width: 80%; line-height: 1.5; padding: 10px 14px; border-radius: 18px; word-break: break-word; }
.fc-msg-assistant { align-self: flex-start; background: var(--fc-input-bg); border-bottom-left-radius: 4px; }
.fc-msg-user { align-self: flex-end; background: var(--fc-user-msg); border-bottom-right-radius: 4px; }
.fc-msg-error { color: #ef4444; background: rgba(239,68,68,0.1); }
.fc-typing { align-self: flex-start; opacity: 0.6; padding: 8px 4px; display: flex; gap: 2px; }
.fc-typing span { display: inline-block; width: 4px; height: 4px; background: var(--fc-fg); border-radius: 50%; animation: fcPulse 1.4s infinite; }
.fc-typing span:nth-child(2) { animation-delay: 0.16s; }
.fc-typing span:nth-child(3) { animation-delay: 0.32s; }
@keyframes fcPulse { 0%, 80%, 100% { opacity: 0.4; } 40% { opacity: 1; } }
.fc-greeting { align-self: flex-start; background: var(--fc-input-bg); padding: 10px 14px; border-radius: 18px; border-bottom-left-radius: 4px; opacity: 0.9; }
.fc-input-area { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-top: 1px solid var(--fc-border); background: var(--fc-bg); }
.fc-input-area textarea { flex: 1; resize: none; border: 1px solid var(--fc-border); border-radius: 18px; padding: 10px 14px; background: var(--fc-input-bg); color: var(--fc-fg); font-size: 14px; outline: none; max-height: 120px; min-height: 40px; transition: border-color 0.2s; }
.fc-input-area textarea:focus { border-color: var(--fc-accent); }
.fc-send { width: 36px; height: 36px; border-radius: 50%; background: var(--fc-accent); color: #fff; cursor: pointer; border: none; display: flex; align-items: center; justify-content: center; }
.fc-send:disabled { opacity: 0.4; cursor: not-allowed; }
.fc-messages::-webkit-scrollbar { width: 6px; }
.fc-messages::-webkit-scrollbar-track { background: transparent; }
.fc-messages::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.2); border-radius: 3px; }
.fc-messages::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.3); }
`;
};

// ─── SVG Icons ──────────────────────────────────────────────────────────────

const ICON_SEND = (
  <svg viewBox="0 0 24 24" fill="white" width="18" height="18">
    <path d="M2.01 10l8.5 8v-5l6-1-6-1V2L2.01 10z" />
  </svg>
);

const ICON_CLOSE = (
  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </svg>
);

const ICON_SPARKLE = (
  <svg viewBox="0 0 24 24" fill="white" width="14" height="14">
    <path d="M12 .5l2.5 7.5H20l-6 4.5 2.5 7.5-6-4.5-6 4.5 2.5-7.5H9.5z" />
  </svg>
);

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return String(str || '').replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[c];
  });
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChatWidgetHandle {
  open: () => void;
  close: () => void;
  sendMessage: (text: string) => void;
  refreshTheme: () => void;
  destroy: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

const ChatWidget = React.forwardRef<ChatWidgetHandle, Partial<ChatWidgetConfig>>((props, ref) => {
  // Build a fully-populated config with explicit defaults.
  // Props are Partial<ChatWidgetConfig>, so we coalesce undefined → default.
  const cfg: ChatWidgetConfig = {
    botId: props.botId || '',
    apiKey: props.apiKey,
    apiUrl: props.apiUrl,
    position: props.position || 'bottom-right',
    theme: props.theme || 'auto',
    greeting: props.greeting || 'Hello! How can I help you today?',
    color: props.color || '#3b82f6',
    autoOpen: props.autoOpen ?? false,
    avatarUrl: props.avatarUrl || '',
    botName: props.botName || 'FlowChat Assistant',
    maxMessagesPerMinute: props.maxMessagesPerMinute ?? 20,
    minIntervalMs: props.minIntervalMs ?? 1000,
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(cfg.autoOpen ?? false);
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMsgTimeRef = useRef(0);
  const msgTimestampsRef = useRef<number[]>([]);
  const shadowRootRef = useRef<ShadowRoot | null>(null);

  // ── PostMessage to host ────────────────────────────────────────────────────
  const postEvent = useCallback(
    (event: FlowChatWidgetEvent) => {
      if (window.parent !== window) {
        window.parent.postMessage(event, '*');
      }
    },
    [],
  );

  // ── Expose imperative handle ───────────────────────────────────────────────
  React.useImperativeHandle(ref, () => ({
    open: () => {
      const btn = shadowRootRef.current?.querySelector('.fc-bubble') as HTMLButtonElement | null;
      btn?.click();
    },
    close: () => {
      const btn = shadowRootRef.current?.querySelector('.fc-close') as HTMLButtonElement | null;
      btn?.click();
    },
    sendMessage: (text: string) => {
      const textarea = shadowRootRef.current?.querySelector('.fc-text-input') as HTMLTextAreaElement | null;
      if (textarea) {
        textarea.value = text;
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true } as any));
      }
    },
    refreshTheme: () => {
      const styleEl = shadowRootRef.current?.querySelector('style');
      if (styleEl) styleEl.textContent = buildCSS(cfg);
    },
    destroy: () => {
      postEvent({ type: 'flowchat:close' });
    },
  }), [postEvent, cfg.color, cfg.theme]);

  // ── Notify host on mount ──────────────────────────────────────────────────
  useEffect(() => {
    postEvent({ type: 'flowchat:ready' });
  }, [postEvent]);

  // ── Setup Shadow DOM ───────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const shadow = container.attachShadow({ mode: 'open' });
    shadowRootRef.current = shadow;
    setShadowRoot(shadow);

    const styleEl = document.createElement('style');
    styleEl.textContent = buildCSS(cfg);
    shadow.appendChild(styleEl);

    return () => {
      shadowRootRef.current = null;
      setShadowRoot(null);
    };
  }, [cfg]);

  // ── Theme change listener (auto mode) ─────────────────────────────────────
  useEffect(() => {
    if (cfg.theme !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const styleEl = shadowRootRef.current?.querySelector('style');
      if (styleEl) styleEl.textContent = buildCSS(cfg);
    };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else mq.removeListener(handler);
    };
  }, [cfg.theme, cfg]);

  // ── Auto-open ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (cfg.autoOpen && messages.length === 0) {
      setIsOpen(true);
      if (cfg.greeting) {
        setMessages([{ id: 'greeting', role: 'assistant', content: cfg.greeting }]);
      }
    }
  }, [cfg.autoOpen, cfg.greeting, messages.length]);

  // ── Scroll to bottom ──────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Open / Close ──────────────────────────────────────────────────────────
  const open = useCallback(() => {
    if (isOpen) return;
    setIsOpen(true);
    if (messages.length === 0 && cfg.greeting) {
      setMessages([{ id: 'greeting', role: 'assistant', content: cfg.greeting }]);
    }
    postEvent({ type: 'flowchat:open' });
  }, [isOpen, messages.length, cfg.greeting, postEvent]);

  const close = useCallback(() => {
    if (!isOpen) return;
    setIsOpen(false);
    postEvent({ type: 'flowchat:close' });
  }, [isOpen, postEvent]);

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !cfg.botId) return;

      const now = Date.now();
      if (now - lastMsgTimeRef.current < (cfg.minIntervalMs || 1000)) return;
      lastMsgTimeRef.current = now;

      const timestamps = msgTimestampsRef.current.filter((t) => Date.now() - t < 60000);
      if (timestamps.length >= (cfg.maxMessagesPerMinute || 20)) {
        postEvent({ type: 'flowchat:error', detail: { message: 'Rate limit exceeded' } });
        return;
      }
      msgTimestampsRef.current = timestamps;
      msgTimestampsRef.current.push(now);

      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: trimmed,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInputValue('');
      postEvent({ type: 'flowchat:message', detail: { role: 'user', content: trimmed } });

      setIsLoading(true);

      try {
        await callChatApi(trimmed);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const errMsg: ChatMessage = {
          id: Date.now().toString(),
          role: 'assistant',
          content: 'Sorry, an error occurred: ' + errorMsg,
          isError: true,
        };
        setMessages((prev) => [...prev, errMsg]);
        postEvent({ type: 'flowchat:error', detail: { message: errorMsg } });
      } finally {
        setIsLoading(false);
      }
    },
    [cfg.botId, cfg.apiKey, cfg.apiUrl, cfg.minIntervalMs, cfg.maxMessagesPerMinute, postEvent, conversationId],
  );

  // ── Call the chat API with streaming ──────────────────────────────────────
  const callChatApi = useCallback(
    async (text: string) => {
      const apiBase = (cfg.apiUrl || '').replace(/\/+$/, '') || window.location.origin;
      const url = apiBase + '/chat/' + encodeURIComponent(cfg.botId);

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cfg.apiKey) headers['X-API-Key'] = cfg.apiKey;

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: text,
          conversation_id: conversationId,
          stream: true,
        }),
      });

      if (!resp.ok) {
        throw new Error('API error: ' + resp.status + ' ' + resp.statusText);
      }

      const typingId = 'typing-' + Date.now();
      setMessages((prev) => [...prev, { id: typingId, role: 'assistant', content: '' }]);

      let assistantContent = '';
      const assistantMsgId = typingId;
      const reader = resp.body?.getReader();

      if (reader) {
        const decoder = new TextDecoder('utf-8');

        const readLoop = async (): Promise<void> => {
          const { done, value } = await reader.read();
          if (done) return;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n\n');

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;

            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.conversation_id) setConversationId(parsed.conversation_id);
              const deltaContent = parsed.choices?.[0]?.delta?.content;
              if (deltaContent) {
                assistantContent += deltaContent;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: assistantContent }
                      : m,
                  ),
                );
                postEvent({ type: 'flowchat:message', detail: { role: 'assistant', content: deltaContent } });
              }
            } catch {
              if (data && !data.startsWith('[')) {
                assistantContent += data;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: assistantContent }
                      : m,
                  ),
                );
              }
            }
          }

          return readLoop();
        };

        await readLoop();
      }
    },
    [cfg.apiUrl, cfg.apiKey, cfg.botId, conversationId, postEvent],
  );

  // ── Handle form submit ────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    if (inputValue.trim() && !isLoading) {
      sendMessage(inputValue.trim());
    }
  }, [inputValue, isLoading, sendMessage]);

  // ── Listen for host PostMessage commands ──────────────────────────────────
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object' || !data.type) return;
      if (!data.type.startsWith('flowchat:')) return;

      switch (data.type) {
        case 'flowchat:open':
          open();
          break;
        case 'flowchat:close':
          close();
          break;
        case 'flowchat:sendMessage':
          if (data.payload?.message) {
            sendMessage(data.payload.message);
          }
          break;
        case 'flowchat:setConfig':
          // Config change — the parent should re-render with new props
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [open, close, sendMessage]);

  // ── Render helpers ────────────────────────────────────────────────────────
  const positionStyle: CSSProperties = {
    ...(POSITION_STYLES[cfg.position!] || POSITION_STYLES['bottom-right']),
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const renderMessages = () => {
    if (messages.length === 0) {
      return (
        <div className="fc-messages">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4 }}>
            <span>Type a message to start chatting.</span>
          </div>
        </div>
      );
    }

    return (
      <>
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`fc-msg fc-msg-${msg.role}`}
            style={{
              opacity: msg.content === '' ? 0.5 : 1,
              ...(msg.isError
                ? { color: '#ef4444', background: 'rgba(239,68,68,0.1)' }
                : {}),
            }}
            dangerouslySetInnerHTML={{
              __html: escapeHtml(msg.content).replace(/\n/g, '<br>'),
            }}
          />
        ))}
        {isLoading && (
          <div className="fc-typing">
            <span />
            <span />
            <span />
          </div>
        )}
        <div ref={messagesEndRef} />
      </>
    );
  };

  // ── Shadow DOM content ────────────────────────────────────────────────────
  const shadowContent = (
    <>
      <style>{buildCSS(cfg)}</style>
      <div className="fc-widget">
        <button
          className="fc-bubble"
          aria-label="Open chat"
          onClick={open}
        >
          {cfg.avatarUrl ? (
            <img className="fc-bubble-img" src={cfg.avatarUrl} alt="Assistant" />
          ) : (
            ICON_SPARKLE
          )}
        </button>

        <div className={`fc-chat ${isOpen ? 'fc-open' : ''}`}>
          <div className="fc-header">
            {cfg.avatarUrl ? (
              <img className="fc-avatar" src={cfg.avatarUrl} alt="Avatar" />
            ) : (
              <div className="fc-avatar">
                {cfg.botName ? cfg.botName.charAt(0).toUpperCase() : 'F'}
              </div>
            )}
            <div className="fc-name">{cfg.botName || 'Assistant'}</div>
            <button
              className="fc-close"
              aria-label="Close chat"
              onClick={close}
            >
              {ICON_CLOSE}
            </button>
          </div>

          <div className="fc-messages" ref={messagesEndRef}>
            {renderMessages()}
          </div>

          <div className="fc-input-area">
            <textarea
              className="fc-text-input"
              placeholder="Type a message..."
              rows={1}
              maxLength={2000}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
            <button
              className="fc-send"
              aria-label="Send"
              onClick={handleSubmit}
              disabled={isLoading || !inputValue.trim()}
            >
              {ICON_SEND}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      data-fc-react-widget="true"
      style={{
        position: 'fixed',
        pointerEvents: 'none',
        ...positionStyle,
      }}
    >
{shadowRoot
        ? createPortal(shadowContent, shadowRoot)
        : null}
    </div>
  );
});

ChatWidget.displayName = 'ChatWidget';

export default ChatWidget;
