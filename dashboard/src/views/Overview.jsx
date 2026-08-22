import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, PieChart, Pie, Cell, Legend, BarChart, Bar } from 'recharts';
import { api } from '../api.js';
import { inr, num, pctLabel, storeColor } from '../util.js';

const AXIS = { stroke: '#6b6b78', style: { fontSize: 11 } };
const GRID = { stroke: '#24242c' };
const TOOLTIP = { contentStyle: { background: '#111114', border: '1px solid #2e2e37', borderRadius: 6, fontSize: 12 } };

export default function Overview({ range, storeKey }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let dead = false;
    setData(null); setErr(null);
    api.overview({ from: range.from, to: range.to, store: storeKey || '' })
      .then((d) => { if (!dead) setData(d); })
      .catch((e) => { if (!dead) setErr(e.message); });
    return () => { dead = true; };
  }, [range.from, range.to, storeKey]);

  if (err) return <div className="empty">Error: {err}</div>;
  if (!data) return <div className="loading">Loading…</div>;

  const { kpi, daily, share } = data;
  const totalShare = share.reduce((a, r) => a + r.sales, 0) || 1;

  return (
    <>
      <div className="kpi-row">
        <div className="kpi"><div className="label">Total Sales</div><div className="value">{inr(kpi.sales)}</div><div className="sub">across the range</div></div>
        <div className="kpi"><div className="label">Bills</div><div className="value">{num(kpi.bills)}</div><div className="sub">{daily.length} days</div></div>
        <div className="kpi"><div className="label">Walk-ins</div><div className="value">{num(kpi.walkins)}</div></div>
        <div className="kpi"><div className="label">Conversion</div><div className="value">{pctLabel(kpi.conversion)}</div><div className="sub">bills ÷ walk-ins</div></div>
        <div className="kpi"><div className="label">Big bills</div><div className="value">{num(kpi.bigBillCount)}</div><div className="sub">{inr(kpi.bigBillTotal)}</div></div>
      </div>

      <div className="card">
        <h3>Daily sales trend</h3>
        <div className="desc">Total sales per day across the selected range{storeKey ? ' (filtered store)' : ''}.</div>
        {daily.length ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={daily} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid vertical={false} {...GRID} />
              <XAxis dataKey="date" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={(v) => v >= 100000 ? (v / 100000).toFixed(1) + 'L' : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v} />
              <Tooltip {...TOOLTIP} formatter={(v) => inr(v)} />
              <Line type="monotone" dataKey="sales" stroke="#7ab7ff" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : <div className="empty">No data in this range.</div>}
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Sales share by store</h3>
          <div className="desc">Contribution to total sales — % of {inr(totalShare)}.</div>
          {share.some((s) => s.sales > 0) ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={share}
                  dataKey="sales"
                  nameKey="store"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  stroke="#0a0a0b"
                >
                  {share.map((s) => (<Cell key={s.store_key} fill={storeColor(s.store_key)} />))}
                </Pie>
                <Tooltip {...TOOLTIP} formatter={(v, _, entry) => [inr(v), entry?.payload?.store]} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9b9ba8' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="empty">No sales data.</div>}
        </div>

        <div className="card">
          <h3>Sales by store</h3>
          <div className="desc">Absolute totals for the range.</div>
          {share.some((s) => s.sales > 0) ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={share} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid vertical={false} {...GRID} />
                <XAxis dataKey="store" {...AXIS} />
                <YAxis {...AXIS} tickFormatter={(v) => v >= 100000 ? (v / 100000).toFixed(1) + 'L' : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v} />
                <Tooltip {...TOOLTIP} formatter={(v) => inr(v)} />
                <Bar dataKey="sales" radius={[4, 4, 0, 0]}>
                  {share.map((s) => (<Cell key={s.store_key} fill={storeColor(s.store_key)} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="empty">No sales data.</div>}
        </div>
      </div>
    </>
  );
}
