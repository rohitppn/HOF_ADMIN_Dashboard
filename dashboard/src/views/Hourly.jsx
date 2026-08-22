import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import { api } from '../api.js';
import { inr, storeColor } from '../util.js';

const AXIS = { stroke: '#6b6b78', style: { fontSize: 11 } };
const GRID = { stroke: '#24242c' };
const TOOLTIP = { contentStyle: { background: '#111114', border: '1px solid #2e2e37', borderRadius: 6, fontSize: 12 } };

export default function Hourly({ range, storeKey, stores }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let dead = false;
    setData(null); setErr(null);
    api.hourly({ from: range.from, to: range.to, store: storeKey || '' })
      .then((d) => { if (!dead) setData(d); })
      .catch((e) => { if (!dead) setErr(e.message); });
    return () => { dead = true; };
  }, [range.from, range.to, storeKey]);

  // Chart data: one row per slot, keyed by store name — grouped bar chart.
  const grouped = useMemo(() => {
    if (!data) return [];
    const bySlot = new Map();
    for (const row of data.matrix) {
      for (const cell of row) {
        const s = bySlot.get(cell.slot) ?? { slot: cell.slot };
        s[cell.store] = cell.sales;
        bySlot.set(cell.slot, s);
      }
    }
    return Array.from(bySlot.values()).sort((a, b) => a.slot.localeCompare(b.slot));
  }, [data]);

  if (err) return <div className="empty">Error: {err}</div>;
  if (!data) return <div className="loading">Loading…</div>;

  const activeStores = data.stores; // names, in order

  // Heatmap max for color scaling.
  const flatCells = data.matrix.flat();
  const max = Math.max(1, ...flatCells.map((c) => c.sales));

  return (
    <>
      <div className="card">
        <h3>Sales by hour of day</h3>
        <div className="desc">Sum across the range, per slot, grouped by store.</div>
        {grouped.length ? (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={grouped} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid vertical={false} {...GRID} />
              <XAxis dataKey="slot" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={(v) => v >= 100000 ? (v / 100000).toFixed(1) + 'L' : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v} />
              <Tooltip {...TOOLTIP} formatter={(v) => inr(v)} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#9b9ba8' }} />
              {activeStores.map((storeName) => {
                const key = stores.find((s) => s.name === storeName)?.key || storeName;
                return <Bar key={storeName} dataKey={storeName} fill={storeColor(key)} radius={[3, 3, 0, 0]} />;
              })}
            </BarChart>
          </ResponsiveContainer>
        ) : <div className="empty">No hourly data in this range.</div>}
      </div>

      <div className="card">
        <h3>Heatmap</h3>
        <div className="desc">Darker = higher sales.</div>
        {data.matrix.length && data.slots.length ? (
          <div className="heatmap">
            <div className="row" style={{ gridTemplateColumns: `140px repeat(${data.slots.length}, minmax(80px, 1fr))` }}>
              <div className="row-label" />
              {data.slots.map((s) => (<div key={s} className="header">{s}</div>))}
            </div>
            {data.matrix.map((row, i) => (
              <div key={i} className="row" style={{ gridTemplateColumns: `140px repeat(${data.slots.length}, minmax(80px, 1fr))` }}>
                <div className="row-label">{data.stores[i]}</div>
                {row.map((cell) => {
                  const intensity = cell.sales / max;
                  const bg = `rgba(122, 183, 255, ${0.08 + intensity * 0.7})`;
                  return (
                    <div key={cell.slot} className="cell" style={{ background: bg }} title={`${cell.store} @ ${cell.slot}: ${inr(cell.sales)}`}>
                      {cell.sales ? (cell.sales >= 1000 ? Math.round(cell.sales / 1000) + 'K' : cell.sales) : '—'}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : <div className="empty">No hourly data in this range.</div>}
      </div>
    </>
  );
}
