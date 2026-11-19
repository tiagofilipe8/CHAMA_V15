// Painel do gestor — uma tela só com a Orcim (chamados) e a TI do grupo (rotina do técnico),
// com filtro por datas. Só o gestor acessa. Tudo SOMENTE LEITURA.
//
// GET /api/gbf/painel-gestor?de=AAAA-MM-DD&ate=AAAA-MM-DD
//
// Regras de período (fuso America/Sao_Paulo, datas inclusivas):
//  - "no período": aconteceu entre 00:00 de "de" e 23:59 de "ate".
//  - "agora": situação no momento da consulta (em aberto, atrasado), independe do filtro.
//
// Os dados da Central (tickets) e os do painel (gbf_*) podem estar em bancos diferentes
// (ver fonte.js), então nunca há JOIN entre os dois lados: cada um é consultado à parte.
const express = require('express');
const { query } = require('../db');
const { queryCentral } = require('./fonte');
const { ah, escopoTickets, STATUS_CENTRAL, PRIORIDADE_CENTRAL, STATUS_TAREFA } = require('./common');
const { requireGestor } = require('./auth');
const { DEMANDA_SELECT, enriquecer } = require('./demandas');

const router = express.Router();
const TZ = 'America/Sao_Paulo';
const MAX_DIAS = 366;
const SOLICITACAO_PARADA_DIAS = 3; // solicitação aberta há mais que isso entra em "precisa de atenção"

const dataOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
// AAAA-MM-DD do instante "d" no fuso de São Paulo
const diaSP = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
const somaDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const difDias = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3);

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
function contar(arr, chave) {
  const m = new Map();
  for (const x of arr) {
    const k = x[chave] || '—';
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([nome, total]) => ({ nome, total })).sort((a, b) => b.total - a.total);
}

// "AAAA-MM-DDTHH" do instante "d" no fuso de São Paulo (para agrupar por hora)
const horaSP = (d) => {
  const x = new Date(d);
  const h = x.toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).slice(0, 2);
  return `${diaSP(x)}T${h}`;
};

// Agrupa o período em hora / dia / semana / mês. A tela escolhe (Dia = por hora, Semana e Mês = por
// dia, Ano = por mês); sem escolha, vai pelo tamanho do período.
// As chaves aceitam "AAAA-MM-DD" ou "AAAA-MM-DDTHH".
function montarEixo(de, ate, pedida) {
  const n = difDias(de, ate) + 1;
  let escala = n <= 62 ? 'dia' : n <= 200 ? 'semana' : 'mes';
  if (['dia', 'semana', 'mes'].includes(pedida)) escala = pedida;
  if (pedida === 'hora' && n === 1) escala = 'hora';
  if (escala === 'dia' && n > 400) escala = 'mes';
  const chave = (valor) => {
    const v = String(valor);
    if (escala === 'hora') return v.length > 10 ? v.slice(0, 13) : `${v.slice(0, 10)}T00`;
    const iso = v.slice(0, 10);
    if (escala === 'dia') return iso;
    if (escala === 'mes') return `${iso.slice(0, 7)}-01`;
    // semana começando na segunda-feira (limitada ao início do período)
    const dow = new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = domingo
    const seg = somaDias(iso, -((dow + 6) % 7));
    return seg < de ? de : seg;
  };
  const baldes = [];
  if (escala === 'hora') {
    for (let h = 0; h < 24; h += 1) baldes.push(`${de}T${String(h).padStart(2, '0')}`);
    return { escala, chave, baldes };
  }
  const vistos = new Set();
  for (let i = 0; i < n; i += 1) {
    const k = chave(somaDias(de, i));
    if (!vistos.has(k)) { vistos.add(k); baldes.push(k); }
  }
  return { escala, chave, baldes };
}

