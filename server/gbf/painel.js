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
const { ah, escopoTickets, STATUS_CENTRAL } = require('./common');
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

// Agrupa os dias do período em dia / semana / mês, conforme o tamanho do período
function montarEixo(de, ate) {
  const n = difDias(de, ate) + 1;
  const escala = n <= 62 ? 'dia' : n <= 200 ? 'semana' : 'mes';
  const chave = (iso) => {
    if (escala === 'dia') return iso;
    if (escala === 'mes') return `${iso.slice(0, 7)}-01`;
    // semana começando na segunda-feira (limitada ao início do período)
    const dow = new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = domingo
    const seg = somaDias(iso, -((dow + 6) % 7));
    return seg < de ? de : seg;
  };
  const baldes = [];
  const vistos = new Set();
  for (let i = 0; i < n; i += 1) {
    const k = chave(somaDias(de, i));
    if (!vistos.has(k)) { vistos.add(k); baldes.push(k); }
  }
  return { escala, chave, baldes };
}

router.get('/', requireGestor, ah(async (req, res) => {
  // ---------------- período ----------------
  const hoje = diaSP(new Date());
  let de = dataOk(req.query.de) ? req.query.de : somaDias(hoje, -29);
  let ate = dataOk(req.query.ate) ? req.query.ate : hoje;
  if (ate < de) [de, ate] = [ate, de];
  if (difDias(de, ate) + 1 > MAX_DIAS) de = somaDias(ate, -(MAX_DIAS - 1));
  const dias = difDias(de, ate) + 1;
  const eixo = montarEixo(de, ate);
  const noPeriodo = (d) => {
    if (!d) return false;
    const x = diaSP(d);
    return x >= de && x <= ate;
  };

  // ---------------- Orcim (Central) ----------------
  // em aberto agora + tudo que foi mexido desde o início do período (cobre criadas e resolvidas)
  const params = [];
  const escopo = await escopoTickets(params);
  params.push(de);
  const iniPeriodo = `($${params.length}::date::timestamp AT TIME ZONE '${TZ}')`;
  const { rows } = await queryCentral(
    `${DEMANDA_SELECT}
     WHERE ${escopo} AND (t.status NOT IN (5,6,7) OR t.updated_at >= ${iniPeriodo})`, params);

  const agora = new Date();
  const lista = rows.map((d) => enriquecer(d, agora));
  const criadas = lista.filter((d) => noPeriodo(d.created_at));
  const resolvidas = lista.filter((d) => noPeriodo(d.resolvido_em));
  const resolvidasComPrazo = resolvidas.filter((d) => d.due_at);
  const cumpridas = resolvidasComPrazo.filter((d) => d.sla === 'cumprido');
  const abertas = lista.filter((d) => d.aberto);
  const atrasadas = abertas.filter((d) => d.sla === 'atrasado');

  const serieOrcim = new Map(eixo.baldes.map((b) => [b, { periodo: b, criadas: 0, resolvidas: 0 }]));
  for (const d of criadas) serieOrcim.get(eixo.chave(diaSP(d.created_at))).criadas += 1;
  for (const d of resolvidas) serieOrcim.get(eixo.chave(diaSP(d.resolvido_em))).resolvidas += 1;

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
  const DIA = (col) => `to_char(${col} AT TIME ZONE '${TZ}', 'YYYY-MM-DD')`;
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

  const serieTI = new Map(eixo.baldes.map((b) => [b, { periodo: b, visitas: 0, atividades: 0, solicitacoes: 0 }]));
  const somar = (linhas, campo) => linhas.forEach((r) => {
    const s = serieTI.get(eixo.chave(r.dia));
    if (s) s[campo] += 1;
  });
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

  res.json({
    periodo: { de, ate, dias, escala: eixo.escala, gerado_em: new Date().toISOString() },
    orcim,
    ti,
  });
}));

module.exports = router;
