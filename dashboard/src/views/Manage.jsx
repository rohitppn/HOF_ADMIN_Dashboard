import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { inr, storeColor } from '../util.js';

// Add / remove stores. The server writes to Supabase and reloads the in-memory
// phone map, so the bot picks up changes without a restart.

const EMPTY = { key: '', name: '', phone: '', daily_target: 100000, hourly_target: 12000 };

export default function Manage() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  async function refresh() {
    setErr(null);
    try {
      const { stores } = await api.storesAll();
      setRows(stores);
    } catch (e) { setErr(e.message); }
  }

  useEffect(() => { refresh(); }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(null); setFlash(null);
    try {
      const r = await api.addStore(form);
      setForm(EMPTY);
      setFlash(`✓ Added ${r.store.name}`);
      await refresh();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function remove(store) {
    if (!confirm(`Remove ${store.name}? Bot will stop routing to this store immediately. History stays intact.`)) return;
    setBusy(true); setErr(null); setFlash(null);
    try {
      await api.deleteStore(store.key);
      setFlash(`✓ Removed ${store.name}`);
      await refresh();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function restore(store) {
    setBusy(true); setErr(null); setFlash(null);
    try {
      await api.reactivateStore(store.key);
      setFlash(`✓ Reactivated ${store.name}`);
      await refresh();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  // Slugify the name into a key as the user types, unless they've customised it.
  function updateName(v) {
    const auto = String(v).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    setForm((f) => ({
      ...f,
      name: v,
      key: (f.key === '' || f.key === slugify(f.name)) ? auto : f.key,
    }));
  }

  return (
    <>
      <div className="card">
        <h3>Add a store</h3>
        <div className="desc">
          Phone must be the WhatsApp number the manager posts from (digits only, with or without the <code>91</code> country code).
          Bot picks up the change immediately — no restart needed.
        </div>
        <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <Field label="Name">
            <input required value={form.name} onChange={(e) => updateName(e.target.value)} placeholder="e.g. Palladium Mumbai" style={INPUT} />
          </Field>
          <Field label="Key (slug)">
            <input required value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))} placeholder="palladium_mumbai" style={INPUT} />
          </Field>
          <Field label="Phone">
            <input required value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, '') }))} placeholder="9355617700" style={INPUT} />
          </Field>
          <Field label="Daily target (₹)">
            <input required type="number" min="0" step="10000" value={form.daily_target} onChange={(e) => setForm((f) => ({ ...f, daily_target: Number(e.target.value) }))} style={INPUT} />
          </Field>
          <Field label="Hourly target (₹)">
            <input required type="number" min="0" step="1000" value={form.hourly_target} onChange={(e) => setForm((f) => ({ ...f, hourly_target: Number(e.target.value) }))} style={INPUT} />
          </Field>
          <div style={{ alignSelf: 'end' }}>
            <button
              type="submit"
              disabled={busy || !form.name || !form.key || !form.phone}
              style={{ padding: '10px 20px', borderRadius: 8, background: 'var(--accent-2)', color: 'white', fontWeight: 500, opacity: busy || !form.name || !form.key || !form.phone ? 0.5 : 1 }}
            >{busy ? 'Saving…' : 'Add store'}</button>
          </div>
        </form>
        {err && <div className="empty" style={{ color: 'var(--red)', marginTop: 12 }}>Error: {err}</div>}
        {flash && <div className="empty" style={{ color: 'var(--green)', marginTop: 12 }}>{flash}</div>}
      </div>

      <div className="card">
        <h3>All stores</h3>
        <div className="desc">Removed stores are hidden from the bot but stay listed here so you can reactivate.</div>
        {!rows && <div className="loading">Loading…</div>}
        {rows && (
          <table>
            <thead>
              <tr>
                <th>Store</th>
                <th>Key</th>
                <th>Phone</th>
                <th className="num">Daily target</th>
                <th className="num">Hourly target</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.key} style={{ opacity: s.active ? 1 : 0.5 }}>
                  <td>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: storeColor(s.key), marginRight: 8 }} />
                    {s.name}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-2)' }}>{s.key}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{s.phone}</td>
                  <td className="num">{inr(s.dailyTarget)}</td>
                  <td className="num">{inr(s.hourlyTarget)}</td>
                  <td>
                    {s.active ? <span className="badge green">active</span> : <span className="badge">removed</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {s.active ? (
                      <button
                        disabled={busy}
                        onClick={() => remove(s)}
                        style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border-2)', color: 'var(--red)', fontSize: 12 }}
                      >Remove</button>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() => restore(s)}
                        style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border-2)', color: 'var(--green)', fontSize: 12 }}
                      >Reactivate</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

const INPUT = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-3)', color: 'var(--text)' };

function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ color: 'var(--text-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.05, marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}

function slugify(s) { return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
