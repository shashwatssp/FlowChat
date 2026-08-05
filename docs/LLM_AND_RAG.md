# LLM Usage & RAG

This document explains how FlowChat uses the LLM (via OpenRouter) and how
**Retrieval-Augmented Generation (RAG)** makes each bot answer from *its own*
knowledge — not from the model's general training data.

## 1. The LLM Provider: OpenRouter

All LLM calls go through one place: `internal/utils/utils.go` →
`OpenRouterClient`. It is a small HTTP client over the **OpenAI-compatible**
endpoint, which OpenRouter implements at `https://openrouter.ai/api/v1`
(overridable via `LLM_BASE_URL`).

The client is **model-agnostic** — which model runs is chosen entirely by
environment variables in `internal/config/config.go`:

| Variable | Purpose | Default |
|---|---|---|
| `LLM_CHAT_MODEL` | Generative model that writes replies | `nvidia/llama-3.1-nemotron-ultra-253b:free` |
| `LLM_EMBEDDING_MODEL` | Embedding model (vectors for search) | `openai/text-embedding-3-small` |
| `LLM_QUESTION_MODEL` | Generates suggested FAQ questions | `google/gemini-2.0-flash:free` |
| `LLM_VISION_MODEL` | Reads/describes images | `google/gemini-2.0-flash:free` |

The defaults are all **free-tier** OpenRouter models, keeping the platform
cost-free for small businesses.

> **Agent SDK?** FlowChat does **not** use an agent SDK (e.g. LangChain,
> OpenAI Agents SDK, or similar). Instead it makes direct HTTP calls to
> OpenRouter's chat/embeddings endpoints. This is deliberate: the product is
> per-turn (one message → one LLM call), not an autonomous multi-step agent.
> A thin HTTP client is simpler, cheaper to host, and faster to debug. The
> "agent" here is the orchestration logic in `chat.go` that fetches context and
> assembles the prompt — it calls a model, it doesn't loop. If a future use case
> needs multi-step reasoning, the `Tools` field in `ChatRequest` is already
> present and ready for tool-use payloads.

## 2. The Three Kinds of LLM Calls

### 2.1 Embeddings — turning text into vectors
`GenerateEmbeddings(ctx, texts)` POSTs to `/embeddings` and returns `[][]float32`
(vectors). These vectors are what powers **everything semantic**:

- Training: every knowledge chunk is embedded here and stored in Qdrant.
- Chat: the customer's message is embedded here and used to search Qdrant.

The default embedding model (`text-embedding-3-small`) produces **1536-dim**
vectors, which matches the `knowledge_chunks` collection dimension wired up at
startup in `qdrant.client.go` (`InitializeCollections`).

### 2.2 Chat completions — the actual reply
`GenerateChat(ctx, req)` POSTs to `/chat/completions` with a list of
`{role, content}` messages and returns the model's full reply.
`GenerateChatStream` does the same with `stream: true` and returns a streamed
`io.ReadCloser` of Server-Sent Events.

The prompt is assembled as:
```
[system: bot's system prompt or default persona]
[system: "Use the following context..." + retrieved chunks]
[history: recent customer/assistant turns]
[user: the new message]
```

### 2.3 Vision — reading images like a price board
`GenerateImageDescription(ctx, imageBytes, mimeType, model)` sends an image
(base64) plus a text instruction to a **vision model** (default
`gemini-2.0-flash:free`). This is used in two places:

- **Knowledge upload of images** (`knowledge.go` → `UploadFile`): a shopkeeper
  uploads a photo of today's price board; the vision model describes it, and
  that description becomes searchable text.
- The description is then chunked, embedded, and stored in Qdrant — so the bot
  "saw" the price board when it answers.

## 3. Retrieval-Augmented Generation (RAG) — the core

RAG is the reason the bot knows *your* stuff. The flow lives in
`handlers/chat.go` → `Chat`:

### Step 1 — Embed the query
```go
embedder := utils.NewOpenRouterClient(...).WithEmbeddingModel(h.embeddingModel)
queryEmbeddings, err := embedder.GenerateEmbeddings(ctx, []string{req.Message})
```
The customer's single message becomes a 1536-dim vector.

