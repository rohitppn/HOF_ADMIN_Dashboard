import React, { useState } from 'react';
import { api } from './api.js';

export default function Login({ onSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api.login(email.trim(), password);
      onSuccess();
    } catch (e) {
      setErr(e.message || 'Login failed');
    } finally { setBusy(false); }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <h1>HOF ADMIN</h1>
        <p>Sign in with the admin email and password set in your Railway env.</p>
        <input
          type="email"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          required
        />
        <input
          type="password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {err && <div className="error">{err}</div>}
      </form>
    </div>
  );
}
