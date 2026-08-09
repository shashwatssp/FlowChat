# Frontend — Next.js (App Router)

This document explains how the **Next.js frontend** delivers FlowChat's two faces:
the **landing / owner experience** and the **customer chat experience** — including
the voice entry point.

## 1. Tech Stack

| Package | Why it's used |
|---|---|
| **Next.js 14 (App Router)** | Server-rendered pages for SEO (landing page) + client components for the interactive chat. |
| **TypeScript** | Type safety across the API client and components. |
| **Tailwind CSS** | Utility-first styling; the brand color `primary-600` is the chat/action color. |
| **Zustand** | Tiny client-side store for auth state and the current bot (no Context re-renders). |
| **Axios** | Typed HTTP client that talks to the Go backend (`/api/v1`). |
| **react-markdown** | Renders the assistant's replies (so the LLM can return formatted text). |
| **lucide-react** | Icons (send, paperclip, bot, message square, etc.). |
| **react-hot-toast** | Non-blocking success/error notifications. |

## 2. Routing Map

Built with the Next.js App Router (`web/src/app/`):

```
/                          landing page (hero, features, CTA)
/login                     sign-in form
/register                  sign-up form
/dashboard                 owner's bot list + "create bot" modal
/dashboard/bot/[id]        bot management (tabs: Settings / Knowledge / Conversations)
/chat/[slug]               the PUBLIC, shareable chat page the customer opens
```

- `/dashboard/bot/[id]` is where an owner **trains** a bot:
  - **Settings tab** — edit the bot name, description, avatar, and system prompt; view stats.
  - **Knowledge tab** — upload files, scrape a website, view and delete sources.
  - **Conversations tab** — browse conversations, read messages, leave feedback.
- `/chat/[slug]` is the **customer-facing** surface. It takes the bot's slug from
  the URL, so the owner literally hands out `chat.flowchat.app/your-store`.

## 3. The Chat Page — `/chat/[slug]`

`web/src/app/chat/[slug]/page.tsx` is the entry point for every customer. It:

1. Reads the `slug` from the URL.
2. Renders a header (bot avatar + name).
3. Mounts `<ChatInterface botSlug={slug} />`.

`ChatInterface` (`src/components/chat/ChatInterface.tsx`) is the brain of the
front-stage chat:

- Holds local state: `messages`, `input`, `loading`, `conversationId`, `sources`.
- On send, calls `chatApi.chat(botSlug, message, conversationId)` from the API
  client (`src/lib/api.ts`).
- On success, appends the assistant's reply and updates `sources` (the chunks
  the backend retrieved — shown so the owner can trust the answer).
- On error, shows a friendly message and a toast.

`ChatInput` (`src/components/chat/ChatInput.tsx`) renders the textarea, the
**send** button, the **mic** button, and the **Volume2** voice-mode toggle. The
mic captures speech via the browser's `SpeechRecognition` (Web Speech API) and
inserts the transcript at the cursor position for review before sending; the
Volume2 toggle controls automatic text-to-speech (TTS) for bot replies. File
uploads are handled through the **Knowledge tab** in the dashboard
(`/dashboard/bot/[id]`), not inline in the chat — the input stays focused on
voice and text entry.

> **Voice entry.** The product's voice experience lives in this chat view and in
> the dashboard Knowledge tab: the mic captures speech via the browser's Web
> Speech API (`SpeechRecognition`) and produces text the user can edit before it
> is sent. The backend is agnostic to how the text arrives — it just receives the
> transcribed message text.

## 4. The API Client — `src/lib/api.ts`

A thin Axios wrapper with typed methods grouped by domain:

- **`authApi`** — `register`, `login`, `oauth` (returns the Supabase redirect URL).
- **`botApi`** — `create`, `list`, `get`, `update`, `getPublic` (slug-based, for chat).
- **`knowledgeApi`** — `uploadFile`, `scrapeWebsite`, `suggestQuestions`, `saveQA`,
  `listSources`, `deleteSource`, plus conversation/feedback reads.
- **`chatApi`** — `chat(slug, message, conversationId)`. This is the single call a
  customer's chat turn makes; it hits `POST /api/v1/chat/:botSlug` and returns
  `{ response, conversation_id, sources }`.

The client reads `NEXT_PUBLIC_API_URL` from the environment and attaches the
owner's JWT (`Authorization: Bearer ...`) to owner routes. The **chat call is
public** — no token required — which is what lets a shareable link work without
the customer signing in.

## 5. State Management (Zustand)

- Auth state (access token, current user) and the selected bot are kept in a
  small Zustand store so components re-render only when the relevant slice
  changes — keeping the chat view snappy while typing/streaming.

## 6. Landing Page & First Impression

`web/src/app/page.tsx` is a static, server-rendered marketing page with:
- Hero ("Create Your Own AI Chatbot"),
- A 3-step "How It Works" explainer (Upload → Get Link → Embed),
- A "Perfect For" grid of use cases,
- CTAs that route to `/register`.

This is the page the owner lands on after hearing about FlowChat — it must look
*finished* and trustworthy before they hand over their business details.

## 7. Styling

- Tailwind config (`tailwind.config.ts`) defines the `primary` palette.
- `globals.css` + `layout.tsx` set the base font, background, and the root
  client-layout provider (toasts, etc.).

## 8. Building the Embeddable Widget

The backend serves a small JS snippet at `GET /api/v1/widget/:botID` (see
`bot.go` → `WidgetHandler`). The long-term plan is for the same Next.js
frontend to **also compile a standalone widget bundle** that the snippet loads
from a CDN, so any website can embed the chat window with one `<script>` tag.
`web/Dockerfile` is set up to produce the static build that gets served.

## 9. Developer Experience

```bash
cd web
cp .env.example .env.local     # NEXT_PUBLIC_API_URL=http://localhost:8080/api/v1
npm install
npm run dev                      # http://localhost:3000
npm run build                    # production build
```

The frontend is a pure static build — it holds no secrets. All keys/tokens live
on the Go backend, which is exactly how a shareable, no-login chat link stays
safe.