### Step 2 — Search Qdrant (scoped to this bot)
```go
searchResults, err = h.qdrantClient.Search(ctx, "knowledge_chunks",
    queryEmbeddings[0], 5, map[string]interface{}{"bot_id": botID})
```
Qdrant finds the **5 most similar** chunks to the user's question — but only
among chunks tagged with **this bot's `bot_id`**. This is the isolation point:
one business's FAQ never returns another business's data.

### Step 3 — Build context + assemble prompt
The top-5 chunks are concatenated into a context block and inserted as a
`system` message ("Use the following context to answer..."). Recent conversation
history (last 10 messages from Supabase) is appended, then the new user message.

### Step 4 — Generate
The assembled message list is sent to `GenerateChat`. The model answers from the
provided context. If an answer isn't in the context, the system prompt tells the
bot to say so honestly.

### Why RAG and not just "fine-tune on my data"?
- **Cheap:** no per-training re-runs; adding a new PDF just adds chunks.
- **Fresh:** the bot always reasons over the *current* knowledge base.
- **Citable:** each returned chunk is a "source" sent back to the frontend, so
  the customer can see *why* the bot said something.

## 4. Graceful Degradation

The platform is built to keep working when an upstream piece is down:

- **If embeddings fail** (e.g. the chosen model has no embedding endpoint): the
  chat handler logs a warning and **still answers** from the system prompt — no
  retrieval, but no 500 either.
- **If Qdrant search fails**: `searchResults` becomes empty, the prompt is sent
  with no context, and the model answers from the system prompt + history.
- **If the chat model call fails**: the handler returns a 500 with a clear error
  message; the frontend shows a friendly toast.

This is why a small business owner never sees a confusing crash — the bot falls
back to a "I don't have that in my notes, but…" style answer.

## 5. The Training Pipeline (where RAG's knowledge comes from)

Training is just "feed Qdrant." All ingestion paths do the **same thing**:

```
input (file / URL / typed)  →  extract text
                              →  chunk (utils.ChunkText, ~500 chars, 50 overlap)
                              →  embed (GenerateEmbeddings)
                              →  upsert into Qdrant knowledge_chunks (tagged bot_id)
                              →  record source in Supabase knowledge_sources
```

- **Files** (`UploadFile`): PDFs, docs, spreadsheets → raw text; images →
  vision description.
- **Websites** (`ScrapeWebsite`): fetch URL, strip HTML, same pipeline.
- **Q&A** (`SaveQA`): owner-typed "question → answer" pairs, formatted as
  `Q: … A: …`, same pipeline.
- **Suggested FAQs** (`SuggestQuestions`): an LLM call that proposes likely
  customer questions from the business name/description — the owner then fills
  in answers (which feed back into the Q&A path).

## 6. Prompt Shaping

- The **system prompt** is authored by the owner in the dashboard (bot settings)
  and stored on the `bots` row. It defines the bot's persona/role.
- If an owner leaves the system prompt blank, the backend synthesizes one:
  `"You are <bot name>, a helpful AI assistant…"` so the bot always has context.
- The **retrieved context** is injected as a separate system message so it is
  treated as authoritative grounding, not conversation history.

## 7. Streaming

When the frontend requests `stream: true`, the backend calls
`GenerateChatStream` and relays OpenRouter's SSE chunks directly to the client
with `Content-Type: text/event-stream`. The client renders tokens as they
arrive, giving the feel of a real-time assistant. Messages are persisted
asynchronously after the stream completes.

## 8. Costs & Quotas

Because everything uses free-tier OpenRouter models:
- **Embeddings** are the cheapest operation and scale with how much text you
  train on (not with chat volume) — one-time cost per upload.
- **Chat** costs scale with conversation length (history is re-sent each turn).
- **Vision** is the most expensive call — used only on image uploads, not per
  chat turn.

Chunking (`CHUNK_SIZE=500`, `CHUNK_OVERLAP=50`) and top-K retrieval (`k=5`)
are tuned to balance answer quality against token cost.
