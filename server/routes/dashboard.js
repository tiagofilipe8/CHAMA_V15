const express = require('express');
const { query } = require('../db');
const { requireAuth, scopeConditions, isStaff, has, entityIdsOf } = require('../middleware/auth');

// Painel: quem tem a permissao "Ver o painel" (cada um ve so o seu escopo de empresas)
const canSeeDashboard = (u) => has(u, 'dashboard.view');
const notify = require('../services/notify');

const router = express.Router();
router.use(requireAuth);

// Resumo do painel: contadores + chamados em aberto ordenados por ultima atualizacao (apenas admin/técnico)
router.get('/', async (req, res) => {
  const user = req.user;
  if (!canSeeDashboard(user)) return res.status(403).json({ error: 'Painel disponível para a equipe, administradores e gestores.' });
  const scope = scopeConditions(user, 1);
  const params = [...scope.params];

  const q1 = await query(
    `SELECT
       count(*) FILTER (WHERE t.status NOT IN (6,7))::int  AS open_total,
       count(*) FILTER (WHERE t.status NOT IN (6,7)
                        AND t.created_at::date = CURRENT_DATE)::int AS open_today,
       count(*) FILTER (WHERE t.status = 5)::int  AS solved,
       count(*) FILTER (WHERE t.status = 4)::int  AS pending,
       count(*) FILTER (WHERE t.status = 3)::int  AS in_progress
     FROM tickets t WHERE 1=1 ${scope.sql ? 'AND ' + scope.sql : ''}`, params);

  const q2 = await query(
    `SELECT t.id, ('#' || t.id) AS number, t.title, t.status, t.priority,
            u_asg.name AS assigned_name, u_asg.id AS assigned_user_id,
            u_req.name AS requester_name, u_req.id AS requester_id,
            e.name AS entity_name, t.entity_id,
            t.updated_at, t.created_at, t.approval_status
     FROM tickets t
     JOIN entities e ON e.id = t.entity_id
     LEFT JOIN users u_asg ON u_asg.id = t.assigned_user_id
     LEFT JOIN users u_req ON u_req.id = t.requester_id
     WHERE t.status NOT IN (6,7) ${scope.sql ? 'AND ' + scope.sql : ''}
     ORDER BY t.updated_at DESC`,
    [...params]);

  res.json({
    counts: q1.rows[0],
    my_open: isStaff(user)
      ? q2.rows.filter((r) => r.assigned_user_id === user.id).length
      : q2.rows.length,
    tickets: q2.rows.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      status: r.status,
      status_label: notify.STATUS_LABELS[r.status],
      priority: r.priority,
      priority_label: notify.PRIORITY_LABELS[r.priority],
      assigned_name: r.assigned_name,
      assigned_user_id: r.assigned_user_id,
      requester_name: r.requester_name,
      requester_id: r.requester_id,
      entity_name: r.entity_name,
      entity_id: r.entity_id,
      updated_at: r.updated_at,
      created_at: r.created_at,
      approval_status: r.approval_status,
    })),
  });
});

