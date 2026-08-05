# Database Schema

The source of truth is `supabase/schema.sql`. This document explains the tables,
their relationships, and how Row-Level Security (RLS) keeps each business's data
isolated.

## At a Glance

```
users ──< bots ──< conversations ──< messages
              │            │
              │            └──< feedback
              │
              └──< knowledge_sources
                    (vectors live in Qdrant, NOT here)
```

- The Go backend reads/writes these tables through Supabase's **PostgREST REST
  API** and validates sessions through **GoTrue** (`/auth/v1/user`).
- The actual *knowledge text vectors* are **not** in Postgres — they live in
  Qdrant's `knowledge_chunks` collection. Postgres only stores the *metadata*
  about a source (name, type, chunk count, status).

## Tables

### `users`
Profile rows auto-created by the `on_auth_user_created` trigger when a user
signs up via GoTrue.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | FK → `auth.users` (Supabase Auth user) |
| `email` | `text` | unique |
| `full_name` | `text` | from signup metadata |
| `avatar_url` | `text` | from signup metadata |
| `created_at` / `updated_at` | `timestamptz` | auto |

**RLS:** users can view/update only their own profile (`auth.uid() = id`).

### `bots`
One row per chatbot. This is the heart of the product.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | primary key |
| `user_id` | `uuid` | FK → `users` — the owner |
| `name` | `text` | e.g. "Sharma's General Store" |
| `description` | `text` | shown on the public chat link |
| `slug` | `text` | **unique**, URL-friendly handle (`your-store`) |
| `avatar_url` | `text` | bot avatar |
| `system_prompt` | `text` | the owner's persona instructions |
| `api_key` | `text` | **unique**, per-bot secret for programmatic/widget access |
| `usage_count` | `bigint` | incremented via `increment_bot_usage` RPC on each chat turn |
| `created_at` / `updated_at` | `timestamptz` | auto |

**Indexes:** `idx_bots_user_id`, `idx_bots_slug`, `idx_bots_api_key`.

**RLS:** the owner can CRUD only their own bots (`user_id = auth.uid()`). The
backend uses the **service role key** (`InsertReturning`, `RPC`) to bypass RLS
for writes like creating a bot or incrementing usage, since the owner is acting
through the backend, not directly against their own RLS scope.

### `conversations`
One row per chat session on a bot.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | primary key (the `conversation_id` the frontend reuses) |
| `bot_id` | `uuid` | FK → `bots` |
| `user_id` | `uuid` | FK → `users` (nullable — public, no-login customers) |
| `started_at` | `timestamptz` | first message time |
| `last_message_at` | `timestamptz` | used for ordering "recent conversations" |

**RLS:** owners can view/create conversations for bots they own.

### `messages`
Every `user`, `assistant`, and `system` message in a conversation.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | primary key |
| `conversation_id` | `uuid` | FK → `conversations` |
| `bot_id` | `uuid` | FK → `bots` (denormalized for fast queries) |
| `role` | `text` | check `in ('user','assistant','system')` |
| `content` | `text` | the message text |
| `created_at` | `timestamptz` | for ordering history |

**RLS:** owners can view messages for conversations of bots they own. Inserts
are allowed for the system (`with check (true)`), because the backend writes
both user and assistant messages.

### `knowledge_sources`
Metadata about each training source (file / website / Q&A set).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | primary key |
| `bot_id` | `uuid` | FK → `bots` |
| `name` | `text` | filename or URL |
| `type` | `text` | `file_upload \| web_scraping \| image \| qa_pairs` |
| `url` | `text` | for scraped sites |
| `status` | `text` | `pending \| processing \| processed \| failed` |
| `chunk_count` | `integer` | how many vectors were stored |
| `created_at` | `timestamptz` | |

**RLS:** owners can manage sources for their own bots.

### `feedback`
Thumbs up/down + optional comment on a conversation.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | primary key |
| `conversation_id` | `uuid` | FK → `conversations` |
| `helpful` | `boolean` | |
| `rating` | `integer` | 1–5 |
| `comment` | `text` | |
| `created_at` | `timestamptz` | |

### `increment_bot_usage(bot_id uuid)`
A Postgres function that atomically bumps `bots.usage_count`. Called by the
backend via `From("bots").RPC("increment_bot_usage", ...)` after each successful
chat turn (see `chat.go` → `updateBotUsage`).

## What Lives Where (Postgres vs Qdrant)

| Concern | Stored in |
|---|---|
| Users, bots, conversations, messages, feedback, source metadata | **Supabase / PostgreSQL** |
| Knowledge text vectors (the things RAG searches) | **Qdrant** (`knowledge_chunks`) |
| The model that generated a reply | (not stored) — replies are in `messages.content` |

This split is intentional: Qdrant is optimized for vector similarity search,
Postgres is optimized for relational/ownership queries. The `bot_id` payload on
every Qdrant point is the bridge that keeps each bot's vectors isolated.

## Notes on the Current Schema (`fix_schema.py`)

There is a `fix_schema.py` script alongside the repo that applies targeted
migrations (e.g. it ensures `SUPABASE_SERVICE_KEY` is wired and RLS is sane).
When standing up a fresh Supabase project, run the schema first, then the
fix script if recommended.
