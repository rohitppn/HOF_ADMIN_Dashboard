import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { inr } from '../util.js';

export default function BigBills({ range, storeKey }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let dead = false;
    setData(null); setErr(null);
    api.bigBills({ from: range.from, to: range.to, store: storeKey || '' })
      .then((d) => { if (!dead) setData(d); })
      .catch((e) => { if (!dead) setErr(e.message); });
    return () => { dead = true; };
  }, [range.from, range.to, storeKey]);

  if (err) return <div className="empty">Error: {err}</div>;
  if (!data) return <div className="loading">Loading…</div>;

  const total = data.rows.reduce((a, r) => a + (r.amount || 0), 0);

  return (
    <>
      <div className="kpi-row">
        <div className="kpi"><div className="label">Big bills</div><div className="value">{data.rows.length}</div></div>
        <div className="kpi"><div className="label">Combined value</div><div className="value">{inr(total)}</div></div>
        <div className="kpi"><div className="label">Average</div><div className="value">{inr(data.rows.length ? Math.round(total / data.rows.length) : 0)}</div></div>
      </div>
      <div className="card">
        <h3>All high-value bills</h3>
        <div className="desc">Sorted by date (newest first), then amount.</div>
        {data.rows.length ? (
          <table>
            <thead>
              <tr><th>Date</th><th>Store</th><th className="num">Amount</th><th>Reported at</th><th>Raw text</th></tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.date}</td>
                  <td>{r.store}</td>
                  <td className="num">{inr(r.amount)}</td>
                  <td>{r.reported_at}</td>
                  <td style={{ color: 'var(--text-3)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.raw_text}>
                    {r.raw_text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">No big bills recorded in this range.</div>}
      </div>
    </>
  );
}
