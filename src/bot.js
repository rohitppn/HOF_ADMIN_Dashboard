import path from 'node:path';
import fs from 'node:fs';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { ingestStoreMessage } from './parser.js';
import { handleOwnerCommand } from './commands.js';
import { answerQuestion } from './qa.js';
import { templates } from './templates.js';
import { MAIN_GROUP_JID, MANAGER_GROUP_JID, storeByPhone, isOwner, isAllowedGroup } from './config.js';

const logger = pino({ level: 'warn' });
let sock = null;
let latestQr = null;
let lastConnectionStatus = 'starting';

// Reconnect backoff — WhatsApp rate-limits fast reconnects and will eventually
// stream-error the client. We back off up to 60s and reset once we're stable.
let reconnectAttempts = 0;
let stableSinceOpenTimer = null;

export function getLatestQr() { return latestQr; }
export function getConnectionStatus() { return lastConnectionStatus; }

const authDir = path.resolve('auth');
if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

export async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    defaultQueryTimeoutMs: 60_000,
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 15_000,
    emitOwnEvents: false,
    // Stable device identity — shows up as "HOF ADMIN" in WhatsApp → Linked
    // Devices, and keeps the session valid across restarts so one QR scan lasts.
    browser: ['HOF ADMIN', 'Desktop', '1.0.0'],
    // Baileys retries decryption on missed messages. Without this, it tries to
    // re-fetch from an in-memory store we don't run, throws, and cascades into
    // a stream error → forced reconnect. Returning empty tells it "give up".
    getMessage: async () => ({ conversation: '' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      latestQr = qr;
      const onRailway = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_PUBLIC_DOMAIN;
      // Terminal QR garbles in Railway logs (line wrapping breaks the box chars), so skip it there.
      if (!onRailway) qrcode.generate(qr, { small: true });

      const publicUrl = process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/qr`
        : `http://localhost:${process.env.PORT || 3001}/qr`;

      console.log('================================================');
      console.log('[bot] SCAN THIS QR IN BROWSER:');
      console.log('  ' + publicUrl);
      console.log('================================================');
    }
    if (connection === 'close') {
      lastConnectionStatus = 'disconnected';
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (stableSinceOpenTimer) { clearTimeout(stableSinceOpenTimer); stableSinceOpenTimer = null; }

      // 401 = WhatsApp says this session is dead. Stale creds on the volume
      // will keep triggering 401 forever, so wipe them and exit. Railway will
      // restart the container with an empty auth folder → fresh QR.
      if (code === DisconnectReason.loggedOut || code === 401) {
        console.error('[bot] logged out (401) — wiping auth and exiting so Railway restarts fresh');
        try {
          for (const f of fs.readdirSync(authDir)) {
            fs.rmSync(path.join(authDir, f), { recursive: true, force: true });
          }
        } catch (e) { console.error('[bot] wipe failed:', e.message); }
        setTimeout(() => process.exit(0), 300);
        return;
      }

      // Cap runaway reconnect loops — after 30 attempts something is genuinely
      // broken (WhatsApp rate limit, network, or a stale volume). Exit so
      // Railway restarts fresh; the log stays readable.
      const MAX = 30;
      if (reconnectAttempts >= MAX) {
        console.error(`[bot] ${MAX} reconnect attempts failed — exiting so Railway restarts`);
        setTimeout(() => process.exit(1), 300);
        return;
      }

      const delay = Math.min(60_000, 1000 * Math.pow(2, reconnectAttempts));
      reconnectAttempts += 1;
      console.log(`[bot] disconnected code=${code} reconnect=true attempt=${reconnectAttempts}/${MAX} in ${delay}ms`);
      setTimeout(() => {
        startBot().catch((e) => console.error('[bot] restart failed:', e));
      }, delay);
    } else if (connection === 'open') {
      lastConnectionStatus = 'connected';
      latestQr = null;
      console.log('[bot] connected');
      // Only reset backoff once the connection has held for 30s — a session that
      // opens then dies inside that window is still unstable.
      stableSinceOpenTimer = setTimeout(() => { reconnectAttempts = 0; }, 30_000);
    } else if (connection === 'connecting') {
      lastConnectionStatus = 'connecting';
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
      try { await handleMessage(m); }
      catch (e) { console.error('[bot] handle error:', e); }
    }
  });

  return sock;
}

