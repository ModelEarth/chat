// POST /api/validate-key
// Validates an API key by making a minimal call to the provider.
// Returns { valid: true } on success, { valid: false } on explicit rejection,
// { valid: null } when the result is unknown (network error, unsupported provider).

export async function POST(request: Request) {
  let body: { provider?: string; key?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { provider } = body;
  let key = body.key;
  if (!provider || !key) {
    return Response.json({ error: 'Missing provider or key' }, { status: 400 });
  }
  // A key the keys page encrypted for this server ("rsa:...").
  if (key.startsWith('rsa:')) {
    const { decryptWithServerKey } = await import('@/lib/server-crypto');
    key = decryptWithServerKey(key, provider) ?? '';
    if (!key) return Response.json({ valid: false });
  }

  try {
    let valid: boolean | null = null;

    switch (provider) {
      case 'anthropic': {
        const r = await fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        });
        if (r.status === 200) valid = true;
        else if (r.status === 401 || r.status === 403) valid = false;
        break;
      }
      case 'openai': {
        const r = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (r.status === 200) valid = true;
        else if (r.status === 401 || r.status === 403) valid = false;
        break;
      }
      case 'google': {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=1`
        );
        if (r.status === 200) valid = true;
        else if (r.status === 400 || r.status === 403) valid = false;
        break;
      }
      case 'xai': {
        const r = await fetch('https://api.x.ai/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (r.status === 200) valid = true;
        else if (r.status === 401 || r.status === 403) valid = false;
        break;
      }
      case 'github': {
        const r = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'codechat-key-validator' },
        });
        if (r.status === 200) valid = true;
        else if (r.status === 401 || r.status === 403) valid = false;
        break;
      }
      default:
        return Response.json({ valid: null, error: 'Unsupported provider' });
    }

    return Response.json({ valid });
  } catch {
    return Response.json({ valid: null });
  }
}
