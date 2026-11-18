const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const config = require('../config');

// ------------------------- Estado da conexao -------------------------
let client = null;
let state = 'idle'; // idle | starting | qr | ready | disconnected | error
let lastQr = null;   // string crua do QR code
let phone = null;    // numero da conta conectada (sem @c.us)
let lastError = null;
let restartTimer = null;

const DATA_DIR = path.join(__dirname, '..', '.wwebjs');

function findBrowser() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Users\\User\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((p) => fs.existsSync(p)) || undefined;
}

function setState(s, extra) {
  state = s;
  if (s === 'ready') lastError = null;
  if (s !== 'qr') lastQr = null;
  if (extra && typeof extra === 'string') lastError = extra;
  console.log(`[whatsapp] estado: ${s}${extra ? ' — ' + extra : ''}`);
}

function destroyClient() {
  if (client) {
    try { client.destroy(); } catch {}
    client = null;
  }
}

function scheduleRestart(delayMs = 6000) {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => { start(); }, delayMs);
}

async function start() {
  if (client || state === 'starting') return;
  setState('starting');
  const puppeteer = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions'] };
  const exe = findBrowser();
  if (exe) puppeteer.executablePath = exe;
  else console.warn('[whatsapp] Nenhum Edge/Chrome encontrado; o puppeteer usara o proprio Chromium (se instalado).');

  try {
    console.log(`[whatsapp] inicializando com ${exe || 'chromium bundled'} em ${DATA_DIR}`);
    client = new Client({
      authStrategy: new LocalAuth({ dataPath: DATA_DIR }),
      puppeteer,
      qrMaxRetries: 0,
      takeoverOnConflict: true,
      takeoverTimeoutMs: 0,
    });

    client.on('qr', (qr) => {
      lastQr = qr;
      setState('qr');
    });

    client.on('authenticated', () => { console.log('[whatsapp] evento: authenticated'); setState('starting'); });
    client.on('auth_failure', (msg) => { console.log('[whatsapp] evento: auth_failure', msg); setState('error', msg || 'Sessao invalida'); });
    client.on('loading_screen', (p, msg) => console.log(`[whatsapp] loading_screen ${p}% ${msg || ''}`));
    client.on('change_state', (s) => console.log(`[whatsapp] change_state: ${s}`));
    client.on('remote_session_saved', () => console.log('[whatsapp] remote_session_saved'));

    client.on('ready', () => {
      try { phone = client.info && client.info.wid && client.info.wid.user ? client.info.wid.user : null; } catch {}
      console.log(`[whatsapp] evento: ready conta=${phone}`);
      setState('ready', phone ? `conta ${phone}` : '');
    });

    client.on('disconnected', (reason) => {
      console.log(`[whatsapp] evento: disconnected ${reason}`);
      setState('disconnected', reason || 'desconectado');
      destroyClient();
      if (reason !== 'LOGOUT') scheduleRestart();
    });

    client.on('message', (msg) => {
      console.log(`[whatsapp] msg de ${msg.from}: ${(msg.body || '').slice(0, 80)}`);
    });

    console.log('[whatsapp] chamando client.initialize()');
    await client.initialize();
    console.log('[whatsapp] initialize() resolveu');
  } catch (err) {
    console.error('[whatsapp] initialize falhou:', err && err.message);
    setState('error', err.message);
    destroyClient();
    scheduleRestart();
  }
}

function isReady() {
  return state === 'ready' && !!client;
}

async function readyTimeout(ms = 20000) {
  if (isReady()) return true;
  const t0 = Date.now();
  while ((state === 'starting' || state === 'qr') && Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 500));
  }
  return isReady();
}

function getStatus() {
  return {
    state,
    ready: isReady(),
    phone,
    hasQr: state === 'qr' && !!lastQr,
    error: lastError || null,
  };
}

async function getQrDataUrl() {
  if (!lastQr) return null;
  return QRCode.toDataURL(lastQr, { margin: 1, width: 260 });
}

async function disconnect() {
  clearTimeout(restartTimer);
  if (client) {
    try { await client.logout(); } catch {}
    destroyClient();
  }
  state = 'idle';
  lastQr = null;
  lastError = null;
  phone = null;
}

function normalizePhone(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D+/g, '');
  if (!digits.length) return null;
  if (!digits.startsWith('55')) digits = '55' + digits;
  if (digits.length !== 12 && digits.length !== 13) return null;
  return digits;
}

async function sendTextMessage(toPhone, body) {
  if (!(await readyTimeout())) {
    const err = new Error(`WhatsApp nao conectado (estado: ${state}${lastError ? ' — ' + lastError : ''})`);
    err.code = 'WHATSAPP_NOT_READY';
    throw err;
  }
  const waId = normalizePhone(toPhone);
  if (!waId) {
    const err = new Error(`Numero de telefone invalido para WhatsApp: ${toPhone}`);
    err.code = 'INVALID_PHONE';
    throw err;
  }
  const chatId = `${waId}@c.us`;

  let numberId = null;
  for (let i = 0; i < 3 && !numberId; i++) {
    try { numberId = await client.getNumberId(waId); } catch (e) { console.log(`[whatsapp] getNumberId tentativa ${i+1} falhou: ${e.message && e.message.slice(0,80)}`); }
    if (!numberId) await new Promise((r) => setTimeout(r, 1200));
  }
  if (!numberId) {
    const err = new Error(`Numero ${toPhone} nao encontrado no WhatsApp (nao possui conta ativa).`);
    err.code = 'WHATSAPP_NUMBER_NOT_FOUND';
    throw err;
  }
  console.log(`[whatsapp] getNumberId ${waId} -> ${numberId._serialized} (server=${numberId.server||'?'})`);

  // Usa o _serialized retornado por getNumberId (ja lida com @lid quando necessario)
  let targetId = (numberId && numberId._serialized) ? numberId._serialized : chatId;
  // Se ainda for @c.us mas o contato real for @lid, resolve via getContactById
  try {
    const contact = await client.getContactById(targetId);
    if (contact && contact.id && contact.id._serialized && contact.id.server === 'lid') {
      console.log(`[whatsapp] contato ${targetId} tem LID ${contact.id._serialized}`);
      targetId = contact.id._serialized;
    }
  } catch (e) { console.log(`[whatsapp] getContactById ${targetId} falhou: ${e.message && e.message.slice(0,60)}`); }
  try { await client.openChat(targetId); } catch (e) { console.log(`[whatsapp] openChat ${targetId} falhou: ${e.message && e.message.slice(0,60)}`); }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const msg = await client.sendMessage(targetId, body);
      return { id: msg && msg.id ? msg.id._serialized : null, chatId: targetId };
    } catch (err) {
      const retryable = /LID|timed out|timeout/i.test(String(err.message || err));
      if (attempt === 1 && retryable) {
        console.log(`[whatsapp] retry ${chatId} (${err.message && err.message.slice(0, 60)})`);
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      err.code = err.code || 'WHATSAPP_SEND_ERROR';
      throw err;
    }
  }
}

function isConfigured() {
  return true;
}

// WHATSAPP_DISABLED=1 desliga o cliente (ex.: servidor sem navegador). Sem a variável, nada muda.
if (process.env.WHATSAPP_DISABLED !== '1') start();

module.exports = {
  start,
  getStatus,
  getQrDataUrl,
  disconnect,
  sendTextMessage,
  normalizePhone,
  isReady,
  isConfigured,
};
