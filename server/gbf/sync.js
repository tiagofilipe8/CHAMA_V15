// Sincronização Central da Orcim -> Painel Beija-Flor (ti.sgogeral.com).
//
// ENVIO (roda na Central da Orcim): a cada minuto manda para o painel o que mudou nas tabelas
//   da Central. Só faz conexões de SAÍDA, então funciona até com a Central num computador
//   local, sem abrir porta. Ligado por GBF_SYNC_URL + GBF_SYNC_TOKEN. Não altera nada na Orcim.
// RECEBIMENTO (roda no servidor do painel): grava uma CÓPIA das tabelas da Central no banco
//   do painel, que o painel já sabe ler. Ligado por GBF_SYNC_TOKEN (o mesmo segredo).
//
// Usuários vão SEM senha, e-mail e telefone. A cada GBF_SYNC_COMPLETO_H horas (padrão 6) o
// envio manda a lista completa de ids, e o recebimento apaga da cópia o que sumiu da Orcim.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../config');
const { query, pool } = require('../db');
const { ah, getSetting, setSetting } = require('./common');

// Ordem importa: pais antes dos filhos (chaves estrangeiras)
const TABELAS = [
  { nome: 'entities', cursor: 'ts', colunas: ['id', 'name', 'description', 'email', 'phone', 'address', 'logo', 'sla_days', 'sla_hours', 'active', 'created_at', 'updated_at'] },
  { nome: 'categories', cursor: 'todos', colunas: ['id', 'name', 'parent_id', 'active', 'created_at'] },
  // users: sem password_hash, email e phone
  { nome: 'users', cursor: 'ts', colunas: ['id', 'username', 'name', 'role', 'client_level', 'entity_id', 'active', 'created_at', 'updated_at'] },
  { nome: 'assets', cursor: 'ts', colunas: ['id', 'entity_id', 'asset_tag', 'name', 'type', 'status', 'manufacturer', 'model', 'serial_number', 'description', 'location', 'department', 'responsible_user_id', 'purchase_date', 'warranty_expiration', 'notes', 'last_seen_at', 'created_by', 'created_at', 'updated_at', 'next_maintenance_date', 'toner', 'cilindro', 'maintenance_alert_notified_date', 'next_maintenance_notes'] },
  { nome: 'tickets', cursor: 'ts', colunas: ['id', 'number', 'title', 'description', 'status', 'priority', 'category_id', 'entity_id', 'requester_id', 'assigned_user_id', 'approval_status', 'approval_requested_by_id', 'approval_responded_by_id', 'approval_comment', 'approval_requested_at', 'approval_responded_at', 'due_at', 'closed_at', 'created_at', 'updated_at', 'asset_id'] },
  { nome: 'ticket_status_history', cursor: 'id', colunas: ['id', 'ticket_id', 'old_status', 'new_status', 'user_id', 'created_at'] },
  { nome: 'ticket_messages', cursor: 'id', colunas: ['id', 'ticket_id', 'user_id', 'kind', 'content', 'new_status', 'created_at'] },
  { nome: 'ticket_attachments', cursor: 'id', colunas: ['id', 'ticket_id', 'file_name', 'storage_path', 'mime_type', 'file_size', 'uploaded_by', 'created_at'] },
  { nome: 'asset_maintenances', cursor: 'ts', colunas: ['id', 'asset_id', 'performed_at', 'description', 'created_by', 'created_at', 'updated_at'] },
];
const POR_NOME = Object.fromEntries(TABELAS.map((t) => [t.nome, t]));
const LOTE = 300;
const TIPO = 'application/x-gbf-sync+json'; // fora do express.json global (limite de 1 MB da Central)
const MAX_ANEXO = 8 * 1024 * 1024;

// Colunas que existem de verdade no banco local (o schema pode mudar de versão para versão)
const cacheColunas = new Map();
async function colunasExistentes(tabela) {
  if (!cacheColunas.has(tabela)) {
    const { rows } = await query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [tabela]);
    cacheColunas.set(tabela, new Set(rows.map((r) => r.column_name)));
  }
  return cacheColunas.get(tabela);
}
async function colunasDe(t) {
  const existem = await colunasExistentes(t.nome);
  return t.colunas.filter((c) => existem.has(c));
}

// ============================================================ RECEBIMENTO
const receptor = express.Router();
const tokenRecebimento = process.env.GBF_SYNC_TOKEN || '';

