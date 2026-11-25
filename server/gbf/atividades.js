// Atividades do nosso técnico (tabelas gbf_* — nada na Central é alterado).
const express = require('express');
const { query } = require('../db');
const { queryCentral } = require('./fonte');
const {
  ah, STATUS_TAREFA, PRIORIDADE_TAREFA, STATUS_CENTRAL, notificar, usuariosAtivos, escopoTickets, prazoDe, textoPrazo, avisarEquipe, limparAvisosPrazo,
} = require('./common');

const router = express.Router();

const TASK_SELECT = `
  SELECT t.*, to_char(t.start_date, 'YYYY-MM-DD') AS inicio, ua.name AS assignee_name, uc.name AS created_by_name,
         gl.name AS location_name
  FROM gbf_tasks t
  LEFT JOIN gbf_users ua ON ua.id = t.assignee_id
  LEFT JOIN gbf_users uc ON uc.id = t.created_by
  LEFT JOIN gbf_locations gl ON gl.id = t.location_id`;

// Número, título e status da demanda ligada vêm da Central (que pode estar em outro banco)
async function comDemandas(lista) {
  const ids = [...new Set(lista.map((t) => t.ticket_id).filter(Boolean).map(String))];
  if (!ids.length) return lista;
  const { rows } = await queryCentral('SELECT id, number, title, status FROM tickets WHERE id = ANY($1::bigint[])', [ids]);
  const mapa = new Map(rows.map((r) => [String(r.id), r]));
  return lista.map((t) => {
    const d = t.ticket_id ? mapa.get(String(t.ticket_id)) : null;
    return { ...t, ticket_number: d?.number ?? null, ticket_title: d?.title ?? null, ticket_status: d?.status ?? null };
  });
}

const FECHADA = ['concluida', 'cancelada'];

function enriquecer(t, agora = new Date()) {
  const aberta = !FECHADA.includes(t.status);
  let prazo = 'sem_prazo';
  if (t.due_at) {
    const due = new Date(t.due_at);
    if (aberta) prazo = due < agora ? 'atrasada' : (due - agora <= 24 * 3600e3 ? 'vence_logo' : 'no_prazo');
    else if (t.status === 'concluida') prazo = t.completed_at && new Date(t.completed_at) <= due ? 'cumprido' : 'fora_do_prazo';
  }
  return {
    ...t,
    aberta,
    prazo,
    status_label: STATUS_TAREFA[t.status],
    priority_label: PRIORIDADE_TAREFA[t.priority],
    ticket_status_label: t.ticket_status ? STATUS_CENTRAL[t.ticket_status] : null,
    tempo_execucao: t.completed_at
      ? Math.round((new Date(t.completed_at) - new Date(t.started_at || t.created_at)) / 1000) : null,
  };
}

const podeVer = (u, t) => u.role === 'gestor' || t.assignee_id === u.id || t.created_by === u.id;

async function carregar(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await query(`${TASK_SELECT} WHERE t.id = $1`, [id]);
  return rows[0] ? (await comDemandas(rows))[0] : null;
}

async function evento(taskId, userId, content, kind = 'system') {
  await query('INSERT INTO gbf_task_events (task_id, user_id, kind, content) VALUES ($1,$2,$3,$4)',
    [taskId, userId, kind, content]);
}

async function validarTicket(ticketId) {
  if (ticketId === null || ticketId === undefined || ticketId === '') return { id: null };
  if (!/^\d+$/.test(String(ticketId))) return { erro: 'Demanda inválida.' };
  const params = [ticketId];
  const escopo = await escopoTickets(params);
  const { rows } = await queryCentral(`SELECT t.id FROM tickets t WHERE t.id = $1 AND ${escopo}`, params);
  return rows.length ? { id: rows[0].id } : { erro: 'Demanda da Orcim não encontrada.' };
}

async function validarResponsavel(id) {
  if (!id) return null;
  const { rows } = await query('SELECT id FROM gbf_users WHERE id = $1 AND active = TRUE', [id]);
  return rows.length ? rows[0].id : undefined;
}