// NOC Dashboard — métricas completas (apenas admin/técnico)
router.get('/noc', async (req, res) => {
  const user = req.user;
  if (!canSeeDashboard(user)) return res.status(403).json({ error: 'Painel NOC disponível para a equipe, administradores e gestores.' });
  const scope = scopeConditions(user, 1);
  const baseParams = [...scope.params];
  try {
    const qVolume = await query(
      `SELECT
        count(*) FILTER (WHERE t.status NOT IN (6,7))::int AS open_total,
        count(*) FILTER (WHERE t.status IN (6,7))::int AS closed_total,
        count(*) FILTER (WHERE t.status NOT IN (6,7) AND t.created_at::date = CURRENT_DATE)::int AS open_today,
        count(*) FILTER (WHERE t.status IN (6,7) AND t.updated_at::date = CURRENT_DATE)::int AS closed_today,
        count(*) FILTER (WHERE t.status NOT IN (6,7))::int AS backlog_total
       FROM tickets t WHERE 1=1 ${scope.sql ? 'AND ' + scope.sql : ''}`, baseParams);
    const qBacklogPrio = await query(
      `SELECT t.priority, count(*)::int AS total
       FROM tickets t WHERE t.status NOT IN (6,7) ${scope.sql ? 'AND ' + scope.sql : ''}
       GROUP BY t.priority ORDER BY t.priority DESC`, baseParams);
    const qDue = await query(
      `SELECT
        count(*) FILTER (WHERE t.status NOT IN (6,7) AND t.due_at IS NOT NULL AND t.due_at < now())::int AS overdue,
        count(*) FILTER (WHERE t.status NOT IN (6,7) AND t.due_at IS NOT NULL AND t.due_at BETWEEN now() AND now() + interval '1 hour')::int AS risk_1h,
        count(*) FILTER (WHERE t.status NOT IN (6,7) AND t.due_at IS NOT NULL AND t.due_at BETWEEN now() AND now() + interval '30 minutes')::int AS risk_30m,
        count(*) FILTER (WHERE t.status NOT IN (6,7) AND t.due_at IS NULL)::int AS without_sla
       FROM tickets t WHERE 1=1 ${scope.sql ? 'AND ' + scope.sql : ''}`, baseParams);
    const qCompliance = await query(
      `SELECT
        count(*) FILTER (WHERE t.status IN (5,6) AND t.due_at IS NOT NULL)::int AS with_sla,
        count(*) FILTER (WHERE t.status IN (5,6) AND t.due_at IS NOT NULL AND COALESCE(t.closed_at, t.updated_at) <= t.due_at)::int AS within_sla
       FROM tickets t WHERE 1=1 ${scope.sql ? 'AND ' + scope.sql : ''}`, baseParams);
    const qTma = await query(
      `SELECT avg(EXTRACT(EPOCH FROM (COALESCE(t.closed_at, t.updated_at) - t.created_at))/3600)::numeric(10,2) AS tma_hours,
              count(*)::int AS resolved_count
       FROM tickets t WHERE t.status IN (5,6) ${scope.sql ? 'AND ' + scope.sql : ''} AND t.updated_at >= now() - interval '30 days'`, baseParams);
    const qTmr = await query(
      `SELECT avg(EXTRACT(EPOCH FROM (sub.first_resp - sub.created_at))/3600)::numeric(10,2) AS tmr_hours
       FROM (
         SELECT t.id, t.created_at,
                (SELECT min(m.created_at) FROM ticket_messages m JOIN users u ON u.id=m.user_id WHERE m.ticket_id=t.id AND u.role IN ('admin','moderator','technician') AND m.kind='comment') AS first_resp
         FROM tickets t WHERE 1=1 ${scope.sql ? 'AND ' + scope.sql : ''} AND t.created_at >= now() - interval '30 days'
       ) sub WHERE sub.first_resp IS NOT NULL`, baseParams);
    const qRadar = await query(
      `SELECT t.id, ('#' || t.id) AS number, t.title, t.priority, t.status, t.due_at, e.name AS entity_name, u.name AS assigned_name,
              il.name AS impact_name, l.name AS location_name,
              EXTRACT(EPOCH FROM (t.due_at - now()))/60 AS minutes_left
       FROM tickets t
       JOIN entities e ON e.id=t.entity_id
       LEFT JOIN users u ON u.id=t.assigned_user_id
       LEFT JOIN impact_levels il ON il.id = t.impact_id
       LEFT JOIN locations l ON l.id = t.location_id
       WHERE t.status NOT IN (5,6,7) AND t.due_at IS NOT NULL AND t.due_at < now() + interval '24 hours'
         ${scope.sql ? 'AND ' + scope.sql : ''}
       ORDER BY t.due_at ASC LIMIT 40`, baseParams);
    const qByStatus = await query(
      `SELECT t.status, count(*)::int AS total FROM tickets t WHERE 1=1 ${scope.sql ? 'AND ' + scope.sql : ''} GROUP BY t.status ORDER BY t.status`, baseParams);
    const qByCategory = await query(
      `SELECT COALESCE(c.name,'Sem categoria') AS category, count(*)::int AS total
       FROM tickets t LEFT JOIN categories c ON c.id=t.category_id
       WHERE t.status NOT IN (6,7) ${scope.sql ? 'AND ' + scope.sql : ''}
       GROUP BY c.name ORDER BY total DESC LIMIT 10`, baseParams);
    const qByPriority = await query(
      `SELECT t.priority, count(*)::int AS total FROM tickets t WHERE t.status NOT IN (6,7) ${scope.sql ? 'AND ' + scope.sql : ''} GROUP BY t.priority`, baseParams);
    const qUnassigned = await query(
      `SELECT count(*)::int AS total FROM tickets t WHERE t.assigned_user_id IS NULL AND t.status NOT IN (6,7) ${scope.sql ? 'AND ' + scope.sql : ''}`, baseParams);
    // Workload por técnico
    let workload;
    if (!isStaff(user)) {
      const w2 = await query(
        `SELECT u.id, u.name, count(t.id)::int AS open_count
         FROM users u LEFT JOIN tickets t ON t.assigned_user_id=u.id AND t.status NOT IN (6,7)
                                         AND t.entity_id::text = ANY($1::text[])
         WHERE u.role='technician' AND u.active=true
         GROUP BY u.id ORDER BY open_count DESC`, [entityIdsOf(user)]);
      workload = w2.rows;
    } else {
      const w = await query(
        `SELECT u.id, u.name, count(t.id)::int AS open_count
         FROM users u LEFT JOIN tickets t ON t.assigned_user_id=u.id AND t.status NOT IN (6,7)
         WHERE u.role='technician' AND u.active=true
         GROUP BY u.id, u.name ORDER BY open_count DESC`, []);
      workload = w.rows;
    }
    const qProductivity = await query(
      `SELECT u.id, u.name, count(*)::int AS closed_today
       FROM tickets t JOIN users u ON u.id=t.assigned_user_id
       WHERE t.status IN (5,6) AND t.updated_at::date = CURRENT_DATE ${scope.sql ? 'AND ' + scope.sql : ''}
       GROUP BY u.id, u.name ORDER BY closed_today DESC`, baseParams);
    const qMaint = await query(
      `SELECT a.id, a.name, a.asset_tag, a.next_maintenance_date, a.next_maintenance_notes, e.name AS entity_name,
              (CURRENT_DATE - a.next_maintenance_date)::int AS days_overdue
       FROM assets a
       JOIN entities e ON e.id = a.entity_id
       WHERE a.next_maintenance_date IS NOT NULL
         AND a.next_maintenance_date <= CURRENT_DATE
         AND a.status NOT IN ('DISPOSED', 'LOST')
         AND ($1::text[] IS NULL OR a.entity_id::text = ANY($1::text[]))
       ORDER BY a.next_maintenance_date ASC
       LIMIT 20`, [entityIdsOf(user)]);
    const qMaintCount = await query(
      `SELECT count(*)::int AS c
       FROM assets a
       WHERE a.next_maintenance_date IS NOT NULL AND a.entity_id IS NOT NULL
         AND a.next_maintenance_date <= CURRENT_DATE
         AND a.status NOT IN ('DISPOSED', 'LOST')
         AND ($1::text[] IS NULL OR a.entity_id::text = ANY($1::text[]))`, [entityIdsOf(user)]);
    const qAnalystStatus = await query(
      `SELECT u.id, u.name, count(t.id) FILTER (WHERE t.status NOT IN (6,7))::int AS open_count, max(t.updated_at) AS last_activity
       FROM users u LEFT JOIN tickets t ON t.assigned_user_id=u.id AND t.status NOT IN (6,7)
       WHERE u.role='technician' AND u.active=true
       GROUP BY u.id ORDER BY open_count DESC`, []);
    // Equipe: quem atende (técnicos e Administrador Mestre com chamados), quantos chamados de cada
    // urgência tem em aberto, o que está atendendo agora e o mais urgente da fila dele.
    const qEquipe = await query(
      `SELECT u.id, u.name, u.role, u.working_since,
              count(t.id)::int AS total,
              count(t.id) FILTER (WHERE t.priority = 4)::int AS p4,
              count(t.id) FILTER (WHERE t.priority = 3)::int AS p3,
              count(t.id) FILTER (WHERE t.priority = 2)::int AS p2,
              count(t.id) FILTER (WHERE t.priority = 1)::int AS p1,
              count(t.id) FILTER (WHERE t.due_at IS NOT NULL AND t.due_at < now())::int AS atrasados,
              (SELECT json_build_object('id', w.id, 'number', '#' || w.id, 'title', w.title, 'priority', w.priority)
                 FROM tickets w WHERE w.id = u.working_ticket_id AND w.status NOT IN (5,6,7)) AS atendendo,
              (SELECT json_build_object('id', p.id, 'number', '#' || p.id, 'title', p.title, 'priority', p.priority)
                 FROM tickets p WHERE p.assigned_user_id = u.id AND p.status NOT IN (5,6,7)
                 ORDER BY p.priority DESC, p.needed_by NULLS LAST, p.created_at LIMIT 1) AS prioritario
       FROM users u
       LEFT JOIN tickets t ON t.assigned_user_id = u.id AND t.status NOT IN (5,6,7) ${scope.sql ? 'AND ' + scope.sql : ''}
       WHERE u.active AND (u.role = 'technician'
             OR (u.role = 'admin' AND EXISTS (SELECT 1 FROM tickets x WHERE x.assigned_user_id = u.id AND x.status NOT IN (5,6,7))))
       GROUP BY u.id
       ORDER BY (u.working_ticket_id IS NOT NULL) DESC, count(t.id) FILTER (WHERE t.priority = 4) DESC, count(t.id) DESC, u.name`,
      baseParams);
    // Chamados novos ainda sem técnico (com o que precisa para decidir quem pega)
    const qNovos = await query(
      `SELECT t.id, ('#' || t.id) AS number, t.title, t.priority, t.status, t.created_at, t.needed_by,
              il.name AS impact_name, l.name AS location_name, e.name AS entity_name, rq.name AS requester_name,
              COALESCE(sc.name, c.name) AS category_name
       FROM tickets t
       JOIN entities e ON e.id = t.entity_id
       LEFT JOIN impact_levels il ON il.id = t.impact_id
       LEFT JOIN locations l ON l.id = t.location_id
       LEFT JOIN users rq ON rq.id = t.requester_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN categories sc ON sc.id = t.simple_category_id
       WHERE t.assigned_user_id IS NULL AND t.status NOT IN (5,6,7) ${scope.sql ? 'AND ' + scope.sql : ''}
       ORDER BY t.priority DESC, t.created_at
       LIMIT 8`, baseParams);
    const volumes = qVolume.rows[0] || {};
    const due = qDue.rows[0] || {};
    const comp = qCompliance.rows[0] || {};
    const compliancePct = comp.with_sla ? Math.round((comp.within_sla / comp.with_sla) * 100) : 100;
    const openTotal = volumes.open_total || 0;
    const overdue = due.overdue || 0;
    const realtimeCompliance = openTotal ? Math.round(((openTotal - overdue) / openTotal) * 100) : 100;
    res.json({
      volume: { ...volumes, backlog_by_priority: qBacklogPrio.rows },
      sla: {
        overdue, risk_1h: due.risk_1h || 0, risk_30m: due.risk_30m || 0, without_sla: due.without_sla || 0,
        compliance: { with_sla: comp.with_sla || 0, within_sla: comp.within_sla || 0, pct: compliancePct },
        realtime_compliance: realtimeCompliance,
        tma_hours: Number(qTma.rows[0]?.tma_hours || 0),
        tmr_hours: Number(qTmr.rows[0]?.tmr_hours || 0),
        radar: qRadar.rows,
      },
      distribution: { by_status: qByStatus.rows, by_category: qByCategory.rows, by_priority: qByPriority.rows },
      team: { workload, productivity: qProductivity.rows, unassigned: qUnassigned.rows[0]?.total || 0, analyst_status: qAnalystStatus.rows },
      equipe: qEquipe.rows,
      novos_sem_tecnico: qNovos.rows,
      maintenance: { overdue_count: qMaintCount.rows[0]?.c || 0, items: qMaint.rows }
    });
  } catch (e) {
    console.error('[noc]', e);
    res.status(500).json({ error: 'Erro ao gerar métricas NOC', details: e.message });
  }
});

