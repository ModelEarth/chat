/**
 * Server-side RSA decryption for API keys encrypted by the browser with the
 * server's public key (Phase 9 — Asymmetric Key Encryption).
 *
 * Requires BROWSER_ENCRYPTION_PRIVATE_KEY in the environment — a PEM-encoded
 * RSA-OAEP 2048-bit private key. Generate with:
 *   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out server_private.pem
 *   openssl rsa -pubout -in server_private.pem -out server_public.pem
 *
 * Store the contents of server_private.pem in BROWSER_ENCRYPTION_PRIVATE_KEY
 * (newlines escaped as \n in .env files).
 */

import {
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  constants,
} from "node:crypto";

// Providers whose keys the server uses from an encrypted value: each is sent
// only to that provider's own API. Also listed in server.mjs (local dev).
export const SERVER_KEY_PROVIDERS = ["google", "anthropic", "openai", "pinecone", "voyage"];

let _cachedPrivateKey: ReturnType<typeof createPrivateKey> | null = null;

function getServerPrivateKey(): ReturnType<typeof createPrivateKey> | null {
  if (_cachedPrivateKey) return _cachedPrivateKey;
  const pem = process.env.BROWSER_ENCRYPTION_PRIVATE_KEY;
  if (!pem) return null;
  try {
    _cachedPrivateKey = createPrivateKey({
      key: pem.replace(/\\n/g, "\n"),
      format: "pem",
    });
    return _cachedPrivateKey;
  } catch {
    return null;
  }
}

/**
 * Decrypt a "rsa:<base64>" blob that was encrypted by the browser using the
 * server public key via RSA-OAEP / SHA-256. It holds "<provider>\n<key>", and
 * opens only for that provider, so a key can't be sent to another provider.
 * Returns the key, or null if the server key is not configured, the blob is
 * for another provider, or decryption fails.
 */
export function decryptWithServerKey(blob: string, provider: string): string | null {
  const privateKey = getServerPrivateKey();
  if (!privateKey || !SERVER_KEY_PROVIDERS.includes(provider)) return null;
  try {
    const b64 = blob.startsWith("rsa:") ? blob.slice(4) : blob;
    const ciphertext = Buffer.from(b64, "base64");
    const plaintext = privateDecrypt(
      {
        key: privateKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      ciphertext
    );
    const text = plaintext.toString("utf-8");
    const split = text.indexOf("\n");
    if (split < 0 || text.slice(0, split) !== provider) return null;
    return text.slice(split + 1) || null;
  } catch {
    return null;
  }
}

/**
 * Return the server's RSA public key as a JWK object, suitable for returning
 * from GET /api/public-key and importing in the browser via crypto.subtle.importKey.
 * Returns null if BROWSER_ENCRYPTION_PRIVATE_KEY is not set.
 */
export function getServerPublicKeyJwk(): object | null {
  const privateKey = getServerPrivateKey();
  if (!privateKey) return null;
  try {
    const { kty, n, e } = createPublicKey(privateKey).export({ format: "jwk" });
    return { kty, n, e, server_providers: SERVER_KEY_PROVIDERS };
  } catch {
    return null;
  }
}
