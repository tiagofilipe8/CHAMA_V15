// Solicitações do gestor para a TI.
// - Solicitação de VISITA (a usada hoje): posto + data desejada + urgência + tarefas tiradas dos
//   checklists. A TI inicia a visita pela solicitação; as tarefas viram o checklist da visita e,
//   quando a visita é concluída, a solicitação se fecha sozinha (ver visitas.js).
// - Solicitação GERAL (texto livre): as antigas continuam abrindo e podendo ser concluídas.
// Situações: A FAZER -> EM ANDAMENTO -> CONCLUÍDA (ou CANCELADA).
const express = require('express');
const { query, withTransaction } = require('../db');
const { ah, notificar, usuariosAtivos, avisarEquipe } = require('./common');

const router = express.Router();
const STATUS = { a_fazer: 'A fazer', em_andamento: 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada' };
const PRIORIDADE = { 1: 'Requisição', 2: 'Operação prejudicada', 3: 'Parada iminente', 4: 'Operação parada' }; // mesma urgência dos chamados
const numero = (id) => `S-${String(id).padStart(4, '0')}`;
const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const MAX_TAREFAS = 60;
const TIPO_VISITA = { rotina: 'Visita de rotina', pontual: 'Visita pontual' };
const tituloVisita = (tipo, posto) => `${TIPO_VISITA[tipo] || 'Visita'} — ${posto}`;

const SELECT = `
  SELECT r.*, r.desired_date::text AS desired_date, l.name AS location_name, ur.name AS requested_by_name, uh.name AS handled_by_name,
         v.status AS visita_status, v.finished_at AS visita_concluida_em,
         COALESCE((SELECT json_agg(i.label ORDER BY i.position, i.id) FROM gbf_request_items i WHERE i.request_id = r.id), '[]'::json) AS tarefas,
         (SELECT count(*)::int FROM gbf_visit_answers a WHERE a.visit_id = r.visit_id AND a.answer = 'nao_ok') AS visita_nao_ok
  FROM gbf_requests r
  LEFT JOIN gbf_locations l ON l.id = r.location_id
  LEFT JOIN gbf_users ur ON ur.id = r.requested_by
  LEFT JOIN gbf_users uh ON uh.id = r.handled_by
  LEFT JOIN gbf_visits v ON v.id = r.visit_id`;

const fmt = (r) => ({
  ...r, numero: numero(r.id), status_label: STATUS[r.status], priority_label: PRIORIDADE[r.priority],
  tipo_visita_label: r.kind === 'visita' ? (TIPO_VISITA[r.visit_type] || 'Visita') : null,
  tempo_ate_concluir: r.completed_at ? Math.round((new Date(r.completed_at) - new Date(r.created_at)) / 1000) : null,
});

async function carregar(id) {
  if (!/^\d+$/.test(String(id))) return null;
  return (await query(`${SELECT} WHERE r.id = $1`, [id])).rows[0] || null;
}

router.get('/', ah(async (req, res) => {
  const s = req.query.situacao;
  let where = 'TRUE';
  if (s === 'abertas') where = `r.status IN ('a_fazer','em_andamento')`;
  else if (s === 'concluidas') where = `r.status = 'concluida'`;
  else if (s === 'novas') where = `r.status = 'a_fazer'`;
  const { rows } = await query(
    `${SELECT} WHERE ${where}
     ORDER BY (r.status IN ('concluida','cancelada')), r.priority DESC, r.desired_date NULLS LAST, r.created_at DESC
     LIMIT 300`);
  res.json(rows.map(fmt));
}));

// Modelos de tarefas para montar a solicitação de visita: os checklists ativos com os itens
router.get('/modelos', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.name,
            COALESCE((SELECT json_agg(i.label ORDER BY i.position, i.id) FROM gbf_checklist_items i WHERE i.checklist_id = c.id), '[]'::json) AS itens
     FROM gbf_checklists c WHERE c.active ORDER BY c.name`);
  res.json(rows);
}));

router.get('/:id', ah(async (req, res) => {
  const r = await carregar(req.params.id);
  if (!r) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  // Resultado da visita (o que a TI marcou em cada tarefa, com o comentário)
  let visita = null;
  if (r.visit_id) {
    const [v, resp] = await Promise.all([
      query(`SELECT v.id, v.status, v.started_at, v.finished_at, v.notes, v.pending_notes, u.name AS user_name
             FROM gbf_visits v LEFT JOIN gbf_users u ON u.id = v.user_id WHERE v.id = $1`, [r.visit_id]),
      query('SELECT item_label, answer, note FROM gbf_visit_answers WHERE visit_id = $1 ORDER BY position, id', [r.visit_id]),
    ]);
    if (v.rows[0]) visita = { ...v.rows[0], respostas: resp.rows };
  }
  const reagendamentos = (await query(
    `SELECT x.old_date::text AS de, x.new_date::text AS para, x.reason AS motivo, x.created_at, u.name AS quem
     FROM gbf_reschedules x LEFT JOIN gbf_users u ON u.id = x.user_id
     WHERE x.kind = 'solicitacao' AND x.ref_id = $1 ORDER BY x.created_at DESC`, [r.id])).rows;
  res.json({ ...fmt(r), visita, reagendamentos });
}));

function limparTarefas(lista) {
  if (!Array.isArray(lista)) return null;
  const vistas = new Set();
  const out = [];
  for (const t of lista) {
    const s = String(t || '').trim().slice(0, 200);
    if (s && !vistas.has(s.toLowerCase())) { vistas.add(s.toLowerCase()); out.push(s); }
  }
  return out;
}

function validar(b, novo, kind) {
  const out = {};
  if (kind === 'geral' && (novo || b.title !== undefined)) {
    const t = String(b.title || '').trim();
    if (!t) return { erro: 'Informe o título.' };
    out.title = t.slice(0, 200);
  }
  if (b.description !== undefined) out.description = String(b.description || '').trim() || null;
  if (b.location_id !== undefined) out.location_id = /^\d+$/.test(String(b.location_id)) ? Number(b.location_id) : null;
  if (kind === 'visita' && (novo || b.location_id !== undefined) && !out.location_id) return { erro: 'Escolha o posto da visita.' };
  if (b.priority !== undefined) out.priority = Math.min(Math.max(parseInt(b.priority, 10) || 1, 1), 4);
  if (b.desired_date !== undefined) {
    if (b.desired_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.desired_date)) return { erro: 'Data desejada inválida.' };
    out.desired_date = b.desired_date || null;
  }
  return { out };
}

async function gravarTarefas(q, requestId, tarefas) {
  await q('DELETE FROM gbf_request_items WHERE request_id = $1', [requestId]);
  for (const [i, t] of tarefas.entries()) {
    await q('INSERT INTO gbf_request_items (request_id, position, label) VALUES ($1, $2, $3)', [requestId, i, t]);
  }
}

// Só o gestor abre solicitação. Hoje a tela só cria solicitação de visita.
router.post('/', ah(async (req, res) => {
  const u = req.gbfUser;
  if (u.role !== 'gestor') return res.status(403).json({ error: 'Apenas o gestor abre solicitações.' });
  const b = req.body || {};
  const kind = b.kind === 'geral' ? 'geral' : 'visita';
  const { erro, out } = validar(b, true, kind);
  if (erro) return res.status(422).json({ error: erro });
  let tarefas = [];
  if (kind === 'visita') {
    const posto = (await query('SELECT id, name FROM gbf_locations WHERE id = $1 AND active', [out.location_id])).rows[0];
    if (!posto) return res.status(422).json({ error: 'Posto inválido.' });
    tarefas = limparTarefas(b.tarefas) || [];
    if (!tarefas.length) return res.status(422).json({ error: 'Escolha pelo menos uma tarefa para a visita.' });
    if (tarefas.length > MAX_TAREFAS) return res.status(422).json({ error: `No máximo ${MAX_TAREFAS} tarefas por visita.` });
    out.visit_type = b.visit_type === 'pontual' ? 'pontual' : 'rotina';
    out.title = tituloVisita(out.visit_type, posto.name);
    if (!out.priority) out.priority = 1;
  }
  out.kind = kind;
  out.requested_by = u.id;
  const cols = Object.keys(out);
  const id = await withTransaction(async (q) => {
    const novo = (await q(
      `INSERT INTO gbf_requests (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      cols.map((c) => out[c]))).rows[0].id;
    if (kind === 'visita') await gravarTarefas(q, novo, tarefas);
    return novo;
  });
  await avisarEquipe(u, {
    kind: 'solicitacao',
    title: kind === 'visita' ? `${out.visit_type === 'pontual' ? 'Visita pontual' : 'Visita de rotina'} pedida: ${out.title.split(' — ').pop()}` : `Nova solicitação: ${out.title}`,
    message: [u.name, out.desired_date ? `para ${dataBR(out.desired_date)}` : null, PRIORIDADE[out.priority || 1],
      kind === 'visita' ? `${tarefas.length} tarefa(s)` : null].filter(Boolean).join(' · '),
    link: `#/solicitacoes/${id}`,
  });
  // (quem pediu não recebe o próprio aviso)
  res.status(201).json({ id });
}));

