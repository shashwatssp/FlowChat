# Use Cases — What Every Piece Is Used For

This is a practical map: given a small business and a goal, *which part of
FlowChat do you use?* It mirrors the sections in the code so you can navigate
from feature → file.

---

## For the Business Owner

### 1. "I want my own chatbot."
- **Where:** `/register` or `/login`, then `/dashboard`.
- **What happens:** Sign up (email/password or Google OAuth) → Supabase GoTrue
  creates your account → you land on your personal dashboard.
- **Code:** `auth.go` (register/login/oauth), then `bot.go` (`CreateBot`) which
  generates a unique slug + per-bot API key and creates the `bots` row.

### 2. "I want my bot to know about my business."
- **Where:** `/dashboard/bot/[id]` → **Knowledge tab**.
- **What happens:** You feed the bot knowledge. Four ways:
  | Input | Endpoint (owner, JWT) | Backend handler |
  |---|---|---|
  | Upload a PDF/menu/photo/price-board | `POST /knowledge/upload` | `UploadFile` |
  | Paste a website / WhatsApp catalogue URL | `POST /knowledge/scrape` | `ScrapeWebsite` |
  | Type common Q&As (e.g. "What are your hours?") | `POST /knowledge/qa` | `SaveQA` |
  | Auto-generate likely customer questions | `POST /knowledge/suggest-questions` | `SuggestQuestions` |

  Behind the scenes each path → text → chunks → embeddings → Qdrant. The bot
  has no memory of training beyond these vectors + its system prompt.

### 3. "I uploaded a photo of my price board — can the bot read it?"
- **Yes.** `UploadFile` detects image extensions and calls the vision model
  (`GenerateImageDescription`). The description becomes searchable text.
- **Code:** `knowledge.go` lines for the `.png/.jpg/.jpeg/.webp/.gif` branch.

### 4. "I want the bot to sound like my business."
- **Where:** `/dashboard/bot/[id]` → **Settings tab** → system prompt field.
- **What happens:** Whatever you write becomes the bot's `system_prompt`,
  injected first in every chat turn. Leave it blank → the backend writes a
  sensible default using the bot's name.

### 5. "I want a link to give my customers."
- **Where:** `/dashboard/bot/[id]` shows the shareable link
  `chat.flowchat.app/<your-slug>`.
- **What happens:** `/chat/[slug]` is the **public** chat page. No login for
  the customer. The backend resolves the bot by slug (`GET /bots/public/:slug`
  and `POST /chat/:botSlug`) and answers from *that bot's* knowledge only.

### 6. "I want the bot on my shop's website / Instagram bio link."
- **Embeddable widget:** `GET /api/v1/widget/:botID` serves a one-line JS
  snippet that bootstraps the chat window. (Frontend bundles a standalone
  widget build for CDN hosting — see `docs/FRONTEND.md`.)

### 7. "I want to see what customers are asking."
- **Where:** `/dashboard/bot/[id]` → **Conversations tab**.
- **What happens:** Lists every conversation for the bot, shows messages, and
  lets you leave feedback. Stats (total conversations, messages, sources) are
  available via `GET /bots/:id/stats`.

---

## For the Customer (using the shared link)

### 1. "I just want to ask a question."
- Open the owner's link → land on `/chat/[slug]`.
- Type (or **speak** — the input bar is intended to accept voice via the
  browser's Web Speech API) a message.
- The turn is sent to `POST /api/v1/chat/:botSlug`.

### 2. "I want the answer fast / I want to watch it type."
- The frontend can request `stream: true`. The backend responds with
  Server-Sent Events (`text/event-stream`) and renders the reply word-by-word.

### 3. "How do I know the answer is trustworthy?"
- The backend returns the **sources** (the exact knowledge chunks it pulled from
  Qdrant). The chat UI shows them under the reply.

---

## For the Developer / Operator

### 1. "I need to point this at a different LLM provider."
- Edit env vars in `backend/.env`: `LLM_BASE_URL`, `LLM_CHAT_MODEL`,
  `LLM_EMBEDDING_MODEL`, `LLM_QUESTION_MODEL`, `LLM_VISION_MODEL`.
- No code changes — every model is selected in `config.go`.

### 2. "I need to change how chunking works."
- `CHUNK_SIZE` (default `500`) and `CHUNK_OVERLAP` (default `50`) in
  `backend/.env`. Used by `utils.ChunkText`.

### 3. "I need per-bot rate limiting / larger uploads."
- `RATE_LIMIT_PER_MINUTE` and `MAX_KNOWLEDGE_SIZE_MB` are read in `config.go`
  (rate-limit middleware is listed as a near-term item).

### 4. "I want to run it all locally."
```bash
docker compose up --build
# frontend :3000, backend :8080 + healthcheck at /health, qdrant :6333, redis :6379
```

### 5. "I need to deploy just the backend somewhere new."
- It's a single binary: `go run cmd/server/main.go` (or build a Docker image;
  `backend/Dockerfile` exists). Read-only health check at `GET /health` returns
  `{ status, service, version }`.

---

## Feature → Where It Lives

| Feature | Frontend location | Backend location |
|---|---|---|
| Landing page | `src/app/page.tsx` | — |
| Sign up / Log in / OAuth | `src/app/(auth)/login`, `register`; `src/lib/api.ts` authApi | `handlers/auth.go`, `middleware/auth.go` |
| Bot list + create | `src/app/dashboard/page.tsx` | `handlers/bot.go` |
| Bot settings / stats | `components/bots/BotSettings.tsx` | `handlers/bot.go` |
| Knowledge upload / scrape / Q&A | `components/knowledge/KnowledgeManager.tsx` | `handlers/knowledge.go` |
| Suggested FAQ questions | (dashboard) | `handlers/knowledge.go` SuggestQuestions |
| Public chat link | `src/app/chat/[slug]/page.tsx`, `ChatInterface` | `handlers/chat.go` Chat |
| Conversation history / feedback | `components/conversations/ConversationHistory.tsx` | `handlers/knowledge.go` ListConversations/GetConversation/SaveFeedback |
| Embeddable widget | (future widget bundle) | `handlers/bot.go` WidgetHandler |
| Voice input | `ChatInput` (intended mic via Web Speech API) | backend is text-agnostic |
| Image reading | (upload via chat/dashboard) | `handlers/knowledge.go` UploadFile (vision) |

---

## The Voice-First Intent

Voice is the north star of FlowChat, and it shows up in two places:

1. **Owner training** — the owner speaks into the dashboard to describe their
   business. The recorded audio is transcribed (browser speech-to-text) and the
   resulting text is fed through the same knowledge pipeline as a typed/Q&A
   upload.
2. **Customer chat** — on `/chat/[slug]`, the customer can speak instead of
   type. The transcript becomes the `message` the backend receives.

Because the backend only ever sees the **text** of a message, the voice layer is
a pure frontend concern — no backend change is needed to turn a voice command
into a bot turn. That is the intentional design: keep voice simple on the edge,
and keep the turn-processing logic in Go exactly as it is.
