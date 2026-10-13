// Demandas da Orcim — SOMENTE LEITURA das tabelas da Central (tickets e afins).
// Os tempos são calculados a partir do histórico de status, nunca digitados.
const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { query } = require('../db');
const { queryCentral, centralExterna } = require('./fonte');
const {
  ah, STATUS_CENTRAL, PRIORIDADE_CENTRAL, escopoTickets,
} = require('./common');

const router = express.Router();

const existeNaCentral = async (nome) => !!(await queryCentral('SELECT to_regclass($1) AS t', [`public.${nome}`])).rows[0].t;

// resolvido_em = primeira entrada em Resolvido/Fechado depois da última reabertura
const DEMANDA_SELECT = `
  SELECT t.id, t.number, t.title, t.description, t.status, t.priority,
         t.created_at, t.updated_at, t.due_at, t.closed_at, t.approval_status,
         t.entity_id, e.name AS entity_name, c.name AS category_name,
         u_req.name AS requester_name, u_asg.name AS assigned_name, t.assigned_user_id,
         x.atribuido_em, x.inicio_em, r.primeira_resposta,
         CASE WHEN t.status IN (5,6)
              THEN COALESCE(rs.resolvido_hist, t.closed_at, t.updated_at) END AS resolvido_em
  FROM tickets t
  JOIN entities e ON e.id = t.entity_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN users u_req ON u_req.id = t.requester_id
  LEFT JOIN users u_asg ON u_asg.id = t.assigned_user_id
  LEFT JOIN LATERAL (
    SELECT min(h.created_at) FILTER (WHERE h.new_status = 2) AS atribuido_em,
           min(h.created_at) FILTER (WHERE h.new_status = 3) AS inicio_em,
           max(h.created_at) FILTER (WHERE h.new_status NOT IN (5,6,7)) AS ultimo_aberto
    FROM ticket_status_history h WHERE h.ticket_id = t.id) x ON TRUE
  LEFT JOIN LATERAL (
    SELECT min(h.created_at) AS resolvido_hist FROM ticket_status_history h
    WHERE h.ticket_id = t.id AND h.new_status IN (5,6)
      AND h.created_at >= COALESCE(x.ultimo_aberto, '-infinity'::timestamptz)) rs ON TRUE
  LEFT JOIN LATERAL (
    SELECT min(m.created_at) AS primeira_resposta
    FROM ticket_messages m JOIN users u ON u.id = m.user_id
    WHERE m.ticket_id = t.id AND u.role IN ('admin','technician') AND m.kind <> 'system') r ON TRUE`;

const ABERTO = 't.status NOT IN (5,6,7)';
const RISCO_HORAS = 4;

const seg = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000)) : null);

function enriquecer(d, agora = new Date()) {
  const aberto = ![5, 6, 7].includes(d.status);
  let sla = 'sem_prazo';
  if (d.due_at) {
    const due = new Date(d.due_at);
    if (aberto) {
      if (due < agora) sla = 'atrasado';
      else if (due - agora <= RISCO_HORAS * 3600e3) sla = 'em_risco';
      else sla = 'no_prazo';
    } else if (d.status !== 7) {
      sla = d.resolvido_em && new Date(d.resolvido_em) <= due ? 'cumprido' : 'estourado';
    }
  }
  return {
    ...d,
    aberto,
    status_label: STATUS_CENTRAL[d.status],
    priority_label: PRIORIDADE_CENTRAL[d.priority],
    sla,
    // tempos em segundos
    tempo_primeira_resposta: seg(d.created_at, d.primeira_resposta),
    tempo_ate_atendimento: seg(d.created_at, d.atribuido_em || d.inicio_em),
    tempo_resolucao: seg(d.created_at, d.resolvido_em),
    tempo_aberto: aberto ? seg(d.created_at, agora) : null,
  };
}

function media(arr) {
  const v = arr.filter((x) => x !== null && x !== undefined);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}
function mediana(arr) {
  const v = arr.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}
const diaISO = (d) => new Date(d).toISOString().slice(0, 10);

