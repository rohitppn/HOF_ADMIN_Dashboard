import React, { useState } from 'react';
import { setSecret, api } from './api.js';

export default function Login({ onSuccess }) {
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    setSecret(value.trim());
    try {
      await api.health();
      onSuccess();
    } catch (e) {
      setErr('Invalid secret. Check ADMIN_SECRET in your Railway env.');
    } finally { setBusy(false); }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <h1>HOF ADMIN</h1>
        <p>Enter the admin secret to continue. It matches the <code>ADMIN_SECRET</code> environment variable on the server.</p>
        <input
          type="password"
          placeholder="admin secret"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={busy || !value.trim()}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
        {err && <div className="error">{err}</div>}
      </form>
    </div>
  );
}
