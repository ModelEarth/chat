# Model.earth CodeChat

A multimodal AI chat application built on the [Vercel AI Chatbot](https://github.com/vercel/ai-chatbot) starter, significantly extended for the [Model.earth](https://model.earth) open-source community.

- [Live app](https://modelearth.vercel.app/chat) · [Key manager](https://modelearth.vercel.app/chat/keys/) · [RAG ingestion](ingestion/)
- [Original Vercel template](https://vercel.com/templates/next.js/chatbot) · [Vercel GitHub](https://github.com/vercel/ai-chatbot)

---

## Deploy Your Own

Deploy the chat app on its own:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FModelEarth%2Fchat&env=BETTER_AUTH_SECRET,POSTGRES_URL,NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,GOOGLE_GENERATIVE_AI_API_KEY&project-name=modelearth-chat)

Deploy the full ModelEarth webroot (builds from the `chat` submodule):

[![Deploy ModelEarth](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FModelEarth%2Fwebroot&root-directory=chat&env=BETTER_AUTH_SECRET,POSTGRES_URL,NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,GOOGLE_GENERATIVE_AI_API_KEY&project-name=modelearth-chat)

> **Note — Deploy ModelEarth is a work in progress.**
> Vercel clones the webroot repo without initializing git submodules, so `chat/` is empty at
> build time. A `vercel.json` at the webroot root with a custom install command
> (`git submodule update --init chat`) may resolve this once Vercel's build environment
> can authenticate submodule refs. Until resolved, use the **Deploy with Vercel** button
> above and follow [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md).

---

## What We Added

### API Key Management
A fully custom browser-based key manager (`/keys`) that stores API keys encrypted at rest using AES-GCM with a non-extractable browser key in IndexedDB — matching the same format used by the chat app. Features include:

- Add, remove, and validate keys per provider
- **Paste Keys** — paste multiple `KEY=value` lines from a `.env` file in one step
- **CopyMyKeys** — reveal decrypted keys in a time-limited window (5 / 20 / 60 min) for copying to another machine
- Server `.env` keys shown alongside browser keys with a `.env` badge
- Embeddable vanilla JS widget (no React, no build step) reusable across the webroot

### RAG — Retrieval-Augmented Generation
Semantic search over indexed GitHub repositories using Pinecone vector DB + Voyage AI embeddings:

- `ingestion/` pipeline indexes repo content as vector embeddings into Pinecone
- At chat time, the top matching code/doc snippets are retrieved and injected into the prompt
- RAG timing panel shows per-request latency (prompt received → RAG → LLM)
- Slow RAG (>8s) flagged in amber
- Configurable via `RAG_ENABLED`, `RAG_TOP_K`, `RAG_SCORE_THRESHOLD`, and other env vars

### GitHub Repo Selection Navigation
Users can select which GitHub repository to use as context for the current conversation. The selected repo filters RAG results and scopes GitHub MCP tool calls to the relevant codebase.

### Multi-Provider Support
Supports Google Gemini, Anthropic Claude, OpenAI GPT, xAI Grok, Groq, Mistral, Perplexity, DeepSeek, Together AI, and Fireworks — all from a single interface. Keys are stored per-provider in browser storage and sent per-request to the server.

### Authentication — BetterAuth
Replaced the original Auth.js with [BetterAuth](https://better-auth.com) for email/password login and social providers (Google, GitHub, LinkedIn, Microsoft, Discord, Facebook). Sessions use JWE cookie caching.

### Settings Page
Simplified settings UI that shows a summary of saved keys and links to the `/keys` page. No duplicate key entry — all key management is on `/keys`.

---

## Features (from Vercel starter, still present)

- [Next.js](https://nextjs.org) App Router with React Server Components
- [AI SDK](https://ai-sdk.dev) for unified LLM streaming across providers
- [shadcn/ui](https://ui.shadcn.com) + [Tailwind CSS](https://tailwindcss.com)
- [Drizzle ORM](https://orm.drizzle.team) + PostgreSQL (Supabase) for chat history
- Artifact system — text documents, Python code, Mermaid diagrams, spreadsheets
- Python code execution sandbox
- File and image attachments
- GitHub MCP (Model Context Protocol) integration

---

## Running Locally

From the `webroot` root directory:

```bash
node chat/server.mjs
```

| URL | What |
|---|---|
| http://localhost:8888/chat | Chat app |
| http://localhost:8888/chat/keys/ | Key manager |
| http://localhost:8888 | Static webroot pages |

See [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) for full setup instructions including Supabase and Vercel deployment.

---

## Environment Variables

See [`automation/.env.example`](../automation/.env.example) for a full reference of the variables. Your actual values live in the local env file that [`automation/paths.yaml`](../automation/paths.yaml) points at (see `automation/README.md`). Minimum required:

```
BETTER_AUTH_SECRET=          # 32+ char random string
BETTER_AUTH_BASE_URL=        # Your deployment URL
ALLOWED_ORIGINS=             # Comma-separated allowed origins
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
POSTGRES_URL=
GOOGLE_GENERATIVE_AI_API_KEY=
```

Optional for RAG:
```
RAG_ENABLED=true
PINECONE_API_KEY=
PINECONE_INDEX=
PINECONE_INDEX_HOST=
VOYAGE_API_KEY=
```

---

## Contributor Deployment

Each contributor runs their own personal Vercel + Supabase instance. See [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) for step-by-step instructions.
