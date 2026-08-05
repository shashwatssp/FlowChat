# API Reference

All endpoints live under `/api/v1` (the backend listens on `:8080` by default).
The frontend points at `NEXT_PUBLIC_API_URL=http://localhost:8080/api/v1`.

Two audiences hit the API:
- **The owner** (browser dashboard) — authenticated with a **JWT**.
- **The customer** (shared chat link) — **no auth**; the bot is identified by
  its slug.

---

## 1. Authentication

The backend delegates auth to Supabase GoTrue. It does **not** issue its own
passwords — it forwards sign-in/sign-up calls to Supabase and validates sessions
server-side.

### Register
```
POST /api/v1/auth/register
Content-Type: application/json
{
  "email": "owner@example.com",
  "password": "secret123",
  "data": { "display_name": "Sharma's Store" }   // optional metadata
}
```
`200 { "message": "User registered successfully", "user_id": "<uuid>" }`

### Login
```
POST /api/v1/auth/login
{ "email": "owner@example.com", "password": "secret123" }
```
`200 { "message": "login successful", "access_token": "<supabase-jwt>" }`

> The returned JWT is what the owner sends as `Authorization: Bearer <token>`
> on protected routes. The backend validates it against
> `https://<supabase>/auth/v1/user` (not by decoding the JWT locally), so
> revoked sessions are honored immediately.

### OAuth (Redirect-style)
```
POST /api/v1/auth/oauth/:provider     // provider ∈ {google, github, azure, discord}
?redirect=https://your-app.com/callback
```
`200 { "url": "https://<supabase>/auth/v1/authorize?provider=google&redirect_to=…" }`

The frontend opens that URL to start the provider sign-in, then receives the
Supabase token back on the redirect target.

---

## 2. Public Access (no login needed)

These power the shareable link and the embeddable widget.

### Chat with a bot (by slug)
```
POST /api/v1/chat/:botSlug
Content-Type: application/json
{
  "message": "What time do you open?",
  "conversation_id": "<optional; omit for a new conversation>",
  "stream": false
}
```
`200`
```json
{
  "response": "We open at 9 AM every morning, including Sundays.",
  "conversation_id": "a1b2c3…",
  "sources": [
    { "content": "...", "score": 0.82, "name": "store-hours.pdf" }
  ]
}
```
With `stream: true`, the response is `text/event-stream`; each event is a
chunk of the assistant's reply, followed by a final event carrying
`conversation_id` + `sources`.

> The customer only needs the bot's **slug** (the `<your-store>` part of the
> share link). The bot's `api_key` is **not** required to chat by slug — the
> slug alone identifies the bot and scopes the RAG search.

### Public bot info (for the chat page header)
```
GET /api/v1/bots/public/:slug
```
`200 { id, name, description, slug, avatar_url, usage_count, created_at }`

### Embeddable widget snippet
```
GET /api/v1/widget/:botID
Content-Type: text/javascript
```
Returns a short bootstrap script that loads `https://cdn.flowchat.app/widget-v1.js`
and initializes `window.FlowChatWidget` with the bot id.

---

## 3. Owner Routes (JWT required)

Protected by the `JWTAuth` middleware. Send `Authorization: Bearer <jwt>`.

### Bots
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/bots` | Create a bot. Body: `{ name, description?, avatar_url?, system_prompt? }`. Returns `{ id, slug, api_key, … }`. |
| GET | `/api/v1/bots` | List the owner's bots. |
| GET | `/api/v1/bots/:botID` | Get one bot. |
| PUT | `/api/v1/bots/:botID` | Update name/description/avatar/system prompt. |
| DELETE | `/api/v1/bots/:botID` | Delete a bot. |
| GET | `/api/v1/bots/:botID/stats` | `{ total_conversations, total_messages, knowledge_sources }`. |

Each bot is created with a random `api_key` (`utils.GenerateAPIKey`, 32 bytes
hex) and a slug (`utils.GenerateSlug` from the name).

### Knowledge (train the bot)
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/knowledge/upload` | Upload a file (`multipart/form-data`, field `file` + `bot_id`). |
| POST | `/api/v1/knowledge/scrape` | Scrape a URL. Body: `{ bot_id, url, sitemap? }`. |
| POST | `/api/v1/knowledge/suggest-questions` | Generate FAQs. Body: `{ name, description }`. Returns `{ questions: [] }`. |
| POST | `/api/v1/knowledge/qa` | Save Q&A pairs. Body: `{ bot_id, qa_pairs:[{question,answer}] }`. |
| GET | `/api/v1/knowledge/:botID` | List knowledge sources for a bot. |
| DELETE | `/api/v1/knowledge/:sourceID` | Remove a source. |