function autorizado(req) {
  const h = req.headers.authorization || '';
  const enviado = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
  const certo = Buffer.from(tokenRecebimento);
  return certo.length > 0 && enviado.length === certo.length && crypto.timingSafeEqual(enviado, certo);
}

receptor.use('/sync', (req, res, next) => {
  if (!tokenRecebimento) return res.status(404).json({ error: 'Rota não encontrada.' });
  if (!autorizado(req)) return res.status(401).json({ error: 'Token inválido.' });
  next();
}, express.json({ type: TIPO, limit: '25mb' }));

receptor.get('/sync/estado', ah(async (req, res) => {
  res.json({
    cursores: (await getSetting('sync_cursores', {})) || {},
    completo_em: await getSetting('sync_completo_em', null),
  });
}));

receptor.post('/sync/lote', ah(async (req, res) => {
  const { tabela, linhas } = req.body || {};
  const t = POR_NOME[tabela];
  if (!t || !Array.isArray(linhas)) return res.status(422).json({ error: 'Lote inválido.' });
  if (!linhas.length) return res.json({ ok: true, gravadas: 0 });
  const colunas = await colunasDe(t);
  const dados = linhas.map((l) => {
    const o = {};
    for (const c of colunas) if (c in l) o[c] = l[c];
    if (tabela === 'users') o.password_hash = '!sincronizado-sem-login';
    return o;
  });
  const lista = tabela === 'users' ? [...colunas, 'password_hash'] : colunas;
  const atualiza = colunas.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  await query(
    `INSERT INTO ${tabela} (${lista.join(', ')})
     SELECT ${lista.join(', ')} FROM jsonb_populate_recordset(NULL::${tabela}, $1::jsonb)
     ON CONFLICT (id) DO UPDATE SET ${atualiza}`, [JSON.stringify(dados)]);

  // Avança o cursor desta tabela
  const cursores = (await getSetting('sync_cursores', {})) || {};
  if (t.cursor === 'ts') {
    // _cursor vem do envio com microssegundos e formato fixo (comparação de texto é segura)
    const max = linhas.reduce((m, l) => (l._cursor && l._cursor > m ? l._cursor : m), cursores[tabela]?.ts || '');
    cursores[tabela] = { ts: max };
  } else if (t.cursor === 'id') {
    const max = linhas.reduce((m, l) => Math.max(m, Number(l.id)), Number(cursores[tabela]?.id || 0));
    cursores[tabela] = { id: max };
  }
  await setSetting('sync_cursores', cursores);
  await setSetting('sync_ultimo_em', new Date().toISOString());
  res.json({ ok: true, gravadas: dados.length });
}));

// Arquivo de anexo (vai para o disco do painel, no mesmo caminho que a Central usa)
receptor.post('/sync/anexo', ah(async (req, res) => {
  const { ticket_id: ticketId, storage_path: arquivo, base64 } = req.body || {};
  if (!/^\d+$/.test(String(ticketId)) || !arquivo || !base64) return res.status(422).json({ error: 'Anexo inválido.' });
  const dir = path.join(config.uploadsDir, 'tickets', String(ticketId));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, path.basename(String(arquivo))), Buffer.from(base64, 'base64'));
  res.json({ ok: true });
}));

