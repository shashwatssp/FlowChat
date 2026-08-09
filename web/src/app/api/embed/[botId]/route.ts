import { NextRequest, NextResponse } from 'next/server';

/**
 * Embed endpoint — serves the FlowChat chat widget for a given bot.
 *
 * Flow:
 *  1. Validate the `pk_` publishable API key (if provided).
 *  2. Check the request origin against the CORS / embed domain allowlist.
 *  3. Fetch the public bot config from the backend (`/api/v1/bots/public/:slug`).
 *  4. Return one of three formats based on the `mode` query param:
 *
 *    - mode=html (default): A full HTML document suitable for iframe embedding
 *      (SSR fallback). The document injects the bot config as data attributes
 *      on the <script> tag that loads `widget.js`.
 *
 *    - mode=widget: Returns a short bootstrap <script> snippet that the host
 *      page can inject inline. It loads widget.js and initialises it with the
 *      bot config.
 *
 *    - mode=json: Returns the bot config as JSON for programmatic clients
 *      that want to render their own UI with our React <ChatWidget> component.
 *
 * Security:
 *  - The `pk_` API key is a publishable key. It is validated against the
 *    backend to ensure the bot exists and the key is valid for it.
 *  - The origin/referer must match the CORS allowlist configured via
 *    ALLOWED_ORIGINS (comma-separated). `*` allows any origin (dev mode).
 *
 * @example
 *   <!-- Iframe embed -->
 *   <iframe src="https://chat.flowchat.app/api/embed/my-store"
 *           data-flowchat-key="pk_..."
 *           style="border:none;width:100%;height:600px"></iframe>
 *
 *   <!-- Script-tag embed -->
 *   <script src="https://chat.flowchat.app/api/embed/my-store?mode=widget"
 *           data-theme="auto" data-position="bottom-right" async></script>
 *
 *   <!-- Programmatic -->
 *   fetch('https://chat.flowchat.app/api/embed/my-store?mode=json')
 *     .then(r => r.json()).then(cfg => render(cfg with ChatWidget component));
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface BotConfig {
  id: string;
  name: string;
  description: string;
  slug: string;
  avatar_url?: string;
  usage_count: number;
  created_at: string;
}

interface EmbedConfig {
  botId: string;          // slug
  apiKey?: string;        // pk_ publishable key
  apiUrl: string;         // backend API base
  position: string;
  theme: string;
  greeting: string;
  color: string;
  autoOpen: boolean;
  avatarUrl?: string;
  botName?: string;
}

// ─── Environment ─────────────────────────────────────────────────────────────

const BACKEND_API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.BACKEND_API_URL ||
  'http://localhost:8080/api/v1';

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  process.env.NEXT_PUBLIC_ALLOWED_ORIGINS ||
  'http://localhost:3000,https://chat.flowchat.app'
).split(',').map((s) => s.trim());

const ALLOW_CREDENTIALS =
  !ALLOWED_ORIGINS.includes('*') && !ALLOWED_ORIGINS.includes('null');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check whether the request origin is in the allowlist.
 * Falls back to checking the `Referer` header when `Origin` is absent
 * (e.g. some iframe scenarios). `*` or empty allowlist = allow all.
 */
function isOriginAllowed(req: NextRequest): boolean {
  if (ALLOWED_ORIGINS.includes('*')) return true;

  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  const check = (url: string | null): boolean => {
    if (!url) return false;
    try {
      const u = new URL(url);
      const originStr = u.origin;
      return ALLOWED_ORIGINS.includes(originStr);
    } catch {
      return false;
    }
  };

  return check(origin) || check(referer);
}

/** Extract the publishable key from query params or headers. */
function extractApiKey(req: NextRequest): string | undefined {
  const fromQuery = req.nextUrl.searchParams.get('key') ||
    req.nextUrl.searchParams.get('api_key') ||
    req.nextUrl.searchParams.get('pk') ||
    undefined;

  if (fromQuery) return fromQuery;

  // Also check for X-API-Key header (but not pk_ prefix — those are
  // publishable keys meant for client-side use)
  const fromHeader =
    req.headers.get('x-api-key') || req.headers.get('x-flowchat-key') || undefined;

  return fromHeader || undefined;
}

