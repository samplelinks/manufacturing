/* ==========================================================================
   api.js — thin wrapper around fetch() for calling the Apps Script backend.
   Shared by main.js (index.html) and admin.js (admin.html).
   ========================================================================== */

const API_TIMEOUT_MS = 20000;

function checkApiUrl_() {
  if (!API_URL || API_URL.indexOf('PASTE_YOUR') > -1) {
    throw new Error('No API URL is set. Open js/config.js and paste your deployed Web App URL (it ends in /exec).');
  }
}

function withTimeout_(ms) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, ms);
  return { signal: controller.signal, done: function () { clearTimeout(timer); } };
}

/**
 * GET is used only for public, read-only data. Results are held in
 * sessionStorage so moving between pages in one visit does not re-fetch the
 * job list — the single biggest thing that made the old site feel slow.
 */
async function apiGet(action, params, cacheSeconds) {
  checkApiUrl_();
  params = params || {};
  const query = new URLSearchParams(Object.assign({ action: action }, params)).toString();
  const cacheKey = 'apiCache:' + query;

  if (cacheSeconds) {
    try {
      const hit = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      if (hit && (Date.now() - hit.at) < cacheSeconds * 1000) return hit.data;
    } catch (err) { /* a bad cache entry is not worth failing over */ }
  }

  const t = withTimeout_(API_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL + '?' + query, { signal: t.signal });
    t.done();
    if (!res.ok) throw new Error('The server returned ' + res.status + '. Check that the Web App is deployed with access set to "Anyone".');
    const data = await res.json();
    if (cacheSeconds) {
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data: data })); } catch (err) { /* storage full */ }
    }
    return data;
  } catch (err) {
    t.done();
    if (err.name === 'AbortError') throw new Error('The server did not respond in time. Check your connection and try again.');
    throw err;
  }
}

/**
 * POST is used for writes and anything behind a sign-in.
 *
 * Content-Type is deliberately text/plain rather than application/json: an
 * Apps Script Web App cannot answer a CORS preflight (OPTIONS) request, and a
 * JSON content type triggers one. text/plain keeps this a "simple request" so
 * the browser skips the preflight, and the Apps Script side still parses the
 * body as JSON.
 */
async function apiPost(action, payload) {
  checkApiUrl_();
  const t = withTimeout_(API_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, payload: payload || {} }),
      signal: t.signal
    });
    t.done();
    if (!res.ok) throw new Error('The server returned ' + res.status + '. Check that the Web App is deployed with access set to "Anyone".');
    return await res.json();
  } catch (err) {
    t.done();
    if (err.name === 'AbortError') throw new Error('The server did not respond in time. Check your connection and try again.');
    throw err;
  }
}

function clearApiCache() {
  try {
    Object.keys(sessionStorage)
      .filter(function (k) { return k.indexOf('apiCache:') === 0; })
      .forEach(function (k) { sessionStorage.removeItem(k); });
  } catch (err) { /* nothing to clear */ }
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
