#!/usr/bin/env node
/**
 * Unified webroot development server.
 *
 * Boots the Next.js chat app, mounts the sibling Sanity Next.js site,
 * and serves sibling webroot static repos from a single port.
 *
 * The chat app occupies the server root (no path prefix):
 *   /              → chat home
 *   /chat          → chat list / new chat
 *   /chat/[id]     → conversation
 *   /settings      → settings
 *   /sanity/       → mounted Sanity site
 *   /sanity/admin  → Sanity Studio
 *
 * Static repos are served from the webroot filesystem at their own paths:
 *   /localsite/    /team/    /requests/    /realitystream/    etc.
 *
 * Run from the webroot root:
 *   node chat/server.mjs               → http://localhost:3700
 *   PORT=8887 node chat/server.mjs     → replaces the Python server
 *
 * Or via pnpm (from webroot/ or from inside chat/):
 *   pnpm --prefix chat dev:webroot
 *
 * Note: pins the bundler to webpack (not Turbopack) — see the `webpack: true`
 * option below. For fastest chat-only development use `pnpm --prefix chat dev`
 * instead, which uses the Next.js default bundler.
 */

import { spawn } from 'node:child_process'
import { createServer, request as proxyRequest } from 'node:http'
import { connect as connectSocket } from 'node:net'
import { parse } from 'node:url'
import { join, extname, resolve, dirname } from 'node:path'
import { createReadStream, statSync, existsSync } from 'node:fs'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import next from 'next'
import { prepareSanityRuntime } from './sanity/prepare-runtime.mjs'

// ── Paths ────────────────────────────────────────────────────────────────────

const CHAT_DIR = dirname(fileURLToPath(import.meta.url))  // .../webroot/chat
const WEBROOT  = resolve(CHAT_DIR, '..')                   // .../webroot
const SANITY_SOURCE_DIR = join(WEBROOT, 'sanity')

// ── Environment ──────────────────────────────────────────────────────────────
// Load docker/.env before Next.js boots (mirrors lib/env-loader.ts).

try {
  const { config } = await import('dotenv')
  const envPath = join(WEBROOT, 'docker', '.env')
  if (existsSync(envPath)) {
    config({ path: envPath })
    console.log(`[env] ${envPath}`)
  }
} catch { /* dotenv unavailable — rely on process environment */ }

// Signal to server components that we're running inside the webroot.
process.env.WEBROOT = 'true'
// Expose the webroot path so server code can locate shared files (.gitmodules, .siterepos).
process.env.WEBROOT_PATH = WEBROOT
// Use polling in the unified webroot server to avoid exhausting macOS file
// watcher limits when developing inside the larger webroot checkout.
process.env.WATCHPACK_POLLING = 'true'
// Keep Next.js file watching scoped to the chat repo rather than the entire
// surrounding webroot. The server is often launched from /webroot, which can
// otherwise exhaust local file-watch limits and leave only _not-found mounted.
process.chdir(CHAT_DIR)

// Pre-compute which provider keys are present in the environment so the
// /api/server-keys route can read a single env var without needing dotenv again.
const PROVIDER_ENV_VARS = {
  anthropic: 'ANTHROPIC_API_KEY',
  google:    'GEMINI_API_KEY',
  openai:    'OPENAI_API_KEY',
  xai:       'XAI_API_KEY',
  github:    'GITHUB_PERSONAL_ACCESS_TOKEN',
  pinecone:  'PINECONE_API_KEY',
  voyage:    'VOYAGE_API_KEY',
}
const PLACEHOLDER_PATTERNS = /^(your_|sk-your|<|example|placeholder|xxx|changeme|todo|test|dummy)/i;
const isRealKey = (val) => val && val.trim().length > 0 && !PLACEHOLDER_PATTERNS.test(val.trim()) && !val.includes('_here') && !val.includes('_key_here');

process.env.SERVER_KEYS_JSON = JSON.stringify(
  Object.entries(PROVIDER_ENV_VARS)
    .filter(([, v]) => isRealKey(process.env[v]))
    .map(([id]) => id)
)

// ── Static file serving ──────────────────────────────────────────────────────

// Directories in the webroot that are reserved for Next.js — never served statically.
const NEXTJS_DIRS = new Set(['chat', 'key', 'sanity'])
const SANITY_BASE_PATH = '/sanity'
const SANITY_REQUIRED_ENV = [
  'NEXT_PUBLIC_SANITY_PROJECT_ID',
  'NEXT_PUBLIC_SANITY_DATASET',
  'SANITY_API_READ_TOKEN',
]

