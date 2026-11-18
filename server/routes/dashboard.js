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
    `SELECT t.id, t.number, t.title, t.status, t.priority,
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
      `SELECT t.id, t.number, t.title, t.priority, t.status, t.due_at, e.name AS entity_name, u.name AS assigned_name,
              EXTRACT(EPOCH FROM (t.due_at - now()))/60 AS minutes_left
       FROM tickets t
       JOIN entities e ON e.id=t.entity_id
       LEFT JOIN users u ON u.id=t.assigned_user_id
       WHERE t.status NOT IN (6,7) AND t.due_at IS NOT NULL ${scope.sql ? 'AND ' + scope.sql : ''}
       ORDER BY t.due_at ASC LIMIT 12`, baseParams);
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
       WHERE a.next_maintenance_date IS NOT NULL
         AND a.next_maintenance_date <= CURRENT_DATE
         AND a.status NOT IN ('DISPOSED', 'LOST')
         AND ($1::text[] IS NULL OR a.entity_id::text = ANY($1::text[]))`, [entityIdsOf(user)]);
    const qAnalystStatus = await query(
      `SELECT u.id, u.name, count(t.id) FILTER (WHERE t.status NOT IN (6,7))::int AS open_count, max(t.updated_at) AS last_activity
       FROM users u LEFT JOIN tickets t ON t.assigned_user_id=u.id AND t.status NOT IN (6,7)
       WHERE u.role='technician' AND u.active=true
       GROUP BY u.id ORDER BY open_count DESC`, []);
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
      maintenance: { overdue_count: qMaintCount.rows[0]?.c || 0, items: qMaint.rows }
    });
  } catch (e) {
    console.error('[noc]', e);
    res.status(500).json({ error: 'Erro ao gerar métricas NOC', details: e.message });
  }
});

module.exports = router;