// ---------------------------------------------------------------------
// Resumo para a visão geral
// ---------------------------------------------------------------------
router.get('/resumo', ah(async (req, res) => {
  const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 30, 1), 365);
  const params = [];
  const escopo = await escopoTickets(params);
  params.push(dias);
  const { rows } = await queryCentral(
    `${DEMANDA_SELECT}
     WHERE ${escopo} AND (${ABERTO} OR t.updated_at >= now() - ($${params.length}::int * interval '1 day'))`,
    params);

  const agora = new Date();
  const inicio = new Date(agora.getTime() - dias * 86400e3);
  const lista = rows.map((d) => enriquecer(d, agora));
  const abertas = lista.filter((d) => d.aberto);
  const resolvidas = lista.filter((d) => d.resolvido_em && new Date(d.resolvido_em) >= inicio);
  const criadas = lista.filter((d) => new Date(d.created_at) >= inicio);
  const comPrazo = resolvidas.filter((d) => d.due_at);

  const agrupar = (arr, chave) => {
    const m = new Map();
    for (const d of arr) {
      const k = d[chave] || '—';
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].map(([nome, total]) => ({ nome, total })).sort((a, b) => b.total - a.total);
  };

  // Por técnico da Orcim: em aberto, resolvidas no período e tempo médio
  const tecnicos = new Map();
  for (const d of lista) {
    const k = d.assigned_name || 'Sem técnico';
    if (!tecnicos.has(k)) tecnicos.set(k, { nome: k, abertas: 0, atrasadas: 0, resolvidas: 0, tempos: [] });
    const t = tecnicos.get(k);
    if (d.aberto) { t.abertas += 1; if (d.sla === 'atrasado') t.atrasadas += 1; }
    if (d.resolvido_em && new Date(d.resolvido_em) >= inicio) { t.resolvidas += 1; t.tempos.push(d.tempo_resolucao); }
  }

  // Tendência diária: abertas x resolvidas
  const serie = [];
  const nDias = Math.min(dias, 60);
  for (let i = nDias - 1; i >= 0; i -= 1) {
    const dia = diaISO(agora.getTime() - i * 86400e3);
    serie.push({
      dia,
      abertas: lista.filter((d) => diaISO(d.created_at) === dia).length,
      resolvidas: lista.filter((d) => d.resolvido_em && diaISO(d.resolvido_em) === dia).length,
    });
  }

  res.json({
    periodo_dias: dias,
    kpis: {
      abertas: abertas.length,
      atrasadas: abertas.filter((d) => d.sla === 'atrasado').length,
      em_risco: abertas.filter((d) => d.sla === 'em_risco').length,
      sem_prazo: abertas.filter((d) => d.sla === 'sem_prazo').length,
      sem_tecnico: abertas.filter((d) => !d.assigned_user_id).length,
      aguardando_aprovacao: abertas.filter((d) => d.approval_status === 'pending').length,
      criadas_periodo: criadas.length,
      resolvidas_periodo: resolvidas.length,
      tempo_medio_resolucao: media(resolvidas.map((d) => d.tempo_resolucao)),
      tempo_mediano_resolucao: mediana(resolvidas.map((d) => d.tempo_resolucao)),
      tempo_medio_primeira_resposta: media(criadas.map((d) => d.tempo_primeira_resposta)),
      tempo_medio_ate_atendimento: media(criadas.map((d) => d.tempo_ate_atendimento)),
      sla_cumprido_pct: comPrazo.length
        ? Math.round((comPrazo.filter((d) => d.sla === 'cumprido').length / comPrazo.length) * 100)
        : null,
      sla_base: comPrazo.length,
    },
    por_status: agrupar(abertas, 'status_label'),
    por_empresa: agrupar(abertas, 'entity_name'),
    por_categoria: agrupar(criadas, 'category_name'),
    por_tecnico: [...tecnicos.values()]
      .map((t) => ({ ...t, tempo_medio: media(t.tempos), tempos: undefined }))
      .sort((a, b) => b.abertas - a.abertas || b.resolvidas - a.resolvidas),
    serie,
    mais_antigas: abertas.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).slice(0, 8)
      .map(({ description, ...d }) => d),
  });
}));

