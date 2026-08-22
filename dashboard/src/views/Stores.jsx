import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { api } from '../api.js';
import { inr, num, pctLabel, storeColor } from '../util.js';

const AXIS = { stroke: '#6b6b78', style: { fontSize: 11 } };
const GRID = { stroke: '#24242c' };
const TOOLTIP = { contentStyle: { background: '#111114', border: '1px solid #2e2e37', borderRadius: 6, fontSize: 12 } };

export default function Stores({ range }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let dead = false;
    setData(null); setErr(null);
    api.storesPerf({ from: range.from, to: range.to })
      .then((d) => { if (!dead) setData(d); })
      .catch((e) => { if (!dead) setErr(e.message); });
    return () => { dead = true; };
  }, [range.from, range.to]);

  if (err) return <div className="empty">Error: {err}</div>;
  if (!data) return <div className="loading">Loading…</div>;

  const rows = data.rows;

  return (
    <>
      <div className="grid-2">
        <div className="card">
          <h3>Target achievement</h3>
          <div className="desc">Total sales ÷ (daily target × {data.days} days). 100% line is dashed.</div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid vertical={false} {...GRID} />
              <XAxis dataKey="store" {...AXIS} />
              <YAxis {...AXIS} unit="%" />
              <Tooltip {...TOOLTIP} formatter={(v) => `${v}%`} />
              <ReferenceLine y={100} stroke="#4ade80" strokeDasharray="4 4" />
              <Bar dataKey="achievement_pct" radius={[4, 4, 0, 0]}>
                {rows.map((r) => (<Cell key={r.store_key} fill={storeColor(r.store_key)} />))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3>Consistency</h3>
          <div className="desc">% of days each store hit ≥ daily target.</div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid vertical={false} {...GRID} />
              <XAxis dataKey="store" {...AXIS} />
              <YAxis {...AXIS} unit="%" domain={[0, 100]} />
              <Tooltip {...TOOLTIP} formatter={(v) => `${v}%`} />
              <Bar dataKey="consistency_pct" radius={[4, 4, 0, 0]}>
                {rows.map((r) => (<Cell key={r.store_key} fill={storeColor(r.store_key)} />))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h3>Detailed metrics</h3>
        <table>
          <thead>
            <tr>
              <th>Store</th>
              <th className="num">Daily target</th>
              <th className="num">Days on record</th>
              <th className="num">Days hit target</th>
              <th className="num">Total sales</th>
              <th className="num">Avg / day</th>
              <th className="num">Achievement</th>
              <th className="num">Consistency</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.store_key}>
                <td>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: storeColor(r.store_key), marginRight: 8 }} />
                  {r.store}
                </td>
                <td className="num">{inr(r.dailyTarget)}</td>
                <td className="num">{num(r.days)}</td>
                <td className="num">{num(r.hit)}</td>
                <td className="num">{inr(r.totalSales)}</td>
                <td className="num">{inr(r.avg_sales)}</td>
                <td className="num">
                  <span className={`badge ${r.achievement_pct >= 100 ? 'green' : r.achievement_pct >= 80 ? 'amber' : 'red'}`}>
                    {pctLabel(r.achievement_pct)}
                  </span>
                </td>
                <td className="num">{pctLabel(r.consistency_pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
