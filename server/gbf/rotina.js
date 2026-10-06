// Agenda, "Meu dia" e acompanhamento do gestor (rotina do técnico).
const express = require('express');
const { query } = require('../db');
const { ah } = require('./common');
const { requireGestor: requireGestorFn } = require('./auth');

const router = express.Router();
const TZ = `'America/Sao_Paulo'`;
const HOJE = `(now() AT TIME ZONE ${TZ})::date`;
const DIA = (col) => `(${col} AT TIME ZONE ${TZ})::date`;
const HORA = (col) => `to_char(${col} AT TIME ZONE ${TZ}, 'HH24:MI')`;

// técnico vê as próprias atividades + as sem responsável; gestor vê todas
function filtroTarefas(u, params) {
  if (u.role === 'gestor') return 'TRUE';
  params.push(u.id);
  return `(t.assignee_id = $${params.length} OR t.assignee_id IS NULL OR t.created_by = $${params.length})`;
}

const dataOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// ------------------------------- Agenda -------------------------------
router.get('/agenda', ah(async (req, res) => {
  const u = req.gbfUser;
  const hoje = (await query(`SELECT ${HOJE}::text AS d`)).rows[0].d;
  const de = dataOk(req.query.de) ? req.query.de : hoje;
  const ate = dataOk(req.query.ate) ? req.query.ate : de;

  const pT = [de, ate];
  const fT = filtroTarefas(u, pT);
  const [previstas, atrasadas, realizadas, tarefas, solic] = await Promise.all([
    query(`SELECT l.id, l.name, l.address, l.next_visit_date::text AS data, to_char(l.next_visit_time,'HH24:MI') AS hora, l.notes,
                  (SELECT v.id FROM gbf_visits v WHERE v.location_id = l.id AND v.status = 'em_andamento' LIMIT 1) AS visita_id
           FROM gbf_locations l WHERE l.active AND l.next_visit_date BETWEEN $1::date AND $2::date`, [de, ate]),
    query(`SELECT l.id, l.name, l.address, l.next_visit_date::text AS data, to_char(l.next_visit_time,'HH24:MI') AS hora, l.notes,
                  (SELECT v.id FROM gbf_visits v WHERE v.location_id = l.id AND v.status = 'em_andamento' LIMIT 1) AS visita_id
           FROM gbf_locations l WHERE l.active AND l.next_visit_date < ${HOJE} AND $1::date <= ${HOJE}
           ORDER BY l.next_visit_date`, [de]),
    query(`SELECT v.id, v.status, ${DIA('v.started_at')}::text AS data, ${HORA('v.started_at')} AS hora,
                  l.name AS location_name, l.id AS location_id, u.name AS user_name
           FROM gbf_visits v JOIN gbf_locations l ON l.id = v.location_id LEFT JOIN gbf_users u ON u.id = v.user_id
           WHERE v.status <> 'cancelada' AND ${DIA('v.started_at')} BETWEEN $1::date AND $2::date`, [de, ate]),
    query(`SELECT t.id, t.title, t.status, t.description, ${DIA('t.due_at')}::text AS data, ${HORA('t.due_at')} AS hora,
                  t.due_at < now() AS atrasada, l.name AS location_name, u.name AS assignee_name
           FROM gbf_tasks t LEFT JOIN gbf_locations l ON l.id = t.location_id LEFT JOIN gbf_users u ON u.id = t.assignee_id
           WHERE t.status <> 'cancelada' AND t.due_at IS NOT NULL
             AND ${DIA('t.due_at')} BETWEEN $1::date AND $2::date AND ${fT}`, pT),
    query(`SELECT r.id, r.title, r.status, r.desired_date::text AS data, l.name AS location_name
           FROM gbf_requests r LEFT JOIN gbf_locations l ON l.id = r.location_id
           WHERE r.status <> 'cancelada' AND r.desired_date BETWEEN $1::date AND $2::date`, [de, ate]),
  ]);

  const itens = [];
  const visita = (p, atrasada) => ({
    tipo: 'visita', id: p.id, titulo: `Visita — ${p.name}`, data: p.data, hora: p.hora,
    local: p.name, obs: p.address || p.notes, status: p.visita_id ? 'em_andamento' : (atrasada ? 'atrasada' : 'agendada'),
    link: p.visita_id ? `#/visitas/${p.visita_id}` : `#/postos/${p.id}`, posto_id: p.id, reagendar: 'posto',
  });
  previstas.rows.forEach((p) => itens.push(visita(p, p.data < hoje)));
  realizadas.rows.forEach((v) => itens.push({
    tipo: 'visita_realizada', id: v.id, titulo: `Visita — ${v.location_name}`, data: v.data, hora: v.hora,
    local: v.location_name, obs: v.user_name, status: v.status, link: `#/visitas/${v.id}`,
  }));
  tarefas.rows.forEach((t) => itens.push({
    tipo: 'atividade', id: t.id, titulo: t.title, data: t.data, hora: t.hora, local: t.location_name,
    obs: t.assignee_name, status: t.status === 'concluida' ? 'concluida' : (t.atrasada ? 'atrasada' : t.status),
    link: `#/atividades/${t.id}`, reagendar: 'atividade',
  }));
  solic.rows.forEach((r) => itens.push({
    tipo: 'solicitacao', id: r.id, titulo: r.title, data: r.data, hora: null, local: r.location_name,
    status: r.status === 'concluida' ? 'concluida' : (r.data < hoje ? 'atrasada' : r.status),
    link: `#/solicitacoes/${r.id}`, reagendar: 'solicitacao',
  }));
  itens.sort((a, b) => (a.data + (a.hora || '99:99')).localeCompare(b.data + (b.hora || '99:99')));
  res.json({ hoje, de, ate, itens, visitas_atrasadas: atrasadas.rows.map((p) => visita(p, true)) });
}));

