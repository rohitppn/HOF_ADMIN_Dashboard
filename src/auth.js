// Password hashing + signed session tokens for the dashboard.
// Zero external deps — uses Node built-in crypto (scrypt for passwords,
// HMAC-SHA256 for tokens). Tokens are a compact "payload.signature" string,
// signed with ADMIN_SECRET so restarts don't invalidate them.

import crypto from 'node:crypto';
import { supabase } from './supabase.js';

const SIGNING_KEY = process.env.ADMIN_SECRET || '';
const TOKEN_TTL_SEC = 7 * 24 * 60 * 60;  // 7 days

if (!SIGNING_KEY) {
  console.warn('[auth] ADMIN_SECRET not set — tokens will not verify across restarts');
}

// --- password hashing (scrypt) ---

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(check, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- signed tokens (JWT-lite: base64url(payload).base64url(hmac)) ---

export function signToken(payload, ttlSec = TOKEN_TTL_SEC) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const b64 = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', SIGNING_KEY).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [b64, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SIGNING_KEY).update(b64).digest('base64url');
  // constant-time compare
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch { return null; }
}

// --- user store (Supabase) ---

export async function findUser(email) {
  if (!email) return null;
  const { data, error } = await supabase.from('admin_users').select('*').eq('email', email.toLowerCase().trim()).maybeSingle();
  if (error) { console.error('[auth] findUser:', error.message); return null; }
  return data;
}

export async function createUser(email, password) {
  const clean = String(email).toLowerCase().trim();
  if (!clean || !password) throw new Error('email and password required');
  const { hash, salt } = hashPassword(password);
  const { error } = await supabase.from('admin_users').insert({ email: clean, password_hash: hash, salt });
  if (error) throw new Error(error.message);
  return { email: clean };
}

export async function updateLastLogin(email) {
  await supabase.from('admin_users').update({ last_login_at: new Date().toISOString() }).eq('email', email);
}

// Bootstrap the first admin from env vars on empty table. Called at boot.
export async function ensureAdmin() {
  const { count, error } = await supabase.from('admin_users').select('*', { count: 'exact', head: true });
  if (error) { console.error('[auth] user table not reachable:', error.message); return; }
  if (count > 0) return;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('[auth] no admin_users rows and no ADMIN_EMAIL/ADMIN_PASSWORD env vars — set them to seed the first admin');
    return;
  }
  try {
    await createUser(email, password);
    console.log(`[auth] seeded first admin: ${email}`);
  } catch (e) {
    console.error('[auth] failed to seed admin:', e.message);
  }
}
