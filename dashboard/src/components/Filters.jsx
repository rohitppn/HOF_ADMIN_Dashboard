import React from 'react';
import { preset } from '../util.js';

const PRESETS = [
  ['today',     'Today'],
  ['yesterday', 'Yesterday'],
  ['last7',     'Last 7d'],
  ['week',      'This week'],
  ['month',     'This month'],
  ['year',      'This year'],
];

export default function Filters({ range, setRange, stores, storeKey, setStoreKey, showStore = true }) {
  const activePreset = matchPreset(range);

  function pick(name) {
    setRange({ ...preset(name), preset: name });
  }

  return (
    <div className="filters">
      <span className="label">Range</span>
      {PRESETS.map(([k, label]) => (
        <button
          key={k}
          className={`preset ${activePreset === k ? 'active' : ''}`}
          onClick={() => pick(k)}
        >{label}</button>
      ))}
      <div className="divider" />
      <input
        type="date"
        value={range.from}
        onChange={(e) => setRange({ from: e.target.value, to: range.to, preset: 'custom' })}
      />
      <span className="range-label">to</span>
      <input
        type="date"
        value={range.to}
        onChange={(e) => setRange({ from: range.from, to: e.target.value, preset: 'custom' })}
      />
      {showStore && stores?.length > 0 && (
        <>
          <div className="divider" />
          <span className="label">Store</span>
          <select value={storeKey || ''} onChange={(e) => setStoreKey(e.target.value || null)}>
            <option value="">All stores</option>
            {stores.map((s) => (
              <option key={s.key} value={s.key}>{s.name}</option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

function matchPreset(range) {
  if (!range.preset) return null;
  return range.preset;
}
