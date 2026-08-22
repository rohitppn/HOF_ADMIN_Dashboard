import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, Legend } from 'recharts';
import { api } from '../api.js';
import { inr, num, pctLabel, storeColor } from '../util.js';

const AXIS = { stroke: '#6b6b78', style: { fontSize: 11 } };
const GRID = { stroke: '#24242c' };
const TOOLTIP = { contentStyle: { background: '#111114', border: '1px solid #2e2e37', borderRadius: 6, fontSize: 12 } };
const fmtCompact = (v) => v >= 100000 ? (v / 100000).toFixed(1) + 'L' : v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v;

export default function Analytics({ range, storeKey }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let dead = false;
    setData(null); setErr(null);
    api.analytics({ from: range.from, to: range.to, store: storeKey || '' })
      .then((d) => { if (!dead) setData(d); })
      .catch((e) => { if (!dead) setErr(e.message); });
    return () => { dead = true; };
  }, [range.from, range.to, storeKey]);

  if (err) return <div className="empty">Error: {err}</div>;
  if (!data) return <div className="loading">Loading…</div>;

  return (
    <>
      <div className="card">
        <h3>Sales momentum</h3>
        <div className="desc">Daily total with 7-day moving average — trend over the range.</div>
        {data.momentum.length ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.momentum} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid vertical={false} {...GRID} />
              <XAxis dataKey="date" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={fmtCompact} />
              <Tooltip {...TOOLTIP} formatter={(v) => inr(v)} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#9b9ba8' }} />
              <Line type="monotone" dataKey="sales" name="Daily" stroke="#7ab7ff" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="ma7"   name="7-day avg" stroke="#fbbf24" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <div className="empty">No data.</div>}
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Week-over-week</h3>
          <div className="desc">Current range vs the previous {data.days}-day window ({data.prevFrom} → {data.prevTo}).</div>
          {data.weekOverWeek.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.weekOverWeek} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid vertical={false} {...GRID} />
                <XAxis dataKey="store" {...AXIS} />
                <YAxis {...AXIS} tickFormatter={fmtCompact} />
                <Tooltip {...TOOLTIP} formatter={(v) => inr(v)} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9b9ba8' }} />
                <Bar dataKey="previous" name="Previous" fill="#4b4b58" radius={[3, 3, 0, 0]} />
                <Bar dataKey="current"  name="Current"  fill="#7ab7ff" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="empty">No comparison data.</div>}
          <table style={{ marginTop: 12 }}>
            <thead><tr><th>Store</th><th className="num">Previous</th><th className="num">Current</th><th className="num">Δ</th></tr></thead>
            <tbody>
              {data.weekOverWeek.map((r) => (
                <tr key={r.store_key}>
                  <td>{r.store}</td>
                  <td className="num">{inr(r.previous)}</td>
                  <td className="num">{inr(r.current)}</td>
                  <td className="num">
                    <span className={`badge ${r.deltaPct > 0 ? 'green' : r.deltaPct < 0 ? 'red' : ''}`}>
                      {r.deltaPct > 0 ? '↑ ' : r.deltaPct < 0 ? '↓ ' : ''}{pctLabel(Math.abs(r.deltaPct))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Big bill distribution</h3>
          <div className="desc">How high-value bills split across amount buckets.</div>
          {data.billDistribution.some((b) => b.count > 0) ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.billDistribution} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid vertical={false} {...GRID} />
                <XAxis dataKey="bucket" {...AXIS} />
                <YAxis {...AXIS} />
                <Tooltip {...TOOLTIP} formatter={(v, name) => name === 'count' ? [`${v} bills`, 'Count'] : v} />
                <Bar dataKey="count" fill="#a78bfa" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="empty">No big bills in this range.</div>}
          <table style={{ marginTop: 12 }}>
            <thead><tr><th>Bucket</th><th className="num">Count</th><th className="num">Combined</th></tr></thead>
            <tbody>
              {data.billDistribution.map((b) => (
                <tr key={b.bucket}><td>{b.bucket}</td><td className="num">{num(b.count)}</td><td className="num">{inr(b.total)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Top sales days</h3>
          <div className="desc">Highest single-store days in the range.</div>
          {data.topDays.length ? (
            <table>
              <thead><tr><th>#</th><th>Date</th><th>Store</th><th className="num">Sales</th></tr></thead>
              <tbody>
                {data.topDays.map((r, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{r.date}</td>
                    <td><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: storeColor(r.store_key), marginRight: 8 }} />{r.store}</td>
                    <td className="num"><b>{inr(r.sales)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty">No sales in this range.</div>}
        </div>
        <div className="card">
          <h3>Worst sales days</h3>
          <div className="desc">Lowest single-store days (excludes zero/missing).</div>
          {data.worstDays.length ? (
            <table>
              <thead><tr><th>#</th><th>Date</th><th>Store</th><th className="num">Sales</th></tr></thead>
              <tbody>
                {data.worstDays.map((r, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{r.date}</td>
                    <td><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: storeColor(r.store_key), marginRight: 8 }} />{r.store}</td>
                    <td className="num">{inr(r.sales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty">No sales in this range.</div>}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Peak hour per store</h3>
          <div className="desc">Best hourly slot (highest average sales) over the range.</div>
          <table>
            <thead><tr><th>Store</th><th>Best slot</th><th className="num">Avg sales</th></tr></thead>
            <tbody>
              {data.peakHours.map((r) => (
                <tr key={r.store_key}>
                  <td><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: storeColor(r.store_key), marginRight: 8 }} />{r.store}</td>
                  <td>{r.slot}</td>
                  <td className="num">{inr(r.avgSales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Consecutive-days-above-target streak</h3>
          <div className="desc">Longest and current streak of days a store hit its daily target.</div>
          <table>
            <thead><tr><th>Store</th><th className="num">Best streak</th><th className="num">Current</th></tr></thead>
            <tbody>
              {data.streaks.map((r) => (
                <tr key={r.store_key}>
                  <td><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: storeColor(r.store_key), marginRight: 8 }} />{r.store}</td>
                  <td className="num"><b>{r.best_streak}</b> day{r.best_streak === 1 ? '' : 's'}</td>
                  <td className="num">
                    <span className={`badge ${r.current_streak > 0 ? 'green' : ''}`}>
                      {r.current_streak} day{r.current_streak === 1 ? '' : 's'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