// ---------------------------------------------------------------------
// Causas e notas: por que abrem chamados (categorias), por que fecham (causa que o técnico
// escolhe ao resolver) e o score de cada local e de cada usuário (estrelas de 0 a 5 que o
// técnico dá ao encerrar). Só para quem pode ver a causa e a nota ("ticket.rating").
//   ?dias=30|90|365 (padrão 90; 0 = tudo) · ?entity_id=
// ---------------------------------------------------------------------
router.get('/causas', async (req, res) => {
  const user = req.user;
  if (!canSeeDashboard(user) || !has(user, 'ticket.rating')) {
    return res.status(403).json({ error: 'Seu perfil não vê as causas e as notas dos chamados.' });
  }
  const dias = [0, 30, 90, 365].includes(Number(req.query.dias)) ? Number(req.query.dias) : 90;
  const scope = scopeConditions(user, 1);
  const params = [...scope.params];
  const conds = [];
  if (scope.sql) conds.push(scope.sql);
  if (req.query.entity_id && /^\d+$/.test(req.query.entity_id)) {
    params.push(req.query.entity_id); conds.push(`t.entity_id = $${params.length}`);
  }
  // filtro por posto (localidade)
  if (req.query.location_id && /^\d+$/.test(req.query.location_id)) {
    params.push(req.query.location_id); conds.push(`t.location_id = $${params.length}`);
  }
  const base = conds.length ? `AND ${conds.join(' AND ')}` : '';
  // período: um mês (?mes=2026-11), um ano (?ano=2026) ou os últimos N dias (?dias=30)
  //   abertura: chamados abertos no período; fechamento e notas: resolvidos no período
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.mes || '')) ? req.query.mes : null;
  const ano = /^\d{4}$/.test(String(req.query.ano || '')) ? req.query.ano : null;
  const faixa = (col) => (mes ? `AND ${col} >= '${mes}-01'::date AND ${col} < ('${mes}-01'::date + interval '1 month')`
    : ano ? `AND ${col} >= '${ano}-01-01'::date AND ${col} < '${Number(ano) + 1}-01-01'::date`
      : dias ? `AND ${col} >= now() - interval '${dias} days'` : '');
  const periodoAbertura = faixa('t.created_at');
  const periodoFech = faixa('COALESCE(t.resolved_at, t.closed_at, t.updated_at)');

  // custos de material (só para quem vê preços): filtros próprios, sem a tabela de chamados
  const veCusto = has(user, 'inventory.secrets');
  const pMat = [];
  let fMov = ' AND m.to_entity_id IS NOT NULL'; let fAst = ' AND a.entity_id IS NOT NULL';
  const ents = entityIdsOf(user);
  if (ents !== null) { pMat.push(ents); fMov += ` AND m.to_entity_id::text = ANY($${pMat.length}::text[])`; fAst += ` AND a.entity_id::text = ANY($${pMat.length}::text[])`; }
  if (req.query.entity_id && /^\d+$/.test(req.query.entity_id)) { pMat.push(req.query.entity_id); fMov += ` AND m.to_entity_id = $${pMat.length}`; fAst += ` AND a.entity_id = $${pMat.length}`; }
  if (req.query.location_id && /^\d+$/.test(req.query.location_id)) { pMat.push(req.query.location_id); fMov += ` AND m.to_location_id = $${pMat.length}`; fAst += ` AND a.location_id = $${pMat.length}`; }
  const UN = "(CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END)";
  const vazio = Promise.resolve({ rows: [] });

  const [abertura, fechamento, locais, usuarios, peloUsuario, matAbertura, matFechamento, compras, retiradas, perdas] = await Promise.all([
    query(
      `SELECT COALESCE(sc.name, c.name, 'Sem categoria') AS nome, COALESCE(sc.icon, c.icon) AS icon,
              count(*)::int AS total, count(*) FILTER (WHERE t.status NOT IN (5,6,7))::int AS abertos
       FROM tickets t
       LEFT JOIN categories sc ON sc.id = t.simple_category_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.status <> 7 ${periodoAbertura} ${base}
       GROUP BY 1, 2 ORDER BY total DESC, nome`, params),
    query(
      `SELECT COALESCE(rc.name, 'Sem causa informada') AS nome, count(*)::int AS total
       FROM tickets t LEFT JOIN resolution_causes rc ON rc.id = t.resolution_cause_id
       WHERE t.status IN (5,6) ${periodoFech} ${base}
       GROUP BY 1 ORDER BY (min(rc.name) IS NULL), total DESC, nome`, params),
    // score por local: média das notas dos chamados daquele local + a causa que mais aparece
    query(
      `SELECT e.id AS entity_id, e.name AS entity_name, l.id AS location_id, COALESCE(l.name, 'Sem localização') AS location_name,
              round(avg(t.requester_rating)::numeric, 2) AS media,
              count(t.requester_rating)::int AS avaliados,
              count(*)::int AS chamados,
              -- checklist da nota: em quantos chamados cada item ficou "não"
              count(t.requester_rating_criteria)::int AS com_checklist,
              count(*) FILTER (WHERE (t.requester_rating_criteria->>'clara')::boolean IS FALSE)::int AS nao_clara,
              count(*) FILTER (WHERE (t.requester_rating_criteria->>'disponivel')::boolean IS FALSE)::int AS nao_disponivel,
              count(*) FILTER (WHERE (t.requester_rating_criteria->>'orientacoes')::boolean IS FALSE)::int AS nao_orientacoes,
              count(*) FILTER (WHERE (t.requester_rating_criteria->>'sem_mau_uso')::boolean IS FALSE)::int AS nao_sem_mau_uso,
              count(*) FILTER (WHERE (t.requester_rating_criteria->>'ajudou')::boolean IS FALSE)::int AS nao_ajudou,
              count(*) FILTER (WHERE t.closed_by_requester)::int AS fechados_usuario,
              (SELECT rc2.name FROM tickets t2 JOIN resolution_causes rc2 ON rc2.id = t2.resolution_cause_id
                WHERE t2.entity_id = e.id AND t2.location_id IS NOT DISTINCT FROM l.id AND t2.status IN (5,6)
                GROUP BY rc2.name ORDER BY count(*) DESC LIMIT 1) AS causa_principal
       FROM tickets t
       JOIN entities e ON e.id = t.entity_id
       LEFT JOIN locations l ON l.id = t.location_id
       WHERE t.status IN (5,6) ${periodoFech} ${base}
       GROUP BY e.id, e.name, l.id, l.name
       ORDER BY e.name, (count(t.requester_rating) = 0), avg(t.requester_rating) NULLS LAST, location_name`, params),
    // score individual: média das notas dadas ao solicitante
    query(
      `SELECT u.id, u.name, t.entity_id, t.location_id,
              round(avg(t.requester_rating)::numeric, 2) AS media, count(t.requester_rating)::int AS avaliados
       FROM tickets t JOIN users u ON u.id = t.requester_id
       WHERE t.status IN (5,6) AND t.requester_rating IS NOT NULL ${periodoFech} ${base}
       GROUP BY u.id, u.name, t.entity_id, t.location_id
       ORDER BY avg(t.requester_rating), u.name`, params),
    // encerrados pelo próprio usuário (resolvi sozinho, aberto por engano...)
    query(
      `SELECT t.requester_close_reason AS motivo, count(*)::int AS total
       FROM tickets t WHERE t.requester_close_reason IS NOT NULL AND t.status IN (5,6) ${periodoFech} ${base}
       GROUP BY 1 ORDER BY total DESC`, params),
    // causa de abertura × posto (a tela monta: total, por posto, por causa)
    query(
      `SELECT COALESCE(sc.name, c.name, 'Sem categoria') AS causa, COALESCE(sc.icon, c.icon) AS icon,
              COALESCE(pc.name, CASE WHEN t.simple_category_id IS NOT NULL THEN 'Pedidos simples' ELSE 'Outros' END) AS tipo,
              t.location_id, COALESCE(l.name, 'Sem posto') AS posto, e.name AS empresa,
              count(*)::int AS total, count(*) FILTER (WHERE t.status NOT IN (5,6,7))::int AS abertos
       FROM tickets t
       LEFT JOIN categories sc ON sc.id = t.simple_category_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN categories pc ON pc.id = COALESCE(sc.parent_id, c.parent_id)
       LEFT JOIN locations l ON l.id = t.location_id JOIN entities e ON e.id = t.entity_id
       WHERE t.status <> 7 ${periodoAbertura} ${base}
       GROUP BY 1, 2, 3, 4, 5, 6`, params),
    // causa de fechamento × posto
    query(
      `SELECT COALESCE(rc.name, 'Sem causa informada') AS causa, t.location_id, COALESCE(l.name, 'Sem posto') AS posto, e.name AS empresa,
              count(*)::int AS total
       FROM tickets t LEFT JOIN resolution_causes rc ON rc.id = t.resolution_cause_id
       LEFT JOIN locations l ON l.id = t.location_id JOIN entities e ON e.id = t.entity_id
       WHERE t.status IN (5,6) ${periodoFech} ${base}
       GROUP BY 1, 2, 3, 4`, params),
    // compras (pedidos de material com preço) por posto de destino
    veCusto ? query(
      `SELECT COALESCE(tm.location_id, t.location_id) AS location_id, sum(tm.price * tm.quantity)::float AS valor, sum(tm.quantity)::int AS n
       FROM ticket_materials tm JOIN tickets t ON t.id = tm.ticket_id
       WHERE tm.price IS NOT NULL AND tm.status IN ('comprado','transito','chegou','rota','entregue') ${faixa('COALESCE(tm.status_at, t.created_at)')} ${base}
       GROUP BY 1`, params) : vazio,
    // retiradas do estoque (o que cada posto consumiu)
    veCusto ? query(
      `SELECT m.to_location_id AS location_id, COALESCE(sum(m.price),0)::float AS valor, sum(m.quantity)::int AS n
       FROM stock_movements m WHERE m.kind = 'withdraw' ${faixa('m.created_at')} ${fMov} GROUP BY 1`, pMat) : vazio,
    // estragado ou perdido no período (o item virou Estragado/Extraviado)
    veCusto ? query(
      `SELECT a.location_id, COALESCE(sum(a.price * ${UN}),0)::float AS valor, count(*)::int AS n
       FROM assets a
       WHERE a.status IN ('BROKEN','LOST') ${fAst}
         AND EXISTS (SELECT 1 FROM asset_history h WHERE h.asset_id = a.id ${faixa('h.created_at')}
                     AND ((h.field = 'status' AND h.new_value IN ('BROKEN','LOST')) OR h.action = 'StockReplaced'))
       GROUP BY 1`, pMat) : vazio,
  ]);
  // custos de material por posto (junta compras, retiradas e perdas)
  let materiais = null;
  if (veCusto) {
    const porLocal = new Map();
    const ids = new Set([...compras.rows, ...retiradas.rows, ...perdas.rows].map((x) => x.location_id).filter(Boolean));
    const nomes = ids.size ? (await query('SELECT l.id, l.name, e.name AS empresa FROM locations l JOIN entities e ON e.id = l.entity_id WHERE l.id = ANY($1::bigint[])', [[...ids]])).rows : [];
    const linha = (id) => {
      const k = String(id || '');
      if (!porLocal.has(k)) {
        const n = nomes.find((x) => String(x.id) === k);
        porLocal.set(k, { location_id: id || null, posto: n ? n.name : 'Sem posto', empresa: n ? n.empresa : '', compras: 0, compras_n: 0, retiradas: 0, retiradas_n: 0, perdas: 0, perdas_n: 0 });
      }
      return porLocal.get(k);
    };
    compras.rows.forEach((x) => { const l = linha(x.location_id); l.compras += x.valor || 0; l.compras_n += x.n || 0; });
    retiradas.rows.forEach((x) => { const l = linha(x.location_id); l.retiradas += x.valor || 0; l.retiradas_n += x.n || 0; });
    perdas.rows.forEach((x) => { const l = linha(x.location_id); l.perdas += x.valor || 0; l.perdas_n += x.n || 0; });
    materiais = [...porLocal.values()];
  }

  // empresas: média geral (só chamados com nota)
  const empresas = new Map();
  locais.rows.forEach((l) => {
    const e = empresas.get(l.entity_id) || { entity_id: l.entity_id, entity_name: l.entity_name, soma: 0, avaliados: 0, chamados: 0 };
    e.soma += Number(l.media || 0) * l.avaliados; e.avaliados += l.avaliados; e.chamados += l.chamados;
    empresas.set(l.entity_id, e);
  });
  res.json({
    dias,
    abertura: abertura.rows,
    fechamento: fechamento.rows,
    empresas: [...empresas.values()].map((e) => ({
      entity_id: e.entity_id, entity_name: e.entity_name, avaliados: e.avaliados, chamados: e.chamados,
      media: e.avaliados ? Math.round((e.soma / e.avaliados) * 100) / 100 : null,
    })),
    locais: locais.rows.map((l) => ({ ...l, media: l.media === null ? null : Number(l.media) })),
    usuarios: usuarios.rows.map((u) => ({ ...u, media: Number(u.media) })),
    pelo_usuario: peloUsuario.rows,
    mat_abertura: matAbertura.rows,
    mat_fechamento: matFechamento.rows,
    materiais,
    criterios: require('../services/avaliacao').CRITERIOS,
  });
});