// Lista
router.get('/', ah(async (req, res) => {
  const u = req.gbfUser;
  const { situacao, responsavel, q, demanda } = req.query;
  const params = [];
  const conds = ['TRUE'];
  const add = (sql, v) => { params.push(v); conds.push(sql.replace('?', `$${params.length}`)); };
  if (u.role !== 'gestor') add('(t.assignee_id = ? OR t.created_by = $1)', u.id);
  else if (responsavel === 'nenhum') conds.push('t.assignee_id IS NULL');
  else if (responsavel && /^\d+$/.test(responsavel)) add('t.assignee_id = ?', Number(responsavel));
  if (situacao === 'abertas') conds.push(`t.status NOT IN ('concluida','cancelada')`);
  else if (situacao === 'atrasadas') conds.push(`t.status NOT IN ('concluida','cancelada') AND t.due_at < now()`);
  else if (situacao === 'hoje') conds.push(`t.status NOT IN ('concluida','cancelada') AND t.due_at < date_trunc('day', now()) + interval '1 day'`);
  else if (situacao === 'concluidas') conds.push(`t.status = 'concluida'`);
  else if (situacao && STATUS_TAREFA[situacao]) add('t.status = ?', situacao);
  if (demanda && /^\d+$/.test(demanda)) add('t.ticket_id = ?', Number(demanda));
  if (req.query.posto && /^\d+$/.test(req.query.posto)) add('t.location_id = ?', Number(req.query.posto));
  if (q) add('(t.title ILIKE ? OR t.description ILIKE $' + (params.length + 1) + ')', `%${String(q).slice(0, 100)}%`);
  const { rows } = await query(
    `${TASK_SELECT} WHERE ${conds.join(' AND ')}
     ORDER BY (t.status IN ('concluida','cancelada')), t.due_at NULLS LAST, t.priority DESC, t.created_at DESC
     LIMIT 500`, params);
  const agora = new Date();
  res.json((await comDemandas(rows)).map((r) => enriquecer(r, agora)));
}));

// Resumo de produtividade (por responsável)
router.get('/resumo', ah(async (req, res) => {
  const u = req.gbfUser;
  const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 30, 1), 365);
  const params = [dias];
  let filtro = '';
  if (u.role !== 'gestor') { params.push(u.id); filtro = 'AND t.assignee_id = $2'; }
  const { rows } = await query(
    `SELECT COALESCE(u.name, 'Sem responsável') AS nome, t.assignee_id,
       count(*) FILTER (WHERE t.status NOT IN ('concluida','cancelada'))::int AS abertas,
       count(*) FILTER (WHERE t.status NOT IN ('concluida','cancelada') AND t.due_at < now())::int AS atrasadas,
       count(*) FILTER (WHERE t.status = 'concluida' AND t.completed_at >= now() - ($1::int * interval '1 day'))::int AS concluidas,
       count(*) FILTER (WHERE t.status = 'concluida' AND t.completed_at >= now() - ($1::int * interval '1 day')
                         AND t.due_at IS NOT NULL AND t.completed_at <= t.due_at)::int AS no_prazo,
       count(*) FILTER (WHERE t.status = 'concluida' AND t.completed_at >= now() - ($1::int * interval '1 day')
                         AND t.due_at IS NOT NULL)::int AS com_prazo,
       avg(EXTRACT(EPOCH FROM (t.completed_at - COALESCE(t.started_at, t.created_at))))
         FILTER (WHERE t.status = 'concluida' AND t.completed_at >= now() - ($1::int * interval '1 day'))::int AS tempo_medio
     FROM gbf_tasks t LEFT JOIN gbf_users u ON u.id = t.assignee_id
     WHERE TRUE ${filtro}
     GROUP BY u.name, t.assignee_id ORDER BY abertas DESC`, params);
  res.json({ periodo_dias: dias, responsaveis: rows });
}));

// Detalhe
router.get('/:id', ah(async (req, res) => {
  const t = await carregar(req.params.id);
  if (!t || !podeVer(req.gbfUser, t)) return res.status(404).json({ error: 'Atividade não encontrada.' });
  const ev = await query(
    `SELECT e.*, u.name AS user_name FROM gbf_task_events e LEFT JOIN gbf_users u ON u.id = e.user_id
     WHERE e.task_id = $1 ORDER BY e.created_at ASC, e.id ASC`, [t.id]);
  res.json({ ...enriquecer(t), eventos: ev.rows });
}));

