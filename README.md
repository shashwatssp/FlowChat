# FlowChat — Your Own AI Assistant, in Your Own Voice

**FlowChat is the easiest way for any small business to have a private, AI-powered support chatbot of its own — no coding, no AI knowledge required.**

A shopkeeper, a clinic receptionist, a local bakery owner, or any small business in India (and beyond) can spin up a chatbot that knows their business, answers customer questions like a real support agent, and is shared with customers through a single link. Ownership, training, and sharing are all designed to be done in seconds — ideally by simply *speaking*.

---

## The Problem We're Solving

- **Most small businesses can't afford a developer** or a SaaS AI chatbot subscription that charges per message.
- **They don't know what AI is**, and they don't want to learn a complex tool.
- **They still want an always-on, 24/7 support assistant** that speaks about their own products, prices, policies, and services.
- **They want it to "just work" with a link** they can send to their customers on WhatsApp, a poster, or their shop window.

FlowChat removes every barrier between a small business and its own AI assistant. The entire experience is built around **voice**: the owner speaks to train the bot, and customers can speak to talk to it.

---

## How It Works (The Owner's Journey)

1. **Create.** Sign up with a phone number or Google account. Name your business — "Sharma's General Store".
2. **Train it, in your own words.** Tell your chatbot about your business by:
   - **Speaking** — describe your products, hours, prices, and policies out loud (voice mode).
   - **Uploading** — drop a PDF of your menu, a photo of today's price board, a Word doc of your return policy, or a spreadsheet of your services.
   - **Sharing a link** — paste your website or WhatsApp catalogue and we'll ingest it.
   - **Answering FAQs** — we'll suggest questions your customers ask, and you fill in the answers (by voice or text).
3. **Share the link.** You get one URL like `chat.flowchat.app/your-store`. Anyone with the link can start chatting — no login needed on their side.
4. **Own it.** The brain of your assistant (your knowledge) stays yours. Customers chat, get accurate answers, and you can see exactly what they're asking.

---

## Features

- 🎤 **Voice-first setup** — train your bot by simply speaking about your business. The microphone in the chat input captures your voice via the browser's Web Speech API and transcribes it locally — no audio is uploaded or stored.
- 🔊 **Voice mode toggle** — a dedicated `Volume2` button in the chat input lets the owner enable automatic text-to-speech (TTS) for bot replies. When voice mode is on, every assistant response is spoken aloud through the browser's speech synthesis; when off, TTS is fully disabled, keeping the experience quiet by default. When voice mode is disabled, `useVoiceState({ enableTTS: false })` is passed, which causes it to cancel any TTS during loading — preventing unwanted spoken output.
- 🧠 **Own knowledge base** — every business gets its own isolated chatbot brain. Knowledge is stored as vectors in **Qdrant**, tagged per-bot by `bot_id`, so no data leaks between businesses. The `knowledge_chunks` collection is a 1,536-dimensional vector space (Cosine distance) — matching the output dimension of the **Cohere embed-v4.0** embedding model exactly, so no padding or dimension adjustment is needed.
- 📄 **Multi-format training** — upload `.pdf`, `.docx`, `.md`, `.csv`, `.json`, `.txt`, and `.tex`/`.latex` files. PDFs are read with the `github.com/ledongthuc/pdf` Go library; DOCX files are unpacked from their ZIP archive and their `word/document.xml` is parsed to extract text from `<w:t>` elements; LaTeX markup (commands, environments, inline/display math) is stripped via regex to leave readable content. Images are passed through a vision model that describes products, prices, and text.
- 🔗 **Shareable chat link** — one public URL (`chat.flowchat.app/your-store`), no customer sign-in required. The bot is resolved by its slug and RAG-searched within only that bot's knowledge.
- 💬 **Embeddable widget** — a one-line `<script>` snippet (`GET /api/v1/widget/:botID`) bootstraps a chat window onto any website.
- 🌍 **Built for India** — every model defaults to a free-tier option. Voice works in Hindi + English + Hinglish through the browser.
- 📊 **Insightful dashboard** — browse conversations, read full message history, and leave feedback — all scoped to a bot.
- 🌐 **Firecrawl-powered web scraping** — when an owner pastes a website URL, FlowChat sends it to the **Firecrawl API** (`/v1/scrape` for single pages, `/v1/crawl` for sitemaps) which returns clean markdown. If the Firecrawl API key is not set or the call fails, FlowChat automatically falls back to a basic HTTP fetch with HTML tag stripping — the bot is always trained, just with varying quality.

