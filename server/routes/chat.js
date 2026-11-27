const express = require('express');
const { query } = require('../db');
const { requireAuth, entityIdsOf } = require('../middleware/auth');
const realtime = require('../services/realtime');
const notify = require('../services/notify');
const settingsStore = require('../services/settingsStore');

// ---------------------------------------------------------------------
// Chat interno
//   Conversas diretas (2 pessoas) e grupos. Nas mensagens:
//     @[Nome](u12) -> cita a pessoa (ela recebe um aviso)
//     #16          -> link para o chamado
//   Quem pode conversar com quem: a equipe (vê todas as empresas) fala com todo mundo;
//   gestor/usuário fala com a equipe e com as pessoas das próprias empresas.
// ---------------------------------------------------------------------
const router = express.Router();
router.use(requireAuth);
// Desligado por padrão: o admin mestre liga em Configurações > Chat interno
router.use(async (req, res, next) => {
  const s = await settingsStore.getAll();
  if (!s['chat.enabled']) return res.status(403).json({ error: 'O chat interno está desligado. O admin mestre pode ligar em Configurações.', desligado: true });
  next();
});

const RE_MENCAO = /@\[([^\]\n]{1,80})\]\(u(\d+)\)/g;
const papelDe = (u) => (u.role === 'admin' ? 'Admin Mestre' : u.role === 'moderator' ? 'Moderador'
  : u.role === 'technician' ? 'Técnico' : Number(u.client_level) === 2 ? 'Gestor' : 'Usuário');
const textoLimpo = (s) => String(s || '').replace(RE_MENCAO, (_, nome) => `@${nome}`);

// pessoas com quem o usuário pode conversar (SQL + parâmetros)
function filtroPessoas(user, idx = 1) {
  const ents = entityIdsOf(user);
  if (ents === null) return { sql: 'TRUE', params: [] };
  return {
    sql: `(u.role IN ('admin','moderator','technician') OR u.entity_id::text = ANY($${idx}::text[])
           OR EXISTS (SELECT 1 FROM user_entities ue WHERE ue.user_id = u.id AND ue.entity_id::text = ANY($${idx}::text[])))`,
    params: [ents],
  };
}

async function podeFalarCom(user, ids) {
  const f = filtroPessoas(user, 2);
  const { rows } = await query(
    `SELECT u.id FROM users u WHERE u.active AND u.id::text = ANY($1::text[]) AND ${f.sql}`, [ids.map(String), ...f.params]);
  return rows.length === new Set(ids.map(String)).size;
}

async function membro(convId, userId) {
  const { rows } = await query('SELECT 1 FROM chat_members WHERE conversation_id = $1 AND user_id = $2', [convId, userId]);
  return rows.length > 0;
}

async function membrosDe(convId) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.role, u.client_level, l.name AS location_name
     FROM chat_members m JOIN users u ON u.id = m.user_id LEFT JOIN locations l ON l.id = u.location_id
     WHERE m.conversation_id = $1 ORDER BY u.name`, [convId]);
  return rows.map((u) => ({ id: u.id, name: u.name, papel: papelDe(u), location_name: u.location_name }));
}

// Pessoas para @ e para começar conversa
router.get('/people', async (req, res) => {
  const f = filtroPessoas(req.user, 2);
  const q = String(req.query.q || '').trim();
  const params = [req.user.id, ...f.params];
  let busca = '';
  if (q) { params.push(`%${q}%`); busca = `AND (u.name ILIKE $${params.length} OR u.username ILIKE $${params.length})`; }
  const { rows } = await query(
    `SELECT u.id, u.name, u.role, u.client_level, e.name AS entity_name, l.name AS location_name
     FROM users u LEFT JOIN entities e ON e.id = u.entity_id LEFT JOIN locations l ON l.id = u.location_id
     WHERE u.active AND u.id <> $1 AND ${f.sql} ${busca}
     ORDER BY (u.role IN ('admin','moderator','technician')) DESC, u.name LIMIT 300`, params);
  res.json(rows.map((u) => ({ id: u.id, name: u.name, papel: papelDe(u), entity_name: u.entity_name, location_name: u.location_name })));
});

// Conversas do usuário, com a última mensagem e quantas não lidas
router.get('/conversations', async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.kind, c.name, c.last_message_at, c.created_at,
            (SELECT json_build_object('id', m.id, 'content', m.content, 'user_name', u.name, 'user_id', m.user_id, 'created_at', m.created_at)
               FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
              WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 1) AS ultima,
            (SELECT count(*)::int FROM chat_messages m
              WHERE m.conversation_id = c.id AND m.deleted_at IS NULL AND m.user_id IS DISTINCT FROM $1
                AND m.created_at > COALESCE(me.last_read_at, 'epoch')) AS nao_lidas,
            (SELECT json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name)
               FROM chat_members mm JOIN users u ON u.id = mm.user_id WHERE mm.conversation_id = c.id) AS membros
     FROM chat_members me JOIN chat_conversations c ON c.id = me.conversation_id
     WHERE me.user_id = $1
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`, [req.user.id]);
  res.json(rows.map((c) => ({
    ...c,
    ultima: c.ultima ? { ...c.ultima, content: textoLimpo(c.ultima.content) } : null,
    // conversa direta: o nome é o da outra pessoa
    titulo: c.kind === 'group' ? c.name : ((c.membros || []).find((m) => String(m.id) !== String(req.user.id)) || {}).name || 'Conversa',
  })));
});