// TI atende (status + resposta); gestor também pode editar os dados.
// Solicitação de visita: a situação muda pela visita (iniciar/concluir), não por aqui.
router.patch('/:id', ah(async (req, res) => {
  const u = req.gbfUser;
  const r = await carregar(req.params.id);
  if (!r) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  const b = req.body || {};
  const sets = [];
  const params = [r.id];
  const set = (c, v) => { params.push(v); sets.push(`${c} = $${params.length}`); };
  let tarefas = null;

  if (u.role === 'gestor') {
    const { erro, out } = validar(b, false, r.kind);
    if (erro) return res.status(422).json({ error: erro });
    if (r.kind === 'visita') {
      const tipo = b.visit_type !== undefined ? (b.visit_type === 'pontual' ? 'pontual' : 'rotina') : (r.visit_type || 'rotina');
      if (b.visit_type !== undefined) out.visit_type = tipo;
      const postoId = out.location_id !== undefined ? out.location_id : r.location_id;
      const posto = (await query('SELECT name FROM gbf_locations WHERE id = $1', [postoId])).rows[0];
      if (!posto) return res.status(422).json({ error: 'Posto inválido.' });
      out.title = tituloVisita(tipo, posto.name);
    }
    for (const [k, v] of Object.entries(out)) set(k, v);
    if (r.kind === 'visita' && b.tarefas !== undefined) {
      if (r.status !== 'a_fazer') return res.status(409).json({ error: 'A visita já começou: as tarefas não podem mais mudar.' });
      tarefas = limparTarefas(b.tarefas) || [];
      if (!tarefas.length) return res.status(422).json({ error: 'Escolha pelo menos uma tarefa para a visita.' });
      if (tarefas.length > MAX_TAREFAS) return res.status(422).json({ error: `No máximo ${MAX_TAREFAS} tarefas por visita.` });
    }
  } else if (b.desired_date !== undefined) {
    return res.status(422).json({ error: 'Para mudar a data, use Reagendar e escreva o motivo.' });
  }
  if (b.response !== undefined) set('response', String(b.response || '').trim() || null);
  let concluiu = false;
  if (b.status !== undefined && b.status !== r.status) {
    if (!STATUS[b.status]) return res.status(422).json({ error: 'Status inválido.' });
    if (b.status === 'cancelada' && u.role !== 'gestor') return res.status(403).json({ error: 'Apenas o gestor cancela.' });
    if (r.kind === 'visita' && b.status !== 'cancelada') {
      return res.status(409).json({ error: 'Esta solicitação anda pela visita: inicie a visita e conclua o checklist.' });
    }
    set('status', b.status);
    if (b.status === 'em_andamento' && !r.started_at) sets.push('started_at = now()');
    if (b.status !== 'a_fazer' && !r.handled_by) set('handled_by', u.id);
    if (b.status === 'concluida') { sets.push('completed_at = now()'); concluiu = true; } else sets.push('completed_at = NULL');
  }
  if (!sets.length && !tarefas) return res.status(422).json({ error: 'Nada para alterar.' });
  await withTransaction(async (q) => {
    if (sets.length) await q(`UPDATE gbf_requests SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
    if (tarefas) await gravarTarefas(q, r.id, tarefas);
  });
  const mudouAlgo = sets.some((x) => !/^(updated_at|completed_at|started_at)/.test(x)) || tarefas;
  if (!concluiu && mudouAlgo) {
    const cancelou = b.status === 'cancelada';
    await avisarEquipe(u, {
      kind: 'solicitacao', title: `${u.name} ${cancelou ? 'cancelou' : 'alterou'} o pedido: ${r.title}`,
      message: cancelou ? (b.response ? String(b.response).slice(0, 200) : null) : (tarefas ? `${tarefas.length} tarefa(s)` : null),
      link: `#/solicitacoes/${r.id}`,
    }, { extras: [r.requested_by, r.handled_by] });
  }
  if (concluiu && r.requested_by && String(r.requested_by) !== String(u.id)) {
    await notificar([r.requested_by], {
      kind: 'solicitacao', title: `Solicitação concluída: ${r.title}`,
      message: b.response ? String(b.response).slice(0, 200) : `Concluída por ${u.name}`,
      link: `#/solicitacoes/${r.id}`,
    });
  }
  res.json(fmt(await carregar(r.id)));
}));

module.exports = router;
module.exports.numero = numero;