// ------------------------------- Meu dia ------------------------------
router.get('/hoje', ah(async (req, res) => {
  const u = req.gbfUser;
  const pT = [];
  const fT = filtroTarefas(u, pT);
  const pV = u.role === 'gestor' ? [] : [u.id];
  const [visitas, andamento, proximas, ativHoje, ativAtrasadas, solic, feitas] = await Promise.all([
    query(`SELECT l.id, l.name, l.address, l.next_visit_date::text AS data, to_char(l.next_visit_time,'HH24:MI') AS hora,
                  l.next_visit_date < ${HOJE} AS atrasada, c.name AS checklist_name,
                  (SELECT v.id FROM gbf_visits v WHERE v.location_id = l.id AND v.status = 'em_andamento' LIMIT 1) AS visita_id
           FROM gbf_locations l LEFT JOIN gbf_checklists c ON c.id = l.checklist_id
           WHERE l.active AND l.next_visit_date <= ${HOJE}
           ORDER BY l.next_visit_date, l.next_visit_time NULLS LAST`),
    query(`SELECT v.id, v.started_at, l.name AS location_name, u.name AS user_name,
                  (SELECT count(*)::int FROM gbf_visit_answers a WHERE a.visit_id = v.id AND a.answer IS NULL) AS faltam
           FROM gbf_visits v JOIN gbf_locations l ON l.id = v.location_id LEFT JOIN gbf_users u ON u.id = v.user_id
           WHERE v.status = 'em_andamento' ${pV.length ? 'AND v.user_id = $1' : ''} ORDER BY v.started_at`, pV),
    query(`SELECT l.id, l.name, l.next_visit_date::text AS data, to_char(l.next_visit_time,'HH24:MI') AS hora
           FROM gbf_locations l WHERE l.active AND l.next_visit_date > ${HOJE}
           ORDER BY l.next_visit_date, l.next_visit_time NULLS LAST LIMIT 8`),
    query(`SELECT t.id, t.title, t.status, t.priority, t.due_at, l.name AS location_name, u.name AS assignee_name
           FROM gbf_tasks t LEFT JOIN gbf_locations l ON l.id = t.location_id LEFT JOIN gbf_users u ON u.id = t.assignee_id
           WHERE t.status NOT IN ('concluida','cancelada') AND ${DIA('t.due_at')} = ${HOJE} AND t.due_at >= now() AND ${fT}
           ORDER BY t.due_at`, pT),
    query(`SELECT t.id, t.title, t.status, t.priority, t.due_at, l.name AS location_name, u.name AS assignee_name
           FROM gbf_tasks t LEFT JOIN gbf_locations l ON l.id = t.location_id LEFT JOIN gbf_users u ON u.id = t.assignee_id
           WHERE t.status NOT IN ('concluida','cancelada') AND t.due_at < now() AND ${fT}
           ORDER BY t.due_at`, pT),
    query(`SELECT r.id, r.title, r.status, r.priority, r.desired_date::text AS desired_date, r.created_at,
                  l.name AS location_name, ur.name AS requested_by_name
           FROM gbf_requests r LEFT JOIN gbf_locations l ON l.id = r.location_id LEFT JOIN gbf_users ur ON ur.id = r.requested_by
           WHERE r.status IN ('a_fazer','em_andamento') ORDER BY (r.status = 'em_andamento'), r.priority DESC, r.created_at`),
    query(`SELECT
             (SELECT count(*)::int FROM gbf_visits WHERE status = 'concluida' AND ${DIA('finished_at')} = ${HOJE}) AS visitas,
             (SELECT count(*)::int FROM gbf_tasks WHERE status = 'concluida' AND ${DIA('completed_at')} = ${HOJE}) AS atividades,
             (SELECT count(*)::int FROM gbf_requests WHERE status = 'concluida' AND ${DIA('completed_at')} = ${HOJE}) AS solicitacoes`),
  ]);
  res.json({
    visitas_hoje: visitas.rows,
    em_andamento: andamento.rows,
    proximas_visitas: proximas.rows,
    atividades_hoje: ativHoje.rows,
    atividades_atrasadas: ativAtrasadas.rows,
    solicitacoes: solic.rows,
    concluidas_hoje: feitas.rows[0],
  });
}));