// Total de não lidas (bolinha do menu)
router.get('/unread', async (req, res) => {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM chat_members me
       JOIN chat_messages m ON m.conversation_id = me.conversation_id
      WHERE me.user_id = $1 AND m.deleted_at IS NULL AND m.user_id IS DISTINCT FROM $1
        AND m.created_at > COALESCE(me.last_read_at, 'epoch')`, [req.user.id]);
  res.json({ unread: rows[0].n });
});

// Começar conversa: 1 pessoa = conversa direta (reaproveita se já existe); mais = grupo
router.post('/conversations', async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body?.user_ids) ? req.body.user_ids : []).map(String).filter((x) => /^\d+$/.test(x) && x !== String(req.user.id)))];
  if (!ids.length) return res.status(422).json({ error: 'Escolha com quem quer conversar.' });
  if (ids.length > 50) return res.status(422).json({ error: 'No máximo 50 pessoas por grupo.' });
  if (!(await podeFalarCom(req.user, ids))) return res.status(403).json({ error: 'Você não pode conversar com alguma dessas pessoas.' });
  if (ids.length === 1) {
    const chave = [String(req.user.id), ids[0]].sort((a, b) => Number(a) - Number(b)).join(':');
    const ja = await query('SELECT id FROM chat_conversations WHERE direct_key = $1', [chave]);
    if (ja.rows.length) return res.json({ id: ja.rows[0].id, existente: true });
    const { rows } = await query(
      `INSERT INTO chat_conversations (kind, direct_key, created_by) VALUES ('direct', $1, $2) RETURNING id`, [chave, req.user.id]);
    await query('INSERT INTO chat_members (conversation_id, user_id) SELECT $1, unnest($2::bigint[])', [rows[0].id, [req.user.id, ids[0]]]);
    return res.status(201).json({ id: rows[0].id });
  }
  const nome = String(req.body?.name || '').trim().slice(0, 80);
  if (!nome) return res.status(422).json({ error: 'Dê um nome ao grupo.' });
  const { rows } = await query(
    `INSERT INTO chat_conversations (kind, name, created_by) VALUES ('group', $1, $2) RETURNING id`, [nome, req.user.id]);
  await query('INSERT INTO chat_members (conversation_id, user_id) SELECT $1, unnest($2::bigint[])', [rows[0].id, [req.user.id, ...ids]]);
  res.status(201).json({ id: rows[0].id });
});

// Uma conversa: dados e membros
router.get('/conversations/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id) || !(await membro(req.params.id, req.user.id))) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const { rows } = await query('SELECT id, kind, name, created_by, created_at FROM chat_conversations WHERE id = $1', [req.params.id]);
  const membros = await membrosDe(req.params.id);
  const c = rows[0];
  res.json({ ...c, membros, titulo: c.kind === 'group' ? c.name : (membros.find((m) => String(m.id) !== String(req.user.id)) || {}).name || 'Conversa' });
});

// Mensagens (as 50 mais recentes, ou antes de ?antes=id)
router.get('/conversations/:id/messages', async (req, res) => {
  if (!/^\d+$/.test(req.params.id) || !(await membro(req.params.id, req.user.id))) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const params = [req.params.id];
  let antes = '';
  if (/^\d+$/.test(String(req.query.antes || ''))) { params.push(req.query.antes); antes = `AND m.id < $${params.length}`; }
  const { rows } = await query(
    `SELECT m.id, m.content, m.user_id, m.created_at, m.deleted_at, u.name AS user_name
     FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
     WHERE m.conversation_id = $1 ${antes} ORDER BY m.id DESC LIMIT 50`, params);
  res.json(rows.reverse().map((m) => (m.deleted_at ? { ...m, content: '' } : m)));
});

// Enviar mensagem
router.post('/conversations/:id/messages', async (req, res) => {
  const convId = req.params.id;
  if (!/^\d+$/.test(convId) || !(await membro(convId, req.user.id))) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const content = String(req.body?.content || '').trim();
  if (!content) return res.status(422).json({ error: 'Escreva a mensagem.' });
  if (content.length > 4000) return res.status(422).json({ error: 'Mensagem grande demais (máximo 4000 letras).' });
  const { rows } = await query(
    `INSERT INTO chat_messages (conversation_id, user_id, content) VALUES ($1, $2, $3) RETURNING id, content, user_id, created_at`,
    [convId, req.user.id, content]);
  await query('UPDATE chat_conversations SET last_message_at = now() WHERE id = $1', [convId]);
  await query('UPDATE chat_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2', [convId, req.user.id]);
  const msg = { ...rows[0], user_name: req.user.name, conversation_id: Number(convId) };
  const membros = await membrosDe(convId);
  realtime.emitToUsers(membros.map((m) => m.id), 'chat:message', msg);

  // citações: só quem está na conversa (quem não está não conseguiria abrir)
  const citados = new Set();
  for (const m of content.matchAll(RE_MENCAO)) if (String(m[2]) !== String(req.user.id)) citados.add(String(m[2]));
  const conv = (await query('SELECT kind, name FROM chat_conversations WHERE id = $1', [convId])).rows[0];
  const onde = conv.kind === 'group' ? `no grupo "${conv.name}"` : 'numa conversa';
  for (const id of citados) {
    if (!membros.some((m) => String(m.id) === id)) continue;
    await notify.createInApp(id, `${req.user.name} citou você ${onde}`, textoLimpo(content).slice(0, 300), null, `#/chat/${convId}`).catch(() => {});
  }
  res.status(201).json(msg);
});

