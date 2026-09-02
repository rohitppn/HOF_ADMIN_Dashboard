// Thin fetch wrapper — attaches the session token and centralises error handling.

// Where the backend lives. Empty ('') = same origin (Railway single-URL deploy).
// On GitHub Pages, set VITE_API_BASE=https://<railway>.up.railway.app at build time.
const API_BASE = (import.meta.env?.VITE_API_BASE || '').replace(/\/$/, '');

const TOKEN_STORAGE = 'hof_admin_token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_STORAGE) || ''; } catch { return ''; }
}
export function setToken(v) {
  try { localStorage.setItem(TOKEN_STORAGE, v); } catch {}
}
export function clearToken() {
  try { localStorage.removeItem(TOKEN_STORAGE); } catch {}
}

function authHeaders(extra = {}) {
  const h = { ...extra };
  const token = getToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function handleResponse(res) {
  if (res.status === 401) {
    clearToken();
    if (window.location.pathname !== '/') window.location.reload();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { const body = await res.json(); msg = body.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

async function req(path, params) {
  const url = new URL(API_BASE + path, API_BASE || window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') url.searchParams.set(k, v);
    }
  }
  return handleResponse(await fetch(url.toString(), { headers: authHeaders() }));
}

async function post(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body || {}),
  });
  return handleResponse(res);
}

async function del(path) {
  const res = await fetch(API_BASE + path, { method: 'DELETE', headers: authHeaders() });
  return handleResponse(res);
}

export const api = {
  // auth — /login is the ONE endpoint that doesn't need a token
  login: async (email, password) => {
    const res = await fetch(API_BASE + '/dashboard-api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) { let m = res.statusText; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
    const data = await res.json();
    if (data.token) setToken(data.token);
    return data;
  },
  me:          ()       => req('/dashboard-api/me'),
  logout:      ()       => { clearToken(); },

  health:      ()       => req('/dashboard-api/health'),
  stores:      ()       => req('/dashboard-api/stores'),
  overview:    (p)      => req('/dashboard-api/overview', p),
  storesPerf:  (p)      => req('/dashboard-api/stores/performance', p),
  ranking:     (p)      => req('/dashboard-api/ranking', p),
  hourly:      (p)      => req('/dashboard-api/hourly', p),
  bigBills:    (p)      => req('/dashboard-api/big-bills', p),
  missing:     (p)      => req('/dashboard-api/missing', p),
  messages:    (p)      => req('/dashboard-api/messages', p),
  analytics:   (p)      => req('/dashboard-api/analytics', p),
  whatsapp:    ()       => req('/dashboard-api/whatsapp'),
  unlinkWhatsapp: ()    => post('/dashboard-api/whatsapp/unlink'),
  storesAll:   ()       => req('/dashboard-api/stores/all'),
  addStore:    (row)    => post('/dashboard-api/stores', row),
  deleteStore: (key)    => del(`/dashboard-api/stores/${encodeURIComponent(key)}`),
  reactivateStore: (key) => post(`/dashboard-api/stores/${encodeURIComponent(key)}/reactivate`),
  broadcast:   (jid, text) => post('/dashboard-api/broadcast', { jid, text }),
};

// Also export API_BASE so other views (e.g. WhatsApp reset-session) can build
// the right URL for non-dashboard-api endpoints.
export { API_BASE };
