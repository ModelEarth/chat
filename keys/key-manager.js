/**
 * key-manager.js — Embeddable vanilla JS API key manager
 *
 * No React, no bundler, no build step required.
 * Reads/writes localStorage['settings_api-keys'] — same format as the
 * chat repo's LocalStorageManager (chat/lib/storage/local-storage-manager.ts).
 *
 * Keys are encrypted at rest using the Web Crypto API with a non-extractable
 * AES-GCM-256 key stored in IndexedDB — matching crypto.ts in the Next.js app.
 *
 * Public API (window.KeyManager):
 *   KeyManager.init(containerEl, options)  — render widget into a container element
 *   KeyManager.get(providerId)             — returns plaintext key or null (from cache)
 *   KeyManager.set(providerId, value)      — encrypts and writes to settings_api-keys
 *   KeyManager.has(providerId)             — boolean (from cache)
 *   KeyManager.remove(providerId)          — deletes from cache + storage
 *   KeyManager.getAll()                    — returns full settings_api-keys object (raw/encrypted)
 *   KeyManager.migrateFromLegacy()         — one-time migration from aPro / ${aiType}_api_key
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'settings_api-keys';
  var LAST_EDIT_KEY = 'settings_api-keys-last-edit';

  // -- Crypto (Web Crypto API + IndexedDB) --------------------------------------

  var DB_NAME = 'km-store';
  var KEY_ID = 'browser-key';
  var _cachedKey = null;
  // In-memory plaintext cache — populated by _initCrypto()
  var _plaintextCache = {};

  // -- RSA-OAEP server-key encryption (Phase 9) --------------------------------

  var USE_APP_API = (
    location.protocol === 'https:' ||
    location.port === '3000' ||
    location.port === '3700' ||
    location.port === '8888'
  );

  var DEFAULT_PUBLIC_KEY_URL = USE_APP_API
    ? '/api/public-key'
    : null; // Not available when served from the Python static server
  var PUBLIC_KEY_URL = DEFAULT_PUBLIC_KEY_URL;

  var _cachedServerPublicKey = null;

  function _fetchServerPublicKey() {
    if (_cachedServerPublicKey) return Promise.resolve(_cachedServerPublicKey);
    if (!PUBLIC_KEY_URL) return Promise.reject(new Error('No public key endpoint'));
    return fetch(PUBLIC_KEY_URL)
      .then(function (r) {
        if (!r.ok) throw new Error('Public key unavailable');
        return r.json();
      })
      .then(function (jwk) {
        return crypto.subtle.importKey(
          'jwk', jwk,
          { name: 'RSA-OAEP', hash: 'SHA-256' },
          false,
          ['encrypt']
        );
      })
      .then(function (key) {
        _cachedServerPublicKey = key;
        return key;
      });
  }

  function _encryptForServer(plaintext) {
    return _fetchServerPublicKey().then(function (key) {
      return crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        key,
        new TextEncoder().encode(plaintext)
      );
    }).then(function (ct) {
      return 'rsa:' + btoa(String.fromCharCode.apply(null, new Uint8Array(ct)));
    });
  }

  function _isServerEncrypted(value) {
    return typeof value === 'string' && value.startsWith('rsa:');
  }

  // -- Server keys (.env) ------------------------------------------------------

  var DEFAULT_SERVER_KEYS_URL = USE_APP_API ? '/api/server-keys' : null;
  var SERVER_KEYS_URL = DEFAULT_SERVER_KEYS_URL;

  var DEFAULT_VALIDATE_KEY_URL = USE_APP_API
    ? '/api/validate-key'
    : null;
  var VALIDATE_KEY_URL = DEFAULT_VALIDATE_KEY_URL;

  var _serverKeys = new Set();
  var _validatedKeys = new Set();
  var _invalidKeys = new Set();

  function _emitProviderValidation(providerId, isValid) {
    try {
      window.dispatchEvent(new CustomEvent('keymanager:provider-validation', {
        detail: { providerId: providerId, valid: isValid }
      }));
    } catch (_) {}
  }

  function _hideGeminiStarterNotice() {
    ['gemini-starter-notice', 'gemini-starter-copy'].forEach(function (id) {
      var notice = document.getElementById(id);
      if (!notice) return;
      if (typeof notice.remove === 'function') {
        notice.remove();
      } else {
        notice.style.display = 'none';
        notice.textContent = '';
      }
    });

    var notices = document.querySelectorAll('.key-notice');
    notices.forEach(function (notice) {
      var text = (notice.textContent || '').trim();
      if (text.indexOf('You can start with a free Google Gemini key from') !== -1) {
        if (typeof notice.remove === 'function') {
          notice.remove();
        } else {
          notice.style.display = 'none';
          notice.textContent = '';
        }
      }
    });
  }

  function _loadServerKeys() {
    if (!SERVER_KEYS_URL) return Promise.resolve();
    return fetch(SERVER_KEYS_URL)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var list = Array.isArray(data) ? data : (data.env_keys_present || []);
        _serverKeys = new Set(list);
      })
      .catch(function () {}); // silently ignore if server unavailable
  }

  var ENCRYPTED_RE = /^[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/;

  function _isEncrypted(value) {
    return ENCRYPTED_RE.test(value);
  }

  function _openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('keys'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function _initBrowserKey() {
    if (_cachedKey) return Promise.resolve(_cachedKey);
    return _openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('keys', 'readonly');
        var req = tx.objectStore('keys').get(KEY_ID);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      }).then(function (key) {
        if (key) { _cachedKey = key; db.close(); return key; }
        return crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
        ).then(function (newKey) {
          return new Promise(function (resolve, reject) {
            var tx = db.transaction('keys', 'readwrite');
            var req = tx.objectStore('keys').put(newKey, KEY_ID);
            req.onsuccess = function () { resolve(newKey); };
            req.onerror = function () { reject(req.error); };
          });
        }).then(function (newKey) {
          _cachedKey = newKey; db.close(); return newKey;
        });
      });
    });
  }

  function _encryptValue(plaintext) {
    return _initBrowserKey().then(function (key) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv }, key,
        new TextEncoder().encode(plaintext)
      ).then(function (ct) {
        var ivB64 = btoa(String.fromCharCode.apply(null, iv));
        var ctB64 = btoa(String.fromCharCode.apply(null, new Uint8Array(ct)));
        return ivB64 + ':' + ctB64;
      });
    });
  }

  function _decryptValue(stored) {
    return _initBrowserKey().then(function (key) {
      var colonIdx = stored.indexOf(':');
      var iv = Uint8Array.from(atob(stored.slice(0, colonIdx)), function (c) { return c.charCodeAt(0); });
      var ct = Uint8Array.from(atob(stored.slice(colonIdx + 1)), function (c) { return c.charCodeAt(0); });
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct)
        .then(function (pt) { return new TextDecoder().decode(pt); });
    });
  }

  /**
   * Decrypt all stored keys into _plaintextCache.
   * Encrypt any plaintext keys found (legacy migration).
   * Returns a Promise that resolves when the cache is ready.
   */
  function _initCrypto() {
    var data = _readAllRaw();
    var providers = Object.keys(data);
    if (providers.length === 0) return Promise.resolve();
    return Promise.all(providers.map(function (providerId) {
      var stored = data[providerId];
      if (!stored) return Promise.resolve();
      if (_isServerEncrypted(stored)) {
        // RSA blob — can only be decrypted server-side; mark as present.
        return Promise.resolve();
      }
      if (_isEncrypted(stored)) {
        return _decryptValue(stored).then(function (pt) {
          _plaintextCache[providerId] = pt;
        }).catch(function () {
          // Cannot decrypt (different browser key) — remove the stale entry.
          delete _plaintextCache[providerId];
        });
      }
      // Plaintext key — cache it and re-encrypt (try RSA first).
      _plaintextCache[providerId] = stored;
      return _encryptForServer(stored).then(function (rsaBlob) {
        data[providerId] = rsaBlob;
        _writeAllRaw(data);
      }).catch(function () {
        return _encryptValue(stored).then(function (enc) {
          data[providerId] = enc;
          _writeAllRaw(data);
        }).catch(function () {});
      });
    }));
  }

  // -- Storage helpers (raw, operates on encrypted values) ---------------------

  function _readAllRaw() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  function _writeAllRaw(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function readAll() {
    // Public readAll returns raw (possibly encrypted) values.
    return _readAllRaw();
  }

  function getKey(providerId) {
    return _plaintextCache[providerId] || null;
  }

  function setKey(providerId, value) {
    // Update cache immediately.
    _plaintextCache[providerId] = value;
    // Record edit timestamp for the 1-hour export window.
    try { localStorage.setItem(LAST_EDIT_KEY, String(Date.now())); } catch (_) {}
    // Try RSA (server-only decryptable) first; fall back to browser AES.
    _encryptForServer(value).then(function (rsaBlob) {
      var data = _readAllRaw();
      data[providerId] = rsaBlob;
      _writeAllRaw(data);
    }).catch(function () {
      _encryptValue(value).then(function (enc) {
        var data = _readAllRaw();
        data[providerId] = enc;
        _writeAllRaw(data);
      }).catch(function () {
        var data = _readAllRaw();
        data[providerId] = value;
        _writeAllRaw(data);
      });
    });
  }

  function removeKey(providerId) {
    delete _plaintextCache[providerId];
    var data = _readAllRaw();
    delete data[providerId];
    _writeAllRaw(data);
  }

  function hasKey(providerId) {
    return !!getKey(providerId);
  }

  // -- Legacy migration ---------------------------------------------------------

  var ENV_TO_PROVIDER = {
    GEMINI_API_KEY:                'google',
    GOOGLE_API_KEY:                'google',
    ANTHROPIC_API_KEY:             'anthropic',
    OPENAI_API_KEY:                'openai',
    XAI_API_KEY:                   'xai',
    GROQ_API_KEY:                  'groq',
    TOGETHER_API_KEY:              'together',
    FIREWORKS_API_KEY:             'fireworks',
    MISTRAL_API_KEY:               'mistral',
    PERPLEXITY_API_KEY:            'perplexity',
    DEEPSEEK_API_KEY:              'deepseek',
    DISCORD_BOT_TOKEN:             'discord',
    GITHUB_PERSONAL_ACCESS_TOKEN:  'github',
    PINECONE_API_KEY:              'pinecone',
    VOYAGE_API_KEY:                'voyage',
    NEXT_PUBLIC_SUPABASE_URL:      'supabase',
  };

  var PROVIDER_TO_ENV = {
    google:     'GOOGLE_API_KEY',
    anthropic:  'ANTHROPIC_API_KEY',
    openai:     'OPENAI_API_KEY',
    xai:        'XAI_API_KEY',
    groq:       'GROQ_API_KEY',
    together:   'TOGETHER_API_KEY',
    fireworks:  'FIREWORKS_API_KEY',
    mistral:    'MISTRAL_API_KEY',
    perplexity: 'PERPLEXITY_API_KEY',
    deepseek:   'DEEPSEEK_API_KEY',
    discord:    'DISCORD_BOT_TOKEN',
    github:     'GITHUB_PERSONAL_ACCESS_TOKEN',
    pinecone:   'PINECONE_API_KEY',
    voyage:     'VOYAGE_API_KEY',
    supabase:   'NEXT_PUBLIC_SUPABASE_URL',
  };

  var COPY_PREF_KEY = 'settings_copymykeys';

  var LEGACY_KEY_TO_PROVIDER = {
    gemini_api_key:   'google',
    anthropic_api_key:   'anthropic',
    openai_api_key:   'openai',
    xai_api_key:      'xai',
    groq_api_key:     'groq',
  };

  function migrateFromLegacy() {
    var data = readAll();
    var changed = false;

    // Migrate from aPro (requests/engine format)
    try {
      var aProRaw = localStorage.getItem('aPro');
      if (aProRaw) {
        var aPro = JSON.parse(aProRaw);
        Object.keys(ENV_TO_PROVIDER).forEach(function (envKey) {
          var providerId = ENV_TO_PROVIDER[envKey];
          if (aPro[envKey] && !data[providerId]) {
            data[providerId] = aPro[envKey];
            changed = true;
          }
        });
        localStorage.removeItem('aPro');
      }
    } catch (_) {}

    // Migrate from per-key ${aiType}_api_key entries
    Object.keys(LEGACY_KEY_TO_PROVIDER).forEach(function (legacyKey) {
      var providerId = LEGACY_KEY_TO_PROVIDER[legacyKey];
      try {
        var value = localStorage.getItem(legacyKey);
        if (value && !data[providerId]) {
          data[providerId] = value;
          changed = true;
        }
        if (value) localStorage.removeItem(legacyKey);
      } catch (_) {}
    });

    if (changed) writeAll(data);
  }

  // -- Icons (Material Icons — loaded via localsite.js) -------------------------

  function mi(name) {
    return '<span class="material-icons" style="font-size:18px;vertical-align:middle">' + name + '</span>';
  }

  var ICON_CHECK_SMALL = mi('check');
  var ICON_CIRCLE  = mi('radio_button_unchecked');
  var ICON_CHEVRON = mi('expand_more');
  var ICON_EYE     = mi('visibility');
  var ICON_EYE_OFF = mi('visibility_off');
  var ICON_INFO    = mi('info');

  // -- Key validation -----------------------------------------------------------

  function _updateStatusIcon(icon, providerId) {
    var browserKey = hasKey(providerId);
    var serverKey = _serverKeys.has(providerId);
    if (browserKey) {
      icon.className = 'key-status-icon browser-key';
      icon.innerHTML = ICON_CHECK_SMALL;
    } else if (serverKey) {
      icon.className = 'key-status-icon server-key';
      icon.innerHTML = ICON_CHECK_SMALL;
    } else {
      icon.className = 'key-status-icon no-key';
      icon.innerHTML = ICON_CIRCLE;
    }
  }

  function _refreshStatusIcon(providerId) {
    var card = document.getElementById('key-provider-' + providerId);
    if (!card) return;
    var icon = card.querySelector('.key-status-icon');
    if (!icon) return;
    _updateStatusIcon(icon, providerId);
  }

  function _validateKey(providerId, key) {
    if (!VALIDATE_KEY_URL || !key) return;
    fetch(VALIDATE_KEY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: providerId, key: key }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.valid === true) {
          _validatedKeys.add(providerId);
          _invalidKeys.delete(providerId);
          _emitProviderValidation(providerId, true);
          if (providerId === 'google') {
            _hideGeminiStarterNotice();
            setTimeout(_hideGeminiStarterNotice, 0);
          }
        } else if (data.valid === false) {
          _invalidKeys.add(providerId);
          _validatedKeys.delete(providerId);
          _emitProviderValidation(providerId, false);
        }
        // data.valid === null means unknown — leave as pending (orange)
        _refreshStatusIcon(providerId);
      })
      .catch(function () {
        // Network error — leave as pending (orange)
      });
  }

  // -- Paste Keys ---------------------------------------------------------------

  function buildPastePanel(onApplied) {
    var panel = document.createElement('div');
    panel.className = 'key-paste-panel';
    panel.hidden = true;

    var title = document.createElement('div');
    title.className = 'key-paste-title';
    title.textContent = 'Paste from .env file';

    var hint = document.createElement('p');
    hint.className = 'key-paste-hint';
    hint.textContent = 'Paste one or more KEY=value lines. Recognised keys are saved automatically.';

    var textarea = document.createElement('textarea');
    textarea.className = 'key-paste-textarea';
    textarea.placeholder = 'PINECONE_API_KEY=pcsk_...\nVOYAGE_API_KEY=pa-...\nGOOGLE_API_KEY=AIza...';
    textarea.rows = 5;
    textarea.spellcheck = false;

    var actions = document.createElement('div');
    actions.className = 'key-paste-actions';

    var applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'key-btn key-btn-primary';
    applyBtn.textContent = 'Apply';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'key-btn';
    cancelBtn.textContent = 'Cancel';

    var result = document.createElement('div');
    result.className = 'key-paste-result';

    applyBtn.addEventListener('click', function () {
      var lines = textarea.value.split('\n');
      var saved = [];
      lines.forEach(function (line) {
        line = line.trim();
        if (!line || line.startsWith('#')) return;
        var eqIdx = line.indexOf('=');
        if (eqIdx < 1) return;
        var envKey = line.slice(0, eqIdx).trim();
        var value = line.slice(eqIdx + 1).trim();
        if (!value) return;
        var providerId = ENV_TO_PROVIDER[envKey];
        if (!providerId) return;
        setKey(providerId, value);
        if (saved.indexOf(providerId) === -1) saved.push(providerId);
      });

      if (saved.length > 0) {
        result.textContent = '✓ ' + saved.length + ' key' + (saved.length > 1 ? 's' : '') + ' saved: ' + saved.join(', ');
        result.className = 'key-paste-result ok';
        textarea.value = '';
        if (typeof onApplied === 'function') onApplied(saved);
      } else {
        result.textContent = 'No recognised keys found. Check that variable names match (e.g. PINECONE_API_KEY=...).';
        result.className = 'key-paste-result err';
      }
    });

    cancelBtn.addEventListener('click', function () {
      panel.hidden = true;
      textarea.value = '';
      result.textContent = '';
    });

    actions.appendChild(applyBtn);
    actions.appendChild(cancelBtn);
    panel.appendChild(title);
    panel.appendChild(hint);
    panel.appendChild(textarea);
    panel.appendChild(actions);
    panel.appendChild(result);
    return panel;
  }

  // -- CopyMyKeys ----------------------------------------------------------------

  var _copyPanelTimer = null;

  function _getCopyWindowMs(value) {
    var map = { '5': 5 * 60 * 1000, '20': 20 * 60 * 1000, '60': 60 * 60 * 1000 };
    return map[value] || 0;
  }

  function _buildCopyKeysText() {
    var lines = [];
    Object.keys(PROVIDER_TO_ENV).forEach(function (providerId) {
      var val = _plaintextCache[providerId];
      if (val) lines.push(PROVIDER_TO_ENV[providerId] + '=' + val);
    });
    return lines.length > 0 ? lines.join('\n') : '(no keys saved in browser)';
  }

  function buildCopyPanel() {
    var panel = document.createElement('div');
    panel.className = 'key-copy-panel';

    var header = document.createElement('div');
    header.className = 'key-copy-panel-header';

    var label = document.createElement('span');
    label.className = 'key-copy-panel-label';

    var textarea = document.createElement('textarea');
    textarea.className = 'key-copy-textarea';
    textarea.readOnly = true;
    textarea.rows = 4;
    textarea.addEventListener('focus', function () { textarea.select(); });

    panel.appendChild(header);
    header.appendChild(label);
    panel.appendChild(textarea);

    function refresh(windowMs) {
      var lastEdit = parseInt(localStorage.getItem(LAST_EDIT_KEY) || '0', 10);
      var remaining = lastEdit + windowMs - Date.now();
      if (remaining <= 0) {
        label.textContent = 'Copy window expired — re-enter a key to reopen.';
        textarea.value = '';
        return false;
      }
      var mins = Math.ceil(remaining / 60000);
      label.textContent = 'Your keys (unencrypted) — visible for ~' + mins + ' more minute' + (mins !== 1 ? 's' : '');
      textarea.value = _buildCopyKeysText();
      return true;
    }

    panel._show = function (windowMs) {
      if (_copyPanelTimer) clearInterval(_copyPanelTimer);
      var ok = refresh(windowMs);
      panel.hidden = !ok;
      if (ok) {
        _copyPanelTimer = setInterval(function () {
          if (!refresh(windowMs)) {
            clearInterval(_copyPanelTimer);
            panel.hidden = true;
          }
        }, 30000);
      }
    };

    panel._hide = function () {
      if (_copyPanelTimer) { clearInterval(_copyPanelTimer); _copyPanelTimer = null; }
      panel.hidden = true;
    };

    panel._refresh = function (windowMs) {
      if (!panel.hidden) refresh(windowMs);
    };

    panel.hidden = true;
    return panel;
  }

  // -- Toolbar (Paste Keys + CopyMyKeys) ----------------------------------------

  function buildToolbar(pastePanel, copyPanel) {
    var toolbar = document.createElement('div');
    toolbar.className = 'key-toolbar';

    var copyGroup = document.createElement('div');
    copyGroup.className = 'key-toolbar-copy-group';

    var copyLabel = document.createElement('label');
    copyLabel.className = 'key-toolbar-label';
    copyLabel.textContent = 'Encrypt:';

    var copySelect = document.createElement('select');
    copySelect.className = 'key-copy-select';
    [
      { value: 'off', label: 'Immediately' },
      { value: '5',   label: 'Within 5 minutes' },
      { value: '20',  label: 'Within 20 minutes' },
      { value: '60',  label: 'Within 1 hour' },
    ].forEach(function (opt) {
      var el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      copySelect.appendChild(el);
    });

    var saved = localStorage.getItem(COPY_PREF_KEY) || 'off';
    copySelect.value = saved;

    copySelect.addEventListener('change', function () {
      var val = copySelect.value;
      localStorage.setItem(COPY_PREF_KEY, val);
      if (val === 'off') {
        copyPanel._hide();
      } else {
        copyPanel._show(_getCopyWindowMs(val));
      }
    });

    var pasteBtn = document.createElement('button');
    pasteBtn.type = 'button';
    pasteBtn.className = 'key-btn key-btn-primary key-paste-btn';
    pasteBtn.innerHTML = '&#8675; Paste Keys';

    pasteBtn.addEventListener('click', function () {
      pastePanel.hidden = !pastePanel.hidden;
    });

    copyGroup.appendChild(copyLabel);
    copyGroup.appendChild(copySelect);
    toolbar.appendChild(copyGroup);
    toolbar.appendChild(pasteBtn);

    // Show copy panel on load if preference is still within the time window
    if (saved !== 'off') {
      var windowMs = _getCopyWindowMs(saved);
      var lastEdit = parseInt(localStorage.getItem(LAST_EDIT_KEY) || '0', 10);
      if (lastEdit + windowMs > Date.now()) {
        copyPanel._show(windowMs);
      } else {
        localStorage.setItem(COPY_PREF_KEY, 'off');
        copySelect.value = 'off';
      }
    }

    return toolbar;
  }

  // -- Widget renderer ----------------------------------------------------------

  function init(containerEl, options) {
    if (!containerEl) return;
    options = options || {};
    SERVER_KEYS_URL = options.serverKeysUrl || DEFAULT_SERVER_KEYS_URL;
    PUBLIC_KEY_URL = options.publicKeyUrl || DEFAULT_PUBLIC_KEY_URL;
    VALIDATE_KEY_URL = options.validateKeyUrl || DEFAULT_VALIDATE_KEY_URL;

    // Run crypto init and server key fetch in parallel; render once both settle.
    Promise.all([
      _initCrypto().catch(function () {}),
      _loadServerKeys(),
    ]).then(function () {
      _renderWidget(containerEl, options);
    });
  }

  function _renderWidget(containerEl, options) {
    var providers = (window.KeyManagerProviders || []);
    containerEl.innerHTML = '';
    containerEl.className = (containerEl.className + ' key-widget').trim();

    if (_shouldShowGeminiStarterNotice(providers, options)) {
      containerEl.appendChild(buildGeminiStarterNotice());
    }

    var copyPanel = buildCopyPanel();
    var pastePanel = buildPastePanel(function () {
      providers.forEach(function (provider) {
        _refreshStatusIcon(provider.id);
        var key = getKey(provider.id);
        if (key) _validateKey(provider.id, key);
      });
      var currentPref = localStorage.getItem(COPY_PREF_KEY) || 'off';
      copyPanel._refresh(_getCopyWindowMs(currentPref));
    });
    var toolbar = buildToolbar(pastePanel, copyPanel);

    containerEl.appendChild(toolbar);
    containerEl.appendChild(pastePanel);
    containerEl.appendChild(copyPanel);

    var list = document.createElement('div');
    list.className = 'key-provider-list';

    providers.forEach(function (provider) {
      list.appendChild(buildProviderCard(provider));
    });

    containerEl.appendChild(list);

    // Trigger background validation for all stored browser keys
    providers.forEach(function (provider) {
      var key = getKey(provider.id);
      if (key) _validateKey(provider.id, key);
    });

    // Security notice
    var notice = document.createElement('div');
    notice.className = 'key-notice';
    notice.innerHTML = ICON_INFO +
      ' Keys are encrypted at rest using AES-GCM with a browser-bound key stored in IndexedDB.' +
      ' That key is non-extractable — JavaScript cannot read its raw bytes, so it cannot be stolen by reading storage.' +
      ' When you send a message, the key is briefly decrypted in memory and sent over HTTPS to the server, which passes it directly to the AI provider.' +
      ' HTTPS prevents network interception, but code already running on this page (e.g. a malicious extension or XSS) could in theory read the key from memory at that moment.';
    containerEl.appendChild(notice);
  }

  function _shouldShowGeminiStarterNotice(providers, options) {
    if (options && options.showGeminiStarterNotice === false) {
      return false;
    }

    var excludedProviders = new Set(['pinecone', 'voyage']);
    return !providers.some(function (provider) {
      if (excludedProviders.has(provider.id)) return false;
      return hasKey(provider.id) || _serverKeys.has(provider.id);
    });
  }

  function buildGeminiStarterNotice() {
    var notice = document.createElement('div');
    notice.id = 'gemini-starter-notice';
    notice.className = 'key-notice';
    notice.innerHTML =
      ICON_INFO +
      ' You can start with a free Google Gemini key from ' +
      '<a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Google AI Studio</a>.';
    return notice;
  }

  function buildProviderCard(provider) {
    var card = document.createElement('div');
    card.className = 'key-provider';
    card.id = 'key-provider-' + provider.id;

    var startOpen = hasKey(provider.id);
    var body = buildProviderBody(provider, startOpen);
    var header = buildProviderHeader(provider, startOpen);

    header.addEventListener('click', function () {
      var expanded = header.getAttribute('aria-expanded') === 'true';
      header.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      body.hidden = expanded;
    });

    card.appendChild(header);
    card.appendChild(body);
    return card;
  }

  function buildProviderHeader(provider, startOpen) {
    var header = document.createElement('button');
    header.type = 'button';
    header.className = 'key-provider-header';
    header.setAttribute('aria-expanded', startOpen ? 'true' : 'false');

    var browserKey = hasKey(provider.id);
    var serverKey = _serverKeys.has(provider.id);

    var statusIcon = document.createElement('span');
    _updateStatusIcon(statusIcon, provider.id);
    if (provider.cliOnly) {
      statusIcon.className = 'key-status-icon cli-provider';
      statusIcon.innerHTML = mi('terminal');
    }

    var name = document.createElement('span');
    name.className = 'key-provider-name';
    name.textContent = provider.name;

    var meta = document.createElement('span');
    meta.className = 'key-provider-meta';
    var modelCount = provider.models.length;
    meta.textContent = modelCount ? modelCount + ' model' + (modelCount !== 1 ? 's' : '') : '';

    var chevron = document.createElement('span');
    chevron.className = 'key-chevron';
    chevron.innerHTML = ICON_CHEVRON;

    header.appendChild(statusIcon);
    header.appendChild(name);
    if (serverKey && !browserKey) {
      var serverBadge = document.createElement('span');
      serverBadge.className = 'key-server-badge';
      serverBadge.textContent = '.env';
      serverBadge.title = 'Key available from server .env file';
      header.appendChild(serverBadge);
    }
    header.appendChild(meta);
    header.appendChild(chevron);

    return header;
  }

  function buildProviderBody(provider, startOpen) {
    var body = document.createElement('div');
    body.className = 'key-provider-body';
    body.hidden = !startOpen;

    if (provider.cliOnly) {
      var cliInfo = document.createElement('div');
      cliInfo.className = 'key-cli-info';
      cliInfo.innerHTML = ICON_INFO + ' Available via local CLI &mdash; no API key required. ' +
        '<a href="' + escapeAttr(provider.getKeyUrl) + '" target="_blank" rel="noopener">Install ↗</a>';
      body.appendChild(cliInfo);

      if (provider.models.length > 0) {
        var cliModelSection = document.createElement('div');
        cliModelSection.className = 'key-model-list';
        var cliLabelRow = document.createElement('div');
        cliLabelRow.className = 'key-model-list-label';
        var cliLabelText = document.createElement('span');
        cliLabelText.textContent = 'Models';
        cliLabelRow.appendChild(cliLabelText);
        cliModelSection.appendChild(cliLabelRow);
        provider.models.forEach(function (model) {
          var row = document.createElement('div');
          row.className = 'key-model-row' + (model.active ? '' : ' inactive');
          var nameEl = document.createElement('span');
          nameEl.className = 'key-model-name';
          nameEl.textContent = model.name;
          var descEl = document.createElement('span');
          descEl.className = 'key-model-desc';
          descEl.textContent = model.description;
          row.appendChild(nameEl);
          if (model.isDefault) {
            var badge = document.createElement('span');
            badge.className = 'key-model-badge';
            badge.textContent = 'default';
            row.appendChild(badge);
          }
          row.appendChild(descEl);
          cliModelSection.appendChild(row);
        });
        body.appendChild(cliModelSection);
      }

      return body;
    }

    var browserKeyPresent = hasKey(provider.id);
    var keyPresent = browserKeyPresent || _serverKeys.has(provider.id);

    // Key input section — hidden by default when browser key is already set
    var keyRow = document.createElement('div');
    keyRow.className = 'key-key-row';
    keyRow.hidden = browserKeyPresent;

    var label = document.createElement('div');
    label.className = 'key-key-label';
    var labelSpan = document.createElement('span');
    labelSpan.textContent = 'API Key';
    var getKeyLink = document.createElement('a');
    getKeyLink.className = 'key-get-key-link';
    getKeyLink.href = provider.getKeyUrl;
    getKeyLink.target = '_blank';
    getKeyLink.rel = 'noopener';
    getKeyLink.textContent = (keyPresent ? 'Get new key ↗' : 'Get key ↗');
    label.appendChild(labelSpan);
    label.appendChild(getKeyLink);

    var inputWrap = document.createElement('div');
    inputWrap.className = 'key-key-input-wrap';

    var input = document.createElement('input');
    input.type = 'password';
    input.className = 'key-key-input';
    input.placeholder = provider.keyPlaceholder || 'Paste your API key';
    input.value = getKey(provider.id) || '';
    input.setAttribute('autocomplete', 'off');

    var toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'key-btn';
    toggleBtn.innerHTML = ICON_EYE;
    toggleBtn.title = 'Show/hide key';

    toggleBtn.addEventListener('click', function () {
      var isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      toggleBtn.innerHTML = isPassword ? ICON_EYE_OFF : ICON_EYE;
    });

    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'key-btn key-btn-primary';
    saveBtn.textContent = 'Save';

    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'key-btn';
    clearBtn.textContent = 'Close';

    var statusMsg = document.createElement('div');
    statusMsg.className = 'key-status-msg';

    var editKeyBtn = null;

    function syncInputToStoredKey() {
      input.value = getKey(provider.id) || '';
      input.type = 'password';
      toggleBtn.innerHTML = ICON_EYE;
    }

    function refreshHeaderStatus() {
      _refreshStatusIcon(provider.id);
    }

    function clearStatus() {
      statusMsg.textContent = '';
      statusMsg.className = 'key-status-msg';
    }

    function refreshEditKeyVisibility() {
      if (!editKeyBtn) return;
      editKeyBtn.hidden = !keyRow.hidden || !hasKey(provider.id);
      editKeyBtn.classList.toggle('invalid', _invalidKeys.has(provider.id));
    }

    function showDeleteKeyStatus() {
      if (!hasKey(provider.id)) {
        clearStatus();
        return;
      }

      statusMsg.className = 'key-status-msg ok';
      statusMsg.innerHTML =
        'The ' + provider.name + ' key is encrypted in your browser storage. ' +
        '<button type="button" class="key-status-link key-status-link-danger">Delete key</button>';

      var deleteBtn = statusMsg.querySelector('.key-status-link-danger');
      if (!deleteBtn) return;

      deleteBtn.addEventListener('click', function () {
        removeKey(provider.id);
        _validatedKeys.delete(provider.id);
        _invalidKeys.delete(provider.id);
        getKeyLink.textContent = 'Get key ↗';
        clearStatus();
        setKeyRowOpen(true);
        refreshHeaderStatus();
        refreshEditKeyVisibility();
        showStatus(statusMsg, provider.name + ' key deleted from this browser.', 'ok');
      });

      setTimeout(function () {
        if (statusMsg.contains(deleteBtn)) {
          statusMsg.textContent = '';
        }
      }, 6000);
    }

    function setKeyRowOpen(isOpen) {
      keyRow.hidden = !isOpen;
      refreshEditKeyVisibility();
      if (isOpen) {
        input.focus();
      } else {
        syncInputToStoredKey();
      }
    }

    function submitKeyValue() {
      var val = input.value.trim();
      if (!val) {
        removeKey(provider.id);
        _validatedKeys.delete(provider.id);
        _invalidKeys.delete(provider.id);
        showStatus(statusMsg, 'Key removed.', 'ok');
        getKeyLink.textContent = 'Get key ↗';
        refreshHeaderStatus();
        refreshEditKeyVisibility();
        return;
      }
      setKey(provider.id, val);
      _validatedKeys.delete(provider.id);
      _invalidKeys.delete(provider.id);
      showStatus(statusMsg, 'Key saved. Validating…', 'ok');
      getKeyLink.textContent = 'Get new key ↗';
      refreshHeaderStatus();
      refreshEditKeyVisibility();
      _validateKey(provider.id, val);
    }

    saveBtn.addEventListener('click', function () {
      submitKeyValue();
    });

    clearBtn.addEventListener('click', function () {
      setKeyRowOpen(false);
    });

    input.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submitKeyValue();
    });

    inputWrap.appendChild(input);
    inputWrap.appendChild(toggleBtn);
    inputWrap.appendChild(saveBtn);
    inputWrap.appendChild(clearBtn);

    if (provider.keyHint) {
      var hintEl = document.createElement('div');
      hintEl.className = 'key-key-hint';
      hintEl.textContent = provider.keyHint;
      keyRow.appendChild(hintEl);
    }
    keyRow.appendChild(label);
    keyRow.appendChild(inputWrap);
    body.appendChild(keyRow);
    body.appendChild(statusMsg);

    // Model list
    if (provider.models.length > 0) {
      var modelSection = document.createElement('div');
      modelSection.className = 'key-model-list';

      var modelLabelRow = document.createElement('div');
      modelLabelRow.className = 'key-model-list-label';

      var modelLabelText = document.createElement('span');
      modelLabelText.textContent = 'Models';

      // Edit-key icon button on the far right of the Models label
      editKeyBtn = document.createElement('button');
      editKeyBtn.type = 'button';
      editKeyBtn.className = 'key-edit-key-btn';
      editKeyBtn.innerHTML = mi('key');
      editKeyBtn.title = 'Key is encrypted in browser storage';
      editKeyBtn.addEventListener('click', function () {
        if (_invalidKeys.has(provider.id)) {
          setKeyRowOpen(true);
          showStatus(statusMsg, 'The ' + provider.name + ' key did not validate. Replace it or clear it.', 'err');
          return;
        }
        showDeleteKeyStatus();
      });
      refreshEditKeyVisibility();

      modelLabelRow.appendChild(modelLabelText);
      modelLabelRow.appendChild(editKeyBtn);
      modelSection.appendChild(modelLabelRow);

      provider.models.forEach(function (model) {
        var row = document.createElement('div');
        row.className = 'key-model-row' + (model.active ? '' : ' inactive');
        row.id = 'key-model-' + model.id;

        var nameEl = document.createElement('span');
        nameEl.className = 'key-model-name';
        nameEl.textContent = model.name;

        var descEl = document.createElement('span');
        descEl.className = 'key-model-desc';
        descEl.textContent = model.description;

        row.appendChild(nameEl);

        if (model.isDefault) {
          var badge = document.createElement('span');
          badge.className = 'key-model-badge';
          badge.textContent = 'default';
          row.appendChild(badge);
        }

        row.appendChild(descEl);
        modelSection.appendChild(row);
      });

      body.appendChild(modelSection);
    } else if (!provider.tokenOnly) {
      var noModels = document.createElement('p');
      noModels.className = 'key-no-models';
      noModels.textContent = 'No models configured.';
      body.appendChild(noModels);
    }

    setKeyRowOpen(!keyRow.hidden);

    return body;
  }

  function showStatus(el, msg, type) {
    el.textContent = msg;
    el.className = 'key-status-msg ' + (type || '');
    setTimeout(function () {
      if (el.textContent === msg) el.textContent = '';
    }, 3000);
  }

  function escapeAttr(str) {
    return (str || '').replace(/"/g, '&quot;');
  }

  // -- Public API ---------------------------------------------------------------

  window.KeyManager = {
    init: init,
    get: getKey,
    set: setKey,
    has: hasKey,
    remove: removeKey,
    getAll: readAll,
    migrateFromLegacy: migrateFromLegacy,
    initCrypto: _initCrypto,
  };
})();
