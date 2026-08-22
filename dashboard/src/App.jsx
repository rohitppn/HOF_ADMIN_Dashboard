import React, { useEffect, useMemo, useState } from 'react';
import { api, getSecret } from './api.js';
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
  const [authed, setAuthed] = useState(!!getSecret());
  const [tab, setTab] = useState('overview');
  const [range, setRange] = useState(() => ({ ...preset('today'), preset: 'today' }));
  const [storeKey, setStoreKey] = useState(null);
  const [stores, setStores] = useState([]);
  const [status, setStatus] = useState(null);

  // Validate secret + load store list on mount.
  useEffect(() => {
    if (!authed) return;
    let dead = false;
    (async () => {
      try {
        await api.health();
        const s = await api.stores();
        if (dead) return;
        setStores(s.stores);
        setStatus({ ok: true });
      } catch (e) {
        if (!dead) setStatus({ ok: false, error: e.message });
      }
    })();
    return () => { dead = true; };
  }, [authed]);

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
        <div className="foot">
          {status?.ok ? `Connected · ${stores.length} stores` : status?.error || 'Loading…'}
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
