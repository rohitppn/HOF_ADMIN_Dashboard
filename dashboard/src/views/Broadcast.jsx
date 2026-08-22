import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

// Manual send tool — restricted server-side to whitelisted groups.
// Confirmation step required so a real WhatsApp message never leaves by accident.

export default function Broadcast() {
  const [wa, setWa] = useState(null);
  const [target, setTarget] = useState('');
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.whatsapp().then(setWa).catch((e) => setErr(e.message));
  }, []);

  const groups = useMemo(() => (wa?.groups || []).filter((g) => g.whitelisted), [wa]);
  const chosen = groups.find((g) => g.jid === target);

  async function send() {
    setSending(true); setResult(null); setErr(null);
    try {
      const r = await api.broadcast(target, text);
      setResult(r);
      setText(''); setConfirming(false);
    } catch (e) { setErr(e.message); }
    finally { setSending(false); }
  }

  const disabled = !target || !text.trim() || sending;

  return (
    <>
      <div className="card">
        <h3>Send a message to a WhatsApp group</h3>
        <div className="desc">
          Use this if the bot missed something and you need to notify a store or leadership manually.
          Only groups whitelisted in <code>.env</code> can be targeted.
        </div>

        {err && <div className="empty" style={{ color: 'var(--red)' }}>Error: {err}</div>}

        {!wa && <div className="loading">Loading groups…</div>}

        {wa && wa.status !== 'connected' && (
          <div className="empty" style={{ color: 'var(--amber)' }}>
            Bot not connected ({wa.status}) — can't send. Fix in the WhatsApp tab first.
          </div>
        )}

        {wa?.status === 'connected' && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', color: 'var(--text-3)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.05, marginBottom: 6 }}>Target group</label>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-3)', color: 'var(--text)' }}
              >
                <option value="">Pick a whitelisted group…</option>
                {groups.map((g) => (
                  <option key={g.jid} value={g.jid}>{g.name} · {g.participants} participants</option>
                ))}
              </select>
              {groups.length === 0 && (
                <div className="empty" style={{ padding: 8, marginTop: 8 }}>
                  No whitelisted groups yet. Set <code>MAIN_GROUP_JID</code> in <code>.env</code> and restart.
                </div>
              )}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', color: 'var(--text-3)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.05, marginBottom: 6 }}>Message</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder="Type the message that should go to the group…"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-3)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 14, resize: 'vertical' }}
              />
              <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 4 }}>{text.length} chars</div>
            </div>

            {!confirming ? (
              <button
                disabled={disabled}
                onClick={() => setConfirming(true)}
                style={{ padding: '10px 20px', borderRadius: 8, background: 'var(--accent-2)', color: 'white', fontWeight: 500, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
              >Preview & send</button>
            ) : (
              <div style={{ background: 'var(--bg-3)', border: '1px solid var(--border-2)', borderRadius: 8, padding: 16 }}>
                <div style={{ color: 'var(--text-3)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.05, marginBottom: 8 }}>Ready to send to</div>
                <div style={{ marginBottom: 12, fontWeight: 600 }}>{chosen?.name || target}</div>
                <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6, padding: 12, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{text}</div>
                <button
                  disabled={sending}
                  onClick={send}
                  style={{ padding: '10px 20px', borderRadius: 8, background: 'var(--green)', color: '#0a0a0b', fontWeight: 600, marginRight: 8 }}
                >{sending ? 'Sending…' : 'Confirm & send'}</button>
                <button
                  disabled={sending}
                  onClick={() => setConfirming(false)}
                  style={{ padding: '10px 20px', borderRadius: 8, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                >Cancel</button>
              </div>
            )}

            {result?.ok && (
              <div className="empty" style={{ color: 'var(--green)', marginTop: 12 }}>
                ✓ Sent at {result.sentAt}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
