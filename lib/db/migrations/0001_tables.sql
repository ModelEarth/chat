-- =====================================================
-- Database Tables Creation
-- File: 0001_tables.sql
-- Description: Creates all database tables
-- =====================================================

-- =====================================================
-- CORE TABLES (Chat, Messages, Votes, Documents)
-- =====================================================

-- Chat table - Main conversation container
CREATE TABLE IF NOT EXISTS "Chat" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    title TEXT NOT NULL,
    user_id UUID NOT NULL,
    visibility VARCHAR(10) CHECK (visibility IN ('public', 'private')) NOT NULL DEFAULT 'private',
    "lastContext" JSONB,
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    total_cost DECIMAL(10, 6) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Message_v2 table - Individual messages in chats
CREATE TABLE IF NOT EXISTS "Message_v2" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "chatId" UUID NOT NULL REFERENCES "Chat"(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    parts JSON NOT NULL,
    attachments JSON NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    model_used VARCHAR(100),
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost DECIMAL(10, 6)
);

-- Vote_v2 table - User votes on messages
CREATE TABLE IF NOT EXISTS "Vote_v2" (
    "chatId" UUID NOT NULL REFERENCES "Chat"(id) ON DELETE CASCADE,
    "messageId" UUID NOT NULL REFERENCES "Message_v2"(id) ON DELETE CASCADE,
    "isUpvoted" BOOLEAN NOT NULL,
    PRIMARY KEY ("chatId", "messageId")
);

-- Document table - Artifacts (text, code, diagrams, spreadsheets) with version control
CREATE TABLE IF NOT EXISTS "Document" (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    title TEXT NOT NULL,
    content TEXT,
    kind VARCHAR(20) CHECK (kind IN ('text', 'python code', 'mermaid code', 'sheet')) NOT NULL DEFAULT 'text',
    user_id UUID NOT NULL,
    chat_id UUID REFERENCES "Chat"(id) ON DELETE CASCADE,
    parent_version_id UUID,
    version_number INTEGER NOT NULL DEFAULT 1,
    metadata JSONB DEFAULT '{}',
    PRIMARY KEY (id, "createdAt"),
    FOREIGN KEY (parent_version_id, "createdAt") REFERENCES "Document"(id, "createdAt") ON DELETE SET NULL
);

-- Add table comment for Document table
COMMENT ON TABLE "Document" IS 'Stores versioned artifacts including text documents, Python code, Mermaid diagrams, and spreadsheets with full version control support';
COMMENT ON COLUMN "Document".chat_id IS 'Links artifact to the chat conversation where it was created';
COMMENT ON COLUMN "Document".parent_version_id IS 'References the parent version for version control hierarchy';
COMMENT ON COLUMN "Document".version_number IS 'Sequential version number starting from 1';
COMMENT ON COLUMN "Document".metadata IS 'JSON metadata including update type, line range, and agent information';

-- Suggestion table - Document edit suggestions
CREATE TABLE IF NOT EXISTS "Suggestion" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "documentId" UUID NOT NULL,
    "documentCreatedAt" TIMESTAMP NOT NULL,
    "originalText" TEXT NOT NULL,
    "suggestedText" TEXT NOT NULL,
    description TEXT,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    user_id UUID NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("documentId", "documentCreatedAt") REFERENCES "Document"(id, "createdAt") ON DELETE CASCADE
);

-- Stream table - Tracks active streams
CREATE TABLE IF NOT EXISTS "Stream" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "chatId" UUID NOT NULL REFERENCES "Chat"(id) ON DELETE CASCADE,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================
-- ADMIN & ANALYTICS TABLES
-- =====================================================

-- Admin configuration table - Stores agent configs
CREATE TABLE IF NOT EXISTS admin_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_data JSONB NOT NULL,
    updated_by UUID,
    updated_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Model configuration table - Stores AI model configurations
