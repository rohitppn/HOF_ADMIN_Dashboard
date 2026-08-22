import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const INTENTS = ['', 'opening_balance', 'store_open', 'hourly_sales', 'big_bill', 'grooming', 'dsr', 'other'];

export default function Messages({ range }) {
  const [intent, setIntent] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let dead = false;
    setData(null); setErr(null);
    api.messages({ from: range.from, to: range.to, intent, limit: 500 })
      .then((d) => { if (!dead) setData(d); })
      .catch((e) => { if (!dead) setErr(e.message); });
    return () => { dead = true; };
  }, [range.from, range.to, intent]);

  return (
    <>
      <div className="filters">
        <span className="label">Intent</span>
        <select value={intent} onChange={(e) => setIntent(e.target.value)}>
          {INTENTS.map((i) => (<option key={i} value={i}>{i || 'All'}</option>))}
        </select>
      </div>

      {err && <div className="empty">Error: {err}</div>}
      {!data && !err && <div className="loading">Loading…</div>}
      {data && (
        <div className="card">
          <h3>Message log</h3>
          <div className="desc">Newest first. Capped at 500 rows.</div>
          {data.rows.length ? (
            <table>
              <thead>
                <tr><th>Received</th><th>Sender</th><th>Intent</th><th>Text</th></tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--text-2)' }}>{r.received_at}</td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--text-2)' }}>{r.sender || '—'}</td>
                    <td><span className="badge">{r.intent || '—'}</span></td>
                    <td style={{ color: 'var(--text)', maxWidth: 500, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.text}>{r.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty">No messages in this range.</div>}
        </div>
      )}
    </>
  );
}
