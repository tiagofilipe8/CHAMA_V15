// Recebimento dos dados da Central da Orcim no Painel Beija-Flor (ti.sgogeral.com).
//
// O ENVIO roda na Central da Orcim: server/integracao-beijaflor (pasta independente, entregue à
// Orcim). Ele descobre sozinho todas as tabelas do banco deles e manda o que mudou a cada minuto.
//
// Aqui cada linha recebida é guardada de dois jeitos:
//  - gbf_espelho (tabela, chave, dados jsonb): TODAS as tabelas, para a tela "Tudo da Orcim";
//  - nas tabelas de mesmo nome da Central (tickets, assets...), só para as que o painel já
//    sabe ler (TIPADAS). Usuários entram sem senha, e-mail e telefone (nem são enviados).
// Ligado por GBF_SYNC_TOKEN (o mesmo segredo configurado na Orcim).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../config');
const { query, pool } = require('../db');
const { ah, getSetting, setSetting } = require('./common');

// Tabelas que o painel lê no formato da Central. Ordem: pais antes dos filhos.
const TIPADAS = ['entities', 'categories', 'resolution_causes', 'locations', 'users', 'assets', 'tickets', 'ticket_status_history',
  'ticket_messages', 'ticket_attachments', 'asset_maintenances'];
const TIPO = 'application/x-gbf-sync+json'; // fora do express.json global (limite de 1 MB da Central)
const NOME_VALIDO = /^[a-z_][a-z0-9_]{0,62}$/;

const cacheColunas = new Map();
async function colunasLocais(tabela) {
  if (!cacheColunas.has(tabela)) {
    const { rows } = await query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [tabela]);
    cacheColunas.set(tabela, new Set(rows.map((r) => r.column_name)));
  }
  return cacheColunas.get(tabela);
}

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

// Lista de tabelas e colunas da Central (a tela "Tudo da Orcim" usa)
receptor.post('/sync/esquema', ah(async (req, res) => {
  const tabelas = Array.isArray(req.body?.tabelas) ? req.body.tabelas : null;
  if (!tabelas || tabelas.some((t) => !NOME_VALIDO.test(String(t.nome)))) return res.status(422).json({ error: 'Esquema inválido.' });
  await setSetting('sync_esquema', {
    versao: Number(req.body.versao) || 0,
    recebido_em: new Date().toISOString(),
    tabelas: tabelas.map((t) => ({
      nome: t.nome, modo: String(t.modo || ''), pk: (t.pk || []).map(String),
      colunas: (t.colunas || []).map((c) => ({ nome: String(c.nome), tipo: String(c.tipo || '') })),
    })),
  });
  res.json({ ok: true });
}));

// Colunas que apontam (chave estrangeira) para tabelas fora de TIPADAS: ficam de fora da cópia
// tipada, senão a gravação falharia (ex.: assets.primary_photo_id -> asset_photos)
let cacheForaDoTipado = null;
async function colunasForaDoTipado(tabela) {
  if (!cacheForaDoTipado) {
    const { rows } = await query(
      `SELECT c.conrelid::regclass::text AS tabela, a.attname AS coluna, c.confrelid::regclass::text AS alvo
       FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
       WHERE c.contype = 'f'`);
    cacheForaDoTipado = new Map();
    for (const r of rows) {
      if (TIPADAS.includes(r.alvo)) continue;
      if (!cacheForaDoTipado.has(r.tabela)) cacheForaDoTipado.set(r.tabela, new Set());
      cacheForaDoTipado.get(r.tabela).add(r.coluna);
    }
  }
  return cacheForaDoTipado.get(tabela) || new Set();
}

async function gravarTipada(tabela, linhas) {
  const existem = await colunasLocais(tabela);
  if (!existem.has('id')) return;
  const fora = await colunasForaDoTipado(tabela);
  const colunas = [...existem].filter((c) => linhas.some((l) => c in l) && c !== 'password_hash' && !fora.has(c));
  const dados = linhas.map((l) => {
    const o = {};
    for (const c of colunas) if (c in l) o[c] = l[c];
    if (tabela === 'users') o.password_hash = '!sincronizado-sem-login';
    return o;
  });
  const lista = tabela === 'users' ? [...colunas, 'password_hash'] : colunas;
  const atualiza = colunas.filter((c) => c !== 'id').map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
  const cols = lista.map((c) => `"${c}"`).join(', ');
  await query(
    `INSERT INTO ${tabela} (${cols})
     SELECT ${cols} FROM jsonb_populate_recordset(NULL::${tabela}, $1::jsonb)
     ON CONFLICT (id) DO ${atualiza ? `UPDATE SET ${atualiza}` : 'NOTHING'}`, [JSON.stringify(dados)]);
}