// Conferência completa: apaga da cópia o que não existe mais na Orcim
receptor.post('/sync/completo', ah(async (req, res) => {
  const ids = req.body?.ids || {};
  const client = await pool.connect();
  const apagados = {};
  try {
    await client.query('BEGIN');
    for (const t of [...TABELAS].reverse()) { // filhos antes dos pais
      if (!Array.isArray(ids[t.nome])) continue;
      const r = await client.query(`DELETE FROM ${t.nome} WHERE NOT (id = ANY($1::bigint[]))`, [ids[t.nome]]);
      if (r.rowCount) apagados[t.nome] = r.rowCount;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  await setSetting('sync_completo_em', new Date().toISOString());
  res.json({ ok: true, apagados });
}));

async function statusSync() {
  if (!tokenRecebimento) return null;
  return {
    ultimo_em: await getSetting('sync_ultimo_em', null),
    completo_em: await getSetting('sync_completo_em', null),
  };
}

// ================================================================ ENVIO
const URL_DESTINO = (process.env.GBF_SYNC_URL || '').replace(/\/$/, '');
const TOKEN_ENVIO = process.env.GBF_SYNC_TOKEN || '';
const INTERVALO_MS = Math.max(15, Number(process.env.GBF_SYNC_INTERVALO_S) || 60) * 1000;
const COMPLETO_MS = Math.max(0.01, Number(process.env.GBF_SYNC_COMPLETO_H) || 6) * 3600e3;
let enviando = false;

async function chamar(metodo, rota, corpo) {
  const r = await fetch(`${URL_DESTINO}${rota}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${TOKEN_ENVIO}`, ...(corpo ? { 'Content-Type': TIPO } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${rota}: HTTP ${r.status} ${j.error || ''}`);
  return j;
}

async function enviarTabela(t, cursor) {
  if (!(await colunasExistentes(t.nome)).size) return 0;
  const colunas = await colunasDe(t);
  const sel = colunas.join(', ');
  let total = 0;
  let c = cursor || {};
  for (let volta = 0; volta < 200; volta += 1) {
    let rows;
    if (t.cursor === 'ts') {
      // _cursor: updated_at com MICROssegundos (o Date do JS corta em ms e o último registro
      // seria reenviado a cada ciclo para sempre)
      ({ rows } = await query(
        `SELECT ${sel}, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS _cursor
         FROM ${t.nome} WHERE ($1::timestamptz IS NULL OR updated_at > $1::timestamptz)
         ORDER BY updated_at, id LIMIT ${LOTE} OFFSET $2`, [c.ts || null, volta * LOTE]));
    } else if (t.cursor === 'id') {
      ({ rows } = await query(`SELECT ${sel} FROM ${t.nome} WHERE id > $1 ORDER BY id LIMIT ${LOTE}`, [Number(c.id || 0)]));
    } else {
      ({ rows } = await query(`SELECT ${sel} FROM ${t.nome} ORDER BY id LIMIT ${LOTE} OFFSET $1`, [volta * LOTE]));
    }
    if (!rows.length) break;
    // datas como ISO (comparação de cursor no recebimento)
    const linhas = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])));
    await chamar('POST', '/lote', { tabela: t.nome, linhas });
    if (t.nome === 'ticket_attachments') await enviarArquivos(linhas);
    if (t.cursor !== 'todos') total += linhas.length;
    if (t.cursor === 'id') c = { id: linhas[linhas.length - 1].id };
    if (rows.length < LOTE) break;
  }
  return total;
}

async function enviarArquivos(linhas) {
  for (const a of linhas) {
    const arq = path.join(config.uploadsDir, 'tickets', String(a.ticket_id), path.basename(String(a.storage_path || '')));
    try {
      const st = fs.statSync(arq);
      if (st.size > MAX_ANEXO) continue;
      await chamar('POST', '/anexo', { ticket_id: a.ticket_id, storage_path: a.storage_path, base64: fs.readFileSync(arq).toString('base64') });
    } catch { /* arquivo ausente no disco: segue */ }
  }
}

async function enviarCompleto() {
  const ids = {};
  for (const t of TABELAS) {
    if (!(await colunasExistentes(t.nome)).size) continue;
    ids[t.nome] = (await query(`SELECT id FROM ${t.nome}`)).rows.map((r) => r.id);
  }
  return chamar('POST', '/completo', { ids });
}

async function cicloEnvio() {
  if (enviando) return;
  enviando = true;
  try {
    const estado = await chamar('GET', '/estado');
    let total = 0;
    for (const t of TABELAS) total += await enviarTabela(t, estado.cursores?.[t.nome]);
    const ultimoCompleto = estado.completo_em ? new Date(estado.completo_em).getTime() : 0;
    if (Date.now() - ultimoCompleto > COMPLETO_MS) {
      const r = await enviarCompleto();
      if (Object.keys(r.apagados || {}).length) console.log('[gbf-sync] removidos na cópia:', JSON.stringify(r.apagados));
    }
    if (total) console.log(`[gbf-sync] ${total} registro(s) enviados ao painel.`);
  } catch (e) {
    console.error('[gbf-sync] envio falhou:', e.message);
  } finally {
    enviando = false;
  }
}

function iniciarEnvio() {
  if (!URL_DESTINO || !TOKEN_ENVIO) return;
  console.log(`[gbf-sync] enviando dados da Central para ${URL_DESTINO} a cada ${INTERVALO_MS / 1000}s`);
  setTimeout(cicloEnvio, 8000);
  const t = setInterval(cicloEnvio, INTERVALO_MS);
  if (t.unref) t.unref();
}

module.exports = { receptor, iniciarEnvio, statusSync, cicloEnvio };