async function handleMessage(m) {
  if (!m.message || m.key.fromMe) return;

  const jid = m.key.remoteJid;
  const isGroup = jid?.endsWith('@g.us');
  const sender = isGroup ? m.key.participant : jid;
  const senderPhone = String(sender || '').split('@')[0];
  const text =
    m.message.conversation ||
    m.message.extendedTextMessage?.text ||
    m.message.imageMessage?.caption ||
    '';

  if (!text) return;

  // Strict group whitelist — messages from any other group are fully ignored,
  // so the bot never sees them, never parses them, never spends tokens on them.
  if (isGroup && !isAllowedGroup(jid)) return;

  // Owner slash commands — only in the leadership group or a direct DM.
  if (text.trim().startsWith('/') && (!isGroup || jid === MANAGER_GROUP_JID)) {
    const result = await handleOwnerCommand({ text, senderPhone });
    if (result) {
      await sock.sendMessage(jid, { text: result.reply });
      if (result.dm) {
        const ownerJid = `${senderPhone}@s.whatsapp.net`;
        await sock.sendMessage(ownerJid, {
          document: fs.readFileSync(result.dm.filePath),
          mimetype: 'text/csv',
          fileName: path.basename(result.dm.filePath),
          caption: result.dm.caption,
        });
      }
      return;
    }
  }

  // Owner natural-language Q&A: leadership group OR a DM from an owner.
  // Only fires when the sender is a listed owner, so store managers' updates
  // don't accidentally trip the Q&A path.
  const inLeadership = isGroup && jid === MANAGER_GROUP_JID && isOwner(senderPhone);
  const inOwnerDm = !isGroup && isOwner(senderPhone);
  if (inLeadership || inOwnerDm) {
    try {
      const result = await answerQuestion(text);
      if (result?.reply) {
        await sock.sendMessage(jid, { text: result.reply });
        if (result.dm) {
          const ownerJid = `${senderPhone}@s.whatsapp.net`;
          await sock.sendMessage(ownerJid, {
            document: fs.readFileSync(result.dm.filePath),
            mimetype: 'text/csv',
            fileName: path.basename(result.dm.filePath),
            caption: result.dm.caption,
          });
        }
      }
    } catch (e) {
      console.error('[bot] qa error:', e);
    }
    return;
  }

  // Store update — inside the main group, only messages from known store phones
  // get parsed. Everyone else in the group is silently ignored (token saver).
  if (isGroup && jid === MAIN_GROUP_JID) {
    const store = storeByPhone(senderPhone);
    if (!store) return;

    const result = await ingestStoreMessage({ store, jid, sender: senderPhone, text });
    if (!result) return;

    if (result.intent !== 'other') {
      await sock.sendMessage(jid, { text: templates.ack() });
    }

    if (result.alert && MANAGER_GROUP_JID) {
      let msg = null;
      if (result.alert.type === 'hourly_above_50') msg = templates.hourlyAbove50(result.alert);
      else if (result.alert.type === 'big_bill') msg = templates.bigBillAlert(result.alert);
      else if (result.alert.type === 'late_open') msg = templates.lateOpening(result.alert);
      if (msg) await sock.sendMessage(MANAGER_GROUP_JID, { text: msg });
    }
  }
}

export function getSock() { return sock; }

// sendTo accepts either a plain string (backwards compat with existing
// templates that return text) or a { text, mentions } object for messages
// that @mention specific users.
export async function sendTo(jid, textOrMsg) {
  if (!sock) throw new Error('bot not started');
  const msg = typeof textOrMsg === 'string' ? { text: textOrMsg } : textOrMsg;
  await sock.sendMessage(jid, msg);
}
