/**
 * Browser-side encryption for API keys using the Web Crypto API.
 *
 * Uses a non-extractable AES-GCM-256 key stored in IndexedDB.  The key is
 * unique per browser profile and origin — it can never be exported and is
 * therefore inaccessible to injected scripts that can only read storage values.
 *
 * Encrypted format stored in localStorage: "<iv base64>:<ciphertext base64>"
 */

const DB_NAME = "km-store";
const DB_VERSION = 1;
const KEY_STORE = "keys";
const KEY_ID = "browser-key";

// Matches the "<base64iv>:<base64ciphertext>" format produced by encryptValue.
// Both segments are standard base64 (A-Z, a-z, 0-9, +, /, optional = padding).
const ENCRYPTED_RE = /^[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/;

let _cachedKey: CryptoKey | null = null;

// ── IndexedDB helpers ────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(KEY_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadStoredKey(db: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readonly");
    const req = tx.objectStore(KEY_STORE).get(KEY_ID);
    req.onsuccess = () => resolve((req.result as CryptoKey) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function saveStoredKey(db: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readwrite");
    const req = tx.objectStore(KEY_STORE).put(key, KEY_ID);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Retrieve the browser-specific CryptoKey from IndexedDB, generating a new
 * non-extractable AES-GCM-256 key if one does not yet exist.
 */
export async function initBrowserKey(): Promise<CryptoKey> {
  if (_cachedKey) return _cachedKey;

  const db = await openDB();
  let key = await loadStoredKey(db);

  if (!key) {
    key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false, // non-extractable — raw bytes are never accessible to JS
      ["encrypt", "decrypt"]
    );
    await saveStoredKey(db, key);
  }

  _cachedKey = key;
  db.close();
  return key;
}

/**
 * Encrypt a plaintext string using the browser key.
 * Returns a "<iv base64>:<ciphertext base64>" string suitable for localStorage.
 */
export async function encryptValue(plaintext: string): Promise<string> {
  const key = await initBrowserKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
  return `${ivB64}:${ctB64}`;
}

/**
 * Decrypt a stored "<iv base64>:<ciphertext base64>" string.
 * Throws if the browser key does not match (different browser/profile).
 */
export async function decryptValue(stored: string): Promise<string> {
  const key = await initBrowserKey();
  const colonIdx = stored.indexOf(":");
  const ivB64 = stored.slice(0, colonIdx);
  const ctB64 = stored.slice(colonIdx + 1);
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(plaintext);
}

/**
 * Returns true if the value looks like it was produced by encryptValue().
 * Used to migrate legacy plaintext entries without double-encrypting.
 */
export function isEncrypted(value: string): boolean {
  return ENCRYPTED_RE.test(value);
}

/**
 * Returns true if the value was encrypted for the server with encryptForServer().
 * These values are stored as "rsa:<base64>" and cannot be decrypted in the browser.
 */
export function isServerEncrypted(value: string): boolean {
  return value.startsWith("rsa:");
}

// ── RSA-OAEP server-key encryption (Phase 9) ─────────────────────────────────

let _cachedServerPublicKey: CryptoKey | null = null;
let _publicKeyUnavailable = false;
// Providers the server can use from an encrypted key (/api/public-key's server_providers).
let _serverProviders: string[] = [];

/**
 * Fetch the server's RSA public key from /api/public-key and import it as a
 * non-extractable CryptoKey for RSA-OAEP encryption.
 * Caches the result in memory so subsequent calls are synchronous.
 * Throws if the key endpoint is unavailable or misconfigured.
 */
export async function fetchServerPublicKey(): Promise<CryptoKey> {
  if (_cachedServerPublicKey) return _cachedServerPublicKey;
  if (_publicKeyUnavailable) throw new Error("Server public key unavailable");
  try {
    const res = await fetch("/api/public-key");
    if (!res.ok) throw new Error("Server public key unavailable");
    const jwk = await res.json();
    _serverProviders = Array.isArray(jwk.server_providers) ? jwk.server_providers : [];
    _cachedServerPublicKey = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e },
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"]
    );
    return _cachedServerPublicKey;
  } catch (error) {
    _publicKeyUnavailable = true;
    throw error;
  }
}

/** Whether the server can use this provider's key from an encrypted value. */
export async function serverCanUse(provider: string): Promise<boolean> {
  try {
    await fetchServerPublicKey();
    return _serverProviders.includes(provider);
  } catch {
    return false;
  }
}

/**
 * Encrypt a provider's key with the server's RSA public key, as
 * "<provider>\n<key>" so the server opens it only for that provider.
 * Returns a "rsa:<base64>" string that only the server can decrypt.
 * Throws if the server key is unavailable or the server can't use this
 * provider's key, so the caller keeps it in the browser instead.
 */
export async function encryptForServer(plaintext: string, provider: string): Promise<string> {
  const key = await fetchServerPublicKey();
  if (!_serverProviders.includes(provider)) {
    throw new Error(`The server can't use ${provider} keys`);
  }
  const ct = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    key,
    new TextEncoder().encode(`${provider}\n${plaintext}`)
  );
  const b64 = btoa(String.fromCharCode(...new Uint8Array(ct)));
  return `rsa:${b64}`;
}