/** Fetch bot config from the backend public endpoint. */
async function fetchBotConfig(slug: string): Promise<BotConfig | null> {
  const res = await fetch(`${BACKEND_API_URL}/bots/public/${encodeURIComponent(slug)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    // Cache for 5 minutes — bot config changes rarely
    next: { revalidate: 300 },
  });

  if (!res.ok) return null;
  return (await res.json()) as BotConfig;
}

/** Validate a pk_ publishable key against the backend. */
async function validatePublishableKey(
  botId: string,
  apiKey: string,
): Promise<boolean> {
  if (!apiKey.startsWith('pk_')) return false;

  // The pk_ key is validated by calling the backend with the X-API-Key header.
  // The backend's APIKeyMiddleware looks up the bot by api_key.
  // However, pk_ keys are publishable keys that may map to the bot's api_key
  // internally. For now, we validate by checking the backend's widget endpoint.
  const res = await fetch(`${BACKEND_API_URL}/widget/${encodeURIComponent(botId)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/javascript',
      'X-API-Key': apiKey,
    },
  });

  // 200 = valid key + bot, 401/403 = invalid key, 404 = bot not found
  return res.ok;
}

/** Merge bot config into the embed config. */
function buildEmbedConfig(bot: BotConfig, req: NextRequest): EmbedConfig {
  const queryApiUrl = req.nextUrl.searchParams.get('api_url');
  const queryTheme = req.nextUrl.searchParams.get('theme') || 'auto';
  const queryGreeting =
    req.nextUrl.searchParams.get('greeting') ||
    `Hello! How can I help you today?`;
  const queryColor =
    req.nextUrl.searchParams.get('color') || `#3b82f6`;
  const queryAutoOpen =
    req.nextUrl.searchParams.get('auto_open') === 'true' ||
    req.nextUrl.searchParams.get('autoOpen') === 'true';
  const queryPosition =
    req.nextUrl.searchParams.get('position') || 'bottom-right';

  return {
    botId: bot.slug || bot.id,
    apiKey: extractApiKey(req) || undefined,
    apiUrl: queryApiUrl || BACKEND_API_URL.replace('/api/v1', '') || '',
    position: queryPosition,
    theme: queryTheme,
    greeting: queryGreeting,
    color: queryColor,
    autoOpen: queryAutoOpen,
    avatarUrl: bot.avatar_url,
    botName: bot.name,
  };
}

/** Generate data attributes for the script tag. */
function configToDataAttributes(cfg: EmbedConfig): string {
  const attrs: string[] = [];
  attrs.push(`data-bot-id="${escapeHtml(cfg.botId)}"`);
  if (cfg.apiKey) attrs.push(`data-api-key="${escapeHtml(cfg.apiKey)}"`);
  if (cfg.apiUrl) attrs.push(`data-api-url="${escapeHtml(cfg.apiUrl)}"`);
  attrs.push(`data-position="${escapeHtml(cfg.position)}"`);
  attrs.push(`data-theme="${escapeHtml(cfg.theme)}"`);
  attrs.push(`data-greeting="${escapeHtml(cfg.greeting)}"`);
  attrs.push(`data-color="${escapeHtml(cfg.color)}"`);
  attrs.push(`data-auto-open="${cfg.autoOpen.toString()}"`);
  if (cfg.avatarUrl) attrs.push(`data-avatar-url="${escapeHtml(cfg.avatarUrl)}"`);
  if (cfg.botName) attrs.push(`data-bot-name="${escapeHtml(cfg.botName)}"`);
  return attrs.join(' ');
}

