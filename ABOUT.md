# Earthscape Chat

A multimodal AI chat application with advanced agent orchestration, built on the [Vercel AI Chatbot](https://vercel.com/templates/next.js/chatbot) starter and significantly extended for the [Model.earth](https://model.earth) open-source community.

[Model.earth CodeChat](https://modelearth.vercel.app) - [Repos in our codechat](https://model.earth/codechat/) - [Earthscape Chat](https://earthscape.vercel.app)

[About original Vercel Chat Starter](https://vercel.com/templates/next.js/chatbot) - [Vercel original GitHub](https://github.com/vercel/ai-chatbot)

---

## Enhancements Beyond the Vercel Starter

**[RAG Ingestion](ingestion/)** — Indexes GitHub submodule content into Pinecone using Voyage AI embeddings. At chat time, the most relevant code and documentation snippets are retrieved and injected into the prompt automatically. Includes a timing panel showing RAG and LLM latency per request.

**[API Key Management](keys/)** — A custom browser-based key manager that encrypts keys at rest using AES-GCM (non-extractable key in IndexedDB). Supports pasting keys from a `.env` file in bulk, revealing keys in a time-limited window for copying to another machine, and per-provider validation. Works as an embeddable vanilla JS widget with no build step.

**GitHub Repo Selection** — Users can select which GitHub repository provides context for the current conversation. Filters RAG results and scopes GitHub MCP tool calls to the chosen repo.

**Multi-Provider Support** — Google Gemini, Anthropic Claude, OpenAI GPT, xAI Grok, Groq, Mistral, Perplexity, DeepSeek, Together AI, and Fireworks — all from one interface with per-provider browser-stored keys.

**BetterAuth** — Replaced Auth.js with [BetterAuth](https://better-auth.com) for email/password and social login (Google, GitHub, LinkedIn, Microsoft, Discord, Facebook).

**Contributor Deployments** — Each contributor runs their own Vercel + Supabase instance. See [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) for setup instructions.