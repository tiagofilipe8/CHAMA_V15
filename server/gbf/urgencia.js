// Score de urgência por posto (telas "Score de urgência" e "Sugerir rota").
//
//   score do item = peso da urgência × fator de atraso × fator de prazo
//     peso:  Rotineira ×1 · Programada ×1,5 · Impeditiva ×2 · Emergencial ×3
//     atraso: 1 + 1 por dia de atraso (até ATRASO_MAX dias)
//     prazo (balanceamento): atrasado ou vence hoje/amanhã ×1 · 2–3 dias ×0,75 · 4–7 dias ×0,5 · mais ×0,25 · sem data ×0,75
//   score do posto = soma dos itens em aberto dele
//
// Itens: atividades e pedidos de visita em aberto, a visita de rotina prevista e, quando a cópia da
// Orcim estiver chegando, os chamados abertos do posto (pela localização ligada ao posto).
const express = require('express');
const { query } = require('../db');
const { queryCentral } = require('./fonte');
const { ah, PRIORIDADE_TAREFA, PRIORIDADE_CENTRAL, STATUS_TAREFA } = require('./common');

const router = express.Router();
const TZ = 'America/Sao_Paulo';
const PESO = { 1: 1, 2: 1.5, 3: 2, 4: 3 };
const ATRASO_MAX = 15;
const FAIXAS_PRAZO = [[1, 1], [3, 0.75], [7, 0.5], [Infinity, 0.25]];
const FATOR_SEM_PRAZO = 0.75;
const REGRAS = {
  peso_urgencia: PESO, nomes: PRIORIDADE_TAREFA, atraso_max: ATRASO_MAX, fator_sem_prazo: FATOR_SEM_PRAZO,
  faixas_prazo: FAIXAS_PRAZO.map(([ate, fator]) => ({ ate: ate === Infinity ? null : ate, fator })),
};

const diaSP = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: TZ });
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

function calcular(prioridade, prazo, hoje) {
  const peso = PESO[Number(prioridade)] || 1;
  let diasAtraso = 0; let diasParaPrazo = null; let fatorPrazo = FATOR_SEM_PRAZO;
  if (prazo) {
    const d = diasEntre(hoje, prazo);
    if (d < 0) { diasAtraso = -d; fatorPrazo = 1; } else {
      diasParaPrazo = d;
      fatorPrazo = FAIXAS_PRAZO.find(([ate]) => d <= ate)[1];
    }
  }
  const fatorAtraso = 1 + Math.min(diasAtraso, ATRASO_MAX);
  return {
    peso, prazo, dias_atraso: diasAtraso, dias_para_prazo: diasParaPrazo, fator_atraso: fatorAtraso, fator_prazo: fatorPrazo,
    score: Math.round(peso * fatorAtraso * fatorPrazo * 100) / 100,
  };
}

