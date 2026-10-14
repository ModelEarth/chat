#!/usr/bin/env node
/**
 * Unified webroot development server.
 *
 * Boots the Next.js chat app and serves sibling webroot static repos
 * from a single port.
 *
 * The chat app occupies the server root (no path prefix):
 *   /              → chat home
 *   /chat          → chat list / new chat
 *   /chat/[id]     → conversation
 *   /settings      → settings
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

import { execFile } from 'node:child_process'
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { parse } from 'node:url'
import { join, extname, resolve, dirname } from 'node:path'
import { createReadStream, statSync, existsSync } from 'node:fs'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { freemem, totalmem, loadavg } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import { fileURLToPath } from 'node:url'
import next from 'next'
import { readEnvFileSetting } from './lib/parse-env-file-setting.mjs'

// ── Paths ────────────────────────────────────────────────────────────────────

const CHAT_DIR = dirname(fileURLToPath(import.meta.url))  // .../webroot/chat
const WEBROOT  = resolve(CHAT_DIR, '..')                   // .../webroot
const AUTOMATION_DIR = join(WEBROOT, 'automation')

// ── Environment ──────────────────────────────────────────────────────────────
// Load the .env file automation/paths.yaml's `env_file:` key points at
// before Next.js boots. Mirrors lib/env-loader.ts exactly — both share
// lib/parse-env-file-setting.mjs's paths.yaml parsing and the same fallback
// chain (automation/paths.yaml → local chat/.env → system env) — instead of
// a second, hand-kept-in-sync copy of the parsing logic.

try {
  const { config } = await import('dotenv')
  let loaded = false

  if (existsSync(AUTOMATION_DIR)) {
    const pathsYamlFile = join(AUTOMATION_DIR, 'paths.yaml')
    const envFileSetting = readEnvFileSetting(pathsYamlFile)

    if (envFileSetting) {
      const envPath = resolve(AUTOMATION_DIR, envFileSetting)
      if (existsSync(envPath)) {
        config({ path: envPath })
        console.log(`[env] ${envPath} (via ${pathsYamlFile})`)
        loaded = true
      } else {
        console.log(`[env] ${pathsYamlFile} points at ${envPath}, but it doesn't exist yet`)
      }
    } else {
      console.log(`[env] No env_file: set in ${pathsYamlFile} yet`)
    }
  }

  if (!loaded) {
    // Mode C fallback: a local .env file next to server.mjs — no
    // webroot/automation context at all (standalone chat/ checkout).
    const localEnvPath = join(CHAT_DIR, '.env')
    if (existsSync(localEnvPath)) {
      config({ path: localEnvPath })
      console.log(`[env] ${localEnvPath}`)
    } else {
      console.log('[env] No .env file found, using system environment variables')
    }
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
const NEXTJS_DIRS = new Set(['chat', 'key'])

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

function run(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => resolve(error ? '' : stdout))
  })
}

// Processes listening on TCP ports (this user's, as lsof reports without
// sudo), one entry per process, with resident memory from ps.
async function listeningPorts() {
  const byPid = new Map()
  let pid = null
  for (const line of (await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'])).split('\n')) {
    const field = line[0]
    const value = line.slice(1)
    if (field === 'p') {
      pid = Number(value)
      if (!byPid.has(pid)) byPid.set(pid, { pid, name: '', ports: new Set() })
    } else if (field === 'c' && pid) {
      byPid.get(pid).name = value
    } else if (field === 'n' && pid) {
      const port = Number(value.slice(value.lastIndexOf(':') + 1))
      if (port) byPid.get(pid).ports.add(port)
    }
  }
  if (!byPid.size) return []
  const details = new Map()
  for (const line of (await run('ps', ['-o', 'pid=,rss=,args=', '-p', [...byPid.keys()].join(',')])).split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)
    if (!match) continue
    // Program and script names only, no full paths or later arguments.
    const command = match[3].split(/\s+/).slice(0, 3).map((part) => part.split('/').pop()).join(' ').slice(0, 60)
    details.set(Number(match[1]), { rssMB: Math.round(Number(match[2]) / 1024), command })
  }
  return [...byPid.values()]
    .map((entry) => ({
      pid: entry.pid,
      name: entry.name,
      ports: [...entry.ports].sort((a, b) => a - b),
      rssMB: details.get(entry.pid)?.rssMB ?? null,
      command: details.get(entry.pid)?.command ?? entry.name,
    }))
    .sort((a, b) => (b.rssMB ?? 0) - (a.rssMB ?? 0))
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
      staticRoots: ['/localsite/', '/team/', '/requests/', '/realitystream/', '/data-pipeline/', '/home/'],
      cwd: CHAT_DIR,
      webroot: WEBROOT,
      timestamp: new Date().toISOString(),
    })
    return true
  }

  // Memory of this dev server, for team/admin/memory/ in webroot. Readable
  // from other localhost pages (e.g. webroot on 8887); the server only
  // listens on localhost.
  if (pathname === '/api/server-memory' && req.method === 'GET') {
    const origin = req.headers.origin || ''
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
    }
    const mb = (bytes) => Math.round(bytes / 1048576)
    const memory = process.memoryUsage()
    const heap = getHeapStatistics()
    sendJson(res, 200, {
      server: 'node chat/server.mjs',
      node: process.version,
      pid: process.pid,
      port: PORT,
      uptimeSeconds: Math.round(process.uptime()),
      rssMB: mb(memory.rss),
      heapUsedMB: mb(memory.heapUsed),
      heapTotalMB: mb(memory.heapTotal),
      heapLimitMB: mb(heap.heap_size_limit),
      externalMB: mb(memory.external),
      systemFreeMB: mb(freemem()),
      systemTotalMB: mb(totalmem()),
      loadAverage: loadavg().map((n) => Math.round(n * 100) / 100),
      timestamp: new Date().toISOString(),
    })
    return true
  }

  // Every process listening on a local TCP port, with its memory, for the
  // ports panel in team/admin/memory/. It lists process names, so other
  // websites open in the browser can't read it: requests carrying an Origin
  // must come from localhost.
  if (pathname === '/api/port-memory' && req.method === 'GET') {
    const origin = req.headers.origin || ''
    const localOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    if (origin && !localOrigin) {
      res.statusCode = 403
      res.end('Local pages only')
      return true
    }
    const ports = await listeningPorts()
    // Not sendJson, which allows any origin.
    res.statusCode = 200
    if (localOrigin) res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ ports, timestamp: new Date().toISOString() }))
    return true
  }

  if (pathname === '/api/server-keys' && req.method === 'GET') {
    const keys = process.env.SERVER_KEYS_JSON ? JSON.parse(process.env.SERVER_KEYS_JSON) : []
    sendJson(res, 200, keys)
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

// ── Sign-in API from the CloudRoot Worker ───────────────────────────────────
// When the Worker runs locally (`npm run dev` in worker/, port 3701), sign-in
// requests here go to it, so localhost uses the same sign-in code as
// cloud.model.earth: the auth repo's /auth/ pages, the widget and chat's own
// pages. It shares the env file's database and BETTER_AUTH_SECRET with chat,
// so sessions work in both. Without it, chat's own API answers as before.
// chat's local-only env panels stay with chat.
const AUTH_WORKER = new URL(process.env.AUTH_WORKER_URL || 'http://localhost:3701')
const CHAT_ONLY_AUTH = new Set(['/api/auth/local-env-values', '/api/auth/supabase-env-values'])
let workerCheck = { at: 0, up: false }

function isWorkerAuthPath(pathname) {
  return (pathname.startsWith('/api/auth/') || pathname.startsWith('/api/oauth/')) && !CHAT_ONLY_AUTH.has(pathname)
}

// Whether the Worker is listening, checked at most every 5 seconds.
function authWorkerUp() {
  if (Date.now() - workerCheck.at < 5000) return Promise.resolve(workerCheck.up)
  return new Promise((done) => {
    const socket = connect({ host: AUTH_WORKER.hostname, port: Number(AUTH_WORKER.port || 80) })
    const finish = (up) => { socket.destroy(); workerCheck = { at: Date.now(), up }; done(up) }
    socket.setTimeout(300, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

function proxyToAuthWorker(req, res) {
  const upstream = httpRequest({
    host: AUTH_WORKER.hostname,
    port: AUTH_WORKER.port,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: AUTH_WORKER.host },
  }, (response) => {
    res.writeHead(response.statusCode, response.headers)
    response.pipe(res)
  })
  upstream.on('error', () => {
    workerCheck = { at: 0, up: false }
    if (!res.headersSent) { res.statusCode = 502; res.end('Sign-in service unavailable') }
  })
  req.pipe(upstream)
}

/** Returns true if the request was handled as a static file. */
function tryStatic(pathname, res) {
  const segments = pathname.split('/').filter(Boolean)
  const top = segments[0]

  // Browsers resolve "..", but a raw request can keep it, and join() would then
  // climb out of the webroot (e.g. to ../safe/*.env). Refuse those paths.
  if (segments.includes('..')) {
    res.statusCode = 400
    res.end('Bad request')
    return true
  }

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

  // /auth/ and /chat/auth — the webroot's auth submodule: the sign-in widget
  // (auth/public/js/auth-{modal,plugin}.js) and, once built, the sign-in
  // pages' static export (auth/out). Without the export, /auth itself falls
  // through to chat's own Next.js page.
  const isChatAuthRoute = top === 'chat' && segments[1] === 'auth'
  const isAuthRoute = top === 'auth' || isChatAuthRoute

  if (isAuthRoute) {
    const relativeSegments = isChatAuthRoute ? segments.slice(2) : segments.slice(1)
    for (const dir of ['public', 'out']) {
      const filePath = join(WEBROOT, 'auth', dir, ...relativeSegments)
      try {
        const stat = statSync(filePath)
        if (stat.isFile()) { serveFile(filePath, res); return true }
        const idx = join(filePath, 'index.html')
        if (stat.isDirectory() && existsSync(idx)) {
          if (!pathname.endsWith('/')) { redirect(pathname + '/', res); return true }
          serveFile(idx, res); return true
        }
      } catch { /* not found */ }
    }
    return false
  }

  // /know and /chat/know — static embed sample demonstrating trade.js's
  // autoload mode, living in the top-level know/ submodule. Root /know is a
  // real Next.js page (chat/app/know/) that embeds a different asset
  // (public/know/embed.html) via iframe, so — like /keys and /auth — the
  // root path falls through to Next.js here; only sub-paths (e.g.
  // /know/index.html) are served statically, straight from the submodule.
  const isChatKnowRoute = top === 'chat' && segments[1] === 'know'
  const isKnowRoute = top === 'know' || isChatKnowRoute

  if (isKnowRoute) {
    const relativeSegments = isChatKnowRoute ? segments.slice(2) : segments.slice(1)
    if (relativeSegments.length === 0) return false

    const filePath = join(WEBROOT, 'know', ...relativeSegments)
    try {
      const stat = statSync(filePath)
      if (stat.isFile()) { serveFile(filePath, res); return true }
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

// ── Next.js ──────────────────────────────────────────────────────────────────

const PORT     = parseInt(process.env.PORT || '3700', 10)
const HOSTNAME = 'localhost'
const dev      = process.env.NODE_ENV !== 'production'

// hostname + port must be passed so Next.js binds HMR WebSockets correctly.
// Webpack is the default for the unified webroot server: Turbopack's file watcher
// footprint can exceed OS limits across the full webroot (many submodules), causing
// the route manifest to collapse to only `_not-found` and spiking CPU.
// Opt into Turbopack with: TURBOPACK=1 node chat/server.mjs
const useTurbopack = process.env.TURBOPACK === '1'
const app    = next({ dev, dir: CHAT_DIR, hostname: HOSTNAME, port: PORT, ...(useTurbopack ? {} : { webpack: true }) })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const upgradeHandler = app.getUpgradeHandler?.()

  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true)
      if (isWorkerAuthPath(parsedUrl.pathname) && await authWorkerUp()) {
        proxyToAuthWorker(req, res)
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
      console.log(`  Key manager : http://${HOSTNAME}:${PORT}/chat/keys/`)
      console.log(`  Know (static): http://${HOSTNAME}:${PORT}/know/index.html`)
      console.log(`  Know (Next) : http://${HOSTNAME}:${PORT}/know`)
      console.log(`  Static      : all webroot dirs except /chat`)
    })
})