// Criação
router.post('/', ah(async (req, res) => {
  const u = req.gbfUser;
  const b = req.body || {};
  const title = String(b.title || '').trim();
  if (!title) return res.status(422).json({ error: 'Informe o título da atividade.' });

  let assignee = u.id;
  if (u.role === 'gestor' && b.assignee_id !== undefined) {
    assignee = await validarResponsavel(b.assignee_id);
    if (assignee === undefined) return res.status(422).json({ error: 'Responsável inválido.' });
  }
  const tk = await validarTicket(b.ticket_id);
  if (tk.erro) return res.status(422).json({ error: tk.erro });

  // Pendência de visita (item NÃO OK): a atividade fica ligada à visita
  let visitId = null;
  if (/^\d+$/.test(String(b.visit_id || ''))) {
    const v = await query('SELECT id FROM gbf_visits WHERE id = $1', [b.visit_id]);
    if (!v.rows.length) return res.status(422).json({ error: 'Visita não encontrada.' });
    visitId = v.rows[0].id;
  }

  // prazo: data + horário opcional (sem horário = o dia todo); due_at direto continua aceito
  const pz = prazoDe(b);
  if (pz && pz.erro) return res.status(422).json({ error: pz.erro });
  const dueAt = pz ? pz.due_at : (b.due_at || null);
  const allDay = pz ? pz.all_day : false;
  const ini = dataInicio(b.start_date);
  if (ini === false) return res.status(422).json({ error: 'Data de início inválida.' });

  const { rows } = await query(
    `INSERT INTO gbf_tasks (title, description, priority, assignee_id, created_by, ticket_id, location, due_at, location_id, visit_id, all_day, start_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [
      title.slice(0, 200), String(b.description || '').trim() || null,
      Math.min(Math.max(parseInt(b.priority, 10) || 1, 1), 4),
      assignee, u.id, tk.id, String(b.location || '').trim() || null, dueAt,
      /^\d+$/.test(String(b.location_id || '')) ? Number(b.location_id) : null,
      visitId, allDay, ini || null,
    ]);
  const id = rows[0].id;
  await evento(id, u.id, `${u.name} criou a atividade.`);
  if (assignee && assignee !== u.id) {
    await notificar([assignee], {
      kind: 'atividade', title: `Nova atividade para você: ${title}`,
      message: dueAt ? `Prazo: ${textoPrazo(dueAt, allDay)}` : null,
      link: `#/atividades/${id}`,
    });
  }
  await avisarEquipe(u, {
    kind: 'atividade', title: `${u.name} criou a atividade: ${title}`,
    message: [dueAt ? `Prazo: ${textoPrazo(dueAt, allDay)}` : null, ini ? `começa ${ini.split('-').reverse().join('/')}` : null].filter(Boolean).join(' · ') || null,
    link: `#/atividades/${id}`,
  }, { excluir: [assignee] });
  res.status(201).json(enriquecer(await carregar(id)));
}));

// Data de início (atividade de vários dias): '' = sem início; false = inválida
function dataInicio(v) {
  if (v === undefined || v === null || v === '') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : false;
}