// ---------------------- Acompanhamento (gestor) -----------------------
router.get('/acompanhamento', requireGestorFn, ah(async (req, res) => {
  const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 7, 1), 90);
  const p = [dias];
  const desde = `now() - ($1::int * interval '1 day')`;
  const [visitas, tarefas, solic, naoOk, postosAtrasados, resumo] = await Promise.all([
    query(`SELECT v.id, v.finished_at AS quando, l.name AS local, u.name AS quem, v.notes, v.pending_notes,
                  (SELECT count(*)::int FROM gbf_visit_answers a WHERE a.visit_id = v.id AND a.answer = 'nao_ok') AS nao_ok,
                  (SELECT count(*)::int FROM gbf_visit_photos f WHERE f.visit_id = v.id) AS fotos
           FROM gbf_visits v JOIN gbf_locations l ON l.id = v.location_id LEFT JOIN gbf_users u ON u.id = v.user_id
           WHERE v.status = 'concluida' AND v.finished_at >= ${desde}`, p),
    query(`SELECT t.id, t.title, t.completed_at AS quando, u.name AS quem, l.name AS local,
                  (t.due_at IS NOT NULL AND t.completed_at > t.due_at) AS com_atraso
           FROM gbf_tasks t LEFT JOIN gbf_users u ON u.id = t.assignee_id LEFT JOIN gbf_locations l ON l.id = t.location_id
           WHERE t.status = 'concluida' AND t.completed_at >= ${desde}`, p),
    query(`SELECT r.id, r.title, r.status, r.created_at, r.completed_at, r.response, uh.name AS quem, l.name AS local
           FROM gbf_requests r LEFT JOIN gbf_users uh ON uh.id = r.handled_by LEFT JOIN gbf_locations l ON l.id = r.location_id
           WHERE r.status = 'concluida' AND r.completed_at >= ${desde}`, p),
    query(`SELECT a.item_label, a.note, v.id AS visit_id, v.finished_at, l.name AS local
           FROM gbf_visit_answers a JOIN gbf_visits v ON v.id = a.visit_id JOIN gbf_locations l ON l.id = v.location_id
           WHERE a.answer = 'nao_ok' AND v.status = 'concluida' AND v.finished_at >= ${desde}
           ORDER BY v.finished_at DESC LIMIT 50`, p),
    query(`SELECT id, name, next_visit_date::text AS data, (${HOJE} - next_visit_date)::int AS dias_atraso
           FROM gbf_locations WHERE active AND next_visit_date < ${HOJE} ORDER BY next_visit_date`),
    query(`SELECT
             (SELECT count(*)::int FROM gbf_visits WHERE status = 'concluida' AND finished_at >= ${desde}) AS visitas,
             (SELECT count(*)::int FROM gbf_tasks WHERE status = 'concluida' AND completed_at >= ${desde}) AS atividades,
             (SELECT count(*)::int FROM gbf_requests WHERE status = 'concluida' AND completed_at >= ${desde}) AS solicitacoes,
             (SELECT count(*)::int FROM gbf_requests WHERE status IN ('a_fazer','em_andamento')) AS solicitacoes_abertas,
             (SELECT count(*)::int FROM gbf_tasks WHERE status NOT IN ('concluida','cancelada') AND due_at < now()) AS atividades_atrasadas,
             (SELECT count(*)::int FROM gbf_locations WHERE active AND next_visit_date IS NULL) AS postos_sem_data,
             (SELECT avg(EXTRACT(EPOCH FROM (completed_at - created_at)))::int FROM gbf_requests
                WHERE status = 'concluida' AND completed_at >= ${desde}) AS tempo_medio_solicitacao`, p),
  ]);
  const feed = [
    ...visitas.rows.map((v) => ({
      tipo: 'visita', quando: v.quando, titulo: `Visita concluída — ${v.local}`, quem: v.quem,
      detalhe: [v.nao_ok ? `${v.nao_ok} item(ns) NÃO OK` : 'checklist todo OK', v.fotos ? `${v.fotos} foto(s)` : null,
        v.pending_notes ? `Pendências: ${v.pending_notes}` : null, v.notes].filter(Boolean).join(' · '),
      alerta: v.nao_ok > 0, link: `#/visitas/${v.id}`,
    })),
    ...tarefas.rows.map((t) => ({
      tipo: 'atividade', quando: t.quando, titulo: `Atividade concluída — ${t.title}`, quem: t.quem,
      detalhe: [t.local, t.com_atraso ? 'concluída com atraso' : null].filter(Boolean).join(' · '),
      alerta: t.com_atraso, link: `#/atividades/${t.id}`,
    })),
    ...solic.rows.map((r) => ({
      tipo: 'solicitacao', quando: r.completed_at, titulo: `Solicitação concluída — ${r.title}`, quem: r.quem,
      detalhe: [r.local, r.response].filter(Boolean).join(' · '), link: `#/solicitacoes/${r.id}`,
    })),
  ].sort((a, b) => new Date(b.quando) - new Date(a.quando));
  res.json({
    dias, resumo: resumo.rows[0], feed, nao_ok: naoOk.rows, postos_atrasados: postosAtrasados.rows,
  });
}));

module.exports = router;