const MIME_TYPES = {
  '.html':  'text/html; charset=utf-8',
  '.css':   'text/css',
  '.js':    'application/javascript',
  '.mjs':   'application/javascript',
  '.json':  'application/json',
  '.svg':   'image/svg+xml',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.gif':   'image/gif',
  '.webp':  'image/webp',
  '.ico':   'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.pdf':   'application/pdf',
  '.txt':   'text/plain; charset=utf-8',
  '.md':    'text/plain; charset=utf-8',
  '.mp4':   'video/mp4',
  '.webm':  'video/webm',
}

function redirect(location, res) {
  res.writeHead(301, { Location: location })
  res.end()
}

function serveFile(filePath, res) {
  const mime = MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream'
  res.setHeader('Content-Type', mime)
  createReadStream(filePath).pipe(res)
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function getServerPublicKeyJwk() {
  const pem = process.env.BROWSER_ENCRYPTION_PRIVATE_KEY
  if (!pem) return null
  try {
    const privateKey = createPrivateKey({
      key: pem.replace(/\\n/g, '\n'),
      format: 'pem',
    })
    const publicKey = createPublicKey(privateKey)
    return publicKey.export({ format: 'jwk' })
  } catch {
    return null
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

async function validateProviderKey(provider, key) {
  switch (provider) {
    case 'anthropic': {
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      })
      if (r.status === 200) return true
      if (r.status === 401 || r.status === 403) return false
      return null
    }
    case 'openai': {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      })
      if (r.status === 200) return true
      if (r.status === 401 || r.status === 403) return false
      return null
    }
    case 'google': {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=1`
      )
      if (r.status === 200) return true
      if (r.status === 400 || r.status === 403) return false
      return null
    }
    case 'xai': {
      const r = await fetch('https://api.x.ai/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      })
      if (r.status === 200) return true
      if (r.status === 401 || r.status === 403) return false
      return null
    }
    case 'github': {
      const r = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'codechat-key-validator' },
      })
      if (r.status === 200) return true
      if (r.status === 401 || r.status === 403) return false
      return null
    }
    default:
      return 'unsupported'
  }
}

async function tryInternalApi(req, pathname, res) {
  if (pathname === '/api/status' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      service: 'chat-webroot-dev-server',
      server: 'node',
      mode: dev ? 'development' : 'production',
      port: PORT,
      hostname: HOSTNAME,
      chatRoot: '/',
      chatRoutes: ['/chat', '/chat/keys/', '/settings'],
      sanityMount: SANITY_BASE_PATH,
      staticRoots: ['/localsite/', '/team/', '/requests/', '/realitystream/', '/data-pipeline/', '/home/'],
      cwd: CHAT_DIR,
      webroot: WEBROOT,
      timestamp: new Date().toISOString(),
    })
    return true
  }

  if (pathname === '/api/server-keys' && req.method === 'GET') {
    const keys = process.env.SERVER_KEYS_JSON ? JSON.parse(process.env.SERVER_KEYS_JSON) : []
    sendJson(res, 200, keys)
    return true
  }

  if (pathname === '/api/sanity-status' && req.method === 'GET') {
    sendJson(res, 200, sanityState)
    return true
  }

  if (pathname === '/api/public-key' && req.method === 'GET') {
    const jwk = getServerPublicKeyJwk()
    if (!jwk) {
      res.statusCode = 404
      res.end('Server encryption key not configured')
      return true
    }
    sendJson(res, 200, jwk)
    return true
  }

  if (pathname === '/api/validate-key' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req)
      const { provider, key } = body || {}

      if (!provider || !key) {
        sendJson(res, 400, { error: 'Missing provider or key' })
        return true
      }

      const valid = await validateProviderKey(provider, key)
      if (valid === 'unsupported') {
        sendJson(res, 200, { valid: null, error: 'Unsupported provider' })
        return true
      }

      sendJson(res, 200, { valid })
      return true
    } catch {
      sendJson(res, 200, { valid: null })
      return true
    }
  }

  return false
}

/** Returns true if the request was handled as a static file. */
function tryStatic(pathname, res) {
  const segments = pathname.split('/').filter(Boolean)
  const top = segments[0]

  // /keys/ and /chat/keys — both serve the static key manager widget (localsite nav).
  const isChatKeysRoute = top === 'chat' && segments[1] === 'keys'
  const isKeysRoute = top === 'keys' || isChatKeysRoute

  if (isKeysRoute) {
    // Strip the leading path prefix to get segments relative to chat/keys/
    const relativeSegments = isChatKeysRoute ? segments.slice(2) : segments.slice(1)

    // Root /keys and /chat/keys fall through to Next.js (chat navigation).
    // Sub-paths like /keys/style.css, /keys/key-manager.js are served statically.
    if (relativeSegments.length === 0) return false

    const filePath = join(CHAT_DIR, 'keys', ...relativeSegments)
    try {
      const stat = statSync(filePath)
      if (stat.isFile()) { serveFile(filePath, res); return true }
    } catch { /* not found */ }
    return false
  }

  // /auth/ and /chat/auth — static auth widget (modal + plugin), like /chat/keys.
  // Pure static, no build: the host page loads /chat/auth/js/auth-{modal,plugin}.js.
  const isChatAuthRoute = top === 'chat' && segments[1] === 'auth'
  const isAuthRoute = top === 'auth' || isChatAuthRoute

  if (isAuthRoute) {
    // Strip the leading path prefix to get segments relative to chat/auth/
    const relativeSegments = isChatAuthRoute ? segments.slice(2) : segments.slice(1)
    if (relativeSegments.length === 0) return false

    const filePath = join(CHAT_DIR, 'auth', ...relativeSegments)
    try {
      const stat = statSync(filePath)
      if (stat.isFile()) { serveFile(filePath, res); return true }
    } catch { /* not found */ }
    return false
  }

  // /chat/know — static embed sample demonstrating trade.js's autoload mode,
  // viewable with no Node.js process running (just the static file server).
  // Unlike /chat/keys and /chat/auth (which have real Next.js pages at their
  // root and only serve sub-paths statically), no Next.js route backs
  // /chat/know, so the root path is served here too, not left to fall
  // through to Next.js. This is a separate thing from the top-level /know
  // Next.js route (chat/app/know/), which only exists when Next.js is
  // actually running and is wrapped in the chat app's own navigation.
  const isChatKnowRoute = top === 'chat' && segments[1] === 'know'

  if (isChatKnowRoute) {
    const relativeSegments = segments.slice(2)
    const filePath = join(CHAT_DIR, 'know', ...relativeSegments)
    try {
      const stat = statSync(filePath)
      if (stat.isFile()) { serveFile(filePath, res); return true }
      if (stat.isDirectory()) {
        const idx = join(filePath, 'index.html')
        if (existsSync(idx)) {
          if (!pathname.endsWith('/')) { redirect(pathname + '/', res); return true }
          serveFile(idx, res); return true
        }
      }
    } catch { /* not found */ }
    return false
  }

  // Any webroot directory that isn't reserved for Next.js is served statically.
  if (!top || NEXTJS_DIRS.has(top)) return false

  const filePath = join(WEBROOT, pathname)
  try {
    const stat = statSync(filePath)
    if (stat.isFile()) { serveFile(filePath, res); return true }
    if (stat.isDirectory()) {
      // Only redirect to the trailing-slash form when there's an index.html to
      // serve there — otherwise a directory with no index.html (e.g. a
      // submodule whose content is served by a Next.js route of the same
      // name, like /know) would redirect to add the slash while Next.js
      // redirects right back to strip it, looping forever.
      const idx = join(filePath, 'index.html')
      if (existsSync(idx)) {
        if (!pathname.endsWith('/')) { redirect(pathname + '/', res); return true }
        serveFile(idx, res); return true
      }
    }
  } catch { /* not found — let Next.js return its 404 */ }
  return false
}

function shouldProxyToSanity(pathname) {
  return pathname === SANITY_BASE_PATH || pathname.startsWith(`${SANITY_BASE_PATH}/`)
}

function renderSanityFallbackPage() {
  const missingVars = sanityState.missingVars.map((name) => `<li><code>${escapeHtml(name)}</code></li>`).join('')
  const startupMessage = sanityState.startupError
    ? `<p><strong>Startup status:</strong> ${escapeHtml(sanityState.startupError)}</p>`
    : '<p><strong>Startup status:</strong> Sanity is not mounted yet.</p>'

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sanity Mount Status</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f4f1ea;
      --panel: rgba(255,255,255,0.82);
      --text: #1f2937;
      --muted: #5b6472;
      --accent: #0f766e;
      --border: rgba(15,118,110,0.18);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111827;
        --panel: rgba(17,24,39,0.84);
        --text: #e5e7eb;
        --muted: #9ca3af;
        --accent: #5eead4;
        --border: rgba(94,234,212,0.2);
      }
    }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, sans-serif;
      background: radial-gradient(circle at top, rgba(15,118,110,0.12), transparent 40%), var(--bg);
      color: var(--text);
    }
    main {
      max-width: 880px;
      margin: 0 auto;
      padding: 32px 20px 64px;
    }
    .panel {
      background: var(--panel);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      border-radius: 22px;
      padding: 22px 24px;
      box-shadow: 0 18px 50px rgba(0,0,0,0.08);
      margin-top: 18px;
    }
    h1, h2 { margin: 0 0 10px; }
    p, li { line-height: 1.55; color: var(--muted); }
    code {
      background: rgba(127,127,127,0.14);
      border-radius: 8px;
      padding: 2px 6px;
      color: var(--text);
    }
    pre {
      overflow: auto;
      background: rgba(127,127,127,0.12);
      border-radius: 14px;
      padding: 14px;
      color: var(--text);
    }
    a { color: var(--accent); }
  </style>
</head>
<body>
  <main>
    <div class="panel">
      <h1>Sanity Mount Pending</h1>
      <p>The combined chat server is running, but the mounted Sanity app is not currently available.</p>
      ${startupMessage}
    </div>
    <div class="panel">
      <h2>What Works Now</h2>
      <p>The chat app on <code>/</code> and the rest of the webroot continue running normally. This page is served by <code>chat/server.mjs</code> as a graceful fallback for <code>/sanity</code>.</p>
    </div>
    <div class="panel">
      <h2>Missing Config</h2>
      ${missingVars
        ? `<ul>${missingVars}</ul>`
        : '<p>No required Sanity env vars are missing. If startup still fails, check whether the values are valid.</p>'}
      <p>Expected local source: <code>docker/.env</code></p>
    </div>
    <div class="panel">
      <h2>Expected Values</h2>
      <pre>NEXT_PUBLIC_SANITY_PROJECT_ID=your_sanity_project_id
NEXT_PUBLIC_SANITY_DATASET=production
SANITY_API_READ_TOKEN=your_sanity_viewer_token
NEXT_PUBLIC_BASE_URL=http://localhost:3700/sanity</pre>
      <p>Mount path injection is handled automatically by chat and does not need to be stored in the upstream <code>sanity/</code> repo.</p>
    </div>
    <div class="panel">
      <h2>Local Guidance</h2>
      <p><a href="/chat/sanity/README.md">chat/sanity/README.md</a></p>
      <p>The upstream repo remains untouched in the local <code>sanity/</code> submodule.</p>
    </div>
  </main>
</body>
</html>`
}

function serveSanityFallback(res) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(renderSanityFallbackPage())
}