CREATE TABLE IF NOT EXISTS model_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('google', 'openai', 'anthropic', 'xai', 'groq')),
    is_active BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,
    thinking_enabled BOOLEAN DEFAULT true,
    input_pricing_per_million_tokens DECIMAL(10, 4) NOT NULL,
    output_pricing_per_million_tokens DECIMAL(10, 4) NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Add table comment for model_config table
COMMENT ON TABLE model_config IS 'Centralized storage for AI model configurations including pricing, capabilities, and availability';
COMMENT ON COLUMN model_config.model_id IS 'Unique identifier for the model (e.g., gemini-2.0-flash, gpt-4o)';
COMMENT ON COLUMN model_config.provider IS 'AI provider (google, openai, anthropic)';
COMMENT ON COLUMN model_config.is_active IS 'Whether the model is currently available for use';
COMMENT ON COLUMN model_config.is_default IS 'Whether this is the default model for its provider';
COMMENT ON COLUMN model_config.thinking_enabled IS 'Whether the model supports thinking/reasoning features';
COMMENT ON COLUMN model_config.metadata IS 'Additional model metadata (context window, capabilities, etc.)';

-- Usage logs - Detailed analytics for API usage
CREATE TABLE IF NOT EXISTS usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    chat_id UUID REFERENCES "Chat"(id) ON DELETE SET NULL,
    agent_type VARCHAR(50) NOT NULL,
    model_used VARCHAR(100),
    provider VARCHAR(50),
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    input_cost DECIMAL(10, 6),
    output_cost DECIMAL(10, 6),
    total_cost DECIMAL(10, 6),
    request_timestamp TIMESTAMP DEFAULT NOW(),
    response_timestamp TIMESTAMP,
    duration_ms INTEGER,
    metadata JSONB
);

-- Rate limit tracking - Enforce rate limits per user/agent
CREATE TABLE IF NOT EXISTS rate_limit_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    agent_type VARCHAR(50) NOT NULL,
    period_start TIMESTAMP NOT NULL,
    period_end TIMESTAMP NOT NULL,
    request_count INTEGER DEFAULT 0,
    limit_type VARCHAR(20) CHECK (limit_type IN ('hourly', 'daily')) NOT NULL,
    limit_value INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- GitHub repositories - User's connected repos for Git MCP
CREATE TABLE IF NOT EXISTS github_repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    repo_owner VARCHAR(100) NOT NULL,
    repo_name VARCHAR(100) NOT NULL,
    repo_url TEXT,
    default_branch VARCHAR(100) DEFAULT 'main',
    is_active BOOLEAN DEFAULT true,
    last_accessed TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Error logs - Comprehensive error tracking for debugging and monitoring
CREATE TABLE IF NOT EXISTS error_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    error_type VARCHAR(50) NOT NULL CHECK (error_type IN ('auth', 'api', 'admin', 'app', 'user', 'permission', 'system')),
    error_category VARCHAR(100) NOT NULL,
    error_message TEXT NOT NULL,
    error_details JSONB,
    request_path VARCHAR(500),
    request_method VARCHAR(10),
    user_agent TEXT,
    ip_address VARCHAR(45),
    session_id VARCHAR(100),
    severity VARCHAR(20) NOT NULL DEFAULT 'error' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    resolved BOOLEAN DEFAULT FALSE,
    resolved_by UUID,
    resolved_at TIMESTAMP,
    resolution_notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- ACTIVITY LOGGING TABLES
-- =====================================================

