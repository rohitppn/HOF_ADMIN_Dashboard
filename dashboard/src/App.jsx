import React, { useEffect, useMemo, useState } from 'react';
import { api, getToken, clearToken } from './api.js';
import Login from './Login.jsx';
import Filters from './components/Filters.jsx';
import Overview from './views/Overview.jsx';
import Analytics from './views/Analytics.jsx';
import Stores from './views/Stores.jsx';
import Hourly from './views/Hourly.jsx';
import BigBills from './views/BigBills.jsx';
import Missing from './views/Missing.jsx';
import Messages from './views/Messages.jsx';
import Broadcast from './views/Broadcast.jsx';
import WhatsAppView from './views/WhatsApp.jsx';
import Manage from './views/Manage.jsx';
import { preset } from './util.js';

const TABS = [
  { id: 'overview',  label: 'Overview',        Icon: '◐', Comp: Overview,     showStore: true,  showFilters: true },
  { id: 'analytics', label: 'Analytics',       Icon: '∿', Comp: Analytics,    showStore: true,  showFilters: true },
  { id: 'stores',    label: 'Store perf.',     Icon: '▤', Comp: Stores,       showStore: false, showFilters: true },
  { id: 'hourly',    label: 'Hourly',          Icon: '⚏', Comp: Hourly,       showStore: true,  showFilters: true },
  { id: 'bigbills',  label: 'Big bills',       Icon: '★', Comp: BigBills,     showStore: true,  showFilters: true },
  { id: 'missing',   label: 'Missing reports', Icon: '!', Comp: Missing,      showStore: false, showFilters: false },
  { id: 'messages',  label: 'Message log',     Icon: '▶', Comp: Messages,     showStore: true,  showFilters: true },
  { id: 'broadcast', label: 'Send message',    Icon: '↗', Comp: Broadcast,    showStore: false, showFilters: false },
  { id: 'whatsapp',  label: 'WhatsApp',        Icon: '⌘', Comp: WhatsAppView, showStore: false, showFilters: false },
  { id: 'manage',    label: 'Manage stores',   Icon: '⚙', Comp: Manage,       showStore: false, showFilters: false },
];

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [userEmail, setUserEmail] = useState('');
  const [tab, setTab] = useState('overview');
  const [range, setRange] = useState(() => ({ ...preset('today'), preset: 'today' }));
  const [storeKey, setStoreKey] = useState(null);
  const [stores, setStores] = useState([]);
  const [status, setStatus] = useState(null);

  // Validate token + load store list on mount.
  useEffect(() => {
    if (!authed) return;
    let dead = false;
    (async () => {
      try {
        const me = await api.me();
        const s = await api.stores();
        if (dead) return;
        setUserEmail(me?.email || '');
        setStores(s.stores);
        setStatus({ ok: true });
      } catch (e) {
        if (!dead) setStatus({ ok: false, error: e.message });
      }
    })();
    return () => { dead = true; };
  }, [authed]);

  function logout() {
    clearToken();
    setAuthed(false);
  }

  const current = useMemo(() => TABS.find((t) => t.id === tab), [tab]);

  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;

  const Comp = current.Comp;
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="dot" /> HOF ADMIN</div>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nav-item ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span style={{ opacity: 0.6, width: 12, textAlign: 'center' }}>{t.Icon}</span>
            {t.label}
          </button>
        ))}
        <div className="spacer" />
        <div className="foot" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          {userEmail && (
            <div style={{ marginBottom: 8, color: 'var(--text-2)', fontSize: 12, wordBreak: 'break-all' }}>
              {userEmail}
            </div>
          )}
          <button
            onClick={logout}
            style={{ color: 'var(--text-3)', fontSize: 12, padding: 0, textAlign: 'left' }}
          >Sign out</button>
          <div style={{ marginTop: 8, color: 'var(--text-3)', fontSize: 11 }}>
            {status?.ok ? `${stores.length} stores connected` : status?.error || 'Loading…'}
          </div>
        </div>
      </aside>
      <main className="main">
        <h1>{current.label}</h1>
        {current.showFilters && (
          <Filters
            range={range}
            setRange={setRange}
            stores={stores}
            storeKey={storeKey}
            setStoreKey={setStoreKey}
            showStore={current.showStore}
          />
        )}
        <Comp range={range} storeKey={storeKey} stores={stores} />
      </main>
    </div>
  );
}