---

## A Note on Voice

Voice is the primary way owners *teach* their assistant and the way customers *talk* to it. The web app uses the browser's built-in SpeechRecognition / speech-to-text so no software is installed on the owner's device. The **voice mode toggle** in the chat input additionally controls automatic text-to-speech (TTS) for bot replies — owners enable it when they want spoken responses, and leave it off otherwise for a silent chat.

The backend is agnostic to how text arrives: whether typed, spoken (browser STT), or pasted, it only ever receives the transcribed message text. This keeps the voice layer simple on the edge while all turn-processing logic stays in Go.

---

## Quick Start (For Developers)

FlowChat is a full-stack app: a **Go** backend (Gin), a **Next.js** frontend, **Supabase** for auth & relational data, **Qdrant** for vector search, **Cohere** for embeddings, and **OpenRouter** / **Groq** for LLM inference. **Firecrawl** powers website scraping with an HTTP fallback when no API key is set.

### Prerequisites

- Go 1.24+
- Node.js 18+
- A Supabase project (URL + anon key + service role key)
- A Qdrant instance (local Docker or cloud — see [Qdrant Configuration](#qdrant-configuration) below)
- A Cohere API key (free tier available) for embeddings
- An OpenRouter API key (free tier available) for chat/vision LLM calls
- (Optional) A Firecrawl API key for higher-quality website scraping
- (Optional) A Groq API key as a secondary LLM provider

### Run everything with Docker

```bash
docker compose up --build
```

This starts **Qdrant** (port 6333/6334), **Redis** (port 6379), the **Go backend** (port 8080), and the **Next.js frontend** (port 3000). The backend automatically receives `QDRANT_URL=http://qdrant:6333` to talk to the Docker-internal container name, and all env vars from `backend/.env`.

### Run locally without Docker

```bash
# Backend
cd backend
cp .env.example .env
# -> fill SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_KEY,
#    QDRANT_URL, QDRANT_API_KEY, OPENROUTER_API_KEY,
#    COHERE_API_KEY, FIRECRAWL_API_KEY
go run cmd/server/main.go

# Frontend
cd web
cp .env.example .env.local
# -> set NEXT_PUBLIC_API_URL=http://localhost:8080/api/v1
npm install
npm run dev
```

Open `http://localhost:3000` and `http://localhost:8080/health`.

---

## Tech Stack

### Backend — Go

- **Go 1.24 + Gin** HTTP router — handles every turn of every conversation, one request at a time.
- **Supabase** (PostgreSQL + GoTrue auth) — bots, conversations, messages, feedback, and user accounts. The backend talks to Supabase's PostgREST REST API and GoTrue auth endpoints directly over HTTP (no ORM). A custom `isJWT` check ensures opaque `sb_publishable_*` / `sb_secret_*` keys are sent via the `apikey` header without a Bearer prefix, while legacy JWTs are sent as `Authorization: Bearer`.
- **Qdrant** — vector database for the knowledge base (semantic search / RAG). Two collections are initialized at startup: `knowledge_chunks` (1,536-dim, Cosine) and `feedback_vectors` (1,536-dim, Cosine). A `bot_id` payload index is created on both for fast per-bot filtering.
- **Cohere** — embeddings provider (`embed-v4.0`, 1,536-dimensional, multilingual). The Cohere client includes retry logic (up to 5 retries with exponential backoff on 429/5xx), batches requests (max 96 per call), and a 120-second timeout. The 1,536-dim output matches the Qdrant collection dimension exactly.
- **OpenRouter** — primary LLM provider for chat generation, question suggestions, and image vision. Supports the OpenAI-compatible API (`/chat/completions`, `/embeddings`).
- **Groq** — secondary LLM provider. If `OPENROUTER_API_KEY` is not set, the config falls back to `GROQ_API_KEY` with `GROQ_BASE_URL=https://api.groq.com/openai/v1`.
- **Firecrawl** — website scraping API (`/v1/scrape` for single pages, `/v1/crawl` for sitemaps using `sitemap.xml`). Falls back to basic HTTP + HTML stripping when no key is set or the API call fails.
- **Redis** — available for future caching / background job queues (runs in Docker Compose but not yet actively used by the core flow).

### Frontend — Next.js

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind CSS**
- **Zustand** — small client-side store (auth, current bot)
- **Axios / fetch** — typed API client
- **react-markdown** — render bot replies
- **lucide-react** — icons (`Send`, `Mic`, `Square`, `Volume2`)
- **react-hot-toast** — notifications
- **Browser Web Speech API** — voice input (SpeechRecognition) and text-to-speech (speech synthesis)

### Infrastructure

- **Docker Compose** for local dev (`qdrant`, `redis`, `backend`, `frontend`)
- **Vercel** — frontend hosting
- **Railway** — backend hosting (typical)
- **Render** — production deployment via `render.yaml`

---

## Qdrant Configuration

Qdrant is the vector database that powers semantic search (RAG). At backend startup (`qdrant/client.go:InitializeCollections`), two collections are created idempotently if they don't already exist:

| Collection | Vector Size | Distance | Purpose |
|---|---|---|---|
| `knowledge_chunks` | 1,536 | Cosine | Stores all bot knowledge vectors (files, scraped sites, Q&A, image descriptions) |
| `feedback_vectors` | 1,536 | Cosine | Reserved for future feedback-based vector storage |

**Why 1,536 dimensions?** Cohere's `embed-v4.0` model (configured via `COHERE_EMBEDDING_MODEL`) produces exactly 1,536-dimensional vectors. This matches the Qdrant collection dimension at creation time, so no padding, truncation, or collection recreation is needed when switching models — the dimensions align out of the box.

**Per-bot isolation:** Every vector point upserted to `knowledge_chunks` carries a `bot_id` payload field. A `bot_id` keyword index is created on the collection so searches can efficiently filter by bot. The Qdrant `Search` method builds a `must`/`match` filter on `bot_id`, ensuring a business's knowledge is never mixed into another's.

**Docker (local development):** The local Qdrant runs with `QDRANT__SERVICE__GRPC_PORT=6334`, exposing REST on port 6333 and gRPC on 6334. The backend connects via `http://qdrant:6333` inside Docker (overridden in `docker-compose.yml`).

**Cloud (production):** Point `QDRANT_URL` and `QDRANT_API_KEY` at your Qdrant Cloud instance. The client sets both the `api-key` and `Authorization: Bearer` headers for cloud authentication.

---

## LLM & RAG Architecture

### Provider Overview

| Provider | Purpose | Config Variables |
|---|---|---|
| **Cohere** | Embeddings (knowledge chunks + query vectors) | `COHERE_API_KEY`, `COHERE_BASE_URL`, `COHERE_EMBEDDING_MODEL` (default `embed-v4.0`) |
| **OpenRouter** | Chat generation, vision, FAQ suggestions | `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL` (default `https://openrouter.ai/api/v1`) |
| **Groq** | Fallback LLM provider (if OpenRouter key is absent) | `GROQ_API_KEY`, `GROQ_BASE_URL` (default `https://api.groq.com/openai/v1`) |
| **Firecrawl** | Website scraping (markdown extraction) | `FIRECRAWL_API_KEY` |

### Model Selection

All model choices are configurable via environment variables — no code changes needed:

| Variable | Purpose | Default |
|---|---|---|
| `LLM_CHAT_MODEL` | Generative model for chat replies | `moonshotai/kimi-k3-free` |
| `LLM_EMBEDDING_MODEL` | Embedding model (OpenRouter fallback) | `openai/text-embedding-3-small:free` |
| `LLM_QUESTION_MODEL` | Model for FAQ suggestion generation | falls back to `LLM_CHAT_MODEL` |
| `LLM_VISION_MODEL` | Vision model for image description | falls back to `LLM_CHAT_MODEL` |
| `COHERE_EMBEDDING_MODEL` | Embedding model (primary, Cohere) | `embed-v4.0` |
| `GROQ_CHAT_MODEL` | Groq chat model | `groq/compound-mini` |
| `GROQ_VISION_MODEL` | Groq vision model | `groq/compound-mini` |

### RAG (Retrieval-Augmented Generation)

Every chat turn follows this pipeline (in `handlers/chat.go`):

1. **Resolve the bot** — look up by slug, fetch `system_prompt` (aka "Bot Instructions"), `id`, and `name`.
2. **Create or reuse conversation** — generate a UUID if it's a new conversation; insert into `conversations` with `bot_id` and `user_id`.
3. **Embed the query** — call Cohere's `GenerateEmbeddings` with `input_type="search_query"` (1,536-dim vector). If Cohere is unavailable, the bot answers from the system prompt only — no 500 error.
4. **Search Qdrant** — `Search("knowledge_chunks", queryVector, topK=5, {bot_id})` returns the 5 most relevant knowledge chunks, scoped to this bot only.
5. **Load history** — fetch the last 10 messages from Supabase, ordered by `created_at desc`.
6. **Assemble prompt** — `[system: bot instructions] + [system: retrieved context] + [history] + [user message]`.
7. **Generate** — call OpenRouter (or Groq fallback) chat completion. Supports both non-streaming (full JSON reply) and streaming (SSE, token-by-token).
8. **Persist** — save user + assistant messages to `messages`, increment bot usage via `RPC("increment_bot_usage")`.

### Training Pipeline (Knowledge Ingestion)

All four ingestion paths (file upload, website scrape, Q&A, suggested FAQs) run the same pipeline:

```
input (file / URL / typed)  →  extract text
                               →  chunk (utils.ChunkText, ~500 chars, 50 overlap)
                               →  embed (Cohere embed-v4.0, 1536-dim)
                               →  upsert into Qdrant knowledge_chunks (tagged bot_id)
                               →  record source in Supabase knowledge_sources
```

**File types and extraction methods:**
- `.pdf` → `github.com/ledongthuc/pdf` reader extracts plain text directly from the byte stream (no temp files).
- `.docx` → `archive/zip` extracts `word/document.xml`, then regex parses `<w:t>` elements for text content.
- `.tex` / `.latex` → `stripLateMarkup` removes LaTeX commands (`\command{}`), environments (`\begin{...}...\end{...}`), and inline/display math (`$...$`, `$$...$$`, `\[...\]`).
- `.md`, `.csv`, `.json`, `.txt` → read as raw text.
- `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` → vision model describes the image content, and the description becomes searchable text.
- Web URLs → Firecrawl API returns markdown (or HTML stripping fallback).

**ChunkText rune fix:** The `ChunkText` function operates on `[]rune` (Unicode code points) rather than bytes, preventing garbled text from slicing mid-UTF-8-character. It also intelligently breaks on sentence boundaries (`.` `!` `?`) within a 50-character window.

---

## High-Level Architecture

```
  Owner / Customer (browser)
        │  voice → speech-to-text  (browser Web Speech API)
        │  text  → chat UI
        ▼
  ┌─────────────┐  HTTPS
  │  Web (Next) │  /api/v1   JWT (owner)  |  public by bot-slug (customers)
  └──────┬──────┘
         ▼
  ┌──────────────────┐  ┌──────────────┐  ┌────────────┐
  │  Go (Gin) Backend │──│  Supabase    │──│ PostgreSQL │
  │  turn processing  │──│  (auth+REST) │  │  bots,     │
  │  RAG + LLM calls   │──│              │  │  msgs, …  │
  └──────┬───────────┘  └──────────────┘  └────────────┘
         ▼  vector search
  ┌────────────┐
  │  Qdrant    │  knowledge_chunks (1536-dim, bot_id filter)
  │  (vectors) │
  └────────────┘
         ▲  embeddings + chat
  ┌────────────┐
  │  Cohere    │  embeddings (embed-v4.0, 1536-dim)
  │  (embed)   │
  └────────────┘
         ▲  chat / vision / question
  ┌────────────┐
  │  OpenRouter │  (chat, vision, FAQ suggestions)
  │  / Groq    │  (fallback if OpenRouter key absent)
  └────────────┘
        │  web scraping
  ┌────────────┐
  │  Firecrawl  │  (scrape + crawl with sitemap)
  │  (scrape)   │
  └────────────┘
```

---

## API Overview

All endpoints live under `/api/v1`. The backend listens on `:8080` by default.

| Area | Example | Auth |
|---|---|---|
| Auth | `POST /api/v1/auth/register`, `/login`, `/oauth/:provider` | public |
| Bots | `POST /api/v1/bots`, `GET /api/v1/bots`, `GET /bots/public/:slug` | owner (JWT) / public (by slug) |
| Knowledge | `POST /api/v1/knowledge/upload`, `/scrape`, `/suggest-questions`, `/qa` | owner (JWT) |
| Knowledge | `GET /api/v1/knowledge/:botID`, `DELETE /api/v1/knowledge/:sourceID` | owner (JWT) |
| Chat | `POST /api/v1/chat/:botSlug` | public (by link) |
| Conversations | `GET /api/v1/conversations/:botID`, `/:id/messages`, `/:id/feedback` | owner (JWT) |
| Widget | `GET /api/v1/widget/:botID` | public |
| Health | `GET /health` | public |

### Key endpoint details

- **`POST /chat/:botSlug`** — The public chat endpoint. Resolves the bot by slug (no API key required for link-based chat), runs RAG, and returns `{ response, conversation_id, sources }`. Supports `stream: true` for SSE token-by-token replies. Messages are persisted after the stream completes.
- **`POST /knowledge/scrape`** — Body: `{ bot_id, url, sitemap? }`. Calls Firecrawl's `/v1/scrape` (or `/v1/crawl` if `sitemap=true`), parses the response (handles both single-object and array `data` formats), and falls back to HTTP + HTML stripping if the key is empty or the API fails.
- **`POST /knowledge/upload`** — Multipart form: `bot_id` + `file`. Validates extension, extracts text (PDF/DOCX/LaTeX/image vision), chunks, embeds, and stores in Qdrant.
- **`GET /conversations/:botID`** — Lists conversations for a bot, ordered by `started_at` descending. Uses `Select("*")` to fetch all columns and avoid 500 errors from missing fields.
- **`GET /widget/:botID`** — Returns a JS snippet that loads the widget from CDN and initializes it.

Full reference in [`docs/API.md`](docs/API.md).

---

## Database Schema

The source of truth is `supabase/schema.sql`. All relational data lives in PostgreSQL (via Supabase). Vector knowledge lives separately in Qdrant — Postgres only stores per-source metadata (name, type, chunk count, status).

| Table | Key Columns | Purpose |
|---|---|---|
| `users` | `id`, `email`, `full_name`, `password_hash` | Owner accounts (Supabase GoTrue + local auth) |
| `bots` | `id`, `user_id`, `name`, `slug`, `system_prompt`, `api_key`, `usage_count` | One row per chatbot; `system_prompt` is the "Bot Instructions" |
| `conversations` | `id`, `bot_id`, `user_id`, `started_at`, `last_message_at` | One row per chat session (no `created_at` column) |
| `messages` | `id`, `conversation_id`, `bot_id`, `role`, `content`, `created_at` | Every user/assistant/system message |
| `knowledge_sources` | `id`, `bot_id`, `name`, `type`, `url`, `status`, `chunk_count`, `created_at` | Metadata about uploaded files / scraped sites / Q&A |
| `feedback` | `id`, `conversation_id`, `helpful`, `rating`, `comment` | Thumbs up/down + optional comment |

**Multi-tenancy:** Every query is scoped by `bot_id`. RLS policies ensure owners see only their own data. The backend uses the Supabase **service role key** for writes (creating bots, inserting messages) to bypass RLS since the owner acts through the backend.

---

## Environment Variables

### Backend (`backend/.env`)

```env
# Server
PORT=8080
ENV=production

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-anon-key
SUPABASE_SERVICE_KEY=your-supabase-service-role-key

# Qdrant
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=your-qdrant-key

# OpenRouter (primary LLM provider for chat, vision, FAQ)
OPENROUTER_API_KEY=sk-or-v1-your-key
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

# LLM model selection
LLM_CHAT_MODEL=moonshotai/kimi-k3-free
LLM_EMBEDDING_MODEL=openai/text-embedding-3-small:free
LLM_QUESTION_MODEL=moonshotai/kimi-k3-free   # falls back to LLM_CHAT_MODEL
LLM_VISION_MODEL=moonshotai/kimi-k3-free     # falls back to LLM_CHAT_MODEL

# Cohere (embeddings — primary embedding provider, 1536-dim matches Qdrant)
COHERE_API_KEY=your-cohere-api-key
COHERE_BASE_URL=https://api.cohere.com/v2
COHERE_EMBEDDING_MODEL=embed-v4.0

# Groq (fallback LLM provider — used if OPENROUTER_API_KEY is not set)
GROQ_API_KEY=your-groq-key
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_CHAT_MODEL=groq/compound-mini
GROQ_VISION_MODEL=groq/compound-mini

# Auth
JWT_SECRET=your-super-secret-key-min-32-chars

# CORS
ALLOWED_ORIGINS=http://localhost:3000,https://chat.flowchat.app

# Rate Limiting & Knowledge Processing
RATE_LIMIT_PER_MINUTE=60
MAX_KNOWLEDGE_SIZE_MB=10
CHUNK_SIZE=500
CHUNK_OVERLAP=50

# Firecrawl (web scraping — optional; falls back to HTTP if absent)
FIRECRAWL_API_KEY=your-firecrawl-key
```

### Frontend (`web/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:8080/api/v1
```

---

## Voice Mode

The chat input (`ChatInput.tsx`) includes a **voice mode toggle** (`Volume2` icon) alongside the send button. When enabled:

- `useVoiceState({ enableTTS: voiceMode })` passes `enableTTS: true` to the voice state hook.
- After a bot response completes, if `fullContent && voiceMode && voice.isTTSSupported`, the browser's speech synthesis speaks the full reply aloud.
- When disabled, `enableTTS: false` causes the voice hook to dispatch a `CANCEL` during loading state, preventing any TTS output.

The toggle is blue when active, gray when inactive, and all chat input action buttons are consistently `w-12 h-12` for visual alignment. The attachment button (`Paperclip`) has been removed from the chat input — file uploads happen through the dashboard's Knowledge tab instead.

---

## Documentation

This README covers *what* FlowChat is. The `docs/` folder explains *how* it is built and works:

| Doc | Explains |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The overall build, data flow, multi-tenancy model, and deployment topology. |
| [`docs/BACKEND_GO.md`](docs/BACKEND_GO.md) | How Go + Gin process each chat turn, handler layers, middleware, service clients, and graceful degradation. |
| [`docs/FRONTEND.md`](docs/FRONTEND.md) | How Next.js serves the landing page and the chat interface, voice capture, and state/API call flow. |
| [`docs/LLM_AND_RAG.md`](docs/LLM_AND_RAG.md) | How the LLM is called (chat, embeddings, vision) and how RAG retrieves answers from your knowledge, with Cohere embeddings. |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Table schemas, relationships, RLS policies, and the Postgres vs Qdrant split. |
| [`docs/API.md`](docs/API.md) | Full endpoint reference and how requests flow end-to-end. |
| [`docs/USE_CASES.md`](docs/USE_CASES.md) | A feature-by-feature map of what every piece is used for. |
| [`docs/TRAINING.md`](docs/TRAINING.md) | A plain-language guide for business owners on how to train their chatbot. |

---

## Local Ports

| Service | Port |
|---|---|
| Frontend (Next.js dev) | `3000` |
| Backend (Go) | `8080` |
| Qdrant | `6333` (REST), `6334` (gRPC) |
| Redis | `6379` |
| Health | `8080/health` |

---

## Deployment

### Render (production backend)

`render.yaml` defines the backend as a Docker service on port `:10000`. Sensitive keys (`SUPABASE_*`, `QDRANT_*`, `OPENROUTER_API_KEY`, `COHERE_API_KEY`, `GROQ_API_KEY`, `FIRECRAWL_API_KEY`, `JWT_SECRET`, `ALLOWED_ORIGINS`) are set as `sync: false` environment variables in the Render dashboard — never committed to version control.

### Docker Compose (local)

The `docker-compose.yml` runs four services. The backend uses `env_file: ./backend/.env` (auto-loading all variables including `FIRECRAWL_API_KEY`, `COHERE_API_KEY`, `GROQ_API_KEY`, etc.) and overrides `QDRANT_URL=http://qdrant:6333` to use the Docker-internal container name.

---

## Design Principles

1. **Voice-first, complexity-hidden.** The owner should never see "embedding," "vector," or "endpoint." They speak. The docs describe how that simplicity is implemented.
2. **Per-turn processing.** Go handles one conversation turn per HTTP request — no long-lived agent sessions, keeping hosting cheap and scaling simple.
3. **Isolation by default.** Every query is scoped to a `bot_id` in both Supabase (RLS) and Qdrant (payload filter). A scoping bug would leak data between businesses.
4. **Free-tier friendly.** Cohere, OpenRouter, and Groq all have generous free tiers. The platform defaults to free models so small businesses pay nothing to run.
5. **Graceful degradation.** If embeddings fail, the bot answers from the system prompt. If Qdrant is down, the bot answers from history + prompt. If Firecrawl is unavailable, basic HTTP scraping kicks in. The bot never 500s when an upstream service is unreachable — it degrades gracefully.
6. **No vendor lock-in for infra.** Each external service (Supabase, Qdrant, Cohere, OpenRouter, Groq, Firecrawl) is reached through a thin HTTP client, so swapping providers only touches one file per service.
7. **Secrets never in the frontend.** The Next.js frontend holds no API keys or tokens. All keys live on the Go backend, keeping shareable, no-login chat links safe.

---

## Roadmap

- ✅ Voice input for training (SpeechRecognition) and voice replies (speech synthesis) with explicit voice mode toggle
- ✅ Image/PDF/DOCX/LaTeX/multi-format ingestion with vision-model reading
- ✅ Shareable, no-login chat links + embeddable widget
- ✅ Owner dashboard for bot management, knowledge, and conversations
- ✅ Cohere embeddings (1,536-dim, matches Qdrant collection)
- ✅ Firecrawl-powered website scraping with HTTP fallback
- ✅ Groq as fallback LLM provider
- ✅ End-to-end type-check and build validation

---

## License & Contributing

MIT. Contributions welcome — open an issue or PR.

For support, please open an issue on GitHub.