function proxyToSanity(req, res) {
  if (!sanityState.running) {
    serveSanityFallback(res)
    return
  }
  const upstream = proxyRequest(
    {
      hostname: HOSTNAME,
      port: SANITY_PORT,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        host: `${HOSTNAME}:${SANITY_PORT}`,
      },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers)
      upstreamRes.pipe(res)
    }
  )

  upstream.on('error', (error) => {
    console.error('Sanity proxy error:', error)
    sanityState.running = false
    sanityState.startupError = `Proxy failed: ${error.message}`
    serveSanityFallback(res)
  })

  req.pipe(upstream)
}

function proxySanityUpgrade(req, socket, head) {
  if (!sanityState.running) {
    socket.destroy()
    return
  }
  const upstream = connectSocket(SANITY_PORT, HOSTNAME, () => {
    const headerLines = Object.entries(req.headers)
      .filter(([key]) => key.toLowerCase() !== 'host')
      .flatMap(([key, value]) => {
        if (Array.isArray(value)) return value.map((item) => `${key}: ${item}`)
        return value === undefined ? [] : [`${key}: ${value}`]
      })

    upstream.write(
      [
        `${req.method} ${req.url} HTTP/${req.httpVersion}`,
        ...headerLines,
        `host: ${HOSTNAME}:${SANITY_PORT}`,
        '',
        '',
      ].join('\r\n')
    )

    if (head?.length) upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })

  upstream.on('error', (error) => {
    console.error('Sanity upgrade proxy error:', error)
    socket.destroy()
  })

  socket.on('error', () => upstream.destroy())
}

