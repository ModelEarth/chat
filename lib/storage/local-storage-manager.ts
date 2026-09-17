/**
 * LocalStorageManager - Secure storage utility for API keys and integrations
 */

import type {
  APIProvider,
  LocalStorageSchema,
  StorageConfig,
  StorageError,
  StorageEvent,
  StorageManager,
  StorageQuotaInfo,
} from "./types";
import { StorageErrorType } from "./types";
import {
  decryptValue,
  encryptValue,
  encryptForServer,
  isEncrypted,
  isServerEncrypted,
} from "./crypto";

class LocalStorageManager implements StorageManager {
  private static instance: LocalStorageManager;
  private readonly storagePrefix = "settings_";
  private readonly eventListeners: ((event: StorageEvent) => void)[] = [];
  private config: StorageConfig = {
    useSessionStorage: false,
    autoCleanupOnLogout: true,
    maxStorageSize: 5 * 1024 * 1024, // 5MB default
    enableEncryption: false,
  };
  private cleanupListeners: (() => void)[] = [];

  // In-memory plaintext cache — populated by initCrypto() and kept in sync by
  // setAPIKey / removeAPIKey.  getAPIKey() reads from this cache so callers
  // always receive plaintext and do not need to handle async decryption.
  private _plaintextCache: Map<string, string> = new Map();

  // Providers whose stored key is an RSA blob ("rsa:...") — the key exists in
  // localStorage but can only be decrypted server-side.  Populated by initCrypto().
  private _serverEncryptedProviders: Set<string> = new Set();

  private constructor() {
    this.setupAutoCleanup();
  }

  static getInstance(): LocalStorageManager {
    if (!LocalStorageManager.instance) {
      LocalStorageManager.instance = new LocalStorageManager();
    }
    return LocalStorageManager.instance;
  }

  /**
   * Get the appropriate storage object based on configuration
   */
  private getStorage(): Storage | null {
    try {
      const storage = this.config.useSessionStorage
        ? sessionStorage
        : localStorage;
      const test = "__storage_test__";
      storage.setItem(test, test);
      storage.removeItem(test);
      return storage;
    } catch {
      return null;
    }
  }

  /**
   * Check if storage is available
   */
  private isStorageAvailable(): boolean {
    return this.getStorage() !== null;
  }

  /**
   * Get storage key with prefix
   */
  private getStorageKey(key: keyof LocalStorageSchema): string {
    return `${this.storagePrefix}${key}`;
  }

  /**
   * Safely get data from storage
   */
  private getStorageData<T>(key: keyof LocalStorageSchema): T | null {
    const storage = this.getStorage();
    if (!storage) {
      this.emitStorageError(
        StorageErrorType.STORAGE_UNAVAILABLE,
        "Storage is not available"
      );
      return null;
    }

    try {
      const storageKey = this.getStorageKey(key);
      const data = storage.getItem(storageKey);

      if (!data) {
        return null;
      }

      const parsed = JSON.parse(data) as T;
      return parsed;
    } catch (error) {
      console.error(`Failed to get storage data for key ${key}:`, error);
      this.emitStorageError(
        StorageErrorType.DATA_CORRUPTION,
        `Failed to parse data for key ${key}`
      );
      return null;
    }
  }

  /**
   * Safely set data to storage
   */
  private setStorageData<T>(key: keyof LocalStorageSchema, data: T): void {
    const storage = this.getStorage();
    if (!storage) {
      this.emitStorageError(
        StorageErrorType.STORAGE_UNAVAILABLE,
        "Storage is not available"
      );
      return;
    }

    try {
      const storageKey = this.getStorageKey(key);
      const jsonData = JSON.stringify(data);

      // Check storage quota before setting
      const quotaInfo = this.getStorageQuota();
      if (quotaInfo && jsonData.length > quotaInfo.available) {
        this.emitStorageError(
          StorageErrorType.QUOTA_EXCEEDED,
          "Storage quota exceeded"
        );
        return;
      }

      storage.setItem(storageKey, jsonData);
    } catch (error) {
      console.error(`Failed to set storage data for key ${key}:`, error);

      if (error instanceof Error && error.name === "QuotaExceededError") {
        this.emitStorageError(
          StorageErrorType.QUOTA_EXCEEDED,
          "Storage quota exceeded"
        );
      } else {
        this.emitStorageError(
          StorageErrorType.UNKNOWN_ERROR,
          `Failed to set data for key ${key}`
        );
      }
    }
  }

