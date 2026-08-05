# Architecture

This document explains how FlowChat is built, end-to-end, and how a single
user message travels from a browser to an LLM and back. If you only read one doc,
read this one.

## 1. What is FlowChat?

FlowChat is a **multi-tenant SaaS platform** that lets any small business own a
private, AI-powered support chatbot trained on *its own* knowledge. Two
audiences matter:

- **The owner** (shopkeeper, clinic receptionist, etc.) — builds, trains, and
  manages their bot through a dashboard. They are the only person who sees
  their own business data.
- **The customer** — visits a shareable link (`chat.flowchat.app/your-store`)
  and chats with the bot. No login required on their side.

Every business gets an **isolated knowledge base** stored as vectors tagged with
that business's `bot_id`, so one business's data is never mixed into another's.

## 2. Stack at a Glance

| Layer | Tech | Responsibility |
|---|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind | Landing, dashboard, chat UI; voice capture; API calls |
| API / Business logic | Go 1.22 + Gin HTTP router | Authenticate, orchestrate RAG, call the LLM, persist chats |
| Auth + Database | Supabase (GoTrue + PostgREST + PostgreSQL) | Users, bots, conversations, messages, feedback, files metadata |
| Vector store | Qdrant | Semantic search over each bot's knowledge chunks |
| LLM provider | OpenRouter | Embeddings, text generation, vision (image reading) |
| Local dev | Docker Compose | Runs Qdrant, Redis, Backend, Frontend locally |

## 3. Deployment Topology

```
Customer's browser  ──HTTPS──▶  Vercel (Next.js frontend)
                                    │
Owner's browser   ──HTTPS──▶  Vercel (Next.js frontend)
                                    │  HTTPS (JWT for owner / public-by-slug for customers)
                                    ▼
                              Railway (Go backend :8080)
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
        Supabase                Qdrant               OpenRouter
      (PostgreSQL              (vectors —           (LLM: chat,
       + GoTrue auth)          knowledge_chunks)     embeddings, vision)
```

- The **frontend** is a static Next.js build hosted on Vercel. It talks to the
  backend API over HTTPS.
- The **backend** is a single Go binary (Gin) hosted on Railway (or anywhere a
  Go binary runs). It is stateless — it does not keep conversation memory in
  process; everything is persisted in Supabase so any server instance can serve
  any request.
- **Supabase** holds all relational data and auth. The backend talks to it
  using Supabase's PostgREST REST API and GoTrue auth endpoints directly over
  HTTP (no heavy ORM — see `internal/supabase/client.go`).
- **Qdrant** holds the vectorized knowledge. Each bot's chunks are tagged with
  a `bot_id` payload filter so searches are always scoped per-business.
- **OpenRouter** provides the LLM. The backend calls it over HTTP for
  embeddings, chat completions, and (for images) vision descriptions.

For local development, `docker-compose.yml` runs all four services at once:
`qdrant`, `redis`, `backend`, `frontend`.

## 4. Multi-Tenancy Model

There is one set of database tables, partitioned by `bot_id`:

- `bots` — one row per chatbot, owned by a `user_id` (the owner).
- `knowledge_sources` — files/websites/Q&A attached to a bot.
- `conversations` — one row per chat session, attached to a bot.
- `messages` — individual messages, attached to a conversation (and transitively a bot).
- `feedback` — thumbs up/down and comments on conversations.

The vector store mirrors this: the `knowledge_chunks` collection holds every
chunk from every bot, but every point is tagged with `bot_id`. Searches always
filter on `bot_id`, so a business never sees another business's knowledge.

## 5. Request Lifespan (one chat turn)

This is the core loop, repeated for every message a customer sends:

```
1.  Customer sends a message to  POST /api/v1/chat/:botSlug
2.  Go looks up the bot by its slug and reads its system prompt.
3.  Go generates an embedding of the user's message (OpenRouter embeddings).
4.  Go searches Qdrant for the 5 most relevant knowledge chunks (filter: bot_id).
5.  Go loads the last 10 messages of this conversation from Supabase (history).
6.  Go assembles a single prompt:
        [system prompt] + [retrieved context] + [recent history] + [new message]
7.  Go sends the prompt to OpenRouter chat completion.
8.  The LLM returns the answer (streamed or one-shot).
9.  Go streams/sends the answer back to the browser and saves both messages.
```

Each step is handled by Go **synchronously per request** (one turn = one HTTP
request = one LLM call). See `docs/BACKEND_GO.md` and `docs/LLM_AND_RAG.md`.

## 6. Data Flow for Training (How the bot "learns")

```
Owner uploads a PDF / image / website / types Q&A
      │
      ▼
Go extracts text (PDF → text, image → vision model describes it, scrape → HTML stripped)
      │
      ▼
Go splits text into overlapping chunks (ChunkText, ~500 chars)
      │
      ▼
Go embeds each chunk with OpenRouter embeddings (1536-dim)
      │
      ▼
Go upserts each (chunk text + embedding + bot_id) into Qdrant
      │
      ▼
Go records the source (name, type, chunk count) in Supabase
```

The bot has *no persistent memory* of training beyond these vector chunks and
the system prompt the owner writes. Retrieval-augmented generation (RAG) is what
makes the bot "know" the training data at chat time.

## 7. Boundaries & Responsibilities

| Component owns | Lives in |
|---|---|
| Serving pages, capturing voice, rendering chat | `web/src/` (Next.js) |
| Routing, auth, validating payloads | `backend/internal/middleware`, `backend/internal/handlers` |
| Per-turn orchestration (embed → search → generate) | `backend/internal/handlers/chat.go` |
| Knowledge ingestion (files, scraping, Q&A, vision) | `backend/internal/handlers/knowledge.go` |
| Bot CRUD + shareable-link plumbing | `backend/internal/handlers/bot.go` |
| Talking to Supabase, Qdrant, OpenRouter | `internal/supabase/client.go`, `internal/qdrant/client.go`, `internal/utils/utils.go` |
| Configuration (models, keys, limits) | `internal/config/config.go` |
| Container definitions for local dev | `docker-compose.yml`, `backend/Dockerfile`, `web/Dockerfile` |

## 8. Design Principles

1. **Voice-first, complexity-hidden.** The owner should never see "embedding,"
   "vector," or "endpoint." They speak. The README and docs describe how that
   simplicity is implemented, not how it is marketed.
2. **Per-turn processing.** Go handles one conversation turn per HTTP request.
   No long-lived agent sessions in the backend — this keeps hosting cheap and
   scaling simple on Railway / a free-tier.
3. **Isolation by default.** Every query is scoped to a `bot_id`. A bug in
   scoping would leak data between businesses, so filters are applied in the
   Go layer, not trusted to the client.
4. **Free-tier friendly.** Everything is wired to OpenRouter free models by
   default; the owner of a business does not pay per-message for the platform to
   run.
5. **No vendor lock-in for infra.** Each external service (Supabase, Qdrant,
   OpenRouter) is reached through a thin HTTP client, so swapping providers
   only touches one file per service.
