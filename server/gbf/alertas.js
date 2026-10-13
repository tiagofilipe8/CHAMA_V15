// Avisos automáticos do Painel Beija-Flor (rodam a cada minuto).
// Lê a Central para detectar novidades; grava só em gbf_*.
const { query } = require('../db');
const { queryCentral } = require('./fonte');
const {
  STATUS_CENTRAL, escopoTickets, notificar, usuariosAtivos,
} = require('./common');

const INTERVALO_MS = 60 * 1000;
let rodando = false;
let timer = null;

const fmt = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

async function verificarDemandas() {
  // A Central pode estar em outro banco (ORCIM_DB_URL): lê o "já visto" aqui e os chamados lá
  const vistos = new Map((await query('SELECT ticket_id, last_status, sla_notified FROM gbf_ticket_watch')).rows
    .map((w) => [String(w.ticket_id), w]));
  const params = [];
  const escopo = await escopoTickets(params);
  params.push([...vistos.keys()]);
  const { rows: chamados } = await queryCentral(
    `SELECT t.id, t.number, t.title, t.status, t.due_at, t.created_at, e.name AS entity_name
     FROM tickets t
     JOIN entities e ON e.id = t.entity_id
     WHERE ${escopo}
       AND (t.status NOT IN (6,7) OR t.updated_at > now() - interval '2 days'
            OR NOT (t.id = ANY($${params.length}::bigint[])))`,
    params);
  const rows = chamados.map((t) => {
    const w = vistos.get(String(t.id));
    return { ...t, visto: w ? t.id : null, last_status: w?.last_status ?? null, sla_notified: w?.sla_notified ?? false };
  });
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

// Visita prevista para hoje (ou atrasada) -> avisa os técnicos uma vez por dia
async function verificarVisitas() {
  const { rows } = await query(
    `UPDATE gbf_locations SET visit_notified_date = (now() AT TIME ZONE 'America/Sao_Paulo')::date
     WHERE active AND next_visit_date <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
       AND (visit_notified_date IS NULL OR visit_notified_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date)
     RETURNING id, name, next_visit_date, to_char(next_visit_time, 'HH24:MI') AS hora,
               next_visit_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date AS atrasada`);
  if (!rows.length) return;
  const tecnicos = await usuariosAtivos('tecnico');
  for (const p of rows) {
    await notificar(tecnicos, {
      kind: 'visita_prevista',
      title: p.atrasada ? `Visita atrasada: ${p.name}` : `Visita hoje: ${p.name}${p.hora ? ` às ${p.hora}` : ''}`,
      message: p.atrasada ? `Estava prevista para ${new Date(p.next_visit_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}` : null,
      link: `#/postos/${p.id}`,
    });
  }
}

async function rodar() {
  if (rodando) return;
  rodando = true;
  try {
    await verificarDemandas();
    await verificarAtividades();
    await verificarVisitas();
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
