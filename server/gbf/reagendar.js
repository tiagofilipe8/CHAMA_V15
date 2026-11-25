// Reagendar com motivo: visita do posto, solicitação de visita ou atividade.
// Técnico ou gestor reagendam; o motivo fica no histórico e vai pelo sino para os outros
// (gestores e técnicos ativos, menos quem reagendou).
//
// POST /api/gbf/reagendar  { tipo: 'posto'|'solicitacao'|'atividade', id, data: 'AAAA-MM-DD', hora?: 'HH:MM', motivo }
// GET  /api/gbf/reagendar?tipo=...&id=...   -> histórico daquele item
const express = require('express');
const { query } = require('../db');
const { ah, notificar, usuariosAtivos, limparAvisosPrazo } = require('./common');

const router = express.Router();
const TZ = 'America/Sao_Paulo';
const dataBR = (iso) => (iso ? String(iso).split('-').reverse().join('/') : 'sem data');
const dataOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const horaOk = (s) => /^\d{2}:\d{2}$/.test(String(s || ''));

async function alvo(tipo, id) {
  if (!/^\d+$/.test(String(id))) return null;
  if (tipo === 'posto') {
    const r = (await query(`SELECT id, name, next_visit_date::text AS data FROM gbf_locations WHERE id = $1`, [id])).rows[0];
    return r && { id: r.id, data: r.data, nome: `Visita ao ${r.name}`, link: `#/postos/${r.id}` };
  }
  if (tipo === 'solicitacao') {
    const r = (await query(`SELECT id, title, status, desired_date::text AS data, requested_by FROM gbf_requests WHERE id = $1`, [id])).rows[0];
    if (!r) return null;
    return { id: r.id, data: r.data, nome: r.title, link: `#/solicitacoes/${r.id}`, fechada: !['a_fazer', 'em_andamento'].includes(r.status), dono: r.requested_by };
  }
  if (tipo === 'atividade') {
    const r = (await query(
      `SELECT id, title, status, assignee_id, to_char(due_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS data FROM gbf_tasks WHERE id = $1`, [id])).rows[0];
    if (!r) return null;
    return { id: r.id, data: r.data, nome: r.title, link: `#/atividades/${r.id}`, fechada: ['concluida', 'cancelada'].includes(r.status), dono: r.assignee_id };
  }
  return null;
}

router.get('/', ah(async (req, res) => {
  const { tipo, id } = req.query;
  if (!['posto', 'solicitacao', 'atividade'].includes(tipo) || !/^\d+$/.test(String(id || ''))) return res.json([]);
  const { rows } = await query(
    `SELECT r.id, r.old_date::text AS de, r.new_date::text AS para, r.reason AS motivo, r.created_at, u.name AS quem
     FROM gbf_reschedules r LEFT JOIN gbf_users u ON u.id = r.user_id
     WHERE r.kind = $1 AND r.ref_id = $2 ORDER BY r.created_at DESC LIMIT 50`, [tipo, id]);
  res.json(rows);
}));

router.post('/', ah(async (req, res) => {
  const u = req.gbfUser;
  const b = req.body || {};
  const tipo = String(b.tipo || '');
  if (!['posto', 'solicitacao', 'atividade'].includes(tipo)) return res.status(422).json({ error: 'Tipo inválido.' });
  if (!dataOk(b.data)) return res.status(422).json({ error: 'Escolha a nova data.' });
  if (b.hora && !horaOk(b.hora)) return res.status(422).json({ error: 'Horário inválido.' });
  const motivo = String(b.motivo || '').trim();
  if (motivo.length < 3) return res.status(422).json({ error: 'Escreva o motivo do reagendamento.' });
  const a = await alvo(tipo, b.id);
  if (!a) return res.status(404).json({ error: 'Item não encontrado.' });
  if (a.fechada) return res.status(409).json({ error: 'Este item já foi concluído ou cancelado.' });

  if (tipo === 'posto') {
    await query(`UPDATE gbf_locations SET next_visit_date = $2, next_visit_time = $3, visit_notified_date = NULL, updated_at = now() WHERE id = $1`,
      [a.id, b.data, b.hora || null]);
  } else if (tipo === 'solicitacao') {
    await query('UPDATE gbf_requests SET desired_date = $2, updated_at = now() WHERE id = $1', [a.id, b.data]);
  } else {
    // sem horário = o dia todo (vence 23:59:59)
    await query(`UPDATE gbf_tasks SET due_at = (($2::date + $3::time)::timestamp AT TIME ZONE '${TZ}'), all_day = $4,
                   due_soon_notified = FALSE, overdue_notified = FALSE, updated_at = now() WHERE id = $1`,
    [a.id, b.data, b.hora || '23:59:59', !b.hora]);
    await limparAvisosPrazo(a.id);
  }
  await query('INSERT INTO gbf_reschedules (kind, ref_id, old_date, new_date, reason, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
    [tipo, a.id, a.data || null, b.data, motivo.slice(0, 1000), u.id]);

  const outros = [...await usuariosAtivos('gestor'), ...await usuariosAtivos('tecnico')]
    .filter((x) => String(x) !== String(u.id));
  await notificar(outros, {
    kind: 'reagendamento',
    title: `Reagendado: ${a.nome}`,
    message: `${u.name} mudou de ${dataBR(a.data)} para ${dataBR(b.data)}${b.hora ? ` às ${b.hora}` : ''}. Motivo: ${motivo.slice(0, 300)}`,
    link: a.link,
  });
  res.json({ ok: true });
}));

module.exports = router;