router.get('/', ah(async (req, res) => {
  const hoje = diaSP(new Date());
  const [postos, tarefas, pedidos] = await Promise.all([
    query(`SELECT id, name, address, latitude::float AS lat, longitude::float AS lng, central_location_id,
                  next_visit_date::text AS proxima, to_char(next_visit_time, 'HH24:MI') AS hora_visita,
                  (SELECT c.name FROM gbf_checklists c WHERE c.id = gbf_locations.checklist_id) AS checklist
           FROM gbf_locations WHERE active ORDER BY name`),
    query(`SELECT t.id, t.title, t.priority, t.status, t.location_id, t.waiting_for,
                  to_char(t.due_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS prazo, u.name AS responsavel
           FROM gbf_tasks t LEFT JOIN gbf_users u ON u.id = t.assignee_id
           WHERE t.status NOT IN ('concluida','cancelada') AND t.location_id IS NOT NULL`),
    query(`SELECT r.id, r.title, r.priority, r.status, r.location_id, r.desired_date::text AS prazo, r.visit_type,
                  COALESCE((SELECT json_agg(i.label ORDER BY i.position) FROM gbf_request_items i WHERE i.request_id = r.id), '[]') AS tarefas
           FROM gbf_requests r WHERE r.status IN ('a_fazer','em_andamento') AND r.location_id IS NOT NULL`),
  ]);

  // coordenadas da Orcim (localização ligada ao posto), quando o posto não tem as suas
  const coordCentral = new Map();
  const chamadosPorLocal = new Map();
  const ligados = postos.rows.filter((p) => p.central_location_id).map((p) => String(p.central_location_id));
  if (ligados.length) {
    try {
      const { rows } = await queryCentral(
        'SELECT id, latitude::float AS lat, longitude::float AS lng FROM locations WHERE id = ANY($1::bigint[])', [ligados]);
      rows.forEach((l) => coordCentral.set(String(l.id), l));
    } catch { /* Central sem coordenadas */ }
    try {
      const { rows } = await queryCentral(
        `SELECT t.id, t.number, t.title, t.priority, t.location_id, to_char(t.due_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS prazo
         FROM tickets t WHERE t.status NOT IN (5,6,7) AND t.location_id = ANY($1::bigint[])`, [ligados]);
      rows.forEach((t) => {
        const k = String(t.location_id);
        if (!chamadosPorLocal.has(k)) chamadosPorLocal.set(k, []);
        chamadosPorLocal.get(k).push(t);
      });
    } catch { /* cópia da Orcim ainda não chega */ }
  }

  const porPosto = new Map(postos.rows.map((p) => [String(p.id), []]));
  const add = (postoId, item) => { const l = porPosto.get(String(postoId)); if (l) l.push(item); };
  for (const t of tarefas.rows) {
    add(t.location_id, {
      tipo: 'atividade', id: t.id, titulo: t.title, prioridade: Number(t.priority) || 1, link: `#/atividades/${t.id}`,
      detalhe: [STATUS_TAREFA[t.status], t.waiting_for ? `aguardando ${t.waiting_for}` : null, t.responsavel || 'sem responsável'].filter(Boolean).join(' · '),
      levar: [], ...calcular(t.priority, t.prazo, hoje),
    });
  }
  for (const r of pedidos.rows) {
    add(r.location_id, {
      tipo: 'pedido', id: r.id, titulo: r.title, prioridade: Number(r.priority) || 1, link: `#/solicitacoes/${r.id}`,
      detalhe: `${r.visit_type === 'rotina' ? 'Visita pedida (com checklist)' : 'Visita pedida'} · ${r.tarefas.length} tarefa(s)`,
      levar: r.tarefas, ...calcular(r.priority, r.prazo, hoje),
    });
  }
  for (const p of postos.rows) {
    if (p.proxima) {
      add(p.id, {
        tipo: 'rotina', id: p.id, titulo: `Visita de rotina${p.checklist ? ` (${p.checklist})` : ''}`, prioridade: 1, link: `#/postos/${p.id}`,
        detalhe: `prevista para ${p.proxima.split('-').reverse().join('/')}${p.hora_visita ? ` às ${p.hora_visita}` : ''}`,
        levar: [], ...calcular(1, p.proxima, hoje),
      });
    }
    for (const t of chamadosPorLocal.get(String(p.central_location_id)) || []) {
      add(p.id, {
        tipo: 'chamado', id: t.id, titulo: t.title, prioridade: Number(t.priority) || 1, link: `#/demandas/${t.id}`,
        detalhe: `Chamado da Orcim ${t.number || `#${t.id}`} · ${PRIORIDADE_CENTRAL[t.priority] || ''}`,
        levar: [], ...calcular(t.priority, t.prazo, hoje),
      });
    }
  }

  const lista = postos.rows.map((p) => {
    const itens = (porPosto.get(String(p.id)) || []).sort((a, b) => b.score - a.score);
    const c = coordCentral.get(String(p.central_location_id)) || {};
    const lat = p.lat ?? c.lat ?? null; const lng = p.lng ?? c.lng ?? null;
    return {
      id: p.id, nome: p.name, endereco: p.address, lat, lng,
      score: Math.round(itens.reduce((s, i) => s + i.score, 0) * 100) / 100,
      atrasados: itens.filter((i) => i.dias_atraso > 0).length, itens,
    };
  }).filter((p) => p.itens.length).sort((a, b) => b.score - a.score || a.nome.localeCompare(b.nome));

  const todos = postos.rows.map((p) => {
    const c = coordCentral.get(String(p.central_location_id)) || {};
    return { id: p.id, nome: p.name, lat: p.lat ?? c.lat ?? null, lng: p.lng ?? c.lng ?? null };
  });
  res.json({ hoje, regras: REGRAS, postos: lista, todos });
}));

module.exports = router;
module.exports.calcular = calcular;