// ── Next.js ──────────────────────────────────────────────────────────────────

const PORT     = parseInt(process.env.PORT || '3700', 10)
const SANITY_PORT = parseInt(process.env.SANITY_PORT || '3701', 10)
const HOSTNAME = 'localhost'
const dev      = process.env.NODE_ENV !== 'production'
const sanityState = {
  enabled: existsSync(join(SANITY_SOURCE_DIR, 'package.json')),
  configured: false,
  running: false,
  mountPath: SANITY_BASE_PATH,
  sourceDir: SANITY_SOURCE_DIR,
  missingVars: [],
  startupError: '',
}

function getMissingSanityVars() {
  return SANITY_REQUIRED_ENV.filter((name) => !isRealKey(process.env[name]))
}

async function startSanityDevServer() {
  if (!dev || !sanityState.enabled) return null

  sanityState.missingVars = getMissingSanityVars()
  sanityState.configured = sanityState.missingVars.length === 0
  if (!sanityState.configured) {
    sanityState.startupError = `Missing required Sanity env vars: ${sanityState.missingVars.join(', ')}`
    console.warn(`[sanity] ${sanityState.startupError}`)
    return null
  }

  const sanityRuntimeDir = await prepareSanityRuntime()
  if (!sanityRuntimeDir) return null

  console.log(`[sanity] Starting Next.js site on http://${HOSTNAME}:${SANITY_PORT}${SANITY_BASE_PATH}`)

  const child = spawn(
    'bun',
    ['run', 'dev', '--', '--hostname', HOSTNAME, '--port', String(SANITY_PORT)],
    {
      cwd: sanityRuntimeDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        NEXT_PUBLIC_BASE_PATH: SANITY_BASE_PATH,
        NEXT_PUBLIC_BASE_URL:
          process.env.SANITY_PUBLIC_BASE_URL ||
          process.env.NEXT_PUBLIC_BASE_URL ||
          `http://${HOSTNAME}:${PORT}${SANITY_BASE_PATH}`,
      },
    }
  )

  child.once('error', (error) => {
    sanityState.running = false
    sanityState.startupError = error.message
    console.error('[sanity] Failed to start dev server:', error)
  })

  child.once('exit', (code, signal) => {
    sanityState.running = false
    if (signal || code) {
      sanityState.startupError = `Sanity dev server exited (${signal || `code ${code}`})`
    }
    if (signal || code) {
      console.error(`[sanity] Dev server exited (${signal || `code ${code}`})`)
    }
  })

  sanityState.running = true
  sanityState.startupError = ''

  return child
}

