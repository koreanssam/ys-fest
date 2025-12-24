const dedupe = (arr) => Array.from(new Set(arr.filter(Boolean)));

const trimTrailingSlash = (value) => String(value || '').replace(/\/$/, '');
const basePath = trimTrailingSlash(import.meta.env.BASE_URL || '/');
const envBase = trimTrailingSlash(import.meta.env.VITE_API_BASE);

const FALLBACK_BASES = dedupe([
  envBase,
  '/api',
  `${basePath}/api`
]).map(trimTrailingSlash);

let resolvedBase = null;
let resolvePromise = null;

const buildUrlWithBase = (base, path) => {
  const trimmed = path.startsWith('/api') ? path.slice(4) : path;
  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${trimTrailingSlash(base)}${normalized}`;
};

const probeBase = async (base) => {
  try {
    const res = await fetch(buildUrlWithBase(base, '/api/phase'), {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) return false;
    if (!contentType.includes('application/json')) return false;
    const data = await res.json().catch(() => null);
    return !!data && typeof data.phase === 'string';
  } catch {
    return false;
  }
};

const getApiBase = async () => {
  if (resolvedBase) return resolvedBase;
  if (!resolvePromise) {
    resolvePromise = (async () => {
      for (const base of FALLBACK_BASES) {
        if (await probeBase(base)) {
          resolvedBase = base;
          return resolvedBase;
        }
      }
      resolvedBase = FALLBACK_BASES[0] || '/api';
      return resolvedBase;
    })();
  }
  return resolvePromise;
};

const buildUrl = async (path) => {
  const base = await getApiBase();
  return buildUrlWithBase(base, path);
};

/**
 * Fetch to the inferred API base.
 * - Uses `VITE_API_BASE` if it responds with JSON (probed via `/api/phase`).
 * - Otherwise falls back to `/api` or `<BASE_URL>/api`.
 * If the response is not JSON, return a synthetic JSON error so callers never crash on parse.
 */
export const apiFetch = async (path, options) => {
  let res;
  try {
    res = await fetch(await buildUrl(path), options);
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return res;
    const text = await res.text();
    return new Response(JSON.stringify({
      error: 'BAD_API_RESPONSE',
      detail: text.slice(0, 200)
    }), { status: res.status || 500, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({
      error: 'NETWORK_ERROR',
      detail: err?.message || String(err)
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const apiEventSource = async (path) => new EventSource(await buildUrl(path));
