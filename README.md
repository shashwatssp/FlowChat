# ChatFlow - Personal AI Assistant Platform

Build custom AI chatbots with your own knowledge base. Share them with a link or embed on your website.

## Features

- 🤖 **Custom AI Chatbots** - Create bots with your own knowledge base
- 📄 **Knowledge Ingestion** - Upload documents, PDFs, or scrape websites
- 🔗 **Shareable Links** - Get unique chat URLs that anyone can access
- 💬 **Embeddable Widget** - Add to any website with one line of code
- 🔌 **REST API** - Integrate with your applications
- 📊 **Analytics Dashboard** - Track usage and conversations
- 🎯 **Self-Learning** - Improve responses through feedback

## Tech Stack

### Backend
- **Go** - High-performance API server
- **Gin** - Fast HTTP router
- **Supabase** - PostgreSQL database + Auth
- **Qdrant** - Vector database for semantic search
- **OpenRouter** - LLM API (free models)

### Frontend
- **Next.js 14** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Axios** - HTTP client

## Architecture

```
Users --> [Vercel: Next.js] --> [Railway: Go Backend]
                   |
    [Supabase DB] [Qdrant Vector]
                   |
    [OpenRouter API] --> LLM Processing
```

## Getting Started

### Prerequisites
- Go 1.22+
- Node.js 18+
- Supabase account
- Qdrant Cloud account
- OpenRouter API key

### Backend Setup

```bash
cd backend

# Install dependencies
go mod download

# Copy environment file
cp .env.example .env

# Edit .env with your credentials
# SUPABASE_URL=your-supabase-url
# SUPABASE_KEY=your-supabase-key
# QDRANT_URL=your-qdrant-url
# QDRANT_API_KEY=your-qdrant-key
# OPENROUTER_API_KEY=your-openrouter-key
# JWT_SECRET=your-secret-key

# Run the server
go run cmd/server/main.go
```

### Frontend Setup

```bash
cd web

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Edit .env.local
# NEXT_PUBLIC_API_URL=http://localhost:8080/api/v1

# Run development server
npm run dev
```

## API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login user
- `POST /api/v1/auth/oauth/:provider` - OAuth login

### Bots
- `POST /api/v1/bots` - Create bot
- `GET /api/v1/bots` - List user's bots
- `GET /api/v1/bots/:id` - Get bot details
- `PUT /api/v1/bots/:id` - Update bot
- `DELETE /api/v1/bots/:id` - Delete bot

### Knowledge
- `POST /api/v1/knowledge/upload` - Upload file
- `POST /api/v1/knowledge/scrape` - Scrape website
- `GET /api/v1/knowledge/:botId` - List sources
- `DELETE /api/v1/knowledge/:sourceId` - Delete source

### Chat
- `POST /api/v1/chat/:botSlug` - Chat with bot

## Deployment

### Backend (Railway)
1. Connect your GitHub repo to Railway
2. Set root directory to `backend`
3. Add environment variables
4. Deploy

### Frontend (Vercel)
1. Connect your GitHub repo to Vercel
2. Set root directory to `web`
3. Add environment variables
4. Deploy

## Environment Variables

### Backend
```env
PORT=8080
ENV=development
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-anon-key
SUPABASE_SERVICE_KEY=your-supabase-service-key
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=your-qdrant-key
OPENROUTER_API_KEY=sk-or-v1-your-key
JWT_SECRET=your-super-secret-key
ALLOWED_ORIGINS=http://localhost:3000,https://chat.chatflow.app
RATE_LIMIT_PER_MINUTE=60
MAX_KNOWLEDGE_SIZE_MB=10
CHUNK_SIZE=500
CHUNK_OVERLAP=50
```

### Frontend
```env
NEXT_PUBLIC_API_URL=http://localhost:8080/api/v1
```

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Support

For support, please open an issue on GitHub.