router.get('/', requireGestor, ah(async (req, res) => {
  // ---------------- período ----------------
  // liga os postos às localizações da Central (para contar os chamados de cada posto)
  await require('./postos').sincronizarPostos().catch(() => {});
  const hoje = diaSP(new Date());
  let de = dataOk(req.query.de) ? req.query.de : somaDias(hoje, -29);
  let ate = dataOk(req.query.ate) ? req.query.ate : hoje;
  if (ate < de) [de, ate] = [ate, de];
  if (difDias(de, ate) + 1 > MAX_DIAS) de = somaDias(ate, -(MAX_DIAS - 1));
  const dias = difDias(de, ate) + 1;
  const eixo = montarEixo(de, ate, String(req.query.escala || ''));
  const noPeriodo = (d) => {
    if (!d) return false;
    const x = diaSP(d);
    return x >= de && x <= ate;
  };

  // ---------------- Orcim (Central) ----------------
  // em aberto agora + tudo que foi mexido desde o início do período (cobre criadas e resolvidas)
  // Período anterior, do mesmo tamanho, para comparar ("+6", "−4h")
  const deAnt = somaDias(de, -dias);
  const ateAnt = somaDias(de, -1);
  const noAnterior = (d) => {
    if (!d) return false;
    const x = diaSP(d);
    return x >= deAnt && x <= ateAnt;
  };

  const params = [];
  const escopo = await escopoTickets(params);
  params.push(deAnt);
  const iniPeriodo = `($${params.length}::date::timestamp AT TIME ZONE '${TZ}')`;
  const { rows } = await queryCentral(
    `${DEMANDA_SELECT}
     WHERE ${escopo} AND (t.status NOT IN (5,6,7) OR t.updated_at >= ${iniPeriodo})`, params);

  const agora = new Date();
  const lista = rows.map((d) => enriquecer(d, agora));
  const criadas = lista.filter((d) => noPeriodo(d.created_at));
  const resolvidas = lista.filter((d) => noPeriodo(d.resolvido_em));
  const criadasAnt = lista.filter((d) => noAnterior(d.created_at));
  const resolvidasAnt = lista.filter((d) => noAnterior(d.resolvido_em));
  const resolvidasComPrazo = resolvidas.filter((d) => d.due_at);
  const cumpridas = resolvidasComPrazo.filter((d) => d.sla === 'cumprido');
  const abertas = lista.filter((d) => d.aberto);
  const atrasadas = abertas.filter((d) => d.sla === 'atrasado');

  const serieOrcim = new Map(eixo.baldes.map((b) => [b, { periodo: b, criadas: 0, resolvidas: 0 }]));
  for (const d of criadas) { const b = serieOrcim.get(eixo.chave(horaSP(d.created_at))); if (b) b.criadas += 1; }
  for (const d of resolvidas) { const b = serieOrcim.get(eixo.chave(horaSP(d.resolvido_em))); if (b) b.resolvidas += 1; }

  const tecnicos = new Map();
  for (const d of resolvidas) {
    const k = d.assigned_name || 'Sem técnico';
    if (!tecnicos.has(k)) tecnicos.set(k, { nome: k, total: 0, tempos: [] });
    const t = tecnicos.get(k);
    t.total += 1;
    t.tempos.push(d.tempo_resolucao);
  }

  const orcim = {
    kpis: {
      criadas: criadas.length,
      resolvidas: resolvidas.length,
      prazo_cumprido_pct: resolvidasComPrazo.length
        ? Math.round((cumpridas.length / resolvidasComPrazo.length) * 100) : null,
      prazo_base: resolvidasComPrazo.length,
      fora_do_prazo: resolvidasComPrazo.length - cumpridas.length,
      tempo_medio_resolucao: media(resolvidas.map((d) => d.tempo_resolucao)),
      tempo_mediano_resolucao: mediana(resolvidas.map((d) => d.tempo_resolucao)),
      tempo_medio_primeira_resposta: media(criadas.map((d) => d.tempo_primeira_resposta)),
      abertas_agora: abertas.length,
      atrasadas_agora: atrasadas.length,
      sem_tecnico_agora: abertas.filter((d) => !d.assigned_user_id).length,
    },
    serie: [...serieOrcim.values()],
    por_empresa: contar(criadas, 'entity_name'),
    por_categoria: contar(criadas, 'category_name'),
    por_prioridade: contar(criadas, 'priority_label'),
    por_tecnico: [...tecnicos.values()]
      .map((t) => ({ nome: t.nome, total: t.total, tempo_medio: media(t.tempos) }))
      .sort((a, b) => b.total - a.total),
    atrasadas: atrasadas
      .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
      .slice(0, 15)
      .map((d) => ({
        id: d.id, number: d.number, title: d.title, entity_name: d.entity_name,
        assigned_name: d.assigned_name, due_at: d.due_at, status_label: STATUS_CENTRAL[d.status],
      })),
  };

  // ---------------- TI do grupo (tabelas gbf_*) ----------------
  const p = [de, ate];
  const INI = `($1::date::timestamp AT TIME ZONE '${TZ}')`;
  const FIM = `(($2::date + 1)::timestamp AT TIME ZONE '${TZ}')`;
  const ENTRE = (col) => `${col} >= ${INI} AND ${col} < ${FIM}`;
  const DIA = (col) => `to_char(${col} AT TIME ZONE '${TZ}', 'YYYY-MM-DD"T"HH24')`;
  const HOJE = `(now() AT TIME ZONE '${TZ}')::date`;

  const [visitas, tarefas, solicConcl, naoOk, postosAtrasados, abertasTI, paradas, porPessoa] = await Promise.all([
    query(`SELECT v.id, ${DIA('v.finished_at')} AS dia, l.name AS local,
                  (SELECT count(*)::int FROM gbf_visit_answers a WHERE a.visit_id = v.id AND a.answer = 'nao_ok') AS nao_ok
           FROM gbf_visits v JOIN gbf_locations l ON l.id = v.location_id
           WHERE v.status = 'concluida' AND ${ENTRE('v.finished_at')}`, p),
    query(`SELECT t.id, ${DIA('t.completed_at')} AS dia,
                  (t.due_at IS NOT NULL AND t.completed_at > t.due_at) AS com_atraso
           FROM gbf_tasks t WHERE t.status = 'concluida' AND ${ENTRE('t.completed_at')}`, p),
    query(`SELECT r.id, ${DIA('r.completed_at')} AS dia,
                  EXTRACT(EPOCH FROM (r.completed_at - r.created_at))::int AS tempo
           FROM gbf_requests r WHERE r.status = 'concluida' AND ${ENTRE('r.completed_at')}`, p),
    query(`SELECT a.item_label, a.note, v.id AS visit_id, v.finished_at, l.name AS local
           FROM gbf_visit_answers a JOIN gbf_visits v ON v.id = a.visit_id JOIN gbf_locations l ON l.id = v.location_id
           WHERE a.answer = 'nao_ok' AND v.status = 'concluida' AND ${ENTRE('v.finished_at')}
           ORDER BY v.finished_at DESC LIMIT 30`, p),
    query(`SELECT id, name, next_visit_date::text AS data, (${HOJE} - next_visit_date)::int AS dias_atraso
           FROM gbf_locations WHERE active AND next_visit_date < ${HOJE} ORDER BY next_visit_date LIMIT 30`),
    query(`SELECT
             (SELECT count(*)::int FROM gbf_tasks WHERE status NOT IN ('concluida','cancelada') AND due_at < now()) AS atividades_atrasadas,
             (SELECT count(*)::int FROM gbf_requests WHERE status IN ('a_fazer','em_andamento')) AS solicitacoes_abertas,
             (SELECT count(*)::int FROM gbf_requests WHERE ${ENTRE('created_at')}) AS solicitacoes_recebidas`, p),
    query(`SELECT r.id, r.title, r.status, r.created_at, l.name AS local
           FROM gbf_requests r LEFT JOIN gbf_locations l ON l.id = r.location_id
           WHERE r.status IN ('a_fazer','em_andamento') AND r.created_at < now() - ($1::int * interval '1 day')
           ORDER BY r.created_at LIMIT 20`, [SOLICITACAO_PARADA_DIAS]),
    query(`SELECT u.name AS nome,
             (SELECT count(*)::int FROM gbf_visits v WHERE v.user_id = u.id AND v.status = 'concluida' AND ${ENTRE('v.finished_at')}) AS visitas,
             (SELECT count(*)::int FROM gbf_tasks t WHERE t.assignee_id = u.id AND t.status = 'concluida' AND ${ENTRE('t.completed_at')}) AS atividades,
             (SELECT count(*)::int FROM gbf_requests r WHERE r.handled_by = u.id AND r.status = 'concluida' AND ${ENTRE('r.completed_at')}) AS solicitacoes
           FROM gbf_users u WHERE u.active ORDER BY u.name`, p),
  ]);

  const serieTI = new Map(eixo.baldes.map((b) => [b, { periodo: b, visitas: 0, atividades: 0, solicitacoes: 0, nao_ok: 0 }]));
  const somar = (linhas, campo) => linhas.forEach((r) => {
    const s = serieTI.get(eixo.chave(r.dia));
    if (s) s[campo] += 1;
  });
  visitas.rows.forEach((r) => { const b = serieTI.get(eixo.chave(r.dia)); if (b) b.nao_ok += r.nao_ok; });
  somar(visitas.rows, 'visitas');
  somar(tarefas.rows, 'atividades');
  somar(solicConcl.rows, 'solicitacoes');

  const ab = abertasTI.rows[0];
  const ti = {
    kpis: {
      visitas: visitas.rows.length,
      atividades: tarefas.rows.length,
      atividades_com_atraso: tarefas.rows.filter((t) => t.com_atraso).length,
      solicitacoes: solicConcl.rows.length,
      solicitacoes_recebidas: ab.solicitacoes_recebidas,
      tempo_medio_solicitacao: media(solicConcl.rows.map((r) => r.tempo)),
      nao_ok: visitas.rows.reduce((s, v) => s + v.nao_ok, 0),
      postos_atrasados_agora: postosAtrasados.rows.length,
      atividades_atrasadas_agora: ab.atividades_atrasadas,
      solicitacoes_abertas_agora: ab.solicitacoes_abertas,
    },
    serie: [...serieTI.values()],
    por_posto: contar(visitas.rows, 'local'),
    por_pessoa: porPessoa.rows.filter((r) => r.visitas || r.atividades || r.solicitacoes),
    nao_ok: naoOk.rows,
    postos_atrasados: postosAtrasados.rows,
    solicitacoes_paradas: paradas.rows,
    parada_dias: SOLICITACAO_PARADA_DIAS,
  };

  // =====================================================================
  // Abas do painel: comparação com o período anterior e métricas extras
  // =====================================================================
  const H = 3600;
  const pctDe = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const faixas = (lst, segundos, cortes) => cortes.map(([nome, min, max]) => ({
    nome, total: lst.filter((x) => { const s = segundos(x); return s >= min && (max === null || s < max); }).length,
  }));

  // ---------------- Orcim ----------------
  const resolvidasAntComPrazo = resolvidasAnt.filter((d) => d.due_at);
  orcim.anterior = {
    criadas: criadasAnt.length,
    resolvidas: resolvidasAnt.length,
    tempo_medio_resolucao: media(resolvidasAnt.map((d) => d.tempo_resolucao)),
    tempo_medio_primeira_resposta: media(criadasAnt.map((d) => d.tempo_primeira_resposta)),
    prazo_cumprido_pct: pctDe(resolvidasAntComPrazo.filter((d) => d.sla === 'cumprido').length, resolvidasAntComPrazo.length),
  };
  orcim.por_urgencia = [4, 3, 2, 1].map((pr) => ({
    nome: PRIORIDADE_CENTRAL[pr], prioridade: pr, total: criadas.filter((d) => Number(d.priority) === pr).length,
  }));
  const porCategoria = new Map();
  for (const d of resolvidas) {
    const k = d.category_name || 'Sem categoria';
    if (!porCategoria.has(k)) porCategoria.set(k, []);
    porCategoria.get(k).push(d.tempo_resolucao);
  }
  orcim.tempo_por_categoria = [...porCategoria.entries()]
    .map(([nome, t]) => ({ nome, total: t.length, tempo_medio: media(t) }))
    .filter((x) => x.tempo_medio !== null).sort((a, b) => b.tempo_medio - a.tempo_medio).slice(0, 6);
  orcim.abertas_por_idade = faixas(abertas, (d) => (agora - new Date(d.created_at)) / 1000,
    [['até 4 h', 0, 4 * H], ['4 h a 1 dia', 4 * H, 24 * H], ['1 a 3 dias', 24 * H, 72 * H], ['mais de 3 dias', 72 * H, null]]);
  const tecs = new Map();
  const tec = (n) => {
    const k = n || 'Sem técnico';
    if (!tecs.has(k)) tecs.set(k, { nome: k, resolvidos: 0, tempos: [], respostas: [], com_prazo: 0, no_prazo: 0, em_aberto: 0 });
    return tecs.get(k);
  };
  resolvidas.forEach((d) => {
    const t = tec(d.assigned_name);
    t.resolvidos += 1;
    t.tempos.push(d.tempo_resolucao);
    if (d.due_at) { t.com_prazo += 1; if (d.sla === 'cumprido') t.no_prazo += 1; }
  });
  criadas.forEach((d) => { if (d.assigned_name) tec(d.assigned_name).respostas.push(d.tempo_primeira_resposta); });
  abertas.forEach((d) => { tec(d.assigned_name).em_aberto += 1; });
  orcim.tecnicos = [...tecs.values()]
    .map((t) => ({
      nome: t.nome, resolvidos: t.resolvidos, tempo_medio: media(t.tempos), primeira_resposta: media(t.respostas),
      no_prazo_pct: pctDe(t.no_prazo, t.com_prazo), em_aberto: t.em_aberto,
    }))
    .filter((t) => t.resolvidos || t.em_aberto)
    .sort((a, b) => b.resolvidos - a.resolvidos || b.em_aberto - a.em_aberto);
  orcim.equipamentos = null; // chega com a API da Orcim

  // Chamados por posto (posto do Dia a dia = localização da Central). Se a Central não tiver
  // a coluna de localização (versão antiga da Orcim), a coluna fica vazia na tela.
  let chamadosPorPosto = new Map();
  try {
    const pc = [];
    const escPosto = await escopoTickets(pc);
    pc.push(de, ate);
    const r = await queryCentral(
      `SELECT t.id, t.location_id, c.name AS categoria FROM tickets t LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${escPosto} AND t.location_id IS NOT NULL
         AND t.created_at >= ($${pc.length - 1}::date::timestamp AT TIME ZONE '${TZ}')
         AND t.created_at < (($${pc.length}::date + 1)::timestamp AT TIME ZONE '${TZ}')`, pc);
    const tempoPorId = new Map(lista.map((d) => [String(d.id), d.tempo_resolucao]));
    for (const t of r.rows) {
      const k = String(t.location_id);
      if (!chamadosPorPosto.has(k)) chamadosPorPosto.set(k, { total: 0, cats: new Map(), tempos: [] });
      const c = chamadosPorPosto.get(k);
      c.total += 1;
      const cat = t.categoria || 'Sem categoria';
      c.cats.set(cat, (c.cats.get(cat) || 0) + 1);
      c.tempos.push(tempoPorId.has(String(t.id)) ? tempoPorId.get(String(t.id)) : null);
    }
    // Chamados no período, mas nenhum com posto (ex.: cópia da Orcim, que não traz a localização):
    // mostra "—" em vez de 0, para não parecer que o posto não teve chamado.
    if (!chamadosPorPosto.size && criadas.length) chamadosPorPosto = null;
  } catch {
    chamadosPorPosto = null;
  }

  // ---------------- TI do grupo e postos ----------------
  const pAnt = [deAnt, ateAnt];
  const [tiAnt, tarefasDet, naoOkItens, abertasIdade, pessoas, postosRows] = await Promise.all([
    query(`SELECT
             (SELECT count(*)::int FROM gbf_visits WHERE status = 'concluida' AND ${ENTRE('finished_at')}) AS visitas,
             (SELECT count(*)::int FROM gbf_tasks WHERE status = 'concluida' AND ${ENTRE('completed_at')}) AS atividades,
             (SELECT count(*)::int FROM gbf_requests WHERE status = 'concluida' AND ${ENTRE('completed_at')}) AS solicitacoes,
             (SELECT avg(EXTRACT(EPOCH FROM (completed_at - created_at)))::int FROM gbf_tasks
                WHERE status = 'concluida' AND ${ENTRE('completed_at')}) AS tempo_medio_atividade,
             (SELECT count(*)::int FROM gbf_visit_answers a JOIN gbf_visits v ON v.id = a.visit_id
                WHERE a.answer = 'nao_ok' AND v.status = 'concluida' AND ${ENTRE('v.finished_at')}) AS nao_ok`, pAnt),
    query(`SELECT EXTRACT(EPOCH FROM (completed_at - created_at))::int AS tempo, assignee_id,
                  (due_at IS NOT NULL) AS com_prazo, (due_at IS NOT NULL AND completed_at <= due_at) AS no_prazo
           FROM gbf_tasks WHERE status = 'concluida' AND ${ENTRE('completed_at')}`, p),
    query(`SELECT a.item_label AS nome, count(*)::int AS total
           FROM gbf_visit_answers a JOIN gbf_visits v ON v.id = a.visit_id
           WHERE a.answer = 'nao_ok' AND v.status = 'concluida' AND ${ENTRE('v.finished_at')}
           GROUP BY a.item_label ORDER BY total DESC, nome LIMIT 8`, p),
    query(`SELECT EXTRACT(EPOCH FROM (now() - created_at))::int AS idade
           FROM gbf_tasks WHERE status NOT IN ('concluida','cancelada')`),
    query(`SELECT u.id, u.name AS nome,
             (SELECT count(*)::int FROM gbf_visits v WHERE v.user_id = u.id AND v.status = 'concluida' AND ${ENTRE('v.finished_at')}) AS visitas,
             (SELECT count(*)::int FROM gbf_requests r WHERE r.handled_by = u.id AND r.status = 'concluida' AND ${ENTRE('r.completed_at')}) AS solicitacoes,
             (SELECT count(*)::int FROM gbf_tasks t WHERE t.assignee_id = u.id AND t.status NOT IN ('concluida','cancelada')) AS em_aberto,
             (SELECT count(*)::int FROM gbf_tasks t WHERE t.assignee_id = u.id AND t.status NOT IN ('concluida','cancelada') AND t.due_at < now()) AS atrasadas,
             (SELECT count(*)::int FROM gbf_requests r WHERE r.requested_by = u.id AND ${ENTRE('r.created_at')}) AS pediu,
             (SELECT count(*)::int FROM gbf_visit_answers a JOIN gbf_visits v ON v.id = a.visit_id
                WHERE v.user_id = u.id AND a.answer = 'nao_ok' AND v.status = 'concluida' AND ${ENTRE('v.finished_at')}) AS nao_ok,
             (SELECT count(*)::int FROM gbf_reschedules g WHERE g.user_id = u.id AND ${ENTRE('g.created_at')}) AS reagendou,
             u.role, u.faz_visitas
           FROM gbf_users u WHERE u.active AND u.role <> 'unidade' ORDER BY u.name`, p),
    query(`SELECT l.id, l.name, l.central_location_id, l.next_visit_date::text AS proxima,
                  (${HOJE} - l.next_visit_date)::int AS dias_atraso,
                  (SELECT max(v.finished_at) FROM gbf_visits v WHERE v.location_id = l.id AND v.status = 'concluida') AS ultima_visita,
                  (SELECT count(*)::int FROM gbf_visits v WHERE v.location_id = l.id AND v.status = 'concluida' AND ${ENTRE('v.finished_at')}) AS visitas,
                  (SELECT count(*)::int FROM gbf_visit_answers a JOIN gbf_visits v ON v.id = a.visit_id
                     WHERE v.location_id = l.id AND a.answer = 'nao_ok' AND v.status = 'concluida' AND ${ENTRE('v.finished_at')}) AS nao_ok,
                  (SELECT count(*)::int FROM gbf_visit_answers a
                     WHERE a.answer = 'nao_ok'
                       AND a.visit_id = (SELECT v3.id FROM gbf_visits v3 WHERE v3.location_id = l.id AND v3.status = 'concluida'
                                         ORDER BY v3.finished_at DESC LIMIT 1)
                       AND NOT EXISTS (SELECT 1 FROM gbf_tasks t WHERE t.visit_id = a.visit_id)) AS nao_ok_pendente,
                  (SELECT count(*)::int FROM gbf_tasks t WHERE t.location_id = l.id AND t.status NOT IN ('concluida','cancelada')) AS atividades_abertas,
                  (SELECT count(*)::int FROM gbf_requests r WHERE r.location_id = l.id AND ${ENTRE('r.created_at')}) AS solicitacoes
           FROM gbf_locations l WHERE l.active ORDER BY l.name`, p),
  ]);

  const td = tarefasDet.rows;
  const tdComPrazo = td.filter((t) => t.com_prazo);
  ti.anterior = tiAnt.rows[0];
  Object.assign(ti.kpis, {
    tempo_medio_atividade: media(td.map((t) => t.tempo)),
    no_prazo_pct: pctDe(tdComPrazo.filter((t) => t.no_prazo).length, tdComPrazo.length),
    no_prazo_base: tdComPrazo.length,
    postos_visitados: new Set(visitas.rows.map((v) => v.local)).size,
    atividades_abertas_agora: abertasIdade.rows.length,
  });
  // Tarefas dos checklists das visitas e solicitações de visita do gestor
  const extraTi = (await query(
    `SELECT
       (SELECT count(*)::int FROM gbf_visit_answers a JOIN gbf_visits v ON v.id = a.visit_id
          WHERE v.status = 'concluida' AND ${ENTRE('v.finished_at')} AND a.answer IN ('ok','nao_ok')) AS tarefas_verificadas,
       (SELECT count(*)::int FROM gbf_visit_answers a JOIN gbf_visits v ON v.id = a.visit_id
          WHERE v.status = 'concluida' AND ${ENTRE('v.finished_at')} AND a.answer = 'nao_ok') AS tarefas_problema,
       (SELECT count(*)::int FROM gbf_requests WHERE kind = 'visita' AND ${ENTRE('created_at')}) AS visitas_pedidas,
       (SELECT count(*)::int FROM gbf_requests WHERE kind = 'visita' AND status = 'concluida' AND ${ENTRE('completed_at')}) AS visitas_pedidas_feitas,
       (SELECT count(*)::int FROM gbf_requests WHERE kind = 'visita' AND status = 'concluida' AND ${ENTRE('completed_at')}
          AND desired_date IS NOT NULL AND (completed_at AT TIME ZONE '${TZ}')::date <= desired_date) AS visitas_pedidas_no_prazo,
       (SELECT count(*)::int FROM gbf_requests WHERE kind = 'visita' AND status = 'concluida' AND ${ENTRE('completed_at')}
          AND desired_date IS NOT NULL) AS visitas_pedidas_com_data,
       (SELECT count(*)::int FROM gbf_requests WHERE kind = 'visita' AND status IN ('a_fazer','em_andamento')
          AND desired_date < ${HOJE}) AS visitas_pedidas_atrasadas_agora`, p)).rows[0];
  Object.assign(ti.kpis, extraTi, {
    visitas_pedidas_no_prazo_pct: pctDe(extraTi.visitas_pedidas_no_prazo, extraTi.visitas_pedidas_com_data),
  });
  ti.nao_ok_por_item = naoOkItens.rows;
  ti.abertas_por_idade = faixas(abertasIdade.rows, (x) => x.idade,
    [['até 1 dia', 0, 24 * H], ['1 a 3 dias', 24 * H, 72 * H], ['3 a 7 dias', 72 * H, 168 * H], ['mais de 7 dias', 168 * H, null]]);
  const planejado = visitas.rows.length + td.length;
  const reativo = solicConcl.rows.length;
  ti.planejado_reativo = { planejado, reativo, planejado_pct: pctDe(planejado, planejado + reativo) };
  ti.tecnicos = pessoas.rows.map((u) => {
    const minhas = td.filter((t) => String(t.assignee_id) === String(u.id));
    const comPrazo = minhas.filter((t) => t.com_prazo);
    return {
      nome: u.nome, visitas: u.visitas, atividades: minhas.length, solicitacoes: u.solicitacoes,
      tempo_medio: media(minhas.map((t) => t.tempo)), no_prazo_pct: pctDe(comPrazo.filter((t) => t.no_prazo).length, comPrazo.length),
      em_aberto: u.em_aberto,
    };
  }).filter((t) => t.visitas || t.atividades || t.solicitacoes || t.em_aberto);
  ti.funcionarios = pessoas.rows.map((u) => {
    const minhas = td.filter((t) => String(t.assignee_id) === String(u.id));
    const comPrazo = minhas.filter((t) => t.com_prazo);
    const papeis = u.role === 'gestor' ? (u.faz_visitas ? ['Gestor', 'Técnico'] : ['Gestor']) : [u.role === 'tecnico' ? 'Técnico' : u.role];
    return {
      id: u.id, nome: u.nome, papeis, visitas: u.visitas, atividades: minhas.length, solicitacoes: u.solicitacoes,
      tempo_medio: media(minhas.map((t) => t.tempo)), no_prazo_pct: pctDe(comPrazo.filter((t) => t.no_prazo).length, comPrazo.length),
      em_aberto: u.em_aberto, atrasadas: u.atrasadas, pediu: u.pediu, nao_ok: u.nao_ok, reagendou: u.reagendou,
    };
  });

  const postos = postosRows.rows.map((l) => {
    const c = chamadosPorPosto && l.central_location_id ? chamadosPorPosto.get(String(l.central_location_id)) : null;
    const topo = c ? [...c.cats.entries()].sort((a, b) => b[1] - a[1])[0] : null;
    const atrasado = l.proxima && l.dias_atraso > 0;
    return {
      id: l.id, nome: l.name,
      situacao: atrasado ? 'atrasado' : l.nao_ok_pendente ? 'atencao' : l.proxima ? 'ok' : 'sem_data',
      dias_atraso: atrasado ? l.dias_atraso : 0,
      chamados: c ? c.total : (chamadosPorPosto ? 0 : null),
      mais_repete: topo ? { nome: topo[0], total: topo[1] } : null,
      tempo_medio: c ? media(c.tempos) : null,
      nao_ok: l.nao_ok, nao_ok_pendente: l.nao_ok_pendente, visitas: l.visitas, ultima_visita: l.ultima_visita,
      atividades_abertas: l.atividades_abertas, solicitacoes: l.solicitacoes,
    };
  }).sort((a, b) => (b.chamados || 0) - (a.chamados || 0) || b.nao_ok - a.nao_ok || a.nome.localeCompare(b.nome));

  res.json({
    periodo: { de, ate, dias, escala: eixo.escala, gerado_em: new Date().toISOString(), anterior: { de: deAnt, ate: ateAnt } },
    orcim,
    ti,
    postos,
  });
}));