// ---------------------------------------------------------------------
// Lista com filtros
// ---------------------------------------------------------------------
router.get('/', ah(async (req, res) => {
  const { situacao, status, empresa, tecnico, prioridade, q, de, ate } = req.query;
  const params = [];
  const conds = [await escopoTickets(params)];
  const add = (sql, ...vals) => {
    let s = sql;
    for (const v of vals) { params.push(v); s = s.replace('?', `$${params.length}`); }
    conds.push(s);
  };
  if (situacao === 'abertas') conds.push(ABERTO);
  else if (situacao === 'atrasadas') conds.push(`${ABERTO} AND t.due_at < now()`);
  else if (situacao === 'em_risco') add(`${ABERTO} AND t.due_at BETWEEN now() AND now() + (? * interval '1 hour')`, RISCO_HORAS);
  else if (situacao === 'concluidas') conds.push('t.status IN (5,6)');
  else if (situacao === 'aprovacao') conds.push(`${ABERTO} AND t.approval_status = 'pending'`);
  else if (situacao === 'sem_tecnico') conds.push(`${ABERTO} AND t.assigned_user_id IS NULL`);
  if (status && /^\d$/.test(status)) add('t.status = ?', Number(status));
  if (empresa && /^\d+$/.test(empresa)) add('t.entity_id = ?', Number(empresa));
  if (tecnico === 'nenhum') conds.push('t.assigned_user_id IS NULL');
  else if (tecnico && /^\d+$/.test(tecnico)) add('t.assigned_user_id = ?', Number(tecnico));
  if (prioridade && /^\d$/.test(prioridade)) add('t.priority = ?', Number(prioridade));
  if (de && /^\d{4}-\d{2}-\d{2}$/.test(de)) add('t.created_at >= ?::date', de);
  if (ate && /^\d{4}-\d{2}-\d{2}$/.test(ate)) add(`t.created_at < ?::date + interval '1 day'`, ate);
  if (q) {
    const like = `%${String(q).slice(0, 100)}%`;
    add('(t.title ILIKE ? OR t.number ILIKE ? OR e.name ILIKE ?)', like, like, like);
  }
  const lim = Math.min(parseInt(req.query.limite, 10) || 300, 1000);
  const { rows } = await queryCentral(
    `${DEMANDA_SELECT} WHERE ${conds.join(' AND ')}
     ORDER BY (t.status IN (5,6,7)), t.due_at NULLS LAST, t.created_at DESC LIMIT ${lim}`, params);

  // tarefas nossas ligadas a cada demanda
  const ids = rows.map((r) => r.id);
  const vinc = ids.length
    ? (await query(
      `SELECT ticket_id, count(*)::int AS total,
              count(*) FILTER (WHERE status NOT IN ('concluida','cancelada'))::int AS abertas
       FROM gbf_tasks WHERE ticket_id = ANY($1::bigint[]) GROUP BY ticket_id`, [ids])).rows
    : [];
  const mapa = new Map(vinc.map((v) => [String(v.ticket_id), v]));
  const agora = new Date();
  res.json(rows.map(({ description, ...d }) => ({
    ...enriquecer(d, agora),
    atividades: mapa.get(String(d.id)) || null,
  })));
}));

// Filtros: empresas e técnicos da Central
router.get('/filtros', ah(async (req, res) => {
  const params = [];
  const escopo = await escopoTickets(params);
  const [empresas, tecnicos] = await Promise.all([
    queryCentral(`SELECT DISTINCT e.id, e.name FROM tickets t JOIN entities e ON e.id = t.entity_id
           WHERE ${escopo} ORDER BY e.name`, params),
    queryCentral(`SELECT id, name FROM users WHERE role IN ('admin','technician') AND active = TRUE ORDER BY name`),
  ]);
  res.json({ empresas: empresas.rows, tecnicos: tecnicos.rows });
}));

// ---------------------------------------------------------------------
// Manutenções programadas dos equipamentos (inventário da Central)
// ---------------------------------------------------------------------
router.get('/manutencoes', ah(async (req, res) => {
  if (!(await existeNaCentral('assets'))) return res.json({ disponivel: false, programadas: [], realizadas: [] });
  const params = [];
  const escopo = (await escopoTickets(params)).replace(/t\.entity_id/g, 'a.entity_id');
  const programadas = await queryCentral(
    `SELECT a.id, a.name, a.asset_tag, a.type, a.location, a.department, a.status,
            a.next_maintenance_date, a.next_maintenance_notes, e.name AS entity_name,
            (a.next_maintenance_date - CURRENT_DATE)::int AS dias
     FROM assets a JOIN entities e ON e.id = a.entity_id
     WHERE ${escopo} AND a.next_maintenance_date IS NOT NULL
       AND a.status NOT IN ('DISPOSED','LOST')
       AND a.next_maintenance_date <= CURRENT_DATE + 60
     ORDER BY a.next_maintenance_date ASC LIMIT 200`, params);
  let realizadas = { rows: [] };
  if (await existeNaCentral('asset_maintenances')) {
    realizadas = await queryCentral(
      `SELECT m.id, m.performed_at, m.description, a.name AS asset_name, a.asset_tag,
              e.name AS entity_name, u.name AS created_by_name
       FROM asset_maintenances m
       JOIN assets a ON a.id = m.asset_id
       JOIN entities e ON e.id = a.entity_id
       LEFT JOIN users u ON u.id = m.created_by
       WHERE ${escopo} AND m.performed_at >= CURRENT_DATE - 90
       ORDER BY m.performed_at DESC LIMIT 200`, params);
  }
  res.json({ disponivel: true, programadas: programadas.rows, realizadas: realizadas.rows });
}));

