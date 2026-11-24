const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const config = require('../config');
const settingsStore = require('./settingsStore');

const readline = require('readline');

const execFileP = promisify(execFile);
const backupsDir = config.backupsDir;

const NAME_RE = /^backup-\d{8}(-\d{6})?\.sql$/;

function ensureDir() {
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
}

function pgDumpPath() {
  if (process.env.PG_DUMP_PATH && fs.existsSync(process.env.PG_DUMP_PATH)) return process.env.PG_DUMP_PATH;
  return pgBin('pg_dump');
}

// psql do mesmo PostgreSQL (para importar)
function psqlPath() {
  if (process.env.PSQL_PATH && fs.existsSync(process.env.PSQL_PATH)) return process.env.PSQL_PATH;
  if (process.env.PG_DUMP_PATH) {
    const p = path.join(path.dirname(process.env.PG_DUMP_PATH), process.platform === 'win32' ? 'psql.exe' : 'psql');
    if (fs.existsSync(p)) return p;
  }
  return pgBin('psql');
}

function pgBin(nome) {
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
      const p = path.join(base, v, 'bin', `${nome}.exe`);
      if (fs.existsSync(p)) return p;
    }
  }
  return nome;
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
  let name = `backup-${stamp()}.sql`;
  // dois backups no mesmo segundo nao podem se sobrescrever
  while (fs.existsSync(filePath(name))) {
    await new Promise((ok) => setTimeout(ok, 1000));
    name = `backup-${stamp()}.sql`;
  }
  const file = filePath(name);
  const args = [
    '-h', config.db.host,
    '-p', String(config.db.port),
    '-U', config.db.user,
    '-d', config.db.name,
    '--format=plain',
    '--exclude-schema=preview_*', // copias da Visualizacao de cargos
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

// ---------------- Importar (restaurar) um backup ----------------
//   Aceita so o SQL gerado pelo pg_dump (o "Gerar backup agora" daqui ou um pg_dump manual).
//   Antes de tudo gera um backup automatico do banco atual. A troca roda numa transacao so:
//   se der qualquer erro, o banco fica exatamente como estava.
//   Por seguranca, recusa comandos do psql (linhas com "\") e comandos que mexem fora do banco.
const PROIBIDO = /^\s*(COPY\b[^;]*\bPROGRAM\b|ALTER\s+SYSTEM|(CREATE|ALTER|DROP)\s+(ROLE|USER|DATABASE|TABLESPACE)\b|CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\b[^;]*\bLANGUAGE\s+(c|plpython|plperlu|plsh)|LOAD\s)/i;

// apaga tudo que e do sistema no esquema public (sem tocar nas extensoes, que podem ser de outro dono)
const LIMPAR = `DO $limpar$ DECLARE r record; BEGIN
  FOR r IN SELECT nspname FROM pg_namespace WHERE nspname ~ '^preview_[0-9]+$' LOOP
    EXECUTE format('DROP SCHEMA %I CASCADE', r.nspname);
  END LOOP;
  FOR r IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e') LOOP
    EXECUTE format('DROP %s IF EXISTS public.%I CASCADE',
      CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE'
                     WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END, r.relname);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.f || ' CASCADE';
  END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typtype IN ('e','d')
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e') LOOP
    EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
  END LOOP;
END $limpar$;`;

// Le o arquivo enviado, confere e grava uma copia "limpa" pronta para o psql
async function prepararImportacao(origem, destino) {
  const entrada = fs.createReadStream(origem, { encoding: 'utf8' });
  const linhas = readline.createInterface({ input: entrada, crlfDelay: Infinity });
  const saida = fs.createWriteStream(destino, { encoding: 'utf8' });
  const escrever = (t) => new Promise((ok) => { if (!saida.write(t)) saida.once('drain', ok); else ok(); });
  let n = 0; let ehDump = false; let temChamados = false; let emCopy = false; let erro = null;
  await escrever(`${LIMPAR}\n`);
  try {
    for await (const linha of linhas) {
      n += 1;
      if (n === 1 && linha.charCodeAt(0) === 0xfeff) { erro = 'O arquivo foi salvo com BOM; gere de novo pelo pg_dump.'; break; }
      if (n <= 30 && /^-- PostgreSQL database dump/.test(linha)) ehDump = true;
      if (emCopy) {
        if (linha === '\\.') emCopy = false;
        await escrever(`${linha}\n`);
        continue;
      }
      if (/^COPY\s.+\sFROM\s+stdin;\s*$/i.test(linha)) { emCopy = true; await escrever(`${linha}\n`); continue; }
      if (linha.startsWith('\\')) {
        if (/^\\(restrict|unrestrict)\b/.test(linha)) continue; // protecao do pg_dump novo; a conferencia e feita aqui
        erro = `Linha ${n}: comando do psql não permitido (${linha.slice(0, 30)}).`; break;
      }
      if (/^SET\s+transaction_timeout\b/i.test(linha)) continue; // nao existe antes do PostgreSQL 17
      if (/^(DROP\s+EXTENSION|COMMENT\s+ON\s+EXTENSION)\b/i.test(linha)) continue; // extensoes ficam como estao
      if (/^CREATE\s+TABLE\s+(public\.)?tickets\s*\(/i.test(linha)) temChamados = true;
      if (PROIBIDO.test(linha)) { erro = `Linha ${n}: comando não permitido num backup (${linha.slice(0, 40)}).`; break; }
      await escrever(`${linha}\n`);
    }
  } finally {
    linhas.close(); entrada.destroy();
    await new Promise((ok) => saida.end(ok));
  }
  if (!erro && !ehDump) erro = 'Este arquivo não é um backup do PostgreSQL (pg_dump em SQL).';
  if (!erro && emCopy) erro = 'O arquivo está incompleto (terminou no meio dos dados).';
  if (!erro && !temChamados) erro = 'Este backup não é do sistema de chamados (não tem a tabela de chamados).';
  if (erro) { try { fs.unlinkSync(destino); } catch { /* ok */ } throw Object.assign(new Error(erro), { publico: true }); }
}

let importando = false;
async function importBackup(origem) {
  if (importando) throw Object.assign(new Error('Já tem uma importação em andamento.'), { publico: true });
  importando = true;
  ensureDir();
  const limpo = path.join(backupsDir, `_importar-${stamp()}.sql`);
  try {
    await prepararImportacao(origem, limpo);
    const seguranca = await createBackup(); // copia do banco atual antes de trocar
    try {
      await execFileP(psqlPath(), [
        '-X', '-q', '--single-transaction', '-v', 'ON_ERROR_STOP=1',
        '-h', config.db.host, '-p', String(config.db.port), '-U', config.db.user, '-d', config.db.name,
        '-f', limpo,
      ], { env: { ...process.env, PGPASSWORD: config.db.password }, timeout: 1800000, maxBuffer: 20 * 1024 * 1024 });
    } catch (err) {
      const msg = String(err.stderr || err.message || err).split('\n').find((l) => /ERRO|ERROR/i.test(l)) || String(err.message || err);
      const limpa = msg.replace(/^psql:.*?:\d+:\s*/, '').trim(); // tira o caminho do arquivo no servidor
      throw Object.assign(new Error(`A importação falhou e o banco não foi alterado. ${limpa.slice(0, 300)}`), { publico: true, seguranca: seguranca.name });
    }
    // completa o banco importado com o que esta versao do sistema precisa (mesmo passo do "npm run init")
    let avisoInit = null;
    try {
      await execFileP(process.execPath, [path.join(__dirname, '..', 'init.js')], { cwd: path.join(__dirname, '..', '..'), timeout: 600000 });
    } catch (err) {
      avisoInit = 'O banco foi importado, mas a atualização da estrutura falhou. Rode "npm run init" no servidor.';
      console.error('[backup] init depois da importação:', err.message);
    }
    try { await settingsStore.getAll(true); } catch { /* recarrega depois */ }
    return { ok: true, seguranca: seguranca.name, aviso: avisoInit };
  } finally {
    importando = false;
    try { fs.unlinkSync(limpo); } catch { /* ja removido */ }
  }
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
  importBackup,
  prepararImportacao,
  safeName,
  filePath,
  startScheduler,
  backupsDir,
};