// Avisos automáticos do Painel Beija-Flor (rodam a cada minuto).
// Lê a Central para detectar novidades; grava só em gbf_*.
const { query } = require('../db');
const {
  STATUS_CENTRAL, escopoTickets, notificar, usuariosAtivos,
} = require('./common');

const INTERVALO_MS = 60 * 1000;
let rodando = false;
let timer = null;

const fmt = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

async function verificarDemandas() {
  const params = [];
  const escopo = await escopoTickets(params);
  const { rows } = await query(
    `SELECT t.id, t.number, t.title, t.status, t.due_at, t.created_at, e.name AS entity_name,
            w.ticket_id AS visto, w.last_status, w.sla_notified
     FROM tickets t
     JOIN entities e ON e.id = t.entity_id
     LEFT JOIN gbf_ticket_watch w ON w.ticket_id = t.id
     WHERE ${escopo}
       AND (t.status NOT IN (6,7) OR t.updated_at > now() - interval '2 days' OR w.ticket_id IS NULL)`,
    params);
  if (!rows.length) return;

  // Primeira execução: só registra o estado atual, sem disparar avisos em massa
  const { rows: base } = await query('SELECT count(*)::int AS n FROM gbf_ticket_watch');
  const primeira = base[0].n === 0;
  const todos = primeira ? [] : await usuariosAtivos();

  for (const t of rows) {
    const atrasada = t.due_at && new Date(t.due_at) < new Date() && ![5, 6, 7].includes(t.status);
    if (!t.visto) {
      await query(
        `INSERT INTO gbf_ticket_watch (ticket_id, last_status, sla_notified) VALUES ($1, $2, $3)
         ON CONFLICT (ticket_id) DO NOTHING`, [t.id, t.status, primeira ? !!atrasada : false]);
      if (!primeira && new Date(t.created_at) > new Date(Date.now() - 86400e3)) {
        await notificar(todos, {
          kind: 'demanda_nova', title: `Nova demanda na Orcim: ${t.number || '#' + t.id}`,
          message: `${t.title} — ${t.entity_name}`, link: `#/demandas/${t.id}`,
        });
      }
      continue;
    }
    if (t.last_status !== t.status) {
      await query('UPDATE gbf_ticket_watch SET last_status = $2, updated_at = now() WHERE ticket_id = $1', [t.id, t.status]);
      // Mudança de status avisa quem tem atividade nossa ligada à demanda;
      // "Resolvido" avisa todos, porque é a hora de conferir o serviço.
      const ligados = (await query(
        `SELECT DISTINCT assignee_id FROM gbf_tasks
         WHERE ticket_id = $1 AND assignee_id IS NOT NULL AND status NOT IN ('concluida','cancelada')`,
        [t.id])).rows.map((r) => r.assignee_id);
      await notificar(t.status === 5 ? todos : ligados, {
        kind: 'demanda_status',
        title: `${t.number || '#' + t.id} agora está "${STATUS_CENTRAL[t.status]}"`,
        message: `${t.title} — ${t.entity_name}`, link: `#/demandas/${t.id}`,
      });
    }
    if (atrasada && !t.sla_notified) {
      await query('UPDATE gbf_ticket_watch SET sla_notified = TRUE WHERE ticket_id = $1', [t.id]);
      await notificar(todos, {
        kind: 'demanda_atrasada', title: `Prazo estourado: ${t.number || '#' + t.id}`,
        message: `${t.title} — venceu em ${fmt(t.due_at)}`, link: `#/demandas/${t.id}`,
      });
    }
  }
}

async function verificarAtividades() {
  // Vence nas próximas 24 h -> avisa o responsável
  const logo = await query(
    `UPDATE gbf_tasks SET due_soon_notified = TRUE
     WHERE status NOT IN ('concluida','cancelada') AND assignee_id IS NOT NULL
       AND due_soon_notified = FALSE AND due_at BETWEEN now() AND now() + interval '24 hours'
     RETURNING id, title, due_at, assignee_id`);
  for (const t of logo.rows) {
    await notificar([t.assignee_id], {
      kind: 'atividade_prazo', title: `Vence em breve: ${t.title}`,
      message: `Prazo: ${fmt(t.due_at)}`, link: `#/atividades/${t.id}`,
    });
  }
  // Atrasou -> avisa o responsável e os gestores
  const atrasadas = await query(
    `UPDATE gbf_tasks SET overdue_notified = TRUE
     WHERE status NOT IN ('concluida','cancelada') AND overdue_notified = FALSE AND due_at < now()
     RETURNING id, title, due_at, assignee_id`);
  if (atrasadas.rows.length) {
    const gestores = await usuariosAtivos('gestor');
    for (const t of atrasadas.rows) {
      await notificar([t.assignee_id, ...gestores], {
        kind: 'atividade_atrasada', title: `Atividade atrasada: ${t.title}`,
        message: `Venceu em ${fmt(t.due_at)}`, link: `#/atividades/${t.id}`,
      });
    }
  }
}

async function rodar() {
  if (rodando) return;
  rodando = true;
  try {
    await verificarDemandas();
    await verificarAtividades();
  } catch (e) {
    console.error('[gbf] alertas:', e.message);
  } finally {
    rodando = false;
  }
}

function iniciar() {
  if (timer) return;
  setTimeout(rodar, 5000);
  timer = setInterval(rodar, INTERVALO_MS);
  if (timer.unref) timer.unref();
}

module.exports = { iniciar, rodar };