// ---------------------------------------------------------------------
// Detalhe com linha do tempo e tempo em cada etapa
// ---------------------------------------------------------------------
async function carregarDemanda(id) {
  const params = [id];
  const escopo = await escopoTickets(params);
  const { rows } = await queryCentral(`${DEMANDA_SELECT} WHERE t.id = $1 AND ${escopo}`, params);
  return rows[0] || null;
}

router.get('/:id', ah(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Demanda não encontrada.' });
  const d = await carregarDemanda(req.params.id);
  if (!d) return res.status(404).json({ error: 'Demanda não encontrada.' });

  const [hist, msgs, anexos, tarefas] = await Promise.all([
    queryCentral(`SELECT h.old_status, h.new_status, h.created_at, u.name AS user_name
           FROM ticket_status_history h LEFT JOIN users u ON u.id = h.user_id
           WHERE h.ticket_id = $1 ORDER BY h.created_at ASC, h.id ASC`, [d.id]),
    queryCentral(`SELECT m.kind, m.content, m.new_status, m.created_at, u.name AS author_name, u.role AS author_role
           FROM ticket_messages m JOIN users u ON u.id = m.user_id
           WHERE m.ticket_id = $1 ORDER BY m.created_at ASC, m.id ASC`, [d.id]),
    queryCentral(`SELECT id, file_name, mime_type, file_size, created_at FROM ticket_attachments
           WHERE ticket_id = $1 ORDER BY created_at ASC`, [d.id]),
    query(`SELECT t.id, t.title, t.status, t.due_at, u.name AS assignee_name
           FROM gbf_tasks t LEFT JOIN gbf_users u ON u.id = t.assignee_id
           WHERE t.ticket_id = $1 ORDER BY t.created_at DESC`, [d.id]),
  ]);

  // Tempo em cada status (do histórico)
  const agora = new Date();
  const etapas = {};
  const h = hist.rows;
  for (let i = 0; i < h.length; i += 1) {
    const ini = new Date(h[i].created_at);
    const fim = h[i + 1] ? new Date(h[i + 1].created_at) : ([6, 7].includes(h[i].new_status) ? ini : agora);
    const k = STATUS_CENTRAL[h[i].new_status] || String(h[i].new_status);
    etapas[k] = (etapas[k] || 0) + Math.max(0, Math.round((fim - ini) / 1000));
  }

  res.json({
    ...enriquecer(d, agora),
    historico: h.map((r) => ({
      ...r, old_label: STATUS_CENTRAL[r.old_status] || null, new_label: STATUS_CENTRAL[r.new_status],
    })),
    tempo_por_etapa: Object.entries(etapas).map(([etapa, segundos]) => ({ etapa, segundos })),
    mensagens: msgs.rows,
    anexos: anexos.rows,
    atividades: tarefas.rows,
  });
}));

// Download de anexo (verifica escopo do painel)
router.get('/:id/anexos/:anexoId', ah(async (req, res) => {
  if (!/^\d+$/.test(req.params.id) || !/^\d+$/.test(req.params.anexoId)) {
    return res.status(404).json({ error: 'Anexo não encontrado.' });
  }
  const d = await carregarDemanda(req.params.id);
  if (!d) return res.status(404).json({ error: 'Demanda não encontrada.' });
  const { rows } = await queryCentral(
    'SELECT * FROM ticket_attachments WHERE id = $1 AND ticket_id = $2', [req.params.anexoId, d.id]);
  if (!rows.length) return res.status(404).json({ error: 'Anexo não encontrado.' });
  const file = path.join(config.uploadsDir, 'tickets', String(d.id), path.basename(rows[0].storage_path));
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: centralExterna
      ? 'Este anexo fica guardado no servidor da Orcim. Abra pela Central deles.'
      : 'Arquivo não está no servidor.' });
  }
  res.type(rows[0].mime_type || 'application/octet-stream');
  const inline = req.query.inline === '1' && /^image\//.test(rows[0].mime_type || '');
  res.setHeader('Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(rows[0].file_name)}`);
  res.sendFile(path.resolve(file));
}));

module.exports = router;
module.exports.DEMANDA_SELECT = DEMANDA_SELECT;
