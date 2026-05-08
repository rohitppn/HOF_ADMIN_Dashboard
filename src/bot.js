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
import { MANAGER_GROUP_JID, storeByJid, isOwner, isAllowedGroup } from './config.js';

const logger = pino({ level: 'warn' });
let sock = null;
let latestQr = null;
let lastConnectionStatus = 'starting';

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
    printQRInTerminal: false,
    markOnlineOnConnect: false,
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
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log('[bot] disconnected, reconnect=', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      lastConnectionStatus = 'connected';
      latestQr = null;
      console.log('[bot] connected');
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

  // Strict group whitelist: any group not in .env is fully ignored.
  if (isGroup && !isAllowedGroup(jid)) return;

  // Owner slash commands — only in leadership group or direct DM.
  if (text.trim().startsWith('/') && (!isGroup || jid === MANAGER_GROUP_JID)) {
    const result = handleOwnerCommand({ text, senderPhone });
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
  const inLeadership = isGroup && jid === MANAGER_GROUP_JID;
  const inOwnerDm = !isGroup && isOwner(senderPhone);
  if ((inLeadership && isOwner(senderPhone)) || inOwnerDm) {
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

  // Store group ingest.
  if (isGroup && storeByJid(jid)) {
    const result = await ingestStoreMessage({ jid, sender: senderPhone, text });
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

export async function sendTo(jid, text) {
  if (!sock) throw new Error('bot not started');
  await sock.sendMessage(jid, { text });
}