// ---------------------------------------------------------------------
// Score de urgência por local (e base da sugestão de rotas). Ver services/scoreUrgencia.js.
//   ?entity_id=  · só chamados em aberto, dentro do que a pessoa pode ver
// ---------------------------------------------------------------------
// Alerta do menu: quantos chamados de operação parada estão em aberto (o ícone do Score de urgência pega fogo)
router.get('/urgencia/alerta', async (req, res) => {
  const user = req.user;
  if (!canSeeDashboard(user)) return res.json({ parada: 0 });
  const scope = scopeConditions(user, 1);
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM tickets t
     WHERE t.priority = 4 AND t.status NOT IN (4,5,6,7) ${scope.sql ? `AND ${scope.sql}` : ''}`, scope.params);
  res.json({ parada: rows[0].n });
});

router.get('/urgencia', async (req, res) => {
  const user = req.user;
  if (!canSeeDashboard(user)) return res.status(403).json({ error: 'Seu perfil não vê o score de urgência.' });
  const { calcular, REGRAS, diaSP } = require('../services/scoreUrgencia');
  const scope = scopeConditions(user, 1);
  const params = [...scope.params];
  // em pausa (aguardando peça, fornecedor, usuário ou visita agendada) não entra: não há o que fazer agora
  const conds = ['t.status NOT IN (4,5,6,7)'];
  if (scope.sql) conds.push(scope.sql);
  if (req.query.entity_id && /^\d+$/.test(req.query.entity_id)) { params.push(req.query.entity_id); conds.push(`t.entity_id = $${params.length}`); }
  const pausados = (await query(
    `SELECT count(*)::int AS n FROM tickets t WHERE ${conds.join(' AND ').replace('t.status NOT IN (4,5,6,7)', 't.status = 4')}`, params)).rows[0].n;
  const { rows } = await query(
    `SELECT t.id, t.title, t.status, t.priority, t.needed_by, t.due_at, t.created_at, t.entity_id, t.location_id,
            e.name AS entity_name, l.name AS location_name, l.address, l.city, l.state, l.latitude, l.longitude,
            il.name AS impact_name, u.name AS assigned_name,
            COALESCE(sc.name, c.name) AS category_name,
            COALESCE((SELECT json_agg(json_build_object('id', m.id, 'name', m.name, 'unit', m.unit, 'quantity', m.quantity,
                                                         'status', m.status, 'destino', m.destino, 'previsao', m.previsao, 'origem_orcim', m.origem_orcim) ORDER BY m.id)
                      FROM ticket_materials m WHERE m.ticket_id = t.id), '[]') AS materiais
     FROM tickets t
     JOIN entities e ON e.id = t.entity_id
     LEFT JOIN locations l ON l.id = t.location_id
     LEFT JOIN impact_levels il ON il.id = t.impact_id
     LEFT JOIN users u ON u.id = t.assigned_user_id
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN categories sc ON sc.id = t.simple_category_id
     WHERE ${conds.join(' AND ')}`, params);
  const hoje = diaSP(new Date());
  const locais = new Map();
  for (const t of rows) {
    const k = `${t.entity_id}:${t.location_id || 'sem'}`;
    if (!locais.has(k)) {
      locais.set(k, {
        location_id: t.location_id, location_name: t.location_name || 'Sem localização', entity_id: t.entity_id, entity_name: t.entity_name,
        address: t.address, city: t.city, state: t.state,
        latitude: t.latitude === null ? null : Number(t.latitude), longitude: t.longitude === null ? null : Number(t.longitude),
        score: 0, chamados: [],
      });
    }
    const loc = locais.get(k);
    const calc = calcular(t, hoje);
    loc.score += calc.score;
    loc.chamados.push({
      id: t.id, number: `#${t.id}`, title: t.title, status: t.status, priority: t.priority, impact_name: t.impact_name,
      category_name: t.category_name, assigned_name: t.assigned_name, materiais: t.materiais, ...calc,
    });
  }
  const lista = [...locais.values()].map((l) => ({
    ...l,
    score: Math.round(l.score * 100) / 100,
    chamados: l.chamados.sort((a, b) => b.score - a.score),
    atrasados: l.chamados.filter((c) => c.dias_atraso > 0).length,
  })).sort((a, b) => b.score - a.score);
  res.json({ hoje, regras: REGRAS, locais: lista, pausados });
});

module.exports = router;