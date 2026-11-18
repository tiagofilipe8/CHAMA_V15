const { query } = require('../db');

const ALLOWED_KEYS = {
  'app.name': null,
  'app.logo': null,
  'app.background': null,
  'app.notify_email': 'boolean',
  'app.notify_whatsapp': 'boolean',
  'app.voice_enabled': 'boolean',
  'app.voice_new_ticket': 'boolean',
  'app.refresh_interval': null,
  'app.admin_email': null,
  'app.notify_techs_new': 'boolean',
  'app.notify_clients': 'boolean',
  'app.approval_on_solve': 'boolean',
  'backup.auto_enabled': 'boolean',
  'backup.auto_hour': null,
  'notify.templates': 'json',
};

let cache = null;
let cacheTime = 0;
const CACHE_MS = 5000;

function coerce(key, value) {
  const type = ALLOWED_KEYS[key];
  if (type === 'boolean') return value === 'true' || value === true || value === '1';
  if (type === 'json') {
    if (!value) return null;
    try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; }
  }
  return String(value ?? '');
}

async function getAll(force = false) {
  const now = Date.now();
  if (!force && cache && now - cacheTime < CACHE_MS) return cache;
  const { rows } = await query('SELECT key, value FROM settings');
  const out = {};
  for (const r of rows) out[r.key] = coerce(r.key, r.value);
  // garante defaults
  for (const key of Object.keys(ALLOWED_KEYS)) {
    if (!(key in out)) out[key] = coerce(key, '');
  }
  cache = out;
  cacheTime = now;
  return out;
}

async function get(key) {
  const all = await getAll();
  return all[key];
}

// atualiza N chaves num unico momento; invalida o cache
async function setMany(entries) {
  const { pool } = require('../db');
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    for (const [k, v] of entries) {
      if (!(k in ALLOWED_KEYS)) continue;
      let val;
      if (ALLOWED_KEYS[k] === 'json') val = typeof v === 'string' ? v : JSON.stringify(v ?? null);
      else val = Array.isArray(v) ? v.join(',') : String(v ?? '');
      await conn.query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [k, val]);
    }
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }
  cache = null;
}

module.exports = { getAll, get, setMany, ALLOWED_KEYS };