All four write paths run the **same ingestion pipeline**:
text → `utils.ChunkText` → `GenerateEmbeddings` → Qdrant `UpsertPoints` →
Supabase `knowledge_sources` metadata row.

### Conversations (review what happened)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/conversations/:botID` | List the bot's conversations. |
| GET | `/api/v1/conversations/:id/messages` | Get a conversation's messages. |
| POST | `/api/v1/conversations/:id/feedback` | `{ helpful, rating?, comment? }`. |

### Bot management
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/bots` | Create bot (JWT) |
| GET | `/api/v1/bots` | List owner's bots (JWT) |
| GET | `/api/v1/bots/:id` | Get bot (JWT) |
| PUT | `/api/v1/bots/:id` | Update bot (JWT) |
| GET | `/api/v1/bots/:id/stats` | Bot analytics (JWT) |

### Knowledge management
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/knowledge/upload` | Upload file (JWT) |
| POST | `/api/v1/knowledge/scrape` | Scrape website (JWT) |
| POST | `/api/v1/knowledge/suggest-questions` | Generate FAQ questions (JWT) |
| POST | `/api/v1/knowledge/qa` | Save Q&A pairs (JWT) |
| GET | `/api/v1/knowledge/:botID` | List sources (JWT) |
| DELETE | `/api/v1/knowledge/:sourceID` | Delete source (JWT) |

### Conversations
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/conversations/:botID` | List conversations (JWT) |
| GET | `/api/v1/conversations/:id/messages` | Get messages (JWT) |
| POST | `/api/v1/conversations/:id/feedback` | Save feedback (JWT) |

### Widget
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/widget/:botID` | Widget JS snippet (public) |

---

## 4. How a Call Flows End-to-End

### Customer chat turn
```
Browser POST /api/v1/chat/:botSlug { message, conversation_id?, stream }
  → chat.go:Chat
    1. look up bot by slug (Supabase)            → bot_id, system_prompt
    2. generate embedding of message (OpenRouter)
    3. search Qdrant knowledge_chunks (filter bot_id, k=5)
    4. load last 10 messages (Supabase)
    5. assemble prompt: system + context + history + message
    6. OpenRouter /chat/completions (stream or one-shot)
    7. return reply + sources to browser
    8. (async for stream) save user+assistant messages + increment usage
```

### Owner trains a bot
```
Dashboard POST /api/v1/knowledge/upload (multipart, bot_id, file)
  → knowledge.go:UploadFile
    1. validate extension
    2. read bytes → extract text (or vision-describe images)
    3. ChunkText → embeddings (OpenRouter)
    4. UpsertPoints to Qdrant (tagged bot_id)
    5. insert row in knowledge_sources (Supabase)
```

### Owner manages a bot
```
Dashboard GET  /api/v1/bots            (JWT)            → bot list
Dashboard PUT  /api/v1/bots/:id         (JWT, body)      → update
Dashboard GET  /api/v1/bots/:id/stats   (JWT)            → analytics
```

---

## 5. Auth Summary

| Audience | How they authenticate | Middleware |
|---|---|---|
| Owner | Supabase JWT (`access_token` from login/oauth) | `JWTAuth` |
| Customer | None — identified by bot slug in the URL | (none) |
| Programmatic (widget/future) | Per-bot `X-API-Key` header | `APIKeyMiddleware` |

---

## 6. Health Check

```
GET /health
```
`200 { "status": "ok", "service": "FlowChat API", "version": "1.0.0" }`

Useful for load balancers and uptime checks.

---

## 7. Local Ports

| Service | Port |
|---|---|
| Frontend (Next.js dev) | `3000` |
| Backend (Go) | `8080` |
| Qdrant | `6333` (REST), `6334` (gRPC, docker) |
| Redis | `6379` |
| Health | `8080/health` |
