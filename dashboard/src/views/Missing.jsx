import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ymd } from '../util.js';

export default function Missing() {
  const [date, setDate] = useState(ymd());
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let dead = false;
    setData(null); setErr(null);
    api.missing({ date })
      .then((d) => { if (!dead) setData(d); })
      .catch((e) => { if (!dead) setErr(e.message); });
    return () => { dead = true; };
  }, [date]);

  if (err) return <div className="empty">Error: {err}</div>;
  if (!data) return <div className="loading">Loading…</div>;

  const sections = [
    { title: 'Store opening',    stores: data.sections.opening },
    { title: 'Grooming',         stores: data.sections.grooming },
    { title: 'DSR (end of day)', stores: data.sections.dsr },
  ];
  for (const [slot, stores] of Object.entries(data.sections.hourly)) {
    sections.push({ title: `Hourly ${slot}`, stores });
  }

  const totalMissing = sections.reduce((a, s) => a + s.stores.length, 0);

  return (
    <>
      <div className="filters">
        <span className="label">Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <span className="range-label" style={{ marginLeft: 12 }}>
          {totalMissing === 0 ? '✓ All reports received' : `${totalMissing} missing report${totalMissing === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="grid-2">
        {sections.map((sec) => (
          <div key={sec.title} className="card">
            <h3>{sec.title}</h3>
            {sec.stores.length ? (
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text)' }}>
                {sec.stores.map((s) => (<li key={s.key} style={{ marginBottom: 4 }}>{s.name}</li>))}
              </ul>
            ) : <div className="empty" style={{ padding: 8 }}>✓ all received</div>}
          </div>
        ))}
      </div>
    </>
  );
}
