// Solicitações do gestor para a TI: A FAZER -> EM ANDAMENTO -> CONCLUÍDA.
const express = require('express');
const { query } = require('../db');
const { ah, notificar, usuariosAtivos } = require('./common');

const router = express.Router();
const STATUS = { a_fazer: 'A fazer', em_andamento: 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada' };
const PRIORIDADE = { 1: 'Baixa', 2: 'Normal', 3: 'Alta', 4: 'Urgente' };

const SELECT = `
  SELECT r.*, r.desired_date::text AS desired_date, l.name AS location_name, ur.name AS requested_by_name, uh.name AS handled_by_name
  FROM gbf_requests r
  LEFT JOIN gbf_locations l ON l.id = r.location_id
  LEFT JOIN gbf_users ur ON ur.id = r.requested_by
  LEFT JOIN gbf_users uh ON uh.id = r.handled_by`;

const fmt = (r) => ({
  ...r, status_label: STATUS[r.status], priority_label: PRIORIDADE[r.priority],
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

router.get('/:id', ah(async (req, res) => {
  const r = await carregar(req.params.id);
  if (!r) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  res.json(fmt(r));
}));

function validar(b, novo) {
  const out = {};
  if (novo || b.title !== undefined) {
    const t = String(b.title || '').trim();
    if (!t) return { erro: 'Informe o título.' };
    out.title = t.slice(0, 200);
  }
  if (b.description !== undefined) out.description = String(b.description || '').trim() || null;
  if (b.location_id !== undefined) out.location_id = /^\d+$/.test(String(b.location_id)) ? Number(b.location_id) : null;
  if (b.priority !== undefined) out.priority = Math.min(Math.max(parseInt(b.priority, 10) || 2, 1), 4);
  if (b.desired_date !== undefined) {
    if (b.desired_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.desired_date)) return { erro: 'Data desejada inválida.' };
    out.desired_date = b.desired_date || null;
  }
  return { out };
}

// Só o gestor abre solicitação
router.post('/', ah(async (req, res) => {
  const u = req.gbfUser;
  if (u.role !== 'gestor') return res.status(403).json({ error: 'Apenas o gestor abre solicitações.' });
  const { erro, out } = validar(req.body || {}, true);
  if (erro) return res.status(422).json({ error: erro });
  out.requested_by = u.id;
  const cols = Object.keys(out);
  const id = (await query(
    `INSERT INTO gbf_requests (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
    cols.map((c) => out[c]))).rows[0].id;
  await notificar((await usuariosAtivos('tecnico')), {
    kind: 'solicitacao', title: `Nova solicitação: ${out.title}`,
    message: `${u.name}${out.desired_date ? ` · para ${out.desired_date.split('-').reverse().join('/')}` : ''}`,
    link: `#/solicitacoes/${id}`,
  });
  res.status(201).json({ id });
}));

// TI atende (status + resposta); gestor também pode editar os dados
router.patch('/:id', ah(async (req, res) => {
  const u = req.gbfUser;
  const r = await carregar(req.params.id);
  if (!r) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  const b = req.body || {};
  const sets = [];
  const params = [r.id];
  const set = (c, v) => { params.push(v); sets.push(`${c} = $${params.length}`); };

  if (u.role === 'gestor') {
    const { erro, out } = validar(b, false);
    if (erro) return res.status(422).json({ error: erro });
    for (const [k, v] of Object.entries(out)) set(k, v);
  } else if (b.desired_date !== undefined) {
    // técnico pode reagendar a data
    const { erro, out } = validar({ desired_date: b.desired_date }, false);
    if (erro) return res.status(422).json({ error: erro });
    set('desired_date', out.desired_date);
  }
  if (b.response !== undefined) set('response', String(b.response || '').trim() || null);
  let concluiu = false;
  if (b.status !== undefined && b.status !== r.status) {
    if (!STATUS[b.status]) return res.status(422).json({ error: 'Status inválido.' });
    if (b.status === 'cancelada' && u.role !== 'gestor') return res.status(403).json({ error: 'Apenas o gestor cancela.' });
    set('status', b.status);
    if (b.status === 'em_andamento' && !r.started_at) sets.push('started_at = now()');
    if (b.status !== 'a_fazer' && !r.handled_by) set('handled_by', u.id);
    if (b.status === 'concluida') { sets.push('completed_at = now()'); concluiu = true; }
    else sets.push('completed_at = NULL');
  }
  if (!sets.length) return res.status(422).json({ error: 'Nada para alterar.' });
  await query(`UPDATE gbf_requests SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
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
