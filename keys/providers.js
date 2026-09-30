/**
 * providers.js — Static provider + model registry (canonical source).
 *
 * Single source of truth for provider metadata used by:
 *   - Static pages via window.KeyManagerProviders (set when loaded as <script>)
 *   - chat/lib/providers.ts (imported via module.exports for Next.js app code)
 *   - requests/engine/js/app.js (reads window.KeyManagerProviders for model picker)
 *
 * Also kept in sync with lib/db/migrations/0007_seed_data_model_config.sql
 * and lib/storage/types.ts APIProvider type.
 *
 * outputs field (optional): non-text capabilities a model supports.
 * Text output is assumed for all models; only list 'image' and/or 'video' here.
 *
 * apiModel field (optional): the exact model/version identifier to send to the
 * provider's API when it differs from the human-friendly `id`. Example: Tripo
 * requires date-stamped versions like "v3.0-20250812". Consumers fall back to
 * `id` when this is absent, so the API-specific strings live here in config
 * rather than being hardcoded in backend code.
 *
 * noCreditsHint field (optional): user-facing message shown when the provider
 * reports the account has no API credits. Kept here in config so the wording
 * and any links are editable without touching backend/frontend code.
 *
 * apiMode field (optional, per-model): which `task3d.modes` entry this model
 * uses (e.g. Tripo versions all use 'text_to_model'). Falls back to the model id.
 *
 * task3d field (optional, provider-level): declarative spec for a task-based 3D
 * generation API (endpoint, request body, response JSON paths, status values,
 * error codes). The Arts Engine frontend builds a per-request spec from this and
 * sends it to the generic Rust 3D runner, so NO provider-specific endpoints or
 * parsing live in backend code. Body strings support {prompt}/{model}/{image_url}
 * placeholders, substituted by the frontend. Shape:
 *   { base, taskIdPath, statusValuePath, statusSuccess[], statusFailure[],
 *     errorMessagePath?, outputPath, outputKeys[], errorCodePath?, noCreditsCode?,
 *     modes: { <mode>: { submitPath, body } } }
 * Submit POSTs to `base + submitPath`; status is polled at `{submitUrl}/{taskId}`.
 */

// Shared across all Tripo models — shown when Tripo returns "no credits" (code 2010).
const TRIPO_NO_CREDITS_HINT =
  'Your Tripo account has no API credits — activate your 14-day free trial at ' +
  'https://platform.tripo3d.ai/billing, then retry.';