function escapeHtml(str: string | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Response builders ──────────────────────────────────────────────────────

/** Build the full HTML page (iframe / SSR fallback). */
function buildHtmlPage(cfg: EmbedConfig, bot: BotConfig): string {
  const dataAttrs = configToDataAttributes(cfg);
  const title = bot.name || 'FlowChat';
  const description = bot.description || 'AI-powered chatbot';
  const avatar = bot.avatar_url || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="color-scheme" content="${cfg.theme === 'dark' ? 'dark' : cfg.theme === 'light' ? 'light' : 'light dark'}" />
  <title>${escapeHtml(title)} – FlowChat</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="referrer" content="no-referrer-when-downgrade" />
  <!-- Allow this page to be embedded in iframes -->
  <meta http-equiv="Permissions-Policy" content="camera=(), microphone=(), geolocation=()" />
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  </style>
</head>
<body>
  <script
    src="/widget.js"
    ${dataAttrs}
    async
  ></script>
</body>
</html>`;
}

/** Build the bootstrap script snippet (mode=widget). */
function buildWidgetScript(cfg: EmbedConfig): string {
  const dataAttrs = configToDataAttributes(cfg);
  // Provide the widget URL relative to the current origin
  const widgetUrl = '/widget.js';
  return `(function(){
var s=document.createElement('script');
s.src="${widgetUrl}";
s.async=true;
${dataAttrs.split(' ').map((a) => 's.setAttribute("' + a.split('=')[0] + '","' + a.split('=')[1].replace(/(^"|"$)/g, '') + '");').join('\n')}
document.head.appendChild(s);
})();`;
}

/** Build JSON response (mode=json). */
function buildJsonResponse(cfg: EmbedConfig, bot: BotConfig): object {
  return {
    bot: {
      id: bot.id,
      name: bot.name,
      description: bot.description,
      slug: bot.slug,
      avatarUrl: bot.avatar_url,
      usageCount: bot.usage_count,
      createdAt: bot.created_at,
    },
    config: cfg,
  };
}

// ─── Route handlers ─────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ botId: string }> },
) {
  const { botId } = await params;
  const mode = req.nextUrl.searchParams.get('mode') || 'html';
  const apiKey = extractApiKey(req);

  // 1. Validate pk_ API key if provided
  if (apiKey) {
    const isValid = await validatePublishableKey(botId, apiKey);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 },
      );
    }
  }

  // 2. Fetch bot config from backend
  const bot = await fetchBotConfig(botId);
  if (!bot) {
    return NextResponse.json(
      { error: 'Bot not found' },
      { status: 404 },
    );
  }

  // 3. Build embed config
  const cfg = buildEmbedConfig(bot, req);

  // 4. Origin / CORS check
  const originAllowed = isOriginAllowed(req);
  if (!originAllowed) {
    return NextResponse.json(
      { error: 'Origin not allowed' },
      { status: 403 },
    );
  }

  // 5. Return based on mode
  const headers: Record<string, string> = {
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
  };

  // CORS headers
  if (ALLOW_CREDENTIALS) {
    const origin = req.headers.get('origin');
    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Vary'] = 'Origin';
    }
  } else {
    headers['Access-Control-Allow-Origin'] = '*';
  }

  switch (mode) {
    case 'json': {
      return NextResponse.json(buildJsonResponse(cfg, bot), { headers });
    }

    case 'widget': {
      return new NextResponse(buildWidgetScript(cfg), {
        headers: {
          ...headers,
          'Content-Type': 'application/javascript',
        },
      });
    }

    case 'html':
    default: {
      return new NextResponse(buildHtmlPage(cfg, bot), {
        headers: {
          ...headers,
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }
  }
}

export async function OPTIONS(req: NextRequest) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-FlowChat-Key',
    'Access-Control-Max-Age': '86400',
  };

  if (ALLOW_CREDENTIALS) {
    const origin = req.headers.get('origin');
    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Vary'] = 'Origin';
    }
    headers['Access-Control-Allow-Credentials'] = 'true';
  } else {
    headers['Access-Control-Allow-Origin'] = '*';
  }

  return new NextResponse(null, { status: 204, headers });
}
