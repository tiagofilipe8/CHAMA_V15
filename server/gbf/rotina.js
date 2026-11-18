// Agenda, "Meu dia" e acompanhamento do gestor (rotina do técnico).
const express = require('express');
const { query } = require('../db');
const { ah } = require('./common');
const { requireGestor: requireGestorFn } = require('./auth');
const sincronizar = () => require('./postos').sincronizarPostos().catch(() => {});

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
  await sincronizar();
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
  await sincronizar();
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
                  r.kind, r.visit_id, r.location_id, l.name AS location_name, ur.name AS requested_by_name,
                  (SELECT count(*)::int FROM gbf_request_items i WHERE i.request_id = r.id) AS tarefas,
                  (r.desired_date IS NOT NULL AND r.desired_date < ${HOJE}) AS atrasada
           FROM gbf_requests r LEFT JOIN gbf_locations l ON l.id = r.location_id LEFT JOIN gbf_users ur ON ur.id = r.requested_by
           WHERE r.status IN ('a_fazer','em_andamento')
           ORDER BY (r.status = 'em_andamento') DESC, r.desired_date NULLS LAST, r.priority DESC, r.created_at`),
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
// A tela responde, nesta ordem: o que precisa do gestor agora, como está o dia de hoje,
// como foi o período (comparado ao período anterior de mesmo tamanho) e como estão os postos.
const PERIODOS = {
  hoje: `date_trunc('day', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ}`,
  7: `now() - interval '7 days'`,
  30: `now() - interval '30 days'`,
  mes: `date_trunc('month', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ}`,
};
const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const quandoBR = (d, opts) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', ...opts });

async function resumoEntre(de, ate) {
  const NO = (col) => `${col} >= $1::timestamptz AND ${col} < $2::timestamptz`;
  const { rows } = await query(`SELECT
      (SELECT count(*)::int FROM gbf_visits WHERE status = 'concluida' AND ${NO('finished_at')}) AS visitas,
      (SELECT count(DISTINCT location_id)::int FROM gbf_visits WHERE status = 'concluida' AND ${NO('finished_at')}) AS postos_visitados,
      (SELECT count(*)::int FROM gbf_tasks WHERE status = 'concluida' AND ${NO('completed_at')}) AS atividades,
      (SELECT count(*)::int FROM gbf_tasks WHERE status = 'concluida' AND ${NO('completed_at')}
          AND due_at IS NOT NULL AND completed_at > due_at) AS atividades_com_atraso,
      (SELECT count(*)::int FROM gbf_requests WHERE status = 'concluida' AND ${NO('completed_at')}) AS solicitacoes,
      (SELECT avg(EXTRACT(EPOCH FROM (completed_at - created_at)))::int FROM gbf_requests
          WHERE status = 'concluida' AND ${NO('completed_at')}) AS tempo_medio_solicitacao,
      (SELECT count(*)::int FROM gbf_visit_answers a JOIN gbf_visits v ON v.id = a.visit_id
          WHERE a.answer = 'nao_ok' AND v.status = 'concluida' AND ${NO('v.finished_at')}) AS nao_ok,
      (SELECT count(*)::int FROM gbf_visit_answers a JOIN gbf_visits v ON v.id = a.visit_id
          WHERE a.answer = 'nao_ok' AND v.status = 'concluida' AND ${NO('v.finished_at')}
            AND EXISTS (SELECT 1 FROM gbf_tasks t WHERE t.visit_id = v.id)) AS nao_ok_com_atividade`, [de, ate]);
  return rows[0];
}

router.get('/acompanhamento', requireGestorFn, ah(async (req, res) => {
  await sincronizar();
  let periodo = String(req.query.periodo || '');
  if (!PERIODOS[periodo]) periodo = String(req.query.dias) === '30' ? '30' : '7';
  const lim = (await query(`SELECT ${PERIODOS[periodo]} AS ini, now() AS fim`)).rows[0];
  const ini = new Date(lim.ini);
  const fim = new Date(lim.fim);
  const iniAnt = new Date(ini.getTime() - (fim.getTime() - ini.getTime()));
  const desde = '$1::timestamptz';

  const [atual, anterior, visitas, tarefas, solic, postosAtrasados, naoOkSemAtividade, ativAtrasadas, ativHoje,
    solicParadas, postos, hojeConcluidas, hojeAndamento, hojePrevistas, hojeAtiv] = await Promise.all([
    resumoEntre(ini, fim),
    resumoEntre(iniAnt, ini),
    query(`SELECT v.id, v.finished_at AS quando, l.name AS local, u.name AS quem, v.pending_notes,
                  (SELECT count(*)::int FROM gbf_visit_answers a WHERE a.visit_id = v.id AND a.answer = 'nao_ok') AS nao_ok,
                  (SELECT count(*)::int FROM gbf_visit_photos f WHERE f.visit_id = v.id) AS fotos
           FROM gbf_visits v JOIN gbf_locations l ON l.id = v.location_id LEFT JOIN gbf_users u ON u.id = v.user_id
           WHERE v.status = 'concluida' AND v.finished_at >= ${desde}`, [ini]),
    query(`SELECT t.id, t.title, t.completed_at AS quando, u.name AS quem, l.name AS local,
                  (t.due_at IS NOT NULL AND t.completed_at > t.due_at) AS com_atraso
           FROM gbf_tasks t LEFT JOIN gbf_users u ON u.id = t.assignee_id LEFT JOIN gbf_locations l ON l.id = t.location_id
           WHERE t.status = 'concluida' AND t.completed_at >= ${desde}`, [ini]),
    query(`SELECT r.id, r.title, r.completed_at, r.response, uh.name AS quem, l.name AS local
           FROM gbf_requests r LEFT JOIN gbf_users uh ON uh.id = r.handled_by LEFT JOIN gbf_locations l ON l.id = r.location_id
           WHERE r.status = 'concluida' AND r.completed_at >= ${desde}`, [ini]),
    // ---- precisa de atenção (situação de agora, não depende do período)
    query(`SELECT l.id, l.name, l.next_visit_date::text AS data, to_char(l.next_visit_time,'HH24:MI') AS hora,
                  (${HOJE} - l.next_visit_date)::int AS dias_atraso
           FROM gbf_locations l WHERE l.active AND l.next_visit_date < ${HOJE}
             AND NOT EXISTS (SELECT 1 FROM gbf_visits v WHERE v.location_id = l.id AND v.status = 'em_andamento')`),
    query(`SELECT v.id, v.finished_at, l.id AS location_id, l.name AS local, u.name AS quem,
                  (${HOJE} - ${DIA('v.finished_at')})::int AS dias,
                  array_agg(a.item_label ORDER BY a.position) AS itens
           FROM gbf_visits v JOIN gbf_locations l ON l.id = v.location_id LEFT JOIN gbf_users u ON u.id = v.user_id
           JOIN gbf_visit_answers a ON a.visit_id = v.id AND a.answer = 'nao_ok'
           WHERE v.status = 'concluida' AND v.finished_at >= now() - interval '30 days'
             AND NOT EXISTS (SELECT 1 FROM gbf_tasks t WHERE t.visit_id = v.id)
             AND NOT EXISTS (SELECT 1 FROM gbf_visits v2 WHERE v2.location_id = v.location_id
                               AND v2.status = 'concluida' AND v2.finished_at > v.finished_at)
           GROUP BY v.id, l.id, l.name, u.name`),
    query(`SELECT t.id, t.title, t.due_at, ${DIA('t.due_at')}::text AS data, ${HORA('t.due_at')} AS hora,
                  EXTRACT(EPOCH FROM (now() - t.due_at))::int AS atraso_s, u.name AS responsavel, l.name AS local
           FROM gbf_tasks t LEFT JOIN gbf_users u ON u.id = t.assignee_id LEFT JOIN gbf_locations l ON l.id = t.location_id
           WHERE t.status NOT IN ('concluida','cancelada') AND t.due_at < now()`),
    query(`SELECT t.id, t.title, ${HORA('t.due_at')} AS hora, u.name AS responsavel, l.name AS local
           FROM gbf_tasks t LEFT JOIN gbf_users u ON u.id = t.assignee_id LEFT JOIN gbf_locations l ON l.id = t.location_id
           WHERE t.status NOT IN ('concluida','cancelada') AND t.due_at >= now() AND ${DIA('t.due_at')} = ${HOJE}`),
    query(`SELECT r.id, r.title, r.desired_date::text AS data, ur.name AS pedido_por, l.name AS local,
                  (${HOJE} - ${DIA('r.created_at')})::int AS dias,
                  (r.desired_date IS NOT NULL AND r.desired_date < ${HOJE}) AS passou_data
           FROM gbf_requests r LEFT JOIN gbf_users ur ON ur.id = r.requested_by LEFT JOIN gbf_locations l ON l.id = r.location_id
           WHERE (r.status = 'a_fazer' AND r.created_at < now() - interval '2 days')
              OR (r.status IN ('a_fazer','em_andamento') AND r.desired_date < ${HOJE})`),
    // ---- postos
    query(`SELECT l.id, l.name, l.next_visit_date::text AS data, to_char(l.next_visit_time,'HH24:MI') AS hora,
                  (${HOJE} - l.next_visit_date)::int AS dias_atraso,
                  EXISTS (SELECT 1 FROM gbf_visits v WHERE v.location_id = l.id AND v.status = 'em_andamento') AS em_andamento,
                  (SELECT count(*)::int FROM gbf_visit_answers a
                     WHERE a.answer = 'nao_ok'
                       AND a.visit_id = (SELECT v3.id FROM gbf_visits v3 WHERE v3.location_id = l.id
                                          AND v3.status = 'concluida' ORDER BY v3.finished_at DESC LIMIT 1)
                       AND NOT EXISTS (SELECT 1 FROM gbf_tasks t WHERE t.visit_id = a.visit_id)) AS nao_ok_pendente
           FROM gbf_locations l WHERE l.active`),
    // ---- hoje
    query(`SELECT v.id, ${HORA('v.finished_at')} AS hora, l.name AS local, u.name AS quem,
                  (SELECT count(*)::int FROM gbf_visit_answers a WHERE a.visit_id = v.id AND a.answer = 'nao_ok') AS nao_ok
           FROM gbf_visits v JOIN gbf_locations l ON l.id = v.location_id LEFT JOIN gbf_users u ON u.id = v.user_id
           WHERE v.status = 'concluida' AND ${DIA('v.finished_at')} = ${HOJE} ORDER BY v.finished_at`),
    query(`SELECT v.id, ${HORA('v.started_at')} AS hora, l.name AS local, u.name AS quem,
                  (SELECT count(*)::int FROM gbf_visit_answers a WHERE a.visit_id = v.id) AS itens,
                  (SELECT count(*)::int FROM gbf_visit_answers a WHERE a.visit_id = v.id AND a.answer IS NOT NULL) AS feitos
           FROM gbf_visits v JOIN gbf_locations l ON l.id = v.location_id LEFT JOIN gbf_users u ON u.id = v.user_id
           WHERE v.status = 'em_andamento' ORDER BY v.started_at`),
    query(`SELECT l.id, l.name AS local, to_char(l.next_visit_time,'HH24:MI') AS hora
           FROM gbf_locations l WHERE l.active AND l.next_visit_date = ${HOJE}
             AND NOT EXISTS (SELECT 1 FROM gbf_visits v WHERE v.location_id = l.id AND v.status = 'em_andamento')
           ORDER BY l.next_visit_time NULLS LAST, l.name`),
    query(`SELECT count(*)::int AS n FROM gbf_tasks WHERE status <> 'cancelada' AND ${DIA('due_at')} = ${HOJE}`),
  ]);

  // ---- lista única "Precisa de você", da mais grave para a menos grave
  const atencao = [];
  postosAtrasados.rows.forEach((p) => atencao.push({
    nivel: 'alto', rotulo: 'Visita atrasada', peso: p.dias_atraso,
    titulo: `${p.name} sem visita há ${p.dias_atraso} dia(s)`, detalhe: `Estava prevista para ${dataBR(p.data)}`,
    link: `#/postos/${p.id}`, acao: { texto: 'Reagendar', reagendar: { tipo: 'posto', id: p.id, data: p.data, hora: p.hora } },
  }));
  naoOkSemAtividade.rows.forEach((v) => atencao.push({
    nivel: 'alto', rotulo: 'NÃO OK', peso: v.dias,
    titulo: `${v.itens.slice(0, 2).join(', ')}${v.itens.length > 2 ? ` e mais ${v.itens.length - 2}` : ''} — ${v.local}`,
    detalhe: [`Visita de ${quandoBR(v.finished_at, { day: '2-digit', month: '2-digit' })}`, v.quem, 'sem atividade ligada'].filter(Boolean).join(' · '),
    link: `#/visitas/${v.id}`,
    acao: { texto: 'Criar atividade', href: `#/atividades/nova?posto=${v.location_id}&visita=${v.id}&titulo=${encodeURIComponent(`Resolver: ${v.itens[0]} (${v.local})`)}` },
  }));
  ativAtrasadas.rows.forEach((t) => atencao.push({
    nivel: 'alto', rotulo: 'Atividade atrasada', peso: Math.floor(t.atraso_s / 86400),
    titulo: t.title,
    detalhe: [`Venceu ${quandoBR(t.due_at, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
      t.responsavel || 'sem responsável', t.local].filter(Boolean).join(' · '),
    link: `#/atividades/${t.id}`, acao: { texto: 'Reagendar', reagendar: { tipo: 'atividade', id: t.id, data: t.data, hora: t.hora } },
  }));
  solicParadas.rows.forEach((r) => atencao.push({
    nivel: 'medio', rotulo: r.passou_data ? 'Passou da data' : 'Solicitação parada', peso: r.dias,
    titulo: r.title,
    detalhe: [r.passou_data ? `Desejada para ${dataBR(r.data)}` : `Aberta há ${r.dias} dia(s) e ninguém assumiu`,
      r.pedido_por ? `pedido por ${r.pedido_por}` : null, r.local].filter(Boolean).join(' · '),
    link: `#/solicitacoes/${r.id}`, acao: { texto: 'Abrir', href: `#/solicitacoes/${r.id}` },
  }));
  ativHoje.rows.forEach((t) => atencao.push({
    nivel: 'medio', rotulo: 'Vence hoje', peso: 0,
    titulo: t.title, detalhe: [`Até ${t.hora}`, t.responsavel || 'sem responsável', t.local].filter(Boolean).join(' · '),
    link: `#/atividades/${t.id}`, acao: { texto: 'Abrir', href: `#/atividades/${t.id}` },
  }));
  const ordemNivel = { alto: 0, medio: 1 };
  atencao.sort((a, b) => ordemNivel[a.nivel] - ordemNivel[b.nivel] || b.peso - a.peso);

  // ---- situação de cada posto
  const listaPostos = postos.rows.map((p) => {
    const faltam = p.data ? -p.dias_atraso : null;
    let situacao = 'ok';
    let motivo = p.data ? `próxima ${dataBR(p.data).slice(0, 5)}${p.hora ? ` ${p.hora}` : ''}` : 'sem próxima visita';
    if (p.em_andamento) { situacao = 'andamento'; motivo = 'visita em andamento'; } else if (faltam !== null && faltam < 0) {
      situacao = 'atrasado'; motivo = `${p.dias_atraso} dia(s) de atraso`;
    } else if (p.nao_ok_pendente) {
      situacao = 'atencao'; motivo = `${p.nao_ok_pendente} item(ns) NÃO OK`;
    } else if (faltam === 0) {
      motivo = `hoje${p.hora ? ` ${p.hora}` : ''}`;
    } else if (faltam === 1) {
      motivo = `amanhã${p.hora ? ` ${p.hora}` : ''}`;
    } else if (!p.data) situacao = 'sem_data';
    return { id: p.id, nome: p.name, situacao, motivo, atraso: p.data ? p.dias_atraso : null, data: p.data };
  });
  const ordemPosto = { atrasado: 0, atencao: 1, andamento: 2, ok: 3, sem_data: 4 };
  listaPostos.sort((a, b) => ordemPosto[a.situacao] - ordemPosto[b.situacao]
    || (b.atraso || 0) - (a.atraso || 0) || String(a.data || '9').localeCompare(String(b.data || '9')));

  // ---- o que foi feito no período
  const feed = [
    ...visitas.rows.map((v) => ({
      tipo: 'visita', quando: v.quando, titulo: `Visita ${v.local}`, quem: v.quem,
      detalhe: [v.nao_ok ? `${v.nao_ok} item(ns) NÃO OK` : 'tudo OK', v.fotos ? `${v.fotos} foto(s)` : null,
        v.pending_notes ? `Pendências: ${v.pending_notes}` : null].filter(Boolean).join(' · '),
      alerta: v.nao_ok > 0, link: `#/visitas/${v.id}`,
    })),
    ...tarefas.rows.map((t) => ({
      tipo: 'atividade', quando: t.quando, titulo: t.title, quem: t.quem,
      detalhe: [t.local, t.com_atraso ? 'concluída com atraso' : null].filter(Boolean).join(' · '),
      alerta: t.com_atraso, link: `#/atividades/${t.id}`,
    })),
    ...solic.rows.map((r) => ({
      tipo: 'solicitacao', quando: r.completed_at, titulo: r.title, quem: r.quem,
      detalhe: [r.local, r.response].filter(Boolean).join(' · '), link: `#/solicitacoes/${r.id}`,
    })),
  ].sort((a, b) => new Date(b.quando) - new Date(a.quando));

  // Série para o gráfico de linha: por hora (Hoje) ou por dia (7 dias, 30 dias, Mês)
  const porHora = periodo === 'hoje';
  const chaveSP = (d) => {
    const x = new Date(d);
    const dia = x.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    if (!porHora) return dia;
    return `${dia}T${x.toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).slice(0, 2)}`;
  };
  const baldes = [];
  if (porHora) {
    const dia = new Date(fim).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    for (let h = 0; h < 24; h += 1) baldes.push(`${dia}T${String(h).padStart(2, '0')}`);
  } else {
    const ultimo = chaveSP(fim);
    for (let d = chaveSP(ini); d <= ultimo;) {
      baldes.push(d);
      d = new Date(Date.parse(`${d}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10);
    }
  }
  const serie = new Map(baldes.map((b) => [b, { periodo: b, visitas: 0, nao_ok: 0, atividades: 0 }]));
  visitas.rows.forEach((v) => { const s = serie.get(chaveSP(v.quando)); if (s) { s.visitas += 1; s.nao_ok += v.nao_ok; } });
  tarefas.rows.forEach((t) => { const s = serie.get(chaveSP(t.quando)); if (s) s.atividades += 1; });

  res.json({
    periodo, inicio: ini, fim,
    serie: [...serie.values()], escala: porHora ? 'hora' : 'dia',
    resumo: atual, anterior,
    atencao,
    hoje: {
      concluidas: hojeConcluidas.rows, em_andamento: hojeAndamento.rows, previstas: hojePrevistas.rows,
      atividades: hojeAtiv.rows[0].n,
    },
    postos: listaPostos,
    feed,
  });
}));

module.exports = router;