// Marcar como lida
router.post('/conversations/:id/read', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Conversa não encontrada.' });
  await query('UPDATE chat_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// Apagar a própria mensagem
router.delete('/messages/:id', async (req, res) => {
  const { rows } = await query('SELECT id, conversation_id, user_id FROM chat_messages WHERE id = $1', [req.params.id]);
  if (!rows.length || String(rows[0].user_id) !== String(req.user.id)) return res.status(404).json({ error: 'Mensagem não encontrada.' });
  await query('UPDATE chat_messages SET deleted_at = now() WHERE id = $1', [req.params.id]);
  const membros = await membrosDe(rows[0].conversation_id);
  realtime.emitToUsers(membros.map((m) => m.id), 'chat:deleted', { id: rows[0].id, conversation_id: rows[0].conversation_id });
  res.json({ ok: true });
});

// Grupo: adicionar pessoas / sair / renomear
router.post('/conversations/:id/members', async (req, res) => {
  const convId = req.params.id;
  if (!/^\d+$/.test(convId) || !(await membro(convId, req.user.id))) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const c = (await query('SELECT kind FROM chat_conversations WHERE id = $1', [convId])).rows[0];
  if (c.kind !== 'group') return res.status(422).json({ error: 'Só dá para adicionar pessoas em grupos.' });
  const ids = [...new Set((req.body?.user_ids || []).map(String).filter((x) => /^\d+$/.test(x)))];
  if (!ids.length) return res.status(422).json({ error: 'Escolha quem adicionar.' });
  if (!(await podeFalarCom(req.user, ids))) return res.status(403).json({ error: 'Você não pode adicionar alguma dessas pessoas.' });
  await query(`INSERT INTO chat_members (conversation_id, user_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING`, [convId, ids]);
  res.json({ ok: true, membros: await membrosDe(convId) });
});

router.delete('/conversations/:id/members/me', async (req, res) => {
  const c = (await query('SELECT kind FROM chat_conversations WHERE id = $1', [req.params.id])).rows[0];
  if (!c) return res.status(404).json({ error: 'Conversa não encontrada.' });
  if (c.kind !== 'group') return res.status(422).json({ error: 'Só dá para sair de grupos.' });
  await query('DELETE FROM chat_members WHERE conversation_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

router.patch('/conversations/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id) || !(await membro(req.params.id, req.user.id))) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const nome = String(req.body?.name || '').trim().slice(0, 80);
  if (!nome) return res.status(422).json({ error: 'Dê um nome ao grupo.' });
  await query(`UPDATE chat_conversations SET name = $2 WHERE id = $1 AND kind = 'group'`, [req.params.id, nome]);
  res.json({ ok: true });
});

module.exports = router;