// Alteração (campos e status)
router.patch('/:id', ah(async (req, res) => {
  const u = req.gbfUser;
  const t = await carregar(req.params.id);
  if (!t || !podeVer(u, t)) return res.status(404).json({ error: 'Atividade não encontrada.' });
  const b = req.body || {};
  const sets = [];
  const params = [t.id];
  const set = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  const mudancas = [];

  if (b.title !== undefined) {
    const title = String(b.title).trim();
    if (!title) return res.status(422).json({ error: 'O título não pode ficar vazio.' });
    set('title', title.slice(0, 200));
  }
  if (b.description !== undefined) set('description', String(b.description).trim() || null);
  if (b.location !== undefined) set('location', String(b.location).trim() || null);
  if (b.location_id !== undefined) set('location_id', /^\d+$/.test(String(b.location_id || '')) ? Number(b.location_id) : null);
  if (b.priority !== undefined) set('priority', Math.min(Math.max(parseInt(b.priority, 10) || 2, 1), 4));
  if (b.start_date !== undefined) {
    const ini = dataInicio(b.start_date);
    if (ini === false) return res.status(422).json({ error: 'Data de início inválida.' });
    const antes = t.start_date ? new Date(t.start_date).toISOString().slice(0, 10) : null;
    if ((ini || null) !== (t.inicio || antes)) {
      set('start_date', ini || null);
      mudancas.push(ini ? `início em ${ini.split('-').reverse().join('/')}` : 'tirou a data de início');
    }
  }
  const pz = prazoDe(b);
  if (pz && pz.erro) return res.status(422).json({ error: pz.erro });
  if (pz || b.due_at !== undefined) {
    const dueAt = pz ? pz.due_at : (b.due_at || null);
    const allDay = pz ? pz.all_day : false;
    set('due_at', dueAt);
    set('all_day', allDay);
    set('due_soon_notified', false);
    set('overdue_notified', false);
    mudancas.push(dueAt ? `prazo para ${textoPrazo(dueAt, allDay)}` : 'removeu o prazo');
  }
  if (b.ticket_id !== undefined) {
    const tk = await validarTicket(b.ticket_id);
    if (tk.erro) return res.status(422).json({ error: tk.erro });
    set('ticket_id', tk.id);
  }
  let novoResponsavel = null;
  if (b.assignee_id !== undefined && u.role === 'gestor') {
    const a = await validarResponsavel(b.assignee_id);
    if (a === undefined) return res.status(422).json({ error: 'Responsável inválido.' });
    if (a !== t.assignee_id) { set('assignee_id', a); novoResponsavel = a; mudancas.push('trocou o responsável'); }
  }
  if (b.status !== undefined && b.status !== t.status) {
    if (!STATUS_TAREFA[b.status]) return res.status(422).json({ error: 'Status inválido.' });
    set('status', b.status);
    // aguardando: guarda o quê; saindo de aguardando, limpa
    var aguardandoOque = b.status === 'aguardando' ? (String(b.aguardando || '').trim().slice(0, 200) || null) : null;
    if (b.status === 'aguardando' || t.status === 'aguardando') set('waiting_for', aguardandoOque);
    if (b.status === 'em_andamento' && !t.started_at) sets.push('started_at = now()');
    if (b.status === 'concluida') sets.push('completed_at = now()');
    else if (FECHADA.includes(t.status)) sets.push('completed_at = NULL');
    mudancas.push(`status: ${STATUS_TAREFA[t.status]} → ${STATUS_TAREFA[b.status]}${aguardandoOque ? ` (aguardando: ${aguardandoOque})` : ''}`);
  }
  if (!sets.length) return res.status(422).json({ error: 'Nada para alterar.' });
  sets.push('updated_at = now()');
  await query(`UPDATE gbf_tasks SET ${sets.join(', ')} WHERE id = $1`, params);
  if (sets.some((x) => /^due_at\b/.test(x)) || ['concluida', 'cancelada'].includes(b.status)) await limparAvisosPrazo(t.id);
  await evento(t.id, u.id, `${u.name} ${mudancas.length ? mudancas.join('; ') : 'editou a atividade'}.`);

  if (novoResponsavel && novoResponsavel !== u.id) {
    await notificar([novoResponsavel], {
      kind: 'atividade', title: `Atividade atribuída a você: ${t.title}`, link: `#/atividades/${t.id}`,
    });
  }
  if (mudancas.length) {
    const verbo = b.status === 'concluida' ? 'concluiu' : b.status === 'cancelada' ? 'cancelou' : 'alterou';
    await avisarEquipe(u, {
      kind: 'atividade', title: `${u.name} ${verbo}: ${t.title}`,
      message: mudancas.join(' · ').slice(0, 300), link: `#/atividades/${t.id}`,
    }, { extras: [t.assignee_id, t.created_by], excluir: [novoResponsavel] });
  }
  res.json(enriquecer(await carregar(t.id)));
}));

// Comentário
router.post('/:id/comentarios', ah(async (req, res) => {
  const u = req.gbfUser;
  const t = await carregar(req.params.id);
  if (!t || !podeVer(u, t)) return res.status(404).json({ error: 'Atividade não encontrada.' });
  const content = String(req.body?.content || '').trim();
  if (!content) return res.status(422).json({ error: 'Escreva o comentário.' });
  await evento(t.id, u.id, content.slice(0, 4000), 'comment');
  await query('UPDATE gbf_tasks SET updated_at = now() WHERE id = $1', [t.id]);
  const baixo = content.toLowerCase();
  const marcados = (await query('SELECT id, name FROM gbf_users WHERE active = TRUE')).rows
    .filter((x) => String(x.id) !== String(u.id) && baixo.includes(`@${String(x.name).toLowerCase()}`))
    .map((x) => x.id);
  await notificar(marcados, {
    kind: 'mencao', title: `${u.name} marcou você em: ${t.title}`,
    message: content.slice(0, 200), link: `#/atividades/${t.id}`,
  });
  await avisarEquipe(u, {
    kind: 'comentario', title: `${u.name} comentou em: ${t.title}`,
    message: content.slice(0, 200), link: `#/atividades/${t.id}`,
  }, { extras: [t.assignee_id, t.created_by], excluir: marcados });
  res.status(201).json({ ok: true });
}));

module.exports = router;
