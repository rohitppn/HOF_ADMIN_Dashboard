import React, { useEffect, useState } from 'react';
import { api, getToken, API_BASE } from '../api.js';

// Polls /whatsapp every 3s so the QR appears the moment the bot emits one,
// and the connected view updates as soon as the link is established.

export default function WhatsAppView() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let dead = false;
    async function tick() {
      try {
        const d = await api.whatsapp();
        if (!dead) { setData(d); setErr(null); }
      } catch (e) { if (!dead) setErr(e.message); }
    }
    tick();
    const id = setInterval(tick, 3000);
    return () => { dead = true; clearInterval(id); };
  }, []);

  async function copyJid(jid) {
    try { await navigator.clipboard.writeText(jid); setCopied(jid); setTimeout(() => setCopied(null), 1200); } catch {}
  }

  async function resetSession() {
    if (!confirm('Wipe WhatsApp session and force a new QR? The bot will restart.')) return;
    setResetting(true);
    try {
      // /admin/relogin still uses the ADMIN_SECRET query param (backend has
      // no bearer-token acceptance on the /admin/* routes). This works as long
      // as ADMIN_SECRET matches on client and server.
      const secret = prompt('Enter ADMIN_SECRET to confirm session reset (matches Railway env var):');
      if (!secret) return;
      await fetch(`${API_BASE}/admin/relogin?secret=${encodeURIComponent(secret)}`);
      // The server exits and restarts — poll will resume once it's up.
    } catch (e) { alert('Reset failed: ' + e.message); }
    finally { setResetting(false); }
  }

  if (err) return <div className="empty" style={{ color: 'var(--red)' }}>Error: {err}</div>;
  if (!data) return <div className="loading">Loading…</div>;

  const dotColor =
    data.status === 'connected' ? 'var(--green)' :
    data.status === 'connecting' ? 'var(--amber)' : 'var(--red)';

  return (
    <>
      <div className="card">
        <h3>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: dotColor, marginRight: 8, boxShadow: `0 0 6px ${dotColor}` }} />
          WhatsApp status: {data.status}
        </h3>
        <div className="desc">Auto-refreshes every 3 seconds.</div>

        {data.status !== 'connected' && (
          data.qr ? (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <img src={data.qr} alt="QR" width={280} height={280} style={{ background: '#fff', padding: 8, borderRadius: 8 }} />
              <div style={{ color: 'var(--text-2)', marginTop: 12, fontSize: 13 }}>
                Open WhatsApp → Settings → Linked Devices → Link a device → scan this code.
              </div>
            </div>
          ) : (
            <div className="empty">Waiting for QR — if this persists for &gt; 30s, try reset session.</div>
          )
        )}

        {data.status === 'connected' && (
          <div style={{ color: 'var(--green)', padding: '8px 0' }}>
            ✓ Linked. The bot is receiving and sending messages normally.
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={resetSession}
            disabled={resetting}
            style={{ padding: '8px 14px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border-2)', color: 'var(--red)' }}
          >{resetting ? 'Resetting…' : 'Reset session (wipe auth, new QR)'}</button>
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>Use this if the bot is stuck disconnected or you want to move it to a different phone.</span>
        </div>
      </div>

      <div className="card">
        <h3>Groups the bot is in</h3>
        <div className="desc">
          Copy the JID of your main store-updates group and paste it into <code>.env</code>
          as <code>MAIN_GROUP_JID</code>, then restart. Use <code>MANAGER_GROUP_JID</code>
          only if the leadership group is separate.
        </div>
        {data.status !== 'connected' ? (
          <div className="empty">Connect the bot first.</div>
        ) : data.groups.length === 0 ? (
          <div className="empty">No groups. Add the bot to a WhatsApp group, then refresh.</div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>JID</th><th className="num">Participants</th><th>Status</th></tr></thead>
            <tbody>
              {data.groups.map((g) => (
                <tr key={g.jid}>
                  <td>{g.name}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-2)' }}>
                    <button onClick={() => copyJid(g.jid)} title="Copy JID" style={{ color: 'var(--accent)', fontFamily: 'inherit', fontSize: 'inherit' }}>
                      {g.jid}
                    </button>
                    {copied === g.jid && <span style={{ color: 'var(--green)', marginLeft: 8, fontSize: 11 }}>copied</span>}
                  </td>
                  <td className="num">{g.participants}</td>
                  <td>
                    {g.whitelisted
                      ? <span className="badge green">whitelisted</span>
                      : <span className="badge">not whitelisted</span>}
                    {g.jid === data.managerJid && <span className="badge amber" style={{ marginLeft: 6 }}>manager</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