-- User Activity Logs - Tracks user actions throughout the application
CREATE TABLE IF NOT EXISTS user_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    correlation_id UUID NOT NULL,
    activity_type VARCHAR(50) NOT NULL CHECK (activity_type IN (
        'auth_login', 'auth_logout', 'auth_register',
        'chat_create', 'chat_view', 'chat_delete', 'chat_message_send',
        'document_create', 'document_view', 'document_update', 'document_delete',
        'admin_config_update', 'admin_dashboard_view', 'admin_provider_view',
        'vote_message', 'suggestion_view',
        'file_upload', 'artifact_create', 'artifact_execute',
        'model_selection', 'history_access', 'history_delete'
    )),
    activity_category VARCHAR(50) NOT NULL CHECK (activity_category IN (
        'authentication', 'chat', 'document', 'admin', 'vote', 'file', 'artifact', 'history'
    )),
    activity_metadata JSONB DEFAULT '{}',
    resource_id UUID,           -- ID of the resource being acted upon (chat_id, document_id, etc.)
    resource_type VARCHAR(50),  -- Type of resource (chat, document, message, etc.)
    ip_address VARCHAR(45),     -- Anonymized if privacy settings require
    user_agent TEXT,
    request_path VARCHAR(500),
    request_method VARCHAR(10),
    session_id VARCHAR(100),
    success BOOLEAN DEFAULT true,
    error_message TEXT,         -- If success=false, why did it fail?
    created_at TIMESTAMP DEFAULT NOW()
);

-- Agent Activity Logs - Tracks AI agent operations and performance
CREATE TABLE IF NOT EXISTS agent_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,                       -- NULL for system operations
    correlation_id UUID NOT NULL,
    agent_type VARCHAR(50) NOT NULL CHECK (agent_type IN (
        'chat_model_agent', 'provider_tools_agent', 'document_agent',
        'python_agent', 'mermaid_agent', 'git_mcp_agent'
    )),
    operation_type VARCHAR(50) NOT NULL CHECK (operation_type IN (
        'initialization', 'tool_invocation', 'code_generation',
        'document_generation', 'diagram_generation', 'code_execution',
        'search', 'url_fetch', 'mcp_operation', 'streaming'
    )),
    operation_category VARCHAR(50) NOT NULL CHECK (operation_category IN (
        'generation', 'execution', 'tool_use', 'streaming', 'configuration'
    )),
    operation_metadata JSONB DEFAULT '{}',
    resource_id UUID,                   -- Document, code, diagram ID
    resource_type VARCHAR(50),          -- document, code, diagram, etc.

    -- Performance Metrics
    duration_ms INTEGER,                -- Operation duration in milliseconds
    start_time TIMESTAMP,
    end_time TIMESTAMP,

    -- AI Model Metrics
    model_id VARCHAR(100),
    provider VARCHAR(50),
    thinking_mode BOOLEAN DEFAULT false,
    input_tokens INTEGER,
    output_tokens INTEGER,
    reasoning_tokens INTEGER,
    total_tokens INTEGER,
    input_cost DECIMAL(10, 6),
    output_cost DECIMAL(10, 6),
    total_cost DECIMAL(10, 6),

    -- Execution Details
    success BOOLEAN DEFAULT true,
    error_type VARCHAR(100),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,

    created_at TIMESTAMP DEFAULT NOW()
);

-- Add comments for activity logging tables
COMMENT ON TABLE user_activity_logs IS 'Tracks all user actions and interactions with the application';
COMMENT ON TABLE agent_activity_logs IS 'Tracks AI agent operations, performance metrics, and resource usage';

COMMENT ON COLUMN user_activity_logs.correlation_id IS 'UUID linking related logs across user and agent activities';
COMMENT ON COLUMN user_activity_logs.activity_metadata IS 'JSON containing activity-specific details (file size, chat model, etc.)';
COMMENT ON COLUMN user_activity_logs.ip_address IS 'User IP address (anonymized based on privacy settings)';

COMMENT ON COLUMN agent_activity_logs.correlation_id IS 'UUID linking this agent operation to user activity';
COMMENT ON COLUMN agent_activity_logs.duration_ms IS 'Total operation duration in milliseconds';
COMMENT ON COLUMN agent_activity_logs.operation_metadata IS 'JSON containing operation-specific metrics and details';
COMMENT ON COLUMN agent_activity_logs.reasoning_tokens IS 'Tokens used for extended thinking (if thinking mode enabled)';