  /**
   * Emit storage event to listeners
   */
  private emitEvent(event: StorageEvent): void {
    this.eventListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error("Storage event listener error:", error);
      }
    });
  }

  /**
   * Emit storage error event
   */
  private emitStorageError(
    type: StorageErrorType,
    message: string,
    _details?: any
  ): void {
    this.emitEvent({
      type: "storage-error",
      timestamp: Date.now(),
      error: `${type}: ${message}`,
    });
  }

  /**
   * Get API key for a specific provider.
   * Returns from the in-memory plaintext cache (populated by initCrypto()).
   * Falls back to raw storage only when the cache has not been initialized yet
   * (e.g. very early in app startup) — in that case plaintext keys still work
   * and encrypted values are skipped gracefully.
   */
  getAPIKey(provider: APIProvider): string | null {
    if (this._plaintextCache.has(provider)) {
      return this._plaintextCache.get(provider)!;
    }
    // Cache miss — read raw storage as a fallback (pre-initCrypto path).
    const apiKeys =
      this.getStorageData<LocalStorageSchema["api-keys"]>("api-keys");
    const raw = apiKeys?.[provider];
    // Return null for encrypted values we cannot decrypt synchronously.
    if (!raw || isEncrypted(raw)) return null;
    return raw;
  }

  /**
   * Set API key for a specific provider.
   * Updates the in-memory plaintext cache immediately (so getAPIKey() works at
   * once) then encrypts and persists to localStorage in the background.
   * Records the edit timestamp used by the 1-hour export window.
   */
  setAPIKey(provider: APIProvider, key: string): void {
    // Update cache synchronously so callers can read the key right away.
    this._plaintextCache.set(provider, key);

    // Record the edit timestamp for the export window check.
    try {
      localStorage.setItem("settings_api-keys-last-edit", String(Date.now()));
    } catch (_) {}

    // Try RSA (server-only decryptable) first; fall back to browser AES.
    encryptForServer(key)
      .then((rsaBlob) => {
        const apiKeys =
          this.getStorageData<LocalStorageSchema["api-keys"]>("api-keys") || {};
        apiKeys[provider] = rsaBlob;
        this.setStorageData("api-keys", apiKeys);
        this._serverEncryptedProviders.add(provider);
      })
      .catch(() => {
        // Server public key unavailable — fall back to browser AES encryption.
        encryptValue(key)
          .then((encrypted) => {
            const apiKeys =
              this.getStorageData<LocalStorageSchema["api-keys"]>(
                "api-keys"
              ) || {};
            apiKeys[provider] = encrypted;
            this.setStorageData("api-keys", apiKeys);
          })
          .catch((err) => {
            console.warn(
              "[storage] crypto unavailable, writing plaintext key",
              err
            );
            const apiKeys =
              this.getStorageData<LocalStorageSchema["api-keys"]>(
                "api-keys"
              ) || {};
            apiKeys[provider] = key;
            this.setStorageData("api-keys", apiKeys);
          });
      });

    this.emitEvent({
      type: "api-key-updated",
      provider,
      timestamp: Date.now(),
    });
  }

  /**
   * Remove API key for a specific provider
   */
  removeAPIKey(provider: APIProvider): void {
    this._plaintextCache.delete(provider);
    const apiKeys =
      this.getStorageData<LocalStorageSchema["api-keys"]>("api-keys");
    if (apiKeys?.[provider]) {
      delete apiKeys[provider];
      this.setStorageData("api-keys", apiKeys);

      this.emitEvent({
        type: "api-key-removed",
        provider,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Migrate API keys from legacy localStorage formats into settings_api-keys.
   * - Reads `aPro` (requests/engine format): { GEMINI_API_KEY: "...", ... }
   * - Reads per-key entries: gemini_api_key, anthropic_api_key, openai_api_key, xai_api_key
   * Runs safely if called multiple times (skips already-set providers, removes legacy keys).
   */
  migrateFromLegacy(): void {
    const storage = this.getStorage();
    if (!storage) return;

    // Map from aPro env-var key names → provider IDs
    const ENV_TO_PROVIDER: Record<string, APIProvider> = {
      GEMINI_API_KEY: "google",
      ANTHROPIC_API_KEY: "anthropic",
      OPENAI_API_KEY: "openai",
      XAI_API_KEY: "xai",
      GROQ_API_KEY: "groq",
      TOGETHER_API_KEY: "together",
      FIREWORKS_API_KEY: "fireworks",
      MISTRAL_API_KEY: "mistral",
      PERPLEXITY_API_KEY: "perplexity",
      DEEPSEEK_API_KEY: "deepseek",
      DISCORD_BOT_TOKEN: "discord",
    };

    // Map from ${aiType}_api_key localStorage entries → provider IDs
    const LEGACY_KEY_TO_PROVIDER: Record<string, APIProvider> = {
      gemini_api_key: "google",
      anthropic_api_key: "anthropic",
      openai_api_key: "openai",
      xai_api_key: "xai",
      groq_api_key: "groq",
    };

    const apiKeys =
      this.getStorageData<LocalStorageSchema["api-keys"]>("api-keys") || {};
    let changed = false;

    // Migrate from aPro (requests/engine format)
    try {
      const aProRaw = storage.getItem("aPro");
      if (aProRaw) {
        const aPro = JSON.parse(aProRaw) as Record<string, string>;
        for (const [envKey, providerId] of Object.entries(ENV_TO_PROVIDER)) {
          const value = aPro[envKey];
          if (value && !apiKeys[providerId]) {
            apiKeys[providerId] = value;
            changed = true;
          }
        }
        storage.removeItem("aPro");
      }
    } catch {
      // aPro missing or malformed — skip silently
    }

    // Migrate from per-key ${aiType}_api_key entries
    for (const [legacyKey, providerId] of Object.entries(LEGACY_KEY_TO_PROVIDER)) {
      try {
        const value = storage.getItem(legacyKey);
        if (value && !apiKeys[providerId]) {
          apiKeys[providerId] = value;
          changed = true;
        }
        if (value) {
          storage.removeItem(legacyKey);
        }
      } catch {
        // skip
      }
    }

    if (changed) {
      // Write migrated keys. They will be encrypted on the next initCrypto()
      // call (or on the next setAPIKey call for any individual key).
      this.setStorageData("api-keys", apiKeys);
    }
  }

  /**
   * Initialize the encryption layer: decrypt all stored API keys into the
   * in-memory plaintext cache.  Must be called once at app startup (or at the
   * start of any async operation that reads keys).  Safe to call multiple times.
   */
  async initCrypto(): Promise<void> {
    const apiKeys =
      this.getStorageData<LocalStorageSchema["api-keys"]>("api-keys") || {};

    const entries = Object.entries(apiKeys) as [APIProvider, string][];
    await Promise.all(
      entries.map(async ([provider, stored]) => {
        if (!stored) return;
        try {
          if (isServerEncrypted(stored)) {
            // RSA blob — can only be decrypted server-side.  Mark as present.
            this._serverEncryptedProviders.add(provider);
            return;
          }
          const plaintext = isEncrypted(stored)
            ? await decryptValue(stored)
            : stored; // legacy plaintext — re-encrypt it now
          this._plaintextCache.set(provider, plaintext);

          // Re-encrypt any plaintext values found in storage (try RSA first).
          if (!isEncrypted(stored)) {
            encryptForServer(plaintext)
              .then((rsaBlob) => {
                const current =
                  this.getStorageData<LocalStorageSchema["api-keys"]>(
                    "api-keys"
                  ) || {};
                current[provider] = rsaBlob;
                this.setStorageData("api-keys", current);
                this._serverEncryptedProviders.add(provider);
              })
              .catch(() =>
                encryptValue(stored)
                  .then((encrypted) => {
                    const current =
                      this.getStorageData<LocalStorageSchema["api-keys"]>(
                        "api-keys"
                      ) || {};
                    current[provider] = encrypted;
                    this.setStorageData("api-keys", current);
                  })
                  .catch(() => {})
              );
          }
        } catch (err) {
          // Decryption failure — different browser/key or corrupted data.
          console.warn(`[storage] could not decrypt key for ${provider}`, err);
          this._plaintextCache.delete(provider);
        }
      })
    );
  }

  /**
   * Check whether the 1-hour export window is currently open.
   * Returns true if settings_api-keys-last-edit is within the last hour.
   */
  isExportWindowOpen(): boolean {
    try {
      const ts = parseInt(
        localStorage.getItem("settings_api-keys-last-edit") || "0",
        10
      );
      return ts > 0 && Date.now() - ts < 3_600_000;
    } catch {
      return false;
    }
  }

  /**
   * Close the export window immediately ("Encrypt Now").
   * Sets settings_api-keys-last-edit to 0 so the export button disappears.
   */
  closeExportWindow(): void {
    try {
      localStorage.setItem("settings_api-keys-last-edit", "0");
    } catch (_) {}
  }

  /**
   * Return all currently decrypted API keys as plaintext (for .env export).
   * Only call when the export window is open (isExportWindowOpen() === true).
   */
  getDecryptedKeysForExport(): Record<string, string> {
    const result: Record<string, string> = {};
    this._plaintextCache.forEach((value, provider) => {
      result[provider] = value;
    });
    return result;
  }

  /**
   * Return the raw "rsa:<base64>" blob stored for this provider, or null if
   * the stored value is not RSA-encrypted.  Used by chat.tsx to send the blob
   * to the server for decryption when no plaintext key is in the session cache.
   */
  getEncryptedBlob(provider: APIProvider): string | null {
    const apiKeys =
      this.getStorageData<LocalStorageSchema["api-keys"]>("api-keys");
    const raw = apiKeys?.[provider];
    if (!raw || !isServerEncrypted(raw)) return null;
    return raw;
  }

  /**
   * Returns true if the provider has an RSA-encrypted key in localStorage
   * (populated by initCrypto).
   */
  hasServerEncryptedKey(provider: APIProvider): boolean {
    return this._serverEncryptedProviders.has(provider);
  }

  /**
   * Get GitHub Personal Access Token.
   * Checks api-keys['github'] first (managed via the key-manager widget and
   * the server .env GITHUB_PERSONAL_ACCESS_TOKEN), then falls back to the
   * legacy integrations storage written by the Settings page.
   */
  getGitHubPAT(): string | null {
    const fromApiKeys = this.getAPIKey("github");
    if (fromApiKeys) return fromApiKeys;
    const integrations =
      this.getStorageData<LocalStorageSchema["integrations"]>("integrations");
    return integrations?.github?.token || null;
  }

  /**
   * Set GitHub Personal Access Token
   */
  setGitHubPAT(token: string): void {
    const integrations =
      this.getStorageData<LocalStorageSchema["integrations"]>("integrations") ||
      {};

    if (integrations.github) {
      integrations.github.token = token;
    } else {
      integrations.github = { token };
    }

    this.setStorageData("integrations", integrations);

    this.emitEvent({
      type: "github-pat-updated",
      timestamp: Date.now(),
    });
  }

  /**
   * Remove GitHub Personal Access Token
   */
  removeGitHubPAT(): void {
    const integrations =
      this.getStorageData<LocalStorageSchema["integrations"]>("integrations");
    if (integrations?.github) {
      integrations.github = undefined;
      this.setStorageData("integrations", integrations);

      this.emitEvent({
        type: "github-pat-removed",
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Get GitHub integration data
   */
  getGitHubIntegration(): LocalStorageSchema["integrations"]["github"] | null {
    const integrations =
      this.getStorageData<LocalStorageSchema["integrations"]>("integrations");
    return integrations?.github || null;
  }

  /**
   * Update GitHub integration data (user info, last verified, etc.)
   */
  updateGitHubIntegration(
    data: Partial<LocalStorageSchema["integrations"]["github"]>
  ): void {
    const integrations =
      this.getStorageData<LocalStorageSchema["integrations"]>("integrations") ||
      {};

    if (integrations.github) {
      integrations.github = { ...integrations.github, ...data };
      this.setStorageData("integrations", integrations);
    }
  }

  /**
   * Get all API keys
   */
  getAllAPIKeys(): LocalStorageSchema["api-keys"] {
    return (
      this.getStorageData<LocalStorageSchema["api-keys"]>("api-keys") || {}
    );
  }

  /**
   * Clear all stored data
   */
  clearAll(): void {
    const storage = this.getStorage();
    if (!storage) {
      return;
    }

    try {
      const keysToRemove = Object.keys(storage).filter((key) =>
        key.startsWith(this.storagePrefix)
      );

      keysToRemove.forEach((key) => storage.removeItem(key));

      this.emitEvent({
        type: "storage-cleared",
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("Failed to clear storage:", error);
      this.emitStorageError(
        StorageErrorType.UNKNOWN_ERROR,
        "Failed to clear storage"
      );
    }
  }

  /**
   * Add event listener for storage changes
   */
  addEventListener(listener: (event: StorageEvent) => void): void {
    this.eventListeners.push(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: (event: StorageEvent) => void): void {
    const index = this.eventListeners.indexOf(listener);
    if (index > -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * Check if storage has any data
   */
  hasData(): boolean {
    const apiKeys = this.getAllAPIKeys();
    const githubPAT = this.getGitHubPAT();

    return Object.keys(apiKeys).length > 0 || !!githubPAT;
  }

  /**
   * Setup automatic cleanup on logout
   */
  setupAutoCleanup(): void {
    if (!this.config.autoCleanupOnLogout) {
      return;
    }

    // Listen for beforeunload event to detect potential logout
    const handleBeforeUnload = () => {
      // Only clear if using sessionStorage or if explicitly configured
      if (this.config.useSessionStorage) {
        this.clearAll();
      }
    };

    // Listen for storage events from other tabs (logout detection)
    const handleStorageEvent = (event: Event) => {
      // Handle browser storage events (different from our custom StorageEvent type)
      if (event instanceof StorageEvent) {
        // This is a browser StorageEvent, not our custom type
        // Additional cleanup if needed
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", handleBeforeUnload);
      window.addEventListener("storage", handleStorageEvent);

      this.cleanupListeners.push(() => {
        window.removeEventListener("beforeunload", handleBeforeUnload);
        window.removeEventListener("storage", handleStorageEvent);
      });
    }
  }

  /**
   * Manually trigger cleanup on logout
   */
  cleanupOnLogout(): void {
    if (this.config.autoCleanupOnLogout) {
      this.clearAll();
    }
  }

  /**
   * Get storage quota information
   */
  getStorageQuota(): StorageQuotaInfo | null {
    if (
      typeof navigator === "undefined" ||
      !navigator.storage ||
      !navigator.storage.estimate
    ) {
      return null;
    }

    try {
      // This is async but we'll return a sync version for now
      // In a real implementation, you might want to cache this or make it async
      const storage = this.getStorage();
      if (!storage) {
        return null;
      }

      // Estimate current usage by calculating size of our data
      let used = 0;
      Object.keys(storage).forEach((key) => {
        if (key.startsWith(this.storagePrefix)) {
          const value = storage.getItem(key);
          if (value) {
            used += key.length + value.length;
          }
        }
      });

      // Use a reasonable estimate for total available storage
      const total = this.config.maxStorageSize || 5 * 1024 * 1024; // 5MB default
      const available = Math.max(0, total - used);
      const percentage = (used / total) * 100;

      return {
        used,
        available,
        total,
        percentage,
      };
    } catch (error) {
      console.error("Failed to get storage quota:", error);
      return null;
    }
  }

  /**
   * Check storage health and return any errors
   */
  checkStorageHealth(): { healthy: boolean; errors: StorageError[] } {
    const errors: StorageError[] = [];

    // Check if storage is available
    if (!this.isStorageAvailable()) {
      errors.push({
        type: StorageErrorType.STORAGE_UNAVAILABLE,
        message: "Storage is not available",
      });
    }

    // Check quota
    const quota = this.getStorageQuota();
    if (quota && quota.percentage > 90) {
      errors.push({
        type: StorageErrorType.QUOTA_EXCEEDED,
        message: `Storage is ${quota.percentage.toFixed(1)}% full`,
        details: quota,
      });
    }

    // Check for data corruption by trying to parse stored data
    try {
      const apiKeys =
        this.getStorageData<LocalStorageSchema["api-keys"]>("api-keys");
      const integrations =
        this.getStorageData<LocalStorageSchema["integrations"]>("integrations");

      // Basic validation
      if (apiKeys && typeof apiKeys !== "object") {
        errors.push({
          type: StorageErrorType.DATA_CORRUPTION,
          message: "API keys data is corrupted",
        });
      }

      if (integrations && typeof integrations !== "object") {
        errors.push({
          type: StorageErrorType.DATA_CORRUPTION,
          message: "Integrations data is corrupted",
        });
      }
    } catch (error) {
      errors.push({
        type: StorageErrorType.DATA_CORRUPTION,
        message: "Failed to validate stored data",
        details: error,
      });
    }

    return {
      healthy: errors.length === 0,
      errors,
    };
  }

  /**
   * Configure storage manager
   */
  configure(config: Partial<StorageConfig>): void {
    this.config = { ...this.config, ...config };

    // Re-setup cleanup if configuration changed
    if (config.autoCleanupOnLogout !== undefined) {
      // Clean up existing listeners
      this.cleanupListeners.forEach((cleanup) => cleanup());
      this.cleanupListeners = [];

      // Setup new listeners
      this.setupAutoCleanup();
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): StorageConfig {
    return { ...this.config };
  }
}

export const localStorageManager = LocalStorageManager.getInstance();
