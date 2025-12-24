const dedupe = (arr) => Array.from(new Set(arr.filter(Boolean)));

const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
const primaryBase = (import.meta.env.VITE_API_BASE || `${basePath}/api`).replace(/\/$/, '');

const buildUrl = (path) => {
  const trimmed = path.startsWith('/api') ? path.slice(4) : path;
  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${primaryBase}${normalized}`;
};

/**
 * Fetch to the inferred API base (defaults to "<BASE_URL>/api").
 * If the response is not JSON, return a synthetic JSON error so callers never crash on parse.
 */
export const apiFetch = async (path, options) => {
  let res;
  try {
    res = await fetch(buildUrl(path), options);
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

export const apiEventSource = (path) => new EventSource(buildUrl(path));
