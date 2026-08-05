# Backend — Go (Gin)

This document explains how the **Go backend** turns a user message into a
chatbot reply, one turn at a time. It is intentionally grounded in the actual
code under `backend/`.

## 1. Entry Point

`backend/cmd/server/main.go` is the only binary. It does, in order:

1. **Load configuration** from `backend/.env` (`internal/config/config.go`).
   This reads every `LLM_*`, `SUPABASE_*`, `QDRANT_*`, `JWT_SECRET`, etc.
   variable, with sensible defaults (e.g. free OpenRouter models).
2. **Initialize service clients:**
   - `supabase.NewClient(url, key, WithServiceKey(...))` — a custom HTTP
     client over Supabase's PostgREST + GoTrue APIs (see §3).
   - `qdrant.NewClient(url, apiKey)` — a custom HTTP client over Qdrant's
     REST API (see §3). It runs a health check on startup.
   - Qdrant collections are initialized idempotently (`knowledge_chunks`
     and `feedback_vectors`, 1536-dim, cosine distance).
3. **Wire handlers** with their dependencies:
   - `NewAuthHandler(supabase, jwtSecret, supabaseURL)`
   - `NewBotHandler(supabase, qdrant)`
   - `NewKnowledgeHandler(...)` — receives model names + chunk sizes.
   - `NewChatHandler(...)` — receives model names.
4. **Mount routes** under `/api/v1` (see `docs/API.md`).
5. **Listen** on `:$PORT` (default `8080`).

Go uses **Gin** as the HTTP router. The handler structs are plain Go structs
holding the service clients — no global state, which makes requests
independent and horizontally scalably (stateless binary).

## 2. Turn-Based Processing ("Turn TPC")

FlowChat was designed so that **each user message is handled as a self-contained
HTTP request (a single turn)** — there are no long-lived server-side sessions
and no background agent loop. This is sometimes called *turn processing*:

- The customer types (or speaks) one message.
- The browser POSTs it to `POST /api/v1/chat/:botSlug`.
- Go receives **one turn**, does everything for it (see §4), returns the answer,
  and forgets nothing because both messages are persisted to Supabase.
- The next message the customer sends is a brand-new HTTP request, but the
  handler rehydrates the prior conversation history from Supabase, so the bot
  still "remembers" the conversation.

Why this matters:

- **Cheap to scale.** Any instance of the binary can serve any turn; there is no
  sticky session or in-process memory to keep warm.
- **Cheap to host.** Works on a single Railway dyno / free-tier container.
- **Simple to reason about.** A turn is a function: `(bot, history, newMessage) → reply`.

The handler supports two response modes:
- **Non-streaming** (`stream: false`) — returns a single JSON reply.
- **Streaming** (`stream: true`) — returns Server-Sent Events (`text/event-stream`)
  so the reply appears token-by-token, like a real-time assistant.

Both modes run the exact same RAG pipeline; only the transport of the final
text differs.

## 3. Service Clients (Thin HTTP Wrappers)

FlowChat does **not** use heavy ORMs or generated SDKs for the external
services. Instead, each service gets a small Go HTTP client:

### Supabase client — `internal/supabase/client.go`
Implements Supabase's PostgREST REST API and GoTrue auth directly over HTTP.
It exposes a `QueryBuilder` pattern (`From(table).Select(...).Eq(...).Order(...).Execute(ctx)`)
that builds the `?select=...&col=eq.val&order=...` query string Supabase expects.

Key methods:
- `Auth().SignUp(...)` / `Auth().SignIn(...)` — calls `/auth/v1/signup` and
  `/auth/v1/token`.
- `GetUser(token)` — validates a session JWT against `/auth/v1/user` and
  returns the real user UUID.
- `From(table).InsertReturning(data)` — writes a row using the **service
  role key** (bypasses Row-Level Security) so the backend can insert bots and
  conversations regardless of the anon key's policies. This is why
  `SUPABASE_SERVICE_KEY` is required.
- `From(table).RPC("increment_bot_usage", ...)` — calls a Postgres
  stored procedure to bump a bot's usage counter atomically.

### Qdrant client — `internal/qdrant/client.go`
Wraps Qdrant's REST/HTTP API. Exposes:
- `InitializeCollections()` — creates `knowledge_chunks` (1536-dim, Cosine)
  if missing.
- `UpsertPoints(collection, points)` — inserts/ updates vector points. IDs are
  hashed from the chunk UUID (Qdrant v1 REST uses numeric or UUID IDs; the code
  hashes to a `uint64`).
- `Search(collection, vector, topK, filter)` — finds the `topK` most similar
  points. The `filter` is built as a PostgREST-style `must`/`match` payload
  filter so searches are **always scoped to a `bot_id`**.

### OpenRouter client — `internal/utils/utils.go`
A small HTTP client over the OpenAI-compatible endpoint
(`https://openrouter.ai/api/v1` by default; overridable via `LLM_BASE_URL`).
Exposes:
- `GenerateEmbeddings(ctx, texts)` → `[][]float32`
- `GenerateChat(ctx, req)` → single completion JSON
- `GenerateChatStream(ctx, req)` → streaming `io.ReadCloser` (SSE)
- `GenerateImageDescription(ctx, image, mime, model)` → vision model describes
  an image so it can be embedded as text.