receptor.post('/sync/lote', ah(async (req, res) => {
  const { tabela, linhas } = req.body || {};
  if (!NOME_VALIDO.test(String(tabela)) || !Array.isArray(linhas)) return res.status(422).json({ error: 'Lote inválido.' });
  if (!linhas.length) return res.json({ ok: true, gravadas: 0 });
  // envio antigo (v1) não manda pk: era sempre "id"
  const pk = Array.isArray(req.body.pk) && req.body.pk.length ? req.body.pk.map(String) : ['id'];
  const chave = (l) => pk.map((c) => (l[c] === null || l[c] === undefined ? '' : String(l[c]))).join('|');

  const limpas = linhas.map((l) => { const o = { ...l }; delete o._cursor; return o; });
  await query(
    `INSERT INTO gbf_espelho (tabela, chave, dados, recebido_em)
     SELECT $1, x.chave, x.dados, now() FROM jsonb_to_recordset($2::jsonb) AS x(chave text, dados jsonb)
     ON CONFLICT (tabela, chave) DO UPDATE SET dados = EXCLUDED.dados, recebido_em = now()`,
    [tabela, JSON.stringify(limpas.map((l) => ({ chave: chave(l), dados: l })))]);
  if (TIPADAS.includes(tabela)) await gravarTipada(tabela, limpas);

  // Avança o cursor desta tabela
  const cursores = (await getSetting('sync_cursores', {})) || {};
  if (linhas.some((l) => l._cursor)) {
    // _cursor vem do envio com microssegundos e formato fixo (comparação de texto é segura)
    cursores[tabela] = { ts: linhas.reduce((m, l) => (l._cursor && l._cursor > m ? l._cursor : m), cursores[tabela]?.ts || '') };
  } else if (pk.length === 1 && linhas.every((l) => /^\d+$/.test(String(l[pk[0]])))) {
    cursores[tabela] = { id: linhas.reduce((m, l) => Math.max(m, Number(l[pk[0]])), Number(cursores[tabela]?.id || 0)) };
  }
  await setSetting('sync_cursores', cursores);
  await setSetting('sync_ultimo_em', new Date().toISOString());
  res.json({ ok: true, gravadas: linhas.length });
}));

// Arquivo (anexo de chamado, foto de equipamento): vai para o disco do painel no mesmo caminho da Central
function gravarArquivo(relativo, base64) {
  const partes = String(relativo || '').split('/');
  if (!['tickets', 'assets'].includes(partes[0]) || partes.length !== 3 || !/^\d+$/.test(partes[1])
    || !partes[2] || partes[2].startsWith('.') || partes[2] !== path.basename(partes[2]) || !base64) return false;
  const dir = path.join(config.uploadsDir, partes[0], partes[1]);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, partes[2]), Buffer.from(String(base64), 'base64'));
  return true;
}
receptor.post('/sync/arquivo', ah(async (req, res) => {
  if (!gravarArquivo(req.body?.caminho, req.body?.base64)) return res.status(422).json({ error: 'Arquivo inválido.' });
  res.json({ ok: true });
}));
// envio antigo (v1)
receptor.post('/sync/anexo', ah(async (req, res) => {
  const { ticket_id: ticketId, storage_path: arquivo, base64 } = req.body || {};
  if (!gravarArquivo(`tickets/${ticketId}/${path.basename(String(arquivo || ''))}`, base64)) return res.status(422).json({ error: 'Anexo inválido.' });
  res.json({ ok: true });
}));

// Conferência completa: apaga da cópia o que não existe mais na Orcim
receptor.post('/sync/completo', ah(async (req, res) => {
  // v2 manda { chaves: { tabela: ['1', '2|x', ...] } }; v1 mandava { ids: { tabela: [1, 2] } }
  const entrada = req.body?.chaves || req.body?.ids || {};
  const chaves = {};
  for (const [t, lista] of Object.entries(entrada)) if (NOME_VALIDO.test(t) && Array.isArray(lista)) chaves[t] = lista.map(String);
  const client = await pool.connect();
  const apagados = {};
  try {
    await client.query('BEGIN');
    for (const t of [...TIPADAS].reverse()) { // filhos antes dos pais
      if (!chaves[t] || !(await colunasLocais(t)).has('id')) continue;
      const r = await client.query(`DELETE FROM ${t} WHERE NOT (id::text = ANY($1::text[]))`, [chaves[t]]);
      if (r.rowCount) apagados[t] = r.rowCount;
    }
    for (const [t, lista] of Object.entries(chaves)) {
      const r = await client.query('DELETE FROM gbf_espelho WHERE tabela = $1 AND NOT (chave = ANY($2::text[]))', [t, lista]);
      if (r.rowCount && !apagados[t]) apagados[t] = r.rowCount;
    }
    // Tabela que deixou de existir (ou passou a ser excluída) na Orcim
    if (req.body?.chaves) await client.query('DELETE FROM gbf_espelho WHERE NOT (tabela = ANY($1::text[]))', [Object.keys(chaves)]);
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
  const esquema = await getSetting('sync_esquema', null);
  return {
    ultimo_em: await getSetting('sync_ultimo_em', null),
    completo_em: await getSetting('sync_completo_em', null),
    versao_envio: esquema?.versao || null,
    tabelas: esquema?.tabelas?.length || null,
  };
}

module.exports = { receptor, statusSync, TIPADAS };