// ---------------------------------------------------------------------
// Calendário: tudo o que foi pedido em cada dia (data em que a solicitação foi feita).
// GET /api/gbf/painel-gestor/calendario?mes=AAAA-MM
// Orcim: chamados (hoje pela cópia da Central; depois pela API da Orcim).
// TI do Beija-Flor: solicitações do gestor para a TI (tabelas do Painel).
// Devolve a grade inteira do mês (de segunda a domingo), inclusive os dias das pontas.
// ---------------------------------------------------------------------
router.get('/calendario', requireGestor, ah(async (req, res) => {
  const hoje = diaSP(new Date());
  const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes || '')) ? req.query.mes : hoje.slice(0, 7);
  const primeiro = `${mes}-01`;
  const ultimo = somaDias(`${somaDias(primeiro, 32).slice(0, 7)}-01`, -1);
  const dowPrimeiro = new Date(`${primeiro}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const inicio = somaDias(primeiro, -((dowPrimeiro + 6) % 7));
  const dowUltimo = new Date(`${ultimo}T12:00:00Z`).getUTCDay();
  const fim = somaDias(ultimo, (7 - dowUltimo) % 7);
  const INI = `($1::date::timestamp AT TIME ZONE '${TZ}')`;
  const FIM = `(($2::date + 1)::timestamp AT TIME ZONE '${TZ}')`;
  const DIA = (col) => `to_char(${col} AT TIME ZONE '${TZ}', 'YYYY-MM-DD')`;
  const HORA = (col) => `to_char(${col} AT TIME ZONE '${TZ}', 'HH24:MI')`;

  const itens = [];
  let orcimOk = true;
  try {
    const pc = [inicio, fim];
    const escopo = await escopoTickets(pc);
    const { rows } = await queryCentral(
      `SELECT t.id, t.number, t.title, t.priority, t.status, t.due_at,
              ${DIA('t.created_at')} AS dia, ${HORA('t.created_at')} AS hora,
              e.name AS empresa, c.name AS categoria, ua.name AS responsavel
       FROM tickets t
       LEFT JOIN entities e ON e.id = t.entity_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN users ua ON ua.id = t.assigned_user_id
       WHERE ${escopo} AND t.created_at >= ${INI} AND t.created_at < ${FIM}
       ORDER BY t.created_at`, pc);
    const agora = Date.now();
    for (const t of rows) {
      const aberto = ![5, 6, 7].includes(Number(t.status));
      itens.push({
        fonte: 'orcim', id: t.id, numero: t.number || `#${t.id}`, titulo: t.title, dia: t.dia, hora: t.hora,
        prioridade: Number(t.priority) || 2, situacao: STATUS_CENTRAL[t.status] || '—', aberto,
        atrasado: aberto && t.due_at && new Date(t.due_at).getTime() < agora,
        detalhe: [t.categoria, t.empresa].filter(Boolean).join(' · '), responsavel: t.responsavel, link: `#/demandas/${t.id}`,
      });
    }
  } catch (e) {
    orcimOk = false;
    console.error('[gbf] calendário (Orcim):', e.message);
  }

  const STATUS_TI = { a_fazer: 'A fazer', em_andamento: 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada' };
  // TI do Beija-Flor: solicitação de visita no DIA DESEJADO (sem data: no dia em que foi pedida);
  // solicitação geral (antigas) no dia em que foi pedida. Concluída aparece no mesmo dia, como feita.
  const DIA_TI = `COALESCE(CASE WHEN r.kind = 'visita' THEN r.desired_date END, (r.created_at AT TIME ZONE '${TZ}')::date)`;
  const ti = await query(
    `SELECT r.id, r.title, r.priority, r.status, r.kind, r.desired_date::text AS desejada,
            to_char(${DIA_TI}, 'YYYY-MM-DD') AS dia,
            CASE WHEN r.kind = 'visita' AND r.desired_date IS NOT NULL THEN '' ELSE ${HORA('r.created_at')} END AS hora,
            l.name AS posto, uh.name AS responsavel,
            (SELECT count(*)::int FROM gbf_request_items i WHERE i.request_id = r.id) AS tarefas,
            (SELECT count(*)::int FROM gbf_visit_answers a WHERE a.visit_id = r.visit_id AND a.answer = 'nao_ok') AS problemas
     FROM gbf_requests r
     LEFT JOIN gbf_locations l ON l.id = r.location_id
     LEFT JOIN gbf_users uh ON uh.id = r.handled_by
     WHERE r.status <> 'cancelada' AND ${DIA_TI} BETWEEN $1::date AND $2::date
     ORDER BY r.created_at`, [inicio, fim]);
  for (const r of ti.rows) {
    const aberto = ['a_fazer', 'em_andamento'].includes(r.status);
    const visita = r.kind === 'visita';
    itens.push({
      fonte: 'ti', id: r.id, numero: `S-${String(r.id).padStart(4, '0')}`, titulo: r.title, dia: r.dia, hora: r.hora,
      prioridade: Number(r.priority) || 1,
      situacao: visita ? ({ a_fazer: 'Visita a fazer', em_andamento: 'Visita em andamento', concluida: 'Visita feita' }[r.status] || '—') : (STATUS_TI[r.status] || '—'),
      aberto, feito: r.status === 'concluida',
      atrasado: aberto && !!r.desejada && r.desejada < hoje,
      detalhe: [r.posto, visita ? `${r.tarefas} tarefa(s)` : null, r.status === 'concluida' && r.problemas ? `${r.problemas} com problema` : null]
        .filter(Boolean).join(' · '),
      responsavel: r.responsavel, link: `#/solicitacoes/${r.id}`,
    });
  }

  const [tarefas, faixasRows, rotina] = await Promise.all([
    query(`SELECT t.id, t.title, t.priority, t.status, t.all_day, ${DIA('t.due_at')} AS dia,
              CASE WHEN t.all_day THEN '' ELSE ${HORA('t.due_at')} END AS hora, (t.due_at < now()) AS vencida,
              l.name AS posto, u.name AS responsavel, to_char(t.start_date, 'YYYY-MM-DD') AS comeca,
              (SELECT json_agg(x) FROM (SELECT uq.name AS quem, e.content AS texto, e.created_at AS quando
                 FROM gbf_task_events e LEFT JOIN gbf_users uq ON uq.id = e.user_id
                 WHERE e.task_id = t.id AND e.kind = 'comment' ORDER BY e.created_at DESC LIMIT 2) x) AS comentarios
       FROM gbf_tasks t
       LEFT JOIN gbf_locations l ON l.id = t.location_id
       LEFT JOIN gbf_users u ON u.id = t.assignee_id
       WHERE t.status <> 'cancelada' AND t.due_at >= ${INI} AND t.due_at < ${FIM}`, [inicio, fim]),
    // atividades de vários dias que passam pela grade (do início à entrega)
    query(`SELECT t.id, t.title, t.priority, t.status, to_char(t.start_date, 'YYYY-MM-DD') AS ini, ${DIA('t.due_at')} AS fim,
              (t.due_at < now()) AS vencida, l.name AS posto, u.name AS responsavel,
              (SELECT json_agg(x) FROM (SELECT uq.name AS quem, e.content AS texto, e.created_at AS quando
                 FROM gbf_task_events e LEFT JOIN gbf_users uq ON uq.id = e.user_id
                 WHERE e.task_id = t.id AND e.kind = 'comment' ORDER BY e.created_at DESC LIMIT 2) x) AS comentarios
       FROM gbf_tasks t
       LEFT JOIN gbf_locations l ON l.id = t.location_id
       LEFT JOIN gbf_users u ON u.id = t.assignee_id
       WHERE t.status <> 'cancelada' AND t.start_date IS NOT NULL AND t.due_at IS NOT NULL
         AND t.start_date < (t.due_at AT TIME ZONE '${TZ}')::date
         AND t.start_date <= $2::date AND (t.due_at AT TIME ZONE '${TZ}')::date >= $1::date`, [inicio, fim]),
    query(`SELECT l.id, l.name, l.next_visit_date::text AS dia, COALESCE(to_char(l.next_visit_time, 'HH24:MI'), '') AS hora,
              c.name AS checklist
       FROM gbf_locations l LEFT JOIN gbf_checklists c ON c.id = l.checklist_id
       WHERE l.active AND l.next_visit_date BETWEEN $1::date AND $2::date`, [inicio, fim]),
  ]);
  for (const t of tarefas.rows) {
    const aberto = !['concluida', 'cancelada'].includes(t.status);
    itens.push({
      fonte: 'ti', tipo: 'atividade', id: t.id, numero: `A-${String(t.id).padStart(4, '0')}`, titulo: t.title, dia: t.dia, hora: t.hora,
      prioridade: Number(t.priority) || 1, situacao: STATUS_TAREFA[t.status] || '—', aberto, feito: t.status === 'concluida',
      atrasado: aberto && t.vencida, detalhe: ['Atividade', t.posto].filter(Boolean).join(' · '),
      responsavel: t.responsavel, link: `#/atividades/${t.id}`,
      comentarios: t.comentarios || [], comeca: t.comeca && t.comeca < t.dia ? t.comeca : null,
    });
  }
  const faixas = faixasRows.rows.map((t) => {
    const aberto = !['concluida', 'cancelada'].includes(t.status);
    return {
      fonte: 'ti', tipo: 'atividade', id: t.id, numero: `A-${String(t.id).padStart(4, '0')}`, titulo: t.title, ini: t.ini, fim: t.fim,
      prioridade: Number(t.priority) || 1, situacao: STATUS_TAREFA[t.status] || '—', aberto, feito: t.status === 'concluida',
      atrasado: aberto && t.vencida, detalhe: ['Atividade de vários dias', t.posto].filter(Boolean).join(' · '),
      responsavel: t.responsavel, link: `#/atividades/${t.id}`, comentarios: t.comentarios || [], hora: '',
    };
  });
  for (const l of rotina.rows) {
    itens.push({
      fonte: 'ti', tipo: 'rotina', id: l.id, numero: 'Rotina', titulo: `Visita de rotina — ${l.name}`, dia: l.dia, hora: l.hora,
      prioridade: 1, situacao: 'Visita prevista', aberto: true, feito: false, atrasado: l.dia < hoje,
      detalhe: l.checklist || '', responsavel: null, link: `#/postos/${l.id}`,
    });
  }

  res.json({ mes, primeiro, ultimo, inicio, fim, hoje, orcim_ok: orcimOk, urgencias: PRIORIDADE_CENTRAL, itens, faixas });
}));

module.exports = router;
