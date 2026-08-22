// Thin fetch wrapper — adds the admin secret header and centralises error handling.

// Where the backend lives. Empty ('') = same origin (Railway deploy).
// On GitHub Pages, set VITE_API_BASE=https://<railway>.up.railway.app at build time.
const API_BASE = (import.meta.env?.VITE_API_BASE || '').replace(/\/$/, '');

const KEY_STORAGE = 'hof_admin_secret';

export function getSecret() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}
export function setSecret(v) {
  try { localStorage.setItem(KEY_STORAGE, v); } catch {}
}
export function clearSecret() {
  try { localStorage.removeItem(KEY_STORAGE); } catch {}
}

async function req(path, params) {
  const url = new URL(API_BASE + path, API_BASE || window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), { headers: { 'x-admin-secret': getSecret() } });
  if (res.status === 401) {
    clearSecret();
    window.location.reload();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { const body = await res.json(); msg = body.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
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
  storesAll:   ()       => req('/dashboard-api/stores/all'),
  addStore:    async (row) => {
    const res = await fetch(API_BASE + '/dashboard-api/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': getSecret() },
      body: JSON.stringify(row),
    });
    if (!res.ok) { let m = res.statusText; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
    return res.json();
  },
  deleteStore: async (key) => {
    const res = await fetch(API_BASE + `/dashboard-api/stores/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: { 'x-admin-secret': getSecret() },
    });
    if (!res.ok) { let m = res.statusText; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
    return res.json();
  },
  reactivateStore: async (key) => {
    const res = await fetch(API_BASE + `/dashboard-api/stores/${encodeURIComponent(key)}/reactivate`, {
      method: 'POST',
      headers: { 'x-admin-secret': getSecret() },
    });
    if (!res.ok) { let m = res.statusText; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
    return res.json();
  },
  broadcast:   async (jid, text) => {
    const res = await fetch(API_BASE + '/dashboard-api/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': getSecret() },
      body: JSON.stringify({ jid, text }),
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const body = await res.json(); msg = body.error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  },
};