// hostname + port must be passed so Next.js binds HMR WebSockets correctly.
// Webpack is the default for the unified webroot server: Turbopack's file watcher
// footprint can exceed OS limits across the full webroot (many submodules), causing
// the route manifest to collapse to only `_not-found` and spiking CPU.
// Opt into Turbopack with: TURBOPACK=1 node chat/server.mjs
const useTurbopack = process.env.TURBOPACK === '1'
const app    = next({ dev, dir: CHAT_DIR, hostname: HOSTNAME, port: PORT, ...(useTurbopack ? {} : { webpack: true }) })
const handle = app.getRequestHandler()
const sanityProcess = await startSanityDevServer()

function stopSanityDevServer() {
  if (sanityProcess && !sanityProcess.killed) sanityProcess.kill('SIGTERM')
}

process.once('SIGINT', stopSanityDevServer)
process.once('SIGTERM', stopSanityDevServer)
process.once('exit', stopSanityDevServer)

app.prepare().then(() => {
  const upgradeHandler = app.getUpgradeHandler?.()

  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true)
      if (shouldProxyToSanity(parsedUrl.pathname)) {
        proxyToSanity(req, res)
        return
      }
      if (!(await tryInternalApi(req, parsedUrl.pathname, res)) && !tryStatic(parsedUrl.pathname, res)) {
        await handle(req, res, parsedUrl)
      }
    } catch (err) {
      console.error('Request error:', req.url, err)
      res.statusCode = 500
      res.end('Internal server error')
    }
  })

  server.on('upgrade', (req, socket, head) => {
    const pathname = parse(req.url || '/', true).pathname
    if (shouldProxyToSanity(pathname)) {
      proxySanityUpgrade(req, socket, head)
      return
    }
    if (upgradeHandler) {
      upgradeHandler(req, socket, head)
      return
    }
    socket.destroy()
  })

  server
    .once('error', (err) => { console.error(err); process.exit(1) })
    .listen(PORT, HOSTNAME, () => {
      console.log(`\n> Ready on http://${HOSTNAME}:${PORT}`)
      console.log(`  Chat        : http://${HOSTNAME}:${PORT}/chat`)
      console.log(`  Sanity site : http://${HOSTNAME}:${PORT}${SANITY_BASE_PATH}/`)
      console.log(`  Sanity admin: http://${HOSTNAME}:${PORT}${SANITY_BASE_PATH}/admin`)
      console.log(`  Key manager : http://${HOSTNAME}:${PORT}/chat/keys/`)
      console.log(`  Know (static): http://${HOSTNAME}:${PORT}/chat/know/`)
      console.log(`  Know (Next) : http://${HOSTNAME}:${PORT}/know`)
      console.log(`  Static      : all webroot dirs except /chat and /sanity`)
    })
})