### Config — `internal/config/config.go`
Centralizes all model choices and limits so nothing is hardcoded. Each model
is configurable:
- `LLM_CHAT_MODEL` — the generative model (default: `nvidia/llama-3.1-nemotron-ultra-253b:free`)
- `LLM_EMBEDDING_MODEL` — the embedding model (default: `openai/text-embedding-3-small`)
- `LLM_QUESTION_MODEL` — model for FAQ suggestion
- `LLM_VISION_MODEL` — model for image description

This means the platform can switch providers/models by editing environment
variables only — no code change.

## 4. The Chat Turn, Line by Line

In `handlers/chat.go` (`Chat` method) one turn does this:

1. **Resolve the bot** — `POST /chat/:botSlug` looks the bot up by `slug`,
   fetching its `id`, `name`, and `system_prompt`. If not found → 404.
2. **Get/create the conversation** — if the client supplied a `conversation_id`,
   reuse it; otherwise generate a 16-byte random ID and insert a row in
   `conversations`.
3. **Embed the user query** — call `GenerateEmbeddings` on the user's message.
   If the embedding provider is unavailable, the code **gracefully degrades**
   (logs a warning and answers from the system prompt only — no retrieval).
4. **Retrieve knowledge** — `qdrantClient.Search("knowledge_chunks", embedding, 5, {bot_id})`
   returns the 5 most relevant chunks from *this bot's* knowledge.
5. **Load history** — pull the last 10 messages from `messages` (ordered by
   `created_at desc`), then reverse them to chronological order.
6. **Assemble the prompt** as an ordered message list:
   - `system` → the bot's system prompt (or a generated default naming the bot)
   - `system` → the retrieved context ("Use the following context …")
   - `user/assistant` → recent conversation history
   - `user` → the new message
7. **Generate** — call OpenRouter chat completion (non-streaming returns the
   full text; streaming writes SSE `data:` lines and flushes to the client as
   they arrive).
8. **Persist** — save the user message and the assistant reply to `messages`,
   and call `RPC("increment_bot_usage", ...)` to bump the bot's usage counter.

## 5. Knowledge Ingestion (Training), Line by Line

In `handlers/knowledge.go`:

- **`UploadFile`** — validates the extension against the allowed set
  (`.txt/.pdf/.docx/.md/.csv/.json/.png/.jpg/.jpeg/.webp/.gif`). For images it
  calls the vision model (`GenerateImageDescription`) so a photo of a price
  board becomes readable text. For documents it reads the raw text. The text is
  then chunked (`utils.ChunkText`, ~500 chars with 50-char overlap), embedded,
  upserted into Qdrant (tagged `bot_id`), and its metadata stored in
  `knowledge_sources`.
- **`ScrapeWebsite`** — fetches a URL, strips HTML (`extractTextFromHTML`),
  chunks, embeds, upserts — same pipeline as file upload.
- **`SuggestQuestions`** — builds an LLM prompt from the business name +
  description and asks it to output a JSON array of likely customer FAQs.
- **`SaveQA`** — takes owner-written Q&A pairs, formats them as
  `Q: …\nA: …`, chunks, embeds, and stores them as knowledge (source name
  "Business FAQ").

## 6. Middleware & Security

- `JWTAuth` — extracts the `Authorization: Bearer <jwt>` header, calls
  Supabase `/auth/v1/user` to resolve and validate the session, and puts the
  real `userID` into the Gin context. This protects all owner routes.
- `APIKeyMiddleware` — validates an `X-API-Key` header against the `bots`
  table (per-bot API key) and resolves a `botID`. This is how the chat endpoint
  can be public while still knowing which bot is being addressed.

> Note: today the **chat endpoint is public by bot slug** (anyone with the link
> can chat, no API key needed), which matches the "share a link, anyone chats"
> product flow. The API-key middleware exists and is wired up in the router for
> use by the embeddable widget and future programmatic clients.

## 7. Routing (summary)

```
GET  /health                         → health check
POST /api/v1/auth/register|login     → auth (public)
POST /api/v1/auth/oauth/:provider    → OAuth URL (public)
POST /api/v1/chat/:botSlug           → chat turn (public, by link)
GET  /api/v1/bots/public/:slug       → public bot info (public)
GET  /api/v1/widget/:botID           → embeddable widget JS (public)

# --- JWT-protected (owner only) ---
POST /api/v1/bots                    → create bot
GET  /api/v1/bots                   → list owner's bots
GET  /api/v1/bots/:id               → get bot
PUT  /api/v1/bots/:id               → update bot
GET  /api/v1/bots/:id/stats         → bot analytics
POST /api/v1/knowledge/upload|scrape|suggest-questions|qa
GET  /api/v1/knowledge/:botID       → list sources
DELETE /api/v1/knowledge/:sourceID  → delete source
GET  /api/v1/conversations/:botID   → list conversations
GET  /api/v1/conversations/:id/messages
POST /api/v1/conversations/:id/feedback
```

The full reference lives in `docs/API.md`.

## 8. Concurrency Model

Go serves each HTTP request in its own goroutine (Gin + net/http). Because the
heavy work (LLM calls, Qdrant search) is I/O-bound HTTP, the goroutine mostly
blocks on network waits, and Go's scheduler multiplexes thousands of such
turns cheaply. The streaming path additionally uses a goroutine to persist
messages *after* the response stream is opened, so saving messages does not
delay the first token.

## 9. Observability

- `gin.Logger()` + `gin.Recovery()` are enabled, so every request is logged and
  panics return 500 instead of crashing the process.
- The chat handler logs explicit warnings when embeddings or search fail (so
  the bot degrades gracefully rather than 500-ing).
- The startup runs a Qdrant `HealthCheck` and logs a warning if Qdrant is
  unreachable.
