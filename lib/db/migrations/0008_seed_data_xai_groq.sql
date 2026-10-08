-- =====================================================
-- xAI and Groq Seed Data
-- File: 0008_seed_data_xai_groq.sql
-- Description: Adds xAI (Grok) and Groq model configs and agent entries
-- =====================================================

-- Allow the two new providers. Databases created before 0001_tables.sql
-- listed them still have the three-provider check.
ALTER TABLE model_config DROP CONSTRAINT IF EXISTS model_config_provider_check;
ALTER TABLE model_config ADD CONSTRAINT model_config_provider_check
  CHECK (provider IN ('google', 'openai', 'anthropic', 'xai', 'groq'));

-- xAI Models
INSERT INTO model_config (model_id, name, description, provider, is_active, is_default, thinking_enabled, input_pricing_per_million_tokens, output_pricing_per_million_tokens, metadata) VALUES
('grok-3',      'Grok 3',      'Most capable Grok model', 'xai', true,  true,  false, 3.0000, 15.0000, '{"contextWindow": 131072, "maxOutputTokens": 4096}'::jsonb),
('grok-3-mini', 'Grok 3 Mini', 'Fast and efficient Grok', 'xai', true,  false, false, 0.3000,  0.5000, '{"contextWindow": 131072, "maxOutputTokens": 4096}'::jsonb)
ON CONFLICT (model_id) DO NOTHING;

-- xAI agent configuration (inactive by default — user must add XAI_API_KEY)
INSERT INTO admin_config (config_key, config_data) VALUES
('chat_model_agent_xai', '{
  "enabled": false,
  "systemPrompt": "You are a helpful AI assistant powered by xAI Grok. Be concise, accurate, and friendly. Delegate tasks to specialized agents when appropriate.",
  "capabilities": {
    "fileInput": false
  },
  "fileInputTypes": {},
  "rateLimit": {
    "perMinute": 4,
    "perHour": 40,
    "perDay": 150
  },
  "tools": {}
}')
ON CONFLICT (config_key) DO NOTHING;

-- Groq Models
INSERT INTO model_config (model_id, name, description, provider, is_active, is_default, thinking_enabled, input_pricing_per_million_tokens, output_pricing_per_million_tokens, metadata) VALUES
('llama-3.3-70b-versatile', 'Llama 3.3 70B', 'Fast open-source model via Groq', 'groq', true, true,  false, 0.0590, 0.0790, '{"contextWindow": 128000, "maxOutputTokens": 32768}'::jsonb),
('llama-3.1-8b-instant',    'Llama 3.1 8B',  'Fastest Groq model',             'groq', true, false, false, 0.0050, 0.0080, '{"contextWindow": 128000, "maxOutputTokens": 8192}'::jsonb)
ON CONFLICT (model_id) DO NOTHING;

-- Groq agent configuration (inactive by default — user must add GROQ_API_KEY)
INSERT INTO admin_config (config_key, config_data) VALUES
('chat_model_agent_groq', '{
  "enabled": false,
  "systemPrompt": "You are a helpful AI assistant powered by Groq. Be concise, accurate, and friendly. Delegate tasks to specialized agents when appropriate.",
  "capabilities": {
    "fileInput": false
  },
  "fileInputTypes": {},
  "rateLimit": {
    "perMinute": 4,
    "perHour": 40,
    "perDay": 150
  },
  "tools": {}
}')
ON CONFLICT (config_key) DO NOTHING;
