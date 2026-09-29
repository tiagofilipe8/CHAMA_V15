const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const config = require('../config');
const settingsStore = require('./settingsStore');

const execFileP = promisify(execFile);
const backupsDir = config.backupsDir;

const NAME_RE = /^backup-\d{8}(-\d{6})?\.sql$/;

function ensureDir() {
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
}

function pgDumpPath() {
  if (process.env.PG_DUMP_PATH && fs.existsSync(process.env.PG_DUMP_PATH)) return process.env.PG_DUMP_PATH;
  const programDirs = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramW6432,
  ].filter(Boolean);
  for (const pf of programDirs) {
    const base = path.join(pf, 'PostgreSQL');
    let versions = [];
    try { versions = fs.readdirSync(base); } catch {}
    for (const v of [...versions].sort().reverse()) {
      const p = path.join(base, v, 'bin', 'pg_dump.exe');
      if (fs.existsSync(p)) return p;
    }
  }
  return 'pg_dump';
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function safeName(n) {
  const base = path.basename(String(n || ''));
  return NAME_RE.test(base) ? base : null;
}

function filePath(name) {
  return path.join(backupsDir, name);
}

async function createBackup() {
  ensureDir();
  const name = `backup-${stamp()}.sql`;
  const file = filePath(name);
  const args = [
    '-h', config.db.host,
    '-p', String(config.db.port),
    '-U', config.db.user,
    '-d', config.db.name,
    '--format=plain',
    '--no-owner',
    '--no-privileges',
    '--clean',
    '--if-exists',
    '-f', file,
  ];
  await execFileP(pgDumpPath(), args, {
    env: { ...process.env, PGPASSWORD: config.db.password },
    timeout: 600000,
  });
  const st = fs.statSync(file);
  return { name, size: st.size, created_at: st.mtime.toISOString() };
}

function listBackups() {
  ensureDir();
  return fs.readdirSync(backupsDir)
    .filter((n) => n.endsWith('.sql'))
    .map((n) => {
      const st = fs.statSync(filePath(n));
      return { name: n, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

async function deleteBackup(name) {
  const safe = safeName(name);
  if (!safe) throw new Error('Nome de backup inválido.');
  await fs.promises.unlink(filePath(safe));
}

// ---------------- Backup automatico diario ----------------
let timer = null;
let lastRunDay = null;

async function maybeAutoBackup() {
  try {
    const s = await settingsStore.getAll();
    if (!s['backup.auto_enabled']) return;
    const hour = parseInt(s['backup.auto_hour'] || '3', 10);
    if (Number.isNaN(hour)) return;
    const now = new Date();
    if (now.getHours() !== hour) return;
    const day = now.toISOString().slice(0, 10);
    if (lastRunDay === day) return;
    lastRunDay = day;
    const info = await createBackup();
    console.log(`[backup] backup automático criado: ${info.name} (${info.size} bytes)`);
  } catch (err) {
    console.error('[backup] erro no backup automático:', err.message);
  }
}

function startScheduler() {
  if (timer) return;
  timer = setInterval(maybeAutoBackup, 60 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = {
  createBackup,
  listBackups,
  deleteBackup,
  safeName,
  filePath,
  startScheduler,
  backupsDir,
};