const _providers = [
  {
    id: 'github',
    name: 'GitHub',
    keyPlaceholder: 'ghp_... or github_pat_...',
    keyHint: 'Personal Access Token (GITHUB_PERSONAL_ACCESS_TOKEN)',
    getKeyUrl: 'https://github.com/settings/tokens',
    tokenOnly: true,
    models: [],
  },
  {
    id: 'google',
    name: 'Google',
    keyPlaceholder: 'AIza...',
    keyHint: 'Google AI Studio key',
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    models: [
      // Google has retired Gemini versions faster than this list gets updated —
      // 2.0-flash, then 2.5-flash, were both rejected live with "no longer
      // available ... use <newer id>" (2026-09). 3.8-flash is the id Google's
      // own error named most recently; kept the older ones listed (not
      // default) in case some accounts still have access to them.
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', description: 'Current default flash model', isDefault: true,  active: true,  supportsThinkingMode: true  },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Enhanced flash model with better performance', isDefault: false, active: true,  supportsThinkingMode: true  },
      { id: 'gemini-2.5-pro',   name: 'Gemini 2.5 Pro',   description: 'Most capable model for complex tasks',         isDefault: false, active: true,  supportsThinkingMode: true  },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Fast, efficient model for most tasks',         isDefault: false, active: true,  outputs: ['image'] },
      { id: 'gemma-3',          name: 'Gemma 3',           description: 'Open source model for basic tasks',           isDefault: false, active: true  },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    keyPlaceholder: 'sk-ant-...',
    keyHint: 'Anthropic Console key',
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Most capable Claude model',        isDefault: true,  active: true  },
      { id: 'claude-3-5-haiku-20241022',  name: 'Claude 3.5 Haiku',  description: 'Fast and efficient Claude model', isDefault: false, active: true  },
      { id: 'claude-3-opus-20240229',     name: 'Claude 3 Opus',     description: 'Previous generation flagship',    isDefault: false, active: false },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    keyPlaceholder: 'sk-...',
    keyHint: 'OpenAI platform key',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4o',      name: 'GPT-4o',      description: 'Most capable GPT-4 model',      isDefault: true,  active: true,  outputs: ['image'] },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Faster, more affordable GPT-4', isDefault: false, active: true  },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Previous generation GPT-4',     isDefault: false, active: false },
    ],
  },
  {
    id: 'xai',
    name: 'xAI',
    keyPlaceholder: 'xai-...',
    keyHint: 'xAI Console key',
    getKeyUrl: 'https://console.x.ai/',
    models: [
      { id: 'grok-3',      name: 'Grok 3',      description: 'Most capable Grok model', isDefault: true,  active: true, outputs: ['image', 'video'] },
      { id: 'grok-3-mini', name: 'Grok 3 Mini', description: 'Fast and efficient Grok', isDefault: false, active: true, outputs: ['image', 'video'] },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    keyPlaceholder: 'gsk_...',
    keyHint: 'Groq Console key — free tier includes Whisper transcription (7,200 audio sec/hr)',
    getKeyUrl: 'https://console.groq.com/keys',
    models: [
      { id: 'llama-3.3-70b-versatile',     name: 'Llama 3.3 70B',         description: 'Fast open-source model via Groq',                  isDefault: true,  active: true },
      { id: 'whisper-large-v3',            name: 'Whisper Large v3',       description: 'Free speech-to-text transcription, 99 languages',  isDefault: false, active: true },
      { id: 'whisper-large-v3-turbo',      name: 'Whisper Large v3 Turbo', description: 'Whisper at 216× real-time speed via Groq',         isDefault: false, active: true },
      { id: 'distil-whisper-large-v3-en',  name: 'Distil-Whisper v3 EN',   description: 'Lightweight English-only Whisper model',           isDefault: false, active: true },
    ],
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    keyPlaceholder: 'pplx-...',
    keyHint: 'Perplexity API key',
    getKeyUrl: 'https://www.perplexity.ai/settings/api',
    models: [],
  },
  {
    id: 'pollinations',
    name: 'Pollinations',
    keyPlaceholder: 'pol-...',
    keyHint: 'Pollinations API token (auth.pollinations.ai) for higher tiers',
    getKeyUrl: 'https://enter.pollinations.ai',
    models: [
      { id: 'flux',   name: 'Flux Schnell',  description: 'Fast Black Forest Labs Flux model', isDefault: true,  active: true, outputs: ['image'] },
      { id: 'zimage', name: 'Z-Image Turbo', description: 'Alibaba Z-Image Turbo',             isDefault: false, active: true, outputs: ['image'] },
    ],
  },
  {
    id: 'meshy',
    name: 'Meshy',
    keyPlaceholder: 'msy-...',
    keyHint: '100 free credits/month — Pro plan required for API access',
    getKeyUrl: 'https://www.meshy.ai/api',
    task3d: {
      base: 'https://api.meshy.ai/openapi',
      taskIdPath: 'result',
      statusValuePath: 'status',
      statusSuccess: ['SUCCEEDED'],
      statusFailure: ['FAILED', 'CANCELED', 'EXPIRED'],
      errorMessagePath: 'task_error.message',
      outputPath: 'model_urls',
      outputKeys: ['glb', 'usdz', 'fbx', 'obj'],
      modes: {
        'text-to-3d':  { submitPath: '/v2/text-to-3d',  body: { mode: 'preview', prompt: '{prompt}', art_style: 'realistic', should_remesh: true } },
        'image-to-3d': { submitPath: '/v1/image-to-3d', body: { image_url: '{image_url}', should_texture: true } },
      },
    },
    models: [
      { id: 'text-to-3d',        name: 'Text to 3D',         description: 'Generate 3D models from text prompts (meshy-6)',      isDefault: true,  active: true, outputs: ['3d'], apiMode: 'text-to-3d' },
      { id: 'image-to-3d',       name: 'Image to 3D',        description: 'Generate 3D models from a reference image',          isDefault: false, active: true, outputs: ['3d'], apiMode: 'image-to-3d' },
      { id: 'multiimage-to-3d',  name: 'Multi-Image to 3D',  description: 'Generate 3D from multiple reference images',         isDefault: false, active: true, outputs: ['3d'], apiMode: 'image-to-3d' },
      { id: 'ai-texturing',      name: 'AI Texturing',       description: 'Apply AI-generated textures to existing 3D meshes',  isDefault: false, active: true, outputs: ['3d'], apiMode: 'text-to-3d' },
    ],
  },
  {
    id: 'tripo',
    name: 'Tripo',
    keyPlaceholder: 'tsk_...',
    keyHint: '300 free credits/month (~24 models) — platform.tripo3d.ai',
    getKeyUrl: 'https://platform.tripo3d.ai/api-keys',
    task3d: {
      base: 'https://api.tripo3d.ai/v2/openapi',
      taskIdPath: 'data.task_id',
      statusValuePath: 'data.status',
      statusSuccess: ['success'],
      statusFailure: ['failed', 'cancelled', 'banned', 'expired'],
      outputPath: 'data.output',
      outputKeys: ['pbr_model', 'model'],
      errorCodePath: 'code',   // Tripo wraps errors in a numeric code (can appear in a 200 body)
      noCreditsCode: 2010,     // → NO_CREDITS sentinel → noCreditsHint
      modes: {
        'text_to_model': { submitPath: '/task', body: { type: 'text_to_model', prompt: '{prompt}', model_version: '{model}' } },
      },
    },
    models: [
      { id: 'v3.0',  name: 'Tripo v3.0',  description: 'Stable text/image-to-3D generation',             isDefault: true,  active: true, outputs: ['3d'], apiMode: 'text_to_model', apiModel: 'v3.0-20250812', noCreditsHint: TRIPO_NO_CREDITS_HINT },
      { id: 'v3.1',  name: 'Tripo v3.1',  description: 'Enhanced quality 3D generation',                 isDefault: false, active: true, outputs: ['3d'], apiMode: 'text_to_model', apiModel: 'v3.1-20260211', noCreditsHint: TRIPO_NO_CREDITS_HINT },
      { id: 'p1',    name: 'Tripo P1',    description: 'Premium game-ready 3D with higher fidelity',     isDefault: false, active: true, outputs: ['3d'], apiMode: 'text_to_model', apiModel: 'P1-20260311', noCreditsHint: TRIPO_NO_CREDITS_HINT },
    ],
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    keyPlaceholder: '',
    keyHint: '10,000 free characters/month TTS — elevenlabs.io',
    getKeyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    models: [
      { id: 'eleven_flash_v2_5',      name: 'Flash v2.5',          description: 'Fast TTS included in free tier',                  isDefault: true,  active: true, outputs: ['audio'] },
      { id: 'eleven_multilingual_v2', name: 'Multilingual v2',     description: 'High-quality TTS in 29+ languages',              isDefault: false, active: true, outputs: ['audio'] },
      { id: 'eleven_turbo_v2_5',      name: 'Turbo v2.5',          description: 'Low-latency TTS for real-time applications',     isDefault: false, active: true, outputs: ['audio'] },
      { id: 'scribe_v1',              name: 'Scribe v1 (STT)',      description: 'Accurate speech-to-text with speaker diarization', isDefault: false, active: true },
    ],
  },
  {
    id: 'discord',
    name: 'Discord Bot',
    keyPlaceholder: '',
    keyHint: 'Discord bot token (DISCORD_BOT_TOKEN)',
    getKeyUrl: 'https://discord.com/developers/applications',
    tokenOnly: true,
    models: [],
  },
  {
    id: 'pinecone',
    name: 'Pinecone',
    keyPlaceholder: 'pcsk_...',
    keyHint: 'Vector DB for repository retrieval (PINECONE_API_KEY)',
    getKeyUrl: 'https://app.pinecone.io/organizations/-/keys',
    tokenOnly: true,
    models: [],
  },
  {
    id: 'voyage',
    name: 'Voyage AI',
    keyPlaceholder: 'pa-...',
    keyHint: 'Embedding model for repository retrieval (VOYAGE_API_KEY)',
    getKeyUrl: 'https://dash.voyageai.com/api-keys',
    tokenOnly: true,
    models: [],
  },
  {
    id: 'supabase',
    name: 'Supabase',
    keyPlaceholder: 'https://xxxx.supabase.co',
    keyHint: 'Supabase project URL — enables chat history and email/password login (NEXT_PUBLIC_SUPABASE_URL)',
    getKeyUrl: 'https://supabase.com/dashboard',
    tokenOnly: true,
    models: [],
  },
];

// Browser global (loaded via <script> tag)
if (typeof window !== 'undefined') window.KeyManagerProviders = _providers;

// Node.js / CommonJS (imported by chat/lib/providers.ts)
if (typeof module !== 'undefined' && module.exports) module.exports = _providers;

// CLI providers — shown only on localhost (no API key required)
if (typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  _providers.push(
    {
      id: 'claude-code-cli',
      name: 'Claude Code CLI',
      keyPlaceholder: '',
      keyHint: 'Local CLI — no API key required',
      getKeyUrl: 'https://claude.ai/download',
      cliOnly: true,
      models: [
        { id: 'claude-code', name: 'Claude Code', description: 'Claude Code CLI running locally', isDefault: true, active: true },
      ],
    },
    {
      id: 'codex-cli',
      name: 'Codex CLI',
      keyPlaceholder: '',
      keyHint: 'Local CLI — no API key required',
      getKeyUrl: 'https://github.com/openai/codex',
      cliOnly: true,
      models: [
        { id: 'codex', name: 'OpenAI Codex', description: 'OpenAI Codex CLI running locally', isDefault: true, active: true },
      ],
    }
  );
}
