const express = require('express');
const { query } = require('../db');
const { requireAuth, scopeConditions, has, entityIdsOf } = require('../middleware/auth');

// ---------------------------------------------------------------------
// Relatórios para exportar em PDF (Atendimento > Relatórios em PDF)
//   GET /api/relatorios?de=2026-11-01&ate=2026-11-30&agrupar=mes&entity_id=&location_id=&secoes=a,b,c
//   O PDF é montado na tela (public/js/views/relatorios.js) e salvo pelo "Salvar como PDF" do navegador.
//   Cada seção só vem para quem tem a permissão dela:
//     - tudo precisa de dashboard.view
//     - notas dos postos e causas de fechamento: ticket.rating
//     - valores em dinheiro: inventory.secrets
//     - inventário e Estoque de T.I.: stock.report
//   Itens da ORCIM (sem empresa) ficam fora, como nas outras telas das empresas.
// ---------------------------------------------------------------------
const router = express.Router();
router.use(requireAuth);

const SECOES = [
  'abertos', 'fechados', 'razoes', 'atraso', 'paradas',
  'req_posto', 'comprados', 'entregues', 'pendentes',
  'estrelas', 'problemas', 'custos',
  'inv_ativo', 'inv_periodo', 'estoque',
];

const UN = "(CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END)";
const dataOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));
const hojeISO = () => new Date().toISOString().slice(0, 10);

function lerPeriodo(q) {
  const ate = dataOk(q.ate) ? q.ate : hojeISO();
  let de = dataOk(q.de) ? q.de : `${ate.slice(0, 7)}-01`;
  if (de > ate) de = ate;
  const dias = Math.round((Date.parse(ate) - Date.parse(de)) / 86400000) + 1;
  // agrupar os gráficos: semana, mês ou ano (sem escolha: pelo tamanho do período)
  let agrupar = ['semana', 'mes', 'ano'].includes(q.agrupar) ? q.agrupar : null;
  if (!agrupar) agrupar = dias <= 62 ? 'semana' : dias <= 800 ? 'mes' : 'ano';
  return { de, ate, dias, agrupar, trunc: { semana: 'week', mes: 'month', ano: 'year' }[agrupar] };
}

