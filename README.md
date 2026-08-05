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

- 🎤 **Voice-first setup** — train your bot by simply speaking about your business.
- 🧠 **Own knowledge base** — every business has its own isolated chatbot brain; no leakage between businesses.
- 📄 **Multi-format training** — PDF, Word, Excel, images, websites, and typed Q&A pairs.
- 🖼️ **Images understood** — upload a photo of your price board or menu; we read it for you.
- 🔗 **Shareable chat link** — one link, no customer sign-in required.
- 💬 **Embeddable widget** — paste one line of code onto any website to add the chat window.
- 🌍 **Built for India** — free-tier friendly, low cost, supports Hindi + English + Hinglish naturally.
- 📊 **Insightful dashboard** — see how many people are chatting and what they ask.

---

## A Note on Voice

Voice is the primary way owners *teach* their assistant and the way customers *talk* to it. The web app uses the browser's built-in SpeechRecognition / speech-to-text so no software is installed on the owner's device. This is the north-star user experience of the product. The rest of this README describes the technical foundation that makes it possible, and `docs/` contains the full engineering story of how each piece works today.

---

## Quick Start (For Developers)

FlowChat is a full-stack app: a **Go** backend, a **Next.js** frontend, **Supabase** for data & auth, and **Qdrant** for vector search.

### Prerequisites

- Go 1.22+
- Node.js 18+
- A Supabase project
- A Qdrant instance (local or cloud)
- An OpenRouter API key

### Run everything with Docker

```bash
docker compose up --build
```

This starts **Qdrant** (vector store), **Redis**, the **Go backend** on `:8080`, and the **Next.js frontend** on `:3000`.

### Run locally without Docker

```bash
# Backend
cd backend
cp .env.example .env
# -> fill SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_KEY,
#    QDRANT_URL, QDRANT_API_KEY, OPENROUTER_API_KEY
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
- **Go 1.22 + Gin** HTTP router — handles every turn of every conversation, one request at a time.
- **Supabase** (PostgreSQL + Auth) — bots, conversations, messages, feedback, and user accounts.
- **Qdrant** — vector database for the knowledge base (semantic search / RAG).
- **OpenRouter** — LLM provider used for embeddings, chat, and image (vision) understanding. Free-tier friendly.

### Frontend — Next.js
- **Next.js 14** (App Router) + **TypeScript** + **Tailwind CSS**
- **Zustand** — light client state (auth, current bot)
- **Axios** — typed API client
- **react-markdown** — render bot replies
- **lucide-react** — icons

### Infrastructure
- **Docker Compose** for local dev (`Qdrant`, `Redis`, `Backend`, `Frontend`)
- **Vercel** — frontend hosting
- **Railway** — backend hosting (typical)

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
  │  Qdrant    │  knowledge_chunks (per bot)
  │  (vectors) │
  └────────────┘
         ▲  embeddings / chat
  ┌────────────┐
  │  OpenRouter │
  │  (LLM)      │
  └────────────┘
```

---

## API Overview

| Area | Example | Auth |
|---|---|---|
| Auth | `POST /api/v1/auth/register`, `/login`, `/oauth/:provider` | public |
| Bots | `POST /api/v1/bots`, `GET /api/v1/bots`, `GET /bots/public/:slug` | owner (JWT) |
| Knowledge | `POST /api/v1/knowledge/upload`, `/scrape`, `/suggest-questions`, `/qa` | owner (JWT) |
| Chat | `POST /api/v1/chat/:botSlug` | public (by link) |
| Conversations | `GET /api/v1/conversations/:botId`, `/:id/messages`, `/:id/feedback` | owner (JWT) |
| Widget | `GET /api/v1/widget/:botID` | public |

Full reference in [`docs/API.md`](docs/API.md).

---

## Documentation

This README covers *what* FlowChat is. The `docs/` folder explains *how* it is built and works:

| Doc | Explains |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The overall build, data flow, and deployment topology. |
| [`docs/BACKEND_GO.md`](docs/BACKEND_GO.md) | How Go + Gin process each chat turn, the handler layers, middleware, and service clients. |
| [`docs/FRONTEND.md`](docs/FRONTEND.md) | How Next.js serves the landing page and the chat interface, and how state/API calls flow. |
| [`docs/LLM_AND_RAG.md`](docs/LLM_AND_RAG.md) | How the LLM is called (chat, embeddings, vision) and how RAG retrieves answers from your knowledge. |
| [`docs/USE_CASES.md`](docs/USE_CASES.md) | A feature-by-feature map of what every piece is used for. |
| [`docs/API.md`](docs/API.md) | Full endpoint reference and how requests flow end-to-end. |

---

## Environment Variables

### Backend (`backend/.env`)

```env
PORT=8080
ENV=development
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-anon-key
SUPABASE_SERVICE_KEY=your-supabase-service-key
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=your-qdrant-key
OPENROUTER_API_KEY=sk-or-v1-your-key
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_CHAT_MODEL=nvidia/llama-3.1-nemotron-ultra-253b:free
LLM_EMBEDDING_MODEL=openai/text-embedding-3-small
LLM_QUESTION_MODEL=google/gemini-2.0-flash:free
LLM_VISION_MODEL=google/gemini-2.0-flash:free
JWT_SECRET=your-super-secret-key
ALLOWED_ORIGINS=http://localhost:3000,https://chat.flowchat.app
RATE_LIMIT_PER_MINUTE=60
MAX_KNOWLEDGE_SIZE_MB=10
CHUNK_SIZE=500
CHUNK_OVERLAP=50
```

### Frontend (`web/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:8080/api/v1
```

---

## Roadmap

- ✅ Voice input for training (SpeechRecognition) and voice replies (speech synthesis) on the chat link
- ✅ Image/PDF/multi-format ingestion with vision-model reading
- ✅ Shareable, no-login chat links + embeddable widget
- ✅ Owner dashboard for bot management, knowledge, and conversations
- ☑ Full TypeScript type-check and lint cleanup

---

## License & Contributing

MIT. Contributions welcome — open an issue or PR.

**Co-Authored-By: Oz <oz-agent@warp.dev>**

For support, please open an issue on GitHub.
