## Table of Contents

- [Project Overview](#projectoverview)
- [Quick Start Guide](#quickstartguide)
- [Tech Stack](#techstack)
- [System Architecture](#systemarchitecture)
- [How to Contribute](#howtocontribute)
- [Documentation Index](#documentationindex)

## Project Overview

Earthscape Chat is an extensible AI chatbot platform featuring:

- **Multi-Agent AI System**: Specialized agents for chat, document management, code execution, diagram generation, and GitHub integration
- **Multi-Provider Support**: Seamlessly integrate Google Gemini, OpenAI, and Anthropic Claude with dynamic model selection
- **Enterprise-Ready**: Comprehensive admin dashboard, usage tracking, rate limiting, and RBAC
- **Developer-Friendly**: Type-safe TypeScript, modern Next.js 15, comprehensive testing strategy, and detailed documentation
- **Secure by Default**: Row Level Security (RLS), Supabase Auth, client-side API key storage, and input validation

### Key Features

#### For Users
- 🤖 Multi-modal AI chat with support for text, images, PDFs, and file uploads
- 📄 Artifact generation (documents, Python code, Mermaid diagrams)
- 🔗 GitHub repository integration via Git MCP
- 🧠 Extended thinking mode for complex reasoning tasks
- 💾 Browser-based API key storage (localStorage)
- 📊 Personal usage analytics and chat history

#### For Admins
- ⚙️ **Admin Dashboard** - Configure all 6 specialized agents across multiple providers
- 📈 **Usage Analytics** - Track API calls, tokens, and costs across all users
- 👥 **User Management** - Role-Based Access Control with Supabase Auth
- 🔧 **Rate Limiting** - Per-agent rate limits (hourly/daily)
- 🎨 **System Prompts** - Customize AI behavior for each specialized agent
- 📊 **Logging & Monitoring** - Comprehensive activity, usage, and error logs


## Quick Start Guide

### Prerequisites

Before you begin, ensure you have:

- **Node.js 18+** and **pnpm** (or npm)
- **Supabase account** (free tier works)
- **Google AI API key** (for Gemini models)
- **GitHub Personal Access Token** (optional, for Git MCP integration)

### Setup Steps

#### 1b. Run in the webroot for full functionality



#### 1b. Or clone only the chat repository

```bash
git clone https://github.com/earthscape/chat.git
cd chat
pnpm install
```

#### 2. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Copy your project credentials from **Project Settings** → **API**:
   - Project URL
   - Anon Key (public)
   - Service Role Key (secret)
   - Database Password

#### 3. Configure Environment Variables

The application supports two configuration modes:

**Option A: Shared Configuration (Recommended for webroot setup)**

If you're using the [Model.Earth webroot structure](https://model.earth/webroot/), the application will automatically load environment variables from the local env file that `../automation/paths.yaml`'s `env_file:` key points at (see `automation/README.md` for how that's set). This allows centralized configuration across multiple projects.

**Option B: Local Configuration**

Create `.env` in project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://[YOUR-PROJECT].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[YOUR-ANON-KEY]
SUPABASE_SERVICE_ROLE_KEY=[YOUR-SERVICE-KEY]
POSTGRES_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

The application will automatically:
1. Resolve `../automation/paths.yaml`'s `env_file:` key and load that file first
2. Fall back to local `.env` if that file doesn't exist
3. Use system environment variables if no .env file is found

#### 4. Run Database Migrations

Apply the database schema to your Supabase project:

```bash
pnpm db:migrate
```

This creates all necessary tables, indexes, RLS policies, and seed data.

#### 5. Start Development Server

```bash
pnpm dev
```

Navigate to `http://localhost:3000`

#### 6. Create Admin User

1. Register at `http://localhost:3000/register`
2. Go to Supabase Dashboard → **Authentication** → **Users**
3. Find your user and click **Edit User**
4. Update `raw_user_meta_data`:
   ```json
   {
     "role": "admin",
     "isActive": true
   }
   ```
5. Save and access admin panel at `/admin`

### Using the Application

1. **Configure API Keys**: Go to Settings page and add your Google AI API key
2. **Start Chatting**: Create a new chat and select your preferred AI model
3. **Upload Files**: Drag and drop images, PDFs, or code files into the chat
4. **Connect GitHub**: Add GitHub PAT in Settings to browse and integrate repository context
5. **Enable Thinking Mode**: Toggle extended reasoning for complex problem-solving
6. **Access Admin Panel** (if admin): Configure agents, monitor usage, and manage users at `/admin`


## Tech Stack

### Frontend Technologies

| Category | Technology | Purpose |
|----------|-----------|---------|
| **Framework** | Next.js 15 (App Router) | React framework with server components |
| **Language** | TypeScript | Type-safe development |
| **UI Library** | React 19 | Component-based UI |
| **Styling** | Tailwind CSS | Utility-first CSS framework |
| **UI Components** | shadcn/ui, Radix UI | Accessible component library |
| **State Management** | React Context & Hooks | Client-side state management |
| **Real-time Updates** | Server-Sent Events (SSE) | Streaming AI responses |

### Backend Technologies

| Category | Technology | Purpose |
|----------|-----------|---------|
| **Runtime** | Node.js | JavaScript runtime |
| **API** | Next.js API Routes | Backend API endpoints |
| **Database** | PostgreSQL (Supabase) | Relational database |
| **ORM** | Drizzle ORM | Type-safe database queries |
| **Authentication** | Supabase Auth | User authentication and RBAC |
| **File Storage** | Vercel Blob Storage | File upload storage |

### AI Provider Integrations

| Provider | Models | Use Cases |
|----------|--------|-----------|
| **Google AI** | Gemini 2.0 Flash<br>Gemini 2.0 Flash Thinking<br>Gemini 1.5 Pro/Flash | Main chat interface<br>Extended reasoning<br>Multi-modal processing |
| **OpenAI** | GPT-4, GPT-4 Turbo<br>GPT-3.5 Turbo | Chat, code generation<br>Fast responses |
| **Anthropic** | Claude 3.5 Sonnet<br>Claude 3 Opus/Haiku | Advanced reasoning<br>Document analysis |

### Key Technologies

- **Agent Orchestration**: Multi-agent system with tool-based delegation
- **GitHub MCP**: Model Context Protocol integration for repository operations
- **Document Versioning**: Version control for generated artifacts
- **Python Sandbox**: Secure code execution environment
- **Mermaid Rendering**: Real-time diagram generation
- **Rate Limiting**: Per-agent and per-user rate controls
- **Comprehensive Logging**: Activity, usage, and error tracking


## System Architecture

### Complete System Flow

```mermaid
flowchart TB
    User([User Browser])

    subgraph "Frontend Layer"
        UI[Next.js UI]
        State[Client State]
        LocalStorage[API Keys<br/>localStorage]
    end

    subgraph "API Layer"
        APIRoutes[Next.js API Routes]
        Auth[Supabase Auth<br/>Middleware]
        RateLimit[Rate Limiting]
    end

    subgraph "Agent Orchestration"
        Router[Agent Router]

        subgraph "Primary Agent"
            ChatAgent[Chat Agent<br/>Multi-Provider]
        end

        subgraph "Sub-Agents"
            ProviderTools[Provider Tools<br/>Search/Execute]
            GitMCP[GitHub MCP<br/>Repo Operations]
        end

        subgraph "Streaming Agents"
            DocAgent[Document Agent<br/>Artifact Creation]
            PyAgent[Python Agent<br/>Code Execution]
            MermaidAgent[Mermaid Agent<br/>Diagram Generation]
        end
    end

    subgraph "AI Providers"
        Google[Google Gemini]
        OpenAI[OpenAI GPT]
        Anthropic[Anthropic Claude]
    end

    subgraph "Data Layer"
        DB[(PostgreSQL<br/>Supabase)]
        Storage[Vercel Blob<br/>File Storage]
    end

    subgraph "External Services"
        GitHub[GitHub API]
        WebSearch[Web Search API]
    end

    User --> UI
    UI --> State
    UI --> LocalStorage
    State --> APIRoutes

    APIRoutes --> Auth
    Auth --> RateLimit
    RateLimit --> Router

    Router --> ChatAgent
    ChatAgent --> ProviderTools
    ChatAgent --> GitMCP
    ChatAgent --> DocAgent
    ChatAgent --> PyAgent
    ChatAgent --> MermaidAgent

    ChatAgent --> Google
    ChatAgent --> OpenAI
    ChatAgent --> Anthropic

    ProviderTools --> WebSearch
    GitMCP --> GitHub

    Router --> DB
    DocAgent --> DB
    PyAgent --> DB
    MermaidAgent --> DB

    APIRoutes --> Storage

    DB -.->|SSE Stream| UI
```

### Multi-Agent Chat Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as Frontend UI
    participant API as API Route
    participant Auth as Auth Middleware
    participant Router as Agent Router
    participant Chat as Chat Agent
    participant SubAgent as Sub-Agent
    participant Stream as Streaming Agent
    participant AI as AI Provider
    participant DB as Database

    User->>UI: Send message + files + GitHub context
    UI->>UI: Retrieve API keys from localStorage
    UI->>API: POST /api/chat (headers: API keys)

    API->>Auth: Verify session
    Auth-->>API: User authenticated

    API->>DB: Check rate limits
    DB-->>API: Within limits

    API->>Router: Initialize agents
    Router->>DB: Fetch admin configs
    DB-->>Router: Agent settings

    Router->>Chat: Create chat agent with tools
    Chat->>AI: Stream request with context

    loop Tool Calls
        AI-->>Chat: Tool call (sub-agent)
        Chat->>SubAgent: Execute tool
        SubAgent-->>Chat: Tool result
        Chat->>AI: Continue with result
    end

    loop Streaming Artifacts
        AI-->>Chat: Tool call (streaming agent)
        Chat->>Stream: Stream artifact creation
        Stream->>DB: Save artifact
        Stream-->>UI: SSE stream artifact
        UI-->>User: Display artifact in real-time
    end

    loop Response Streaming
        AI-->>Chat: Token chunk
        Chat-->>API: Process chunk
        API-->>UI: SSE event
        UI-->>User: Display update
    end

    Chat->>DB: Log usage (tokens, cost)
    Chat->>DB: Save message

    API-->>UI: Complete
    UI-->>User: Final message displayed
```

### Database Schema Overview

```mermaid
erDiagram
    AUTH_USERS ||--o{ CHAT : "owns"
    AUTH_USERS ||--o{ GITHUB_REPOSITORIES : "connects"
    AUTH_USERS ||--o{ USAGE_LOGS : "generates"
    AUTH_USERS ||--o{ RATE_LIMIT_TRACKING : "tracks"

    CHAT ||--o{ MESSAGE_V2 : "contains"
    CHAT ||--o{ DOCUMENT : "has"

    MESSAGE_V2 ||--o{ SUGGESTION : "receives"
    MESSAGE_V2 ||--o{ VOTE_V2 : "receives"
    MESSAGE_V2 }o--|| MODEL_CONFIG : "uses"

    DOCUMENT ||--o{ SUGGESTION : "has"

    ADMIN_CONFIG ||--o| AGENT_TYPE : "configures"

    AUTH_USERS {
        uuid id PK
        string email
        jsonb raw_user_meta_data
        timestamp created_at
    }

    CHAT {
        uuid id PK
        uuid userId FK
        string title
        timestamp createdAt
        timestamp updatedAt
    }

    MESSAGE_V2 {
        uuid id PK
        uuid chatId FK
        string role
        jsonb content
        int promptTokens
        int completionTokens
        timestamp createdAt
    }

    DOCUMENT {
        uuid id PK
        uuid chatId FK
        uuid userId FK
        string title
        string kind
        text content
        timestamp createdAt
    }

    ADMIN_CONFIG {
        uuid id PK
        string agentType
        string provider
        jsonb systemPrompt
        jsonb rateLimit
        boolean isActive
    }

    MODEL_CONFIG {
        uuid id PK
        string modelId
        string provider
        decimal inputPrice
        decimal outputPrice
        boolean isActive
    }

    USAGE_LOGS {
        uuid id PK
        uuid userId FK
        string provider
        string model
        int promptTokens
        int completionTokens
        decimal estimatedCost
        timestamp createdAt
    }
```


## How to Contribute

We welcome contributions from the community! Whether you're fixing bugs, adding features, improving documentation, or writing tests, your help is appreciated.

### Getting Started

1. **Fork the repository** and clone your fork
2. **Set up your local environment** following the [Quick Start Guide](#quick-start-guide)
3. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. **Make your changes** following our coding standards
5. **Test your changes** thoroughly
6. **Commit your changes** with clear, descriptive messages:
   ```bash
   git commit -m "feat: add new feature description"
   ```
7. **Push to your fork** and create a pull request

### Contribution Guidelines

#### Code Standards

- **TypeScript**: Use strict TypeScript with proper typing
- **Formatting**: Code is automatically formatted with Prettier
- **Linting**: Ensure ESLint passes with no errors
- **Naming Conventions**:
  - Components: PascalCase (`ChatInterface.tsx`)
  - Functions: camelCase (`getUserChats()`)
  - Constants: UPPER_SNAKE_CASE (`MAX_FILE_SIZE`)
  - Files: kebab-case for utilities (`rate-limiter.ts`)

#### Testing Requirements

- **Unit Tests**: Write tests for all new utility functions
- **Integration Tests**: Test API endpoints and database queries
- **E2E Tests**: Add Playwright tests for new user flows
- **Coverage**: Maintain or improve test coverage

See [Testing Documentation](./testing.md) for detailed guidelines.

#### Pull Request Process

1. **Fill out the PR template** completely
2. **Link related issues** if applicable
3. **Ensure CI/CD passes** (tests, linting, build)
4. **Request review** from maintainers
5. **Address feedback** promptly
6. **Squash commits** before merging (if requested)

#### Database Changes

If your changes require database schema modifications:

1. **Create a migration file** in `lib/db/migrations/`:
   ```bash
   pnpm db:generate
   ```
2. **Test the migration** on your local Supabase instance:
   ```bash
   pnpm db:migrate
   ```
3. **Document the changes** in your PR description
4. **Include rollback instructions** if applicable

#### Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, no logic change)
- `refactor:` Code refactoring
- `test:` Adding or updating tests
- `chore:` Maintenance tasks

**Examples:**
- `feat: add GitHub repository search functionality`
- `fix: resolve streaming timeout issue in chat agent`
- `docs: update admin panel configuration guide`
- `test: add unit tests for rate limiting service`

### Development Workflow

1. **Local Development**: All developers work on their own Supabase projects
2. **Feature Branches**: Create branches for each feature or bug fix
3. **Code Review**: All changes require peer review
4. **Migrations**: Database changes must include migration scripts
5. **Deployment**: Super admins apply migrations to production

For detailed workflow information, see [CONTRIBUTING.md](./CONTRIBUTING.md).

### Getting Help

- **Documentation**: Check the [Documentation Index](#documentation-index) below
- **Issues**: Browse or create [GitHub Issues](https://github.com/earthscape/chat/issues)
- **Discussions**: Join [GitHub Discussions](https://github.com/earthscape/chat/discussions)
- **Questions**: Reach out to maintainers in pull request comments


## Documentation Index

### **[Admin Panel Documentation](./admin-panel.md)**

Comprehensive guide to the admin dashboard and configuration management.

**Table of Contents:**
1. [Overview](./admin-panel.md#overview)
2. [Accessing the Admin Panel](./admin-panel.md#accessing-the-admin-panel)
3. [Making a User Admin](./admin-panel.md#making-a-user-admin)
4. [Admin Dashboard](./admin-panel.md#admin-dashboard)
5. [Model Configuration](./admin-panel.md#model-configuration)
6. [Logging Configuration](./admin-panel.md#logging-configuration)
7. [Agent Configuration Pages](./admin-panel.md#agent-configuration-pages)
8. [Logging & Error Handling Integration](./admin-panel.md#logging--error-handling-integration)
9. [API Endpoints](./admin-panel.md#api-endpoints)
10. [File References](./admin-panel.md#file-references)
11. [TODOs](./admin-panel.md#todos)

---

### **[Agent Architecture Documentation](./agent-architecture.md)**

Detailed documentation of the multi-agent AI system and orchestration.

**Table of Contents:**
- [Overview](./agent-architecture.md#overview)
- [Architecture Diagram](./agent-architecture.md#architecture-diagram)
- [Provider System](./agent-architecture.md#provider-system)
- [Agent Types](./agent-architecture.md#agent-types)
  - [Chat Model Agent](./agent-architecture.md#chat-model-agent)
  - [Sub-Agents](./agent-architecture.md#sub-agents)
  - [Streaming Agents](./agent-architecture.md#streaming-agents)
- [Streaming Architecture](./agent-architecture.md#streaming-architecture)
- [Tool System](./agent-architecture.md#tool-system)
- [Artifacts](./agent-architecture.md#artifacts)
- [API Key Management](./agent-architecture.md#api-key-management)
- [Request Flow](./agent-architecture.md#request-flow)
- [Agent Initialization](./agent-architecture.md#agent-initialization)
- [File References](./agent-architecture.md#file-references)
- [TODOs](./agent-architecture.md#todos)

---

### **[Database Design Documentation](./database-design.md)**

Complete database schema, relationships, and migration strategy.

**Table of Contents:**
- [Overview](./database-design.md#overview)
- [Entity Relationship Diagram](./database-design.md#entity-relationship-diagram)
- [Database Schema](./database-design.md#database-schema)
  - [Core Tables](./database-design.md#core-tables)
  - [Admin & Analytics Tables](./database-design.md#admin--analytics-tables)
  - [Activity Logging Tables](./database-design.md#activity-logging-tables)
- [Database Functions](./database-design.md#database-functions)
- [Indexes](./database-design.md#indexes)
- [Triggers](./database-design.md#triggers)
- [Row Level Security (RLS)](./database-design.md#row-level-security-rls)
- [Seed Data](./database-design.md#seed-data)
- [Supabase Setup](./database-design.md#supabase-setup)
- [Database Migrations](./database-design.md#database-migrations)
- [Schema Changes](./database-design.md#schema-changes)
- [TODOs](./database-design.md#todos)

---

### **[Multimodal Chat Features Documentation](./multimodal-chat-features.md)**

In-depth guide to chat system features and multimodal capabilities.

**Table of Contents:**
- [Overview](./multimodal-chat-features.md#overview)
- [Architecture Diagram](./multimodal-chat-features.md#architecture-diagram)
- [Multimodal Input System](./multimodal-chat-features.md#multimodal-input-system)
  - [File Upload & Processing](./multimodal-chat-features.md#file-upload--processing)
  - [Supported File Types](./multimodal-chat-features.md#supported-file-types)
  - [File Validation & Security](./multimodal-chat-features.md#file-validation--security)
- [GitHub Context Integration](./multimodal-chat-features.md#github-context-integration)
  - [Repository Selection](./multimodal-chat-features.md#repository-selection)
  - [File & Folder Browser](./multimodal-chat-features.md#file--folder-browser)
  - [GitHub MCP Agent Integration](./multimodal-chat-features.md#github-mcp-agent-integration)
- [Thinking Mode & Reasoning](./multimodal-chat-features.md#thinking-mode--reasoning)
  - [Extended Reasoning](./multimodal-chat-features.md#extended-reasoning)
  - [Reasoning Streaming](./multimodal-chat-features.md#reasoning-streaming)
  - [UI Display](./multimodal-chat-features.md#ui-display)
- [Model Selection](./multimodal-chat-features.md#model-selection)
  - [Model Selector Component](./multimodal-chat-features.md#model-selector-component)
  - [Admin Configuration Integration](./multimodal-chat-features.md#admin-configuration-integration)
  - [Per-Provider Model Management](./multimodal-chat-features.md#per-provider-model-management)
- [Chat History](./multimodal-chat-features.md#chat-history)
  - [Conversation Management](./multimodal-chat-features.md#conversation-management)
  - [Infinite Scroll Pagination](./multimodal-chat-features.md#infinite-scroll-pagination)
  - [Grouping & Organization](./multimodal-chat-features.md#grouping--organization)
- [Message System](./multimodal-chat-features.md#message-system)
  - [Message Parts](./multimodal-chat-features.md#message-parts)
  - [Streaming Display](./multimodal-chat-features.md#streaming-display)
  - [Tool Call Rendering](./multimodal-chat-features.md#tool-call-rendering)
- [Complete User Flow](./multimodal-chat-features.md#complete-user-flow)
- [File References](./multimodal-chat-features.md#file-references)
- [TODOs](./multimodal-chat-features.md#todos)

---

### **[Settings & Verification Documentation](./settings-and-verification.md)**

API key management, verification system, and security considerations.

**Table of Contents:**
- [Overview](./settings-and-verification.md#overview)
- [Architecture Diagram](./settings-and-verification.md#architecture-diagram)
- [Settings Page Features](./settings-and-verification.md#settings-page-features)
  - [API Key Management](./settings-and-verification.md#api-key-management)
  - [GitHub Integration](./settings-and-verification.md#github-integration)
  - [Storage Management](./settings-and-verification.md#storage-management)
- [Verification System](./settings-and-verification.md#verification-system)
  - [Google API Key Verification](./settings-and-verification.md#google-api-key-verification)
  - [GitHub Token Verification](./settings-and-verification.md#github-token-verification)
  - [Verification Service Architecture](./settings-and-verification.md#verification-service-architecture)
- [Local Storage System](./settings-and-verification.md#local-storage-system)
  - [Storage Manager](./settings-and-verification.md#storage-manager)
  - [Storage Session Hook](./settings-and-verification.md#storage-session-hook)
  - [Storage Helpers](./settings-and-verification.md#storage-helpers)
- [API Key Flow in Chat](./settings-and-verification.md#api-key-flow-in-chat)
- [Agent API Key Access](./settings-and-verification.md#agent-api-key-access)
- [UI Components](./settings-and-verification.md#ui-components)
- [API Endpoints](./settings-and-verification.md#api-endpoints)
- [Security Considerations](./settings-and-verification.md#security-considerations)
- [File References](./settings-and-verification.md#file-references)

---

### **[Testing Strategy Documentation](./testing.md)**

Comprehensive testing guide with philosophy, test pyramid, and PR requirements.

**Table of Contents:**
1. [Overview](./testing.md#overview)
2. [Testing Philosophy](./testing.md#testing-philosophy)
3. [Test Pyramid Architecture](./testing.md#test-pyramid-architecture)
4. [Quality Gates & PR Requirements](./testing.md#quality-gates--pr-requirements)
5. [Test Coverage Areas](./testing.md#test-coverage-areas)
6. [API Testing](./testing.md#api-testing)
7. [Feature Testing](./testing.md#feature-testing)
8. [Flow Testing](./testing.md#flow-testing)
9. [UI Testing](./testing.md#ui-testing)
10. [E2E Testing](./testing.md#e2e-testing)
11. [Test Scenarios](./testing.md#test-scenarios)
12. [Contributing Guidelines](./testing.md#contributing-guidelines)
13. [File References](./testing.md#file-references)
14. [TODOs](./testing.md#todos)

---

### **[Comprehensive Testing Structure](./comprehensive-testing-structure.md)**

Detailed test file organization and structure for the entire codebase.

**Contents:**
- Complete testing folder structure
- Unit test organization for all components
- Integration test patterns
- E2E test scenarios
- Security and performance testing
- Mock and fixture patterns

**Note:** This document provides the implementation blueprint for the testing strategy outlined in `testing.md`.

---

### **[Contributing Guide](./CONTRIBUTING.md)**

Step-by-step guide for contributors to set up their environment and submit changes.

**Table of Contents:**
- [Getting Started](./CONTRIBUTING.md#getting-started)
- [Development Workflow](./CONTRIBUTING.md#development-workflow)
- [Testing](./CONTRIBUTING.md#testing)
- [Building](./CONTRIBUTING.md#building)
- [Submitting Changes](./CONTRIBUTING.md#submitting-changes)
- [Code Standards](./CONTRIBUTING.md#code-standards)
- [Getting Help](./CONTRIBUTING.md#getting-help)


## Additional Resources

### Project Structure

```
webroot
    chat/
    ├── app/                    # Next.js app directory
    │   ├── (auth)/            # Authentication routes
    │   ├── (chat)/            # Chat interface routes
    │   ├── admin/             # Admin panel routes
    │   └── api/               # API endpoints
    ├── components/            # React components
    │   ├── admin/             # Admin-specific components
    │   ├── chat/              # Chat interface components
    │   └── ui/                # Reusable UI components
    ├── lib/                   # Core utilities and services
    │   ├── ai/                # Agent system and AI integrations
    │   ├── db/                # Database schema and queries
    │   └── utils/             # Utility functions
    ├── docs/                  # Documentation (you are here!)
    └── public/                # Static assets
    team
    requests
```

### Useful Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm db:migrate` | Run database migrations |
| `pnpm db:generate` | Generate migration from schema changes |
| `pnpm db:studio` | Open Drizzle Studio (database GUI) |
| `pnpm lint` | Run ESLint |
| `pnpm format` | Format code with Prettier |

### External Links

- **Supabase Dashboard**: [app.supabase.com](https://app.supabase.com)
- **Vercel Dashboard**: [vercel.com](https://vercel.com)
- **Google AI Studio**: [aistudio.google.com](https://aistudio.google.com)
- **GitHub Token**: [github.com/settings/tokens](https://github.com/settings/tokens)

---

**Happy Coding! 🚀**

For questions or support, please open an issue on [GitHub](https://github.com/earthscape/chat/issues).
