/*!
 * FlowChat Widget v1.0.0
 * CDN-loadable, async chat widget with Shadow DOM isolation.
 *
 * Usage (script tag):
 *   <script src="https://cdn.flowchat.app/widget.js"
 *           data-bot-id="your-bot-slug"
 *           data-api-key="pk_..."
 *           data-api-url="https://chat.flowchat.app/api/v1"
 *           data-position="bottom-right"
 *           data-theme="auto"
 *           data-greeting="Hi! How can I help?"
 *           data-color="#3b82f6"
 *           data-auto-open="false"
 *           data-avatar-url="https://.../avatar.png"
 *           data-bot-name="My Assistant"
 *           async></script>
 *
 * Programmatic API:
 *   window.FlowChatWidget.init(config)
 *   window.FlowChatWidget.open()
 *   window.FlowChatWidget.close()
 *   window.FlowChatWidget.sendMessage(text)
 *
 * PostMessage events (sent to parent window):
 *   { type: 'flowchat:ready' }
 *   { type: 'flowchat:open' }
 *   { type: 'flowchat:close' }
 *   { type: 'flowchat:message', detail: { role: 'user'|'assistant', content: string } }
 *   { type: 'flowchat:error', detail: { message: string } }
 *
 * Accepted PostMessage commands (from parent window):
 *   { type: 'flowchat:open' }
 *   { type: 'flowchat:close' }
 *   { type: 'flowchat:sendMessage', payload: { message: string } }
 *   { type: 'flowchat:setConfig', payload: { ...config } }
 */