router.get('/', async (req, res) => {
  const user = req.user;
  if (!has(user, 'dashboard.view')) return res.status(403).json({ error: 'Seu perfil não vê os relatórios.' });
  const per = lerPeriodo(req.query);
  const pedidas = String(req.query.secoes || '').split(',').filter((s) => SECOES.includes(s));
  const querSecao = (s) => !pedidas.length || pedidas.includes(s);
  const veNota = has(user, 'ticket.rating');
  const veValor = has(user, 'inventory.secrets');
  const veInv = has(user, 'stock.report');
  const entityId = /^\d+$/.test(String(req.query.entity_id || '')) ? req.query.entity_id : null;
  const locationId = /^\d+$/.test(String(req.query.location_id || '')) ? req.query.location_id : null;

  // ---- filtros dos chamados (o que a pessoa pode ver + empresa + posto) ----
  const scope = scopeConditions(user, 1);
  const pT = [...scope.params];
  const cT = [];
  if (scope.sql) cT.push(scope.sql);
  if (entityId) { pT.push(entityId); cT.push(`t.entity_id = $${pT.length}`); }
  if (locationId) { pT.push(locationId); cT.push(`t.location_id = $${pT.length}`); }
  const pT0 = [...pT]; // sem as datas (para o que vale agora, não no período)
  pT.push(per.de); const iDe = pT.length;
  pT.push(per.ate); const iAte = pT.length;
  const fT = cT.length ? `AND ${cT.join(' AND ')}` : '';
  const noPeriodo = (col) => `${col} >= $${iDe}::date AND ${col} < ($${iAte}::date + 1)`;
  const balde = (col) => `to_char(date_trunc('${per.trunc}', ${col}), 'YYYY-MM-DD')`;
  const FECH = 'COALESCE(t.resolved_at, t.closed_at, t.updated_at)';
  const POSTO_T = `COALESCE(l.name, 'Sem posto')`;
  const JOIN_T = 'JOIN entities e ON e.id = t.entity_id LEFT JOIN locations l ON l.id = t.location_id';

  // ---- filtros do inventário (empresas que a pessoa vê; sem itens da ORCIM) ----
  const pA = [];
  let fA = 'AND a.entity_id IS NOT NULL';
  const ents = entityIdsOf(user);
  if (ents !== null) { pA.push(ents); fA += ` AND a.entity_id::text = ANY($${pA.length}::text[])`; }
  if (entityId) { pA.push(entityId); fA += ` AND a.entity_id = $${pA.length}`; }
  if (locationId) { pA.push(locationId); fA += ` AND a.location_id = $${pA.length}`; }

  const tarefas = {};
  const q = (nome, sql, params) => { tarefas[nome] = query(sql, params).then((r) => r.rows); };

  // ===================== Chamados =====================
  if (querSecao('abertos')) {
    q('abertos', `
      SELECT t.id, t.title, t.status, t.priority, t.created_at, e.name AS empresa, ${POSTO_T} AS posto,
             il.name AS urgencia, u.name AS tecnico, COALESCE(sc.name, c.name) AS categoria,
             round(extract(epoch FROM now() - t.created_at) / 3600)::int AS horas_aberto
      FROM tickets t ${JOIN_T}
      LEFT JOIN impact_levels il ON il.id = t.impact_id
      LEFT JOIN users u ON u.id = t.assigned_user_id
      LEFT JOIN categories sc ON sc.id = t.simple_category_id LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.status IN (1,2,3,4) ${fT}
      ORDER BY t.priority DESC, t.created_at LIMIT 400`, pT0);
  }
  if (querSecao('fechados')) {
    q('fechados', `
      SELECT t.id, t.title, t.created_at, ${FECH} AS fechado_em, e.name AS empresa, ${POSTO_T} AS posto,
             u.name AS tecnico, ${veNota ? 'rc.name' : 'NULL'} AS causa, ${veNota ? 't.requester_rating' : 'NULL'} AS nota,
             round(extract(epoch FROM ${FECH} - t.created_at) / 3600)::int AS horas
      FROM tickets t ${JOIN_T}
      LEFT JOIN users u ON u.id = COALESCE(t.resolved_by_id, t.assigned_user_id)
      LEFT JOIN resolution_causes rc ON rc.id = t.resolution_cause_id
      WHERE t.status IN (5,6) AND ${noPeriodo(FECH)} ${fT}
      ORDER BY ${FECH} DESC LIMIT 400`, pT);
    q('fechados_serie', `
      SELECT ${balde('t.created_at')} AS balde, count(*)::int AS n FROM tickets t
      WHERE t.status <> 7 AND ${noPeriodo('t.created_at')} ${fT} GROUP BY 1`, pT);
    q('fechados_serie2', `
      SELECT ${balde(FECH)} AS balde, count(*)::int AS n FROM tickets t
      WHERE t.status IN (5,6) AND ${noPeriodo(FECH)} ${fT} GROUP BY 1`, pT);
  }
  if (querSecao('razoes')) {
    q('razoes_abertura', `
      SELECT COALESCE(sc.name, c.name, 'Sem categoria') AS nome, count(*)::int AS total
      FROM tickets t LEFT JOIN categories sc ON sc.id = t.simple_category_id LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.status <> 7 AND ${noPeriodo('t.created_at')} ${fT}
      GROUP BY 1 ORDER BY total DESC, nome`, pT);
    if (veNota) {
      q('razoes_fechamento', `
        SELECT COALESCE(rc.name, 'Sem causa informada') AS nome, count(*)::int AS total
        FROM tickets t LEFT JOIN resolution_causes rc ON rc.id = t.resolution_cause_id
        WHERE t.status IN (5,6) AND ${noPeriodo(FECH)} ${fT}
        GROUP BY 1 ORDER BY (min(rc.name) IS NULL), total DESC, nome`, pT);
    }
  }
  if (querSecao('atraso')) {
    // prazo = SLA (due_at); sem SLA, a previsão da TI; sem previsão, a data que o usuário precisava
    //   atrasados = fechados no período depois do prazo + abertos com o prazo já vencido
    const PRAZO = `COALESCE(t.due_at, t.estimated_at, (t.needed_by + 1)::timestamptz)`;
    const FIM = `(CASE WHEN t.status IN (5,6) THEN ${FECH} ELSE now() END)`;
    q('atraso', `
      SELECT t.id, t.title, t.status, e.name AS empresa, ${POSTO_T} AS posto, u.name AS tecnico,
             ${PRAZO} AS prazo, ${FIM} AS fim,
             round(extract(epoch FROM ${FIM} - ${PRAZO}) / 3600)::int AS horas_atraso
      FROM tickets t ${JOIN_T} LEFT JOIN users u ON u.id = t.assigned_user_id
      WHERE t.status <> 7 AND ${PRAZO} IS NOT NULL AND ${FIM} > ${PRAZO}
        AND (t.status IN (1,2,3,4) OR ${noPeriodo(FECH)}) ${fT}
      ORDER BY horas_atraso DESC LIMIT 300`, pT);
    q('atraso_total', `
      SELECT count(*) FILTER (WHERE ${PRAZO} IS NOT NULL)::int AS com_prazo,
             count(*) FILTER (WHERE ${PRAZO} IS NOT NULL AND ${FECH} <= ${PRAZO})::int AS no_prazo
      FROM tickets t WHERE t.status IN (5,6) AND ${noPeriodo(FECH)} ${fT}`, pT);
  }
  if (querSecao('paradas')) {
    // Operação parada = urgência de prioridade 4
    q('paradas', `
      SELECT t.id, t.title, t.created_at, ${FECH} AS fechado_em, e.name AS empresa, ${POSTO_T} AS posto, u.name AS tecnico,
             COALESCE(sc.name, c.name) AS categoria,
             round(extract(epoch FROM ${FECH} - t.created_at) / 60)::int AS minutos
      FROM tickets t ${JOIN_T}
      LEFT JOIN users u ON u.id = COALESCE(t.resolved_by_id, t.assigned_user_id)
      LEFT JOIN categories sc ON sc.id = t.simple_category_id LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.priority = 4 AND t.status IN (5,6) AND ${noPeriodo(FECH)} ${fT}
      ORDER BY ${FECH} DESC LIMIT 300`, pT);
    q('paradas_abertas', `SELECT count(*)::int AS n FROM tickets t WHERE t.priority = 4 AND t.status IN (1,2,3,4) ${fT}`, pT0);
  }

  // ===================== Pedidos de material =====================
  //   posto do item = posto do pedido (ou o do chamado)
  const JOIN_M = `JOIN tickets t ON t.id = m.ticket_id JOIN entities e ON e.id = t.entity_id
                  LEFT JOIN locations l ON l.id = COALESCE(m.location_id, t.location_id)`;
  const VALOR_M = veValor ? '(m.price * m.quantity)::float' : 'NULL::float';
  if (querSecao('req_posto')) {
    q('req_posto', `
      SELECT e.name AS empresa, COALESCE(l.name, 'Sem posto') AS posto, m.name AS item,
             sum(m.quantity)::int AS qtd, count(DISTINCT t.id)::int AS chamados,
             ${veValor ? 'sum(m.price * m.quantity)::float' : 'NULL::float'} AS valor,
             ${veValor ? 'count(*) FILTER (WHERE m.price IS NULL)::int' : '0'} AS sem_preco
      FROM ticket_materials m ${JOIN_M}
      WHERE m.status <> 'cancelado' AND t.status <> 7 AND ${noPeriodo('t.created_at')} ${fT}
      GROUP BY 1, 2, 3 ORDER BY 1, 2, qtd DESC`, pT);
  }
  const listaEtapa = (nome, etapa) => q(nome, `
      SELECT m.id, m.name AS item, m.quantity AS qtd, m.unit, m.status, t.id AS ticket_id, e.name AS empresa,
             COALESCE(l.name, 'Sem posto') AS posto, ${VALOR_M} AS valor,
             (m.etapas->>'${etapa}')::timestamptz AS quando
      FROM ticket_materials m ${JOIN_M}
      WHERE m.etapas ? '${etapa}' AND ${noPeriodo(`(m.etapas->>'${etapa}')::timestamptz`)} ${fT}
      ORDER BY quando DESC LIMIT 400`, pT);
  if (querSecao('comprados')) listaEtapa('comprados', 'comprado');
  if (querSecao('entregues')) listaEtapa('entregues', 'entregue');
  if (querSecao('pendentes')) {
    q('pendentes', `
      SELECT m.id, m.name AS item, m.quantity AS qtd, m.unit, m.status, m.previsao, t.id AS ticket_id, t.created_at,
             e.name AS empresa, COALESCE(l.name, 'Sem posto') AS posto, ${VALOR_M} AS valor,
             (now()::date - t.created_at::date) AS dias
      FROM ticket_materials m ${JOIN_M}
      WHERE m.status NOT IN ('entregue','cancelado') AND t.status <> 7 ${fT}
      ORDER BY t.created_at LIMIT 400`, pT0);
  }

  // ===================== Postos =====================
  if (querSecao('estrelas') && veNota) {
    // média das estrelas por posto em cada semana/mês + mês atual (o do fim do período) x mês anterior
    q('estrelas_serie', `
      SELECT e.name AS empresa, ${POSTO_T} AS posto, ${balde(FECH)} AS balde,
             round(avg(t.requester_rating)::numeric, 2)::float AS media, count(*)::int AS n
      FROM tickets t ${JOIN_T}
      WHERE t.status IN (5,6) AND t.requester_rating IS NOT NULL AND ${noPeriodo(FECH)} ${fT}
      GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, pT);
    q('estrelas_mes', `
      SELECT e.name AS empresa, ${POSTO_T} AS posto,
             round(avg(t.requester_rating) FILTER (WHERE ${FECH} >= date_trunc('month', $${iAte}::date)
                                                   AND ${FECH} < date_trunc('month', $${iAte}::date) + interval '1 month')::numeric, 2)::float AS mes_atual,
             count(*) FILTER (WHERE ${FECH} >= date_trunc('month', $${iAte}::date)
                              AND ${FECH} < date_trunc('month', $${iAte}::date) + interval '1 month')::int AS n_atual,
             round(avg(t.requester_rating) FILTER (WHERE ${FECH} >= date_trunc('month', $${iAte}::date) - interval '1 month'
                                                   AND ${FECH} < date_trunc('month', $${iAte}::date))::numeric, 2)::float AS mes_anterior,
             count(*) FILTER (WHERE ${FECH} >= date_trunc('month', $${iAte}::date) - interval '1 month'
                              AND ${FECH} < date_trunc('month', $${iAte}::date))::int AS n_anterior
      FROM tickets t ${JOIN_T}
      WHERE t.status IN (5,6) AND t.requester_rating IS NOT NULL
        AND ${FECH} >= date_trunc('month', $${iAte}::date) - interval '1 month'
        AND ${FECH} < date_trunc('month', $${iAte}::date) + interval '1 month' AND $${iDe}::date IS NOT NULL ${fT}
      GROUP BY 1, 2`, pT);
  }
  if (querSecao('problemas')) {
    q('problemas_cat', `
      SELECT e.name AS empresa, ${POSTO_T} AS posto, COALESCE(sc.name, c.name, 'Sem categoria') AS nome, count(*)::int AS total
      FROM tickets t ${JOIN_T}
      LEFT JOIN categories sc ON sc.id = t.simple_category_id LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.status <> 7 AND ${noPeriodo('t.created_at')} ${fT}
      GROUP BY 1, 2, 3`, pT);
    if (veNota) {
      q('problemas_causa', `
        SELECT e.name AS empresa, ${POSTO_T} AS posto, rc.name AS nome, count(*)::int AS total
        FROM tickets t ${JOIN_T} JOIN resolution_causes rc ON rc.id = t.resolution_cause_id
        WHERE t.status IN (5,6) AND ${noPeriodo(FECH)} ${fT}
        GROUP BY 1, 2, 3`, pT);
    }
  }
  if (querSecao('custos') && veValor) {
    // custo de T.I. por posto: compras (pedidos com preço), retiradas do Estoque de T.I. e prejuízo (estragado/perdido)
    const pM = [per.de, per.ate];
    let fM = ' AND m.to_entity_id IS NOT NULL';
    if (ents !== null) { pM.push(ents); fM += ` AND m.to_entity_id::text = ANY($${pM.length}::text[])`; }
    if (entityId) { pM.push(entityId); fM += ` AND m.to_entity_id = $${pM.length}`; }
    if (locationId) { pM.push(locationId); fM += ` AND m.to_location_id = $${pM.length}`; }
    const pP = [per.de, per.ate, ...pA];
    const fP = fA.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 2}`);
    q('custo_compras', `
      SELECT e.name AS empresa, COALESCE(l.name, 'Sem posto') AS posto, sum(m.price * m.quantity)::float AS valor, sum(m.quantity)::int AS n
      FROM ticket_materials m ${JOIN_M}
      WHERE m.price IS NOT NULL AND m.etapas ? 'comprado' AND ${noPeriodo(`(m.etapas->>'comprado')::timestamptz`)} ${fT}
      GROUP BY 1, 2`, pT);
    q('custo_retiradas', `
      SELECT e.name AS empresa, COALESCE(l.name, 'Sem posto') AS posto, COALESCE(sum(m.price), 0)::float AS valor, sum(m.quantity)::int AS n
      FROM stock_movements m LEFT JOIN locations l ON l.id = m.to_location_id LEFT JOIN entities e ON e.id = m.to_entity_id
      WHERE m.kind = 'withdraw' AND m.created_at >= $1::date AND m.created_at < ($2::date + 1) ${fM}
      GROUP BY 1, 2`, pM);
    q('custo_perdas', `
      SELECT e.name AS empresa, COALESCE(l.name, 'Sem posto') AS posto, a.name AS item, a.status,
             COALESCE(a.price * ${UN}, 0)::float AS valor, ${UN}::int AS n
      FROM assets a JOIN entities e ON e.id = a.entity_id LEFT JOIN locations l ON l.id = a.location_id
      WHERE a.status IN ('BROKEN','LOST') ${fP}
        AND EXISTS (SELECT 1 FROM asset_history h WHERE h.asset_id = a.id
                    AND h.created_at >= $1::date AND h.created_at < ($2::date + 1)
                    AND ((h.field = 'status' AND h.new_value IN ('BROKEN','LOST')) OR h.action = 'StockReplaced'))
      ORDER BY valor DESC`, pP);
  }

  // ===================== Inventário e Estoque de T.I. =====================
  const valorA = veValor ? `COALESCE(sum(a.price * ${UN}), 0)::float` : 'NULL::float';
  if (veInv && querSecao('inv_ativo')) {
    // inventário ativo = equipamentos em uso nos postos (operando ou em conserto)
    q('inv_ativo', `
      SELECT a.type, COALESCE(sum(${UN}), 0)::int AS n, ${valorA} AS valor
      FROM assets a WHERE a.status IN ('OPERATING','REPAIR') ${fA} GROUP BY 1 ORDER BY 3 DESC NULLS LAST, 2 DESC`, pA);
    q('inv_ativo_posto', `
      SELECT e.name AS empresa, COALESCE(l.name, 'Sem posto') AS posto, COALESCE(sum(${UN}), 0)::int AS n, ${valorA} AS valor
      FROM assets a JOIN entities e ON e.id = a.entity_id LEFT JOIN locations l ON l.id = a.location_id
      WHERE a.status IN ('OPERATING','REPAIR') ${fA} GROUP BY 1, 2 ORDER BY 4 DESC NULLS LAST, 3 DESC`, pA);
  }
  if (veInv && querSecao('inv_periodo')) {
    // custo do inventário no período: o que entrou em cada semana/mês/ano (data de compra; sem ela, a do cadastro)
    //   e quanto o inventário valia no fim de cada uma (itens que já existiam e não foram descartados/perdidos)
    const pI = [per.de, per.ate, ...pA];
    const fI = fA.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 2}`);
    const DATA_A = 'COALESCE(a.purchase_date::timestamptz, a.created_at)';
    q('inv_entradas', `
      SELECT to_char(date_trunc('${per.trunc}', ${DATA_A}), 'YYYY-MM-DD') AS balde,
             COALESCE(sum(${UN}), 0)::int AS n, ${valorA} AS valor
      FROM assets a WHERE ${DATA_A} >= $1::date AND ${DATA_A} < ($2::date + 1) AND a.status <> 'DISPOSED' ${fI}
      GROUP BY 1 ORDER BY 1`, pI);
    q('inv_antes', `
      SELECT COALESCE(sum(${UN}), 0)::int AS n, ${valorA} AS valor
      FROM assets a WHERE ${DATA_A} < $1::date AND a.status NOT IN ('DISPOSED','LOST','BROKEN') AND $2::date IS NOT NULL ${fI}`, pI);
  }
  if (veInv && querSecao('estoque')) {
    // Estoque de T.I. = Em estoque, Na ORCIM (aguardando entrega) e Comprado (a caminho da ORCIM)
    q('estoque', `
      SELECT a.status, a.type, COALESCE(sum(${UN}), 0)::int AS n, ${valorA} AS valor
      FROM assets a WHERE a.status IN ('STOCK','READY','ORDERED') ${fA} GROUP BY 1, 2 ORDER BY 4 DESC NULLS LAST, 3 DESC`, pA);
    q('estoque_posto', `
      SELECT e.name AS empresa, COALESCE(l.name, 'Sem posto') AS posto, COALESCE(sum(${UN}), 0)::int AS n, ${valorA} AS valor
      FROM assets a JOIN entities e ON e.id = a.entity_id LEFT JOIN locations l ON l.id = a.location_id
      WHERE a.status IN ('STOCK','READY','ORDERED') ${fA} GROUP BY 1, 2 ORDER BY 4 DESC NULLS LAST, 3 DESC`, pA);
    if (veValor) {
      const pM = [per.de, per.ate];
      let fM = ' AND m.to_entity_id IS NOT NULL';
      if (ents !== null) { pM.push(ents); fM += ` AND m.to_entity_id::text = ANY($${pM.length}::text[])`; }
      if (entityId) { pM.push(entityId); fM += ` AND m.to_entity_id = $${pM.length}`; }
      if (locationId) { pM.push(locationId); fM += ` AND m.to_location_id = $${pM.length}`; }
      q('estoque_retiradas', `
        SELECT to_char(date_trunc('${per.trunc}', m.created_at), 'YYYY-MM-DD') AS balde,
               sum(m.quantity)::int AS n, COALESCE(sum(m.price), 0)::float AS valor
        FROM stock_movements m WHERE m.kind = 'withdraw' AND m.created_at >= $1::date AND m.created_at < ($2::date + 1) ${fM}
        GROUP BY 1 ORDER BY 1`, pM);
    }
  }

  try {
    const nomes = Object.keys(tarefas);
    const valores = await Promise.all(nomes.map((n) => tarefas[n]));
    const dados = {};
    nomes.forEach((n, i) => { dados[n] = valores[i]; });
    // nomes da empresa e do posto escolhidos (para o cabeçalho do PDF)
    const filtro = {};
    if (entityId) filtro.empresa = (await query('SELECT name FROM entities WHERE id = $1', [entityId])).rows[0]?.name || null;
    if (locationId) filtro.posto = (await query('SELECT name FROM locations WHERE id = $1', [locationId])).rows[0]?.name || null;
    res.json({
      periodo: per, filtro, gerado_em: new Date().toISOString(), gerado_por: user.name,
      pode: { notas: veNota, valores: veValor, inventario: veInv },
      dados,
    });
  } catch (err) {
    res.status(500).json({ error: 'Não foi possível montar o relatório.', details: err.message });
  }
});

module.exports = router;
module.exports.SECOES = SECOES;