(function (global, document) {
  'use strict';

  // ─── Defaults ─────────────────────────────────────────────────────────────

  var DEFAULTS = {
    botId: '',
    apiKey: '',
    apiUrl: '',
    position: 'bottom-right',
    theme: 'auto',
    greeting: 'Hello! How can I help you today?',
    color: '#3b82f6',
    autoOpen: false,
    avatarUrl: '',
    botName: 'FlowChat Assistant',
    shadow: true,
    lazy: true,
    maxMessagesPerMinute: 20,
    minIntervalMs: 1000
  };

  var POSITION_STYLES = {
    'bottom-right': 'bottom: 16px; right: 16px;',
    'bottom-left': 'bottom: 16px; left: 16px;',
    'top-right': 'top: 16px; right: 16px;',
    'top-left': 'top: 16px; left: 16px;'
  };

  // ─── SVG Icons ────────────────────────────────────────────────────────────

  var ICON_MESSAGE = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 3C8.13 3 5 5.69 5 9.26c0 2.41.99 4.52 2.64 6.03-.18.62-.55 1.45-.61 1.58-.07.13-.01.26.07.36.08.1.23.13.36.08.12-.04.2-.09.27-.17A7.47 7.47 0 0 0 10 17H12c3.87 0 7-2.69 7-6.5S15.87 3 12 3z"/></svg>';

  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="white" width="18" height="18"><path d="M2.01 10l8.5 8v-5l6-1-6-1V2L2.01 10z"/></svg>';

  var ICON_SPARKLE = '<svg viewBox="0 0 24 24" fill="white" width="14" height="14"><path d="M12 .5l2.5 7.5H20l-6 4.5 2.5 7.5-6-4.5-6 4.5 2.5-7.5H9.5z"/></svg>';

  // ─── CSS (injected into Shadow DOM) ─────────────────────────────────────────

  function buildStyles(cfg) {
    var isLight = cfg.theme === 'light' ||
      (cfg.theme === 'auto' && !window.matchMedia('(prefers-color-scheme: dark)').matches);
    var bg = isLight ? '#ffffff' : '#1a1a1a';
    var fg = isLight ? '#1a1a1a' : '#f0f0f0';
    var border = isLight ? '#e5e7eb' : '#374151';
    var inputBg = isLight ? '#f9fafb' : '#2a2a2a';
    var userMsgBg = isLight ? '#eff6ff' : '#2a2a4a';
    var accent = cfg.color || '#3b82f6';

    return [
      ':host {',
      '  --fc-bg: ' + bg + ';',
      '  --fc-fg: ' + fg + ';',
      '  --fc-border: ' + border + ';',
      '  --fc-accent: ' + accent + ';',
      '  --fc-input-bg: ' + inputBg + ';',
      '  --fc-user-msg: ' + userMsgBg + ';',
      '}',
      '* { box-sizing: border-box; margin: 0; padding: 0; }',
      'html, body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, sans-serif; font-size: 14px; line-height: 1.5; }',
      '.fc-widget { position: fixed; z-index: 2147483647; ' + POSITION_STYLES[cfg.position] + ' }',
      '.fc-bubble {',
      '  width: 56px; height: 56px; border-radius: 50%; border: none;',
      '  background: var(--fc-accent); color: #fff; cursor: pointer;',
      '  box-shadow: 0 4px 12px rgba(0,0,0,0.15);',
      '  display: inline-flex; align-items: center; justify-content: center;',
      '  transition: all 0.2s ease; overflow: hidden;',
      '}',
      '.fc-bubble:hover { transform: scale(1.05); box-shadow: 0 6px 20px rgba(0,0,0,0.25); }',
      '.fc-bubble:active { transform: scale(0.97); }',
      '.fc-bubble .fc-bubble-img { width: 24px; height: 24px; object-fit: contain; }',
      '.fc-chat {',
      '  width: 380px; max-width: calc(100vw - 40px);',
      '  height: 520px; max-height: calc(100vh - 40px);',
      '  background: var(--fc-bg); border-radius: 16px;',
      '  box-shadow: 0 4px 12px rgba(0,0,0,0.15);',
      '  display: none; flex-direction: column; overflow: hidden;',
      '}',
      '.fc-chat.fc-open { display: flex; }',
      '.fc-header { padding: 14px 16px; border-bottom: 1px solid var(--fc-border);',
      '  display: flex; align-items: center; gap: 10px; }',
      '.fc-header .fc-avatar {',
      '  width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex-shrink: 0;',
      '  background: var(--fc-accent); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 16px;',
      '}',
      '.fc-header .fc-name { font-weight: 600; flex: 1; }',
      '.fc-header .fc-close {',
      '  background: none; border: none; color: var(--fc-fg); opacity: 0.6; cursor: pointer;',
      '  padding: 6px; border-radius: 6px; transition: opacity 0.2s;',
      '}',
      '.fc-header .fc-close:hover { opacity: 1; }',
      '.fc-messages { flex: 1; padding: 14px 16px; overflow-y: auto;',
      '  display: flex; flex-direction: column; gap: 10px; }',
      '.fc-messages:empty { display: flex; align-items: center; justify-content: center; opacity: 0.4; }',
      '.fc-msg { max-width: 80%; line-height: 1.5; padding: 10px 14px; border-radius: 18px; word-break: break-word; }',
      '.fc-msg-assistant { align-self: flex-start; background: var(--fc-input-bg); border-bottom-left-radius: 4px; }',
      '.fc-msg-user { align-self: flex-end; background: var(--fc-user-msg); border-bottom-right-radius: 4px; }',
      '.fc-msg-error { color: #ef4444; background: rgba(239,68,68,0.1); }',
      '.fc-typing { align-self: flex-start; opacity: 0.6; padding: 8px 4px; }',
      '.fc-typing span {',
      '  display: inline-block; width: 4px; height: 4px; background: var(--fc-fg);',
      '  border-radius: 50%; margin: 0 2px; animation: fcPulse 1.4s infinite;',
      '}',
      '.fc-typing span:nth-child(2) { animation-delay: 0.16s; }',
      '.fc-typing span:nth-child(3) { animation-delay: 0.32s; }',
      '@keyframes fcPulse { 0%, 80%, 100% { opacity: 0.4; } 40% { opacity: 1; } }',
      '.fc-greeting {',
      '  align-self: flex-start; background: var(--fc-input-bg);',
      '  padding: 10px 14px; border-radius: 18px; border-bottom-left-radius: 4px; opacity: 0.9;',
      '}',
      '.fc-input-area {',
      '  display: flex; align-items: center; gap: 8px; padding: 12px 14px;',
      '  border-top: 1px solid var(--fc-border); background: var(--fc-bg);',
      '}',
      '.fc-input-area textarea {',
      '  flex: 1; resize: none; border: 1px solid var(--fc-border); border-radius: 18px;',
      '  padding: 10px 14px; background: var(--fc-input-bg); color: var(--fc-fg);',
      '  font-size: 14px; outline: none; max-height: 120px; min-height: 40px;',
      '  transition: border-color 0.2s;',
      '}',
      '.fc-input-area textarea:focus { border-color: var(--fc-accent); }',
      '.fc-input-area .fc-send {',
      '  width: 36px; height: 36px; border-radius: 50%;',
      '  background: var(--fc-accent); color: #fff; cursor: pointer;',
      '  border: none; display: flex; align-items: center; justify-content: center;',
      '}',
      '.fc-input-area .fc-send:disabled { opacity: 0.4; cursor: not-allowed; }',
      '.fc-messages::-webkit-scrollbar { width: 6px; }',
      '.fc-messages::-webkit-scrollbar-track { background: transparent; }',
      '.fc-messages::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.2); border-radius: 3px; }',
      '.fc-messages::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.3); }'
    ].join('\n');
  }

  // ─── HTML Escaper ─────────────────────────────────────────────────────────

  function esc(str) {
    return String(str || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ─── Widget Class ─────────────────────────────────────────────────────────

  function Widget(config) {
    this.config = Object.assign({}, DEFAULTS, config || {});
    this.isOpen = false;
    this.isLoading = false;
    this.conversationId = null;
    this._lastMsgTime = 0;
    this._msgTimestamps = [];
    this._contentReady = false;
    this._shadow = null;
    this._root = null;
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  Widget.prototype.render = function () {
    // Root widget container
    var widget = document.createElement('div');
    widget.className = 'fc-widget';
    var pos = POSITION_STYLES[this.config.position] || POSITION_STYLES['bottom-right'];
    widget.style.cssText = pos;
    widget.setAttribute('data-fc-widget', 'true');

    if (this.config.shadow) {
      var host = document.createElement('div');
      host.className = 'fc-shadow-host';
      widget.appendChild(host);
      this._shadow = host.attachShadow({ mode: 'open' });
      this._root = widget;
    } else {
      this._root = widget;
    }

    // Inject styles
    var styleEl = document.createElement('style');
    styleEl.textContent = buildStyles(this.config);
    this._root.appendChild(styleEl);

    // Build content
    var content = this._buildContent();
    this._root.appendChild(content);

    // Attach to DOM
    if (this._shadow) {
      this._shadow.appendChild(this._root);
    }
    document.body.appendChild(widget);

    this._bindEvents();
    this._postMessage({ type: 'flowchat:ready' });
  };

  Widget.prototype._buildContent = function () {
    var cfg = this.config;
    var frag = document.createDocumentFragment();

    // Bubble button
    var bubble = document.createElement('button');
    bubble.className = 'fc-bubble';
    bubble.setAttribute('aria-label', 'Open chat');
    if (cfg.avatarUrl) {
      bubble.innerHTML = '<img class="fc-bubble-img" src="' + esc(cfg.avatarUrl) + '" alt="Assistant">';
    } else {
      bubble.innerHTML = ICON_SPARKLE;
    }

    // Chat window
    var chat = document.createElement('div');
    chat.className = 'fc-chat';

    // Header
    var header = document.createElement('div');
    header.className = 'fc-header';
    var avatarHtml;
    if (cfg.avatarUrl) {
      avatarHtml = '<img class="fc-avatar" src="' + esc(cfg.avatarUrl) + '" alt="Avatar">';
    } else {
      avatarHtml = '<div class="fc-avatar">' + esc(cfg.botName ? cfg.botName.charAt(0).toUpperCase() : 'F') + '</div>';
    }
    header.innerHTML = avatarHtml +
      '<div class="fc-name">' + esc(cfg.botName || 'Assistant') + '</div>' +
      '<button class="fc-close" aria-label="Close chat">' + ICON_CLOSE + '</button>';

    // Messages container
    var messages = document.createElement('div');
    messages.className = 'fc-messages';

    // Input area
    var inputArea = document.createElement('div');
    inputArea.className = 'fc-input-area';
    inputArea.innerHTML =
      '<textarea class="fc-text-input" placeholder="Type a message..." rows="1" maxlength="2000"></textarea>' +
      '<button class="fc-send" aria-label="Send">' + ICON_SEND + '</button>';

    chat.appendChild(header);
    chat.appendChild(messages);
    chat.appendChild(inputArea);

    frag.appendChild(bubble);
    frag.appendChild(chat);
    return frag;
  };

  // ─── Event Binding ───────────────────────────────────────────────────────

  Widget.prototype._bindEvents = function () {
    var self = this;
    var root = this._shadow || this._root;

    var bubble = root.querySelector('.fc-bubble');
    var closeBtn = root.querySelector('.fc-close');
    var sendBtn = root.querySelector('.fc-send');
    var input = root.querySelector('.fc-text-input');
    var chat = root.querySelector('.fc-chat');

    if (bubble) bubble.addEventListener('click', function (e) { e.stopPropagation(); self.open(); });
    if (closeBtn) closeBtn.addEventListener('click', function (e) { e.stopPropagation(); self.close(); });
    if (chat) chat.addEventListener('click', function (e) { e.stopPropagation(); });
    if (sendBtn) sendBtn.addEventListener('click', function () { self._handleSubmit(); });

    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          self._handleSubmit();
        }
      });
      input.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      });
    }

    document.addEventListener('click', function () {
      if (self.isOpen) self.close();
    });

    if (this.config.theme === 'auto') {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) {
        mq.addEventListener('change', function () { self.refreshTheme(); });
      } else {
        mq.addListener(function () { self.refreshTheme(); });
      }
    }
  };

  // ─── Public Methods ──────────────────────────────────────────────────────

  Widget.prototype.open = function () {
    if (this.isOpen) return;
    this.isOpen = true;
    if (!this._contentReady) this._lazyLoad();
    var chat = this._q('.fc-chat');
    if (chat) chat.classList.add('fc-open');
    this._postMessage({ type: 'flowchat:open' });
  };

  Widget.prototype.close = function () {
    if (!this.isOpen) return;
    this.isOpen = false;
    var chat = this._q('.fc-chat');
    if (chat) chat.classList.remove('fc-open');
    this._postMessage({ type: 'flowchat:close' });
  };

  Widget.prototype._lazyLoad = function () {
    this._contentReady = true;
    if (this.config.greeting) {
      this._addMessage('assistant', this.config.greeting);
    }
  };

  Widget.prototype.sendMessage = function (text) {
    if (!text || !text.trim()) return;
    this._handleSubmit(text);
  };

  Widget.prototype.refreshTheme = function () {
    var styleEl = this._shadow ? this._shadow.querySelector('style') : null;
    if (styleEl) {
      styleEl.textContent = buildStyles(this.config);
    }
  };

  Widget.prototype.destroy = function () {
    if (this._root && this._root.parentNode) {
      this._root.parentNode.removeChild(this._root);
    }
    this._postMessage({ type: 'flowchat:close' });
  };

  // ─── Internal Methods ────────────────────────────────────────────────────

  Widget.prototype._q = function (sel) {
    var root = this._shadow || this._root;
    return root.querySelector(sel);
  };

  Widget.prototype._handleSubmit = function (text) {
    var self = this;
    var input = this._q('.fc-text-input');
    var message = text || (input ? input.value.trim() : '');

    if (!message || this.isLoading || !this.config.botId) return;

    // Rate limiting: min interval
    var now = Date.now();
    if (now - this._lastMsgTime < this.config.minIntervalMs) return;
    this._lastMsgTime = now;

    // Rate limiting: per minute
    this._msgTimestamps = this._msgTimestamps.filter(function (t) { return Date.now() - t < 60000; });
    if (this._msgTimestamps.length >= this.config.maxMessagesPerMinute) {
      this._postMessage({ type: 'flowchat:error', detail: { message: 'Rate limit exceeded' } });
      return;
    }
    this._msgTimestamps.push(now);

    this.isLoading = true;
    this._setSendState(true);
    this._addMessage('user', message);
    if (input) input.value = '';
    this._postMessage({ type: 'flowchat:message', detail: { role: 'user', content: message } });
    this._showTyping(true);

    this._callAPI(message).then(function () {
      self._showTyping(false);
      self._setSendState(false);
      self.isLoading = false;
    }).catch(function (err) {
      self._showTyping(false);
      self._setSendState(false);
      self.isLoading = false;
      self._addMessage('assistant', 'Sorry, an error occurred: ' + (err.message || err), 'error');
      self._postMessage({ type: 'flowchat:error', detail: { message: err.message || String(err) } });
    });
  };

  Widget.prototype._callAPI = function (message) {
    var self = this;
    var apiUrl = (this.config.apiUrl || '').replace(/\/+$/, '') || window.location.origin;
    var url = apiUrl + '/chat/' + encodeURIComponent(this.config.botId);

    var headers = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers['X-API-Key'] = this.config.apiKey;

    var body = JSON.stringify({
      message: message,
      conversation_id: this.conversationId,
      stream: true
    });

    return fetch(url, { method: 'POST', headers: headers, body: body })
      .then(function (resp) {
        if (!resp.ok) throw new Error('API error: ' + resp.status + ' ' + resp.statusText);
        return self._readStream(resp);
      });
  };

  Widget.prototype._readStream = function (resp) {
    var self = this;
    var reader = resp.body.getReader();
    var decoder = new TextDecoder('utf-8');
    var assistantMsgEl = null;

    function read() {
      return reader.read().then(function (result) {
        if (result.done) return;
        var chunk = decoder.decode(result.value, { stream: true });
        var lines = chunk.split('\n\n');
        lines.forEach(function (line) {
          line = line.trim();
          if (line.startsWith('data:')) {
            var data = line.slice(5).trim();
            if (data === '[DONE]') return;
            try {
              var parsed = JSON.parse(data);
              if (parsed.conversation_id) self.conversationId = parsed.conversation_id;
              var deltaContent = parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content;
              if (deltaContent) {
                if (!assistantMsgEl) assistantMsgEl = self._addMessage('assistant', '');
                self._appendMessage(assistantMsgEl, deltaContent);
                self._postMessage({ type: 'flowchat:message', detail: { role: 'assistant', content: deltaContent } });
              }
            } catch (e) {
              var text = data.trim();
              if (text && !text.startsWith('[')) {
                if (!assistantMsgEl) assistantMsgEl = self._addMessage('assistant', '');
                self._appendMessage(assistantMsgEl, text);
                self._postMessage({ type: 'flowchat:message', detail: { role: 'assistant', content: text } });
              }
            }
          }
        });
        return read();
      });
    }

    return read();
  };

  Widget.prototype._addMessage = function (role, text, isError) {
    var messagesEl = this._q('.fc-messages');
    if (!messagesEl) return null;

    // Clear greeting on first real message
    var greeting = messagesEl.querySelector('.fc-greeting');
    if (greeting) greeting.remove();

    var msgDiv = document.createElement('div');
    msgDiv.className = 'fc-msg fc-msg-' + role;
    if (isError) msgDiv.classList.add('fc-msg-error');
    msgDiv.innerHTML = this._formatMessage(text);
    if (text === '') msgDiv.style.opacity = '0.5';
    messagesEl.appendChild(msgDiv);
    this._scrollToBottom();
    return msgDiv;
  };

  Widget.prototype._appendMessage = function (msgEl, text) {
    if (!msgEl) return;
    msgEl.innerHTML += this._formatMessage(text);
    msgEl.style.opacity = '1';
    this._scrollToBottom();
  };

  Widget.prototype._formatMessage = function (text) {
    return esc(text).replace(/\n/g, '<br>');
  };

  Widget.prototype._showTyping = function (show) {
    var existing = this._q('.fc-typing');
    var messagesEl = this._q('.fc-messages');
    if (!messagesEl) return;

    if (show && !existing) {
      var typing = document.createElement('div');
      typing.className = 'fc-typing';
      typing.innerHTML = '<span></span><span></span><span></span>';
      messagesEl.appendChild(typing);
      this._scrollToBottom();
    } else if (existing) {
      existing.remove();
    }
  };

  Widget.prototype._setSendState = function (disabled) {
    var btn = this._q('.fc-send');
    if (btn) btn.disabled = disabled;
  };

  Widget.prototype._scrollToBottom = function () {
    var el = this._q('.fc-messages');
    if (el) {
      setTimeout(function () { el.scrollTop = el.scrollHeight; }, 0);
    }
  };

  // ─── PostMessage ─────────────────────────────────────────────────────────

  Widget.prototype._postMessage = function (data) {
    if (window.parent !== window) {
      window.parent.postMessage(data, '*');
    }
    // Same-frame DOM event
    window.dispatchEvent(new CustomEvent('flowchatwidget:' + data.type.replace(/^flowchat:/, ''), { detail: data.detail || {} }));
  };

  // ─── Global API ───────────────────────────────────────────────────────────

  function init(config) {
    config = Object.assign({}, DEFAULTS, config || {});
    if (!config.botId) {
      if (typeof console !== 'undefined') console.error('[FlowChatWidget] botId is required');
      return null;
    }
    var instance = new Widget(config);
    instance.render();
    if (config.autoOpen) instance.open();
    return instance;
  }

  // Expose on window
  if (typeof global !== 'undefined') {
    global.FlowChatWidget = {
      init: function (config) {
        var instance = init(config);
        if (instance) this._instances[config.botId || '_default'] = instance;
        return instance;
      },
      _instances: {},

      open: function (botId) { var i = this._instances[botId || '_default']; if (i) i.open(); },
      close: function (botId) { var i = this._instances[botId || '_default']; if (i) i.close(); },
      sendMessage: function (text, botId) { var i = this._instances[botId || '_default']; if (i) i.sendMessage(text); },
      refreshTheme: function (botId) { var i = this._instances[botId || '_default']; if (i) i.refreshTheme(); },
    };
  }

  // ─── Auto-init from script tag ────────────────────────────────────────────

  function autoInit() {
    var script = document.currentScript;
    if (!script) {
      var scripts = document.getElementsByTagName('script');
      for (var i = 0; i < scripts.length; i++) {
        if (scripts[i].src && scripts[i].src.indexOf('widget.js') !== -1) {
          script = scripts[i];
          break;
        }
      }
    }

    if (!script || !global.FlowChatWidget) return;

    var config = {};
    for (var j = 0; j < script.attributes.length; j++) {
      var name = script.attributes[j].name;
      if (name.indexOf('data-') === 0) {
        var key = name.substring(5);
        var val = script.attributes[j].value;
        if (val === 'true' || val === 'false') {
          config[key] = val === 'true';
        } else if (key === 'maxMessagesPerMinute' || key === 'minIntervalMs') {
          config[key] = parseInt(val, 10);
        } else {
          config[key] = val;
        }
      }
    }

    // Global config override (set by embed route)
    if (global.__FlowChatWidgetConfig) {
      config = Object.assign({}, config, global.__FlowChatWidgetConfig);
      delete global.__FlowChatWidgetConfig;
    }

    if (config.botId) {
      global.FlowChatWidget.init(config);
    }

    // Listen for PostMessage commands from host
    window.addEventListener('message', function (event) {
      var data = event.data;
      if (!data || typeof data !== 'object' || !data.type) return;
      if (data.type.indexOf('flowchat:') !== 0) return;

      var inst = global.FlowChatWidget._instances[data.payload && data.payload.botId || '_default'];
      switch (data.type) {
        case 'flowchat:open':
          if (inst) inst.open(); break;
        case 'flowchat:close':
          if (inst) inst.close(); break;
        case 'flowchat:sendMessage':
          if (inst && data.payload && data.payload.message) {
            inst.sendMessage(data.payload.message);
          }
          break;
        case 'flowchat:setConfig':
          if (data.payload) {
            init(data.payload);
          }
          break;
      }
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit, { once: true });
  } else {
    autoInit();
  }

})(typeof window !== 'undefined' ? window : {}, typeof document !== 'undefined' ? document : {});
