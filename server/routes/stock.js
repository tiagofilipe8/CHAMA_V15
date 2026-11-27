const express = require('express');
const { query, withTransaction } = require('../db');
const { requireAuth, canAccessEntity, entityIdsOf, has } = require('../middleware/auth');
const notify = require('../services/notify');
const { perfilDaEmpresa, doPerfil } = require('./optionProfiles');

// ---------------------------------------------------------------------
// Estoque de T.I.
//   Itens do inventário guardados no estoque de cada posto (Em estoque, Pronto para
//   entregar e Comprado - aguardando chegar).
//   - Gestor/usuário: vê o estoque das próprias empresas e dá baixa no item que pegou,
//     dizendo o motivo (Categorias e opções > Razões de retirada).
//   - Quem cadastra equipamentos: devolve ao estoque e transfere para outra unidade.
//   - Tudo vira uma movimentação (log do item e base do relatório).
// ---------------------------------------------------------------------
const router = express.Router();
router.use(requireAuth);

const NO_ESTOQUE = ['STOCK', 'READY', 'ORDERED'];
const PODE_PEGAR = ['STOCK', 'READY'];
const veSegredos = (u) => has(u, 'inventory.secrets');
const podeVer = (u) => has(u, 'stock.withdraw') || has(u, 'inventory.view');

function filtroEmpresas(user, params, alias = 'a') {
  const ents = entityIdsOf(user);
  if (ents === null) return '';
  params.push(ents);
  return `AND ${alias}.entity_id::text = ANY($${params.length}::text[])`;
}

async function carregarItem(id) {
  const { rows } = await query(
    `SELECT a.id, a.name, a.asset_tag, a.type, a.status, a.price, a.entity_id, a.location_id, a.controle, a.quantity,
            e.name AS entity_name, l.name AS location_name
     FROM assets a JOIN entities e ON e.id = a.entity_id LEFT JOIN locations l ON l.id = a.location_id
     WHERE a.id = $1`, [id]);
  return rows[0] || null;
}

// avisa quem cuida do estoque (equipe e gestores da empresa) que um item saiu
async function avisarSaida(item, user, texto) {
  const { rows } = await query(
    `SELECT u.id FROM users u
     WHERE u.active AND u.id <> $1
       AND (u.role IN ('admin','technician')
            OR (u.role = 'client' AND u.client_level >= 2 AND u.entity_id = $2))`, [user.id, item.entity_id]);
  for (const r of rows) {
    await notify.createInApp(r.id, `${user.name} pegou ${item.name}${item.asset_tag ? ` (${item.asset_tag})` : ''} do estoque`, texto, null, '#/estoque').catch(() => {});
  }
}

// Itens no estoque (?entity_id= ?location_id= ?q= ?status=)
router.get('/', async (req, res) => {
  if (!podeVer(req.user)) return res.status(403).json({ error: 'Seu perfil não vê o estoque de T.I.' });
  const params = [NO_ESTOQUE];
  let where = 'a.status = ANY($1::text[]) ' + filtroEmpresas(req.user, params);
  if (/^\d+$/.test(String(req.query.entity_id || ''))) { params.push(req.query.entity_id); where += ` AND a.entity_id = $${params.length}`; }
  if (/^\d+$/.test(String(req.query.location_id || ''))) { params.push(req.query.location_id); where += ` AND a.location_id = $${params.length}`; }
  if (req.query.status && NO_ESTOQUE.includes(req.query.status)) { params.push(req.query.status); where += ` AND a.status = $${params.length}`; }
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    where += ` AND (a.name ILIKE $${params.length} OR a.asset_tag ILIKE $${params.length} OR a.model ILIKE $${params.length} OR a.serial_number ILIKE $${params.length})`;
  }
  const { rows } = await query(
    `SELECT a.id, a.name, a.asset_tag, a.type, a.status, a.price, a.manufacturer, a.model, a.notes, a.updated_at, a.controle, a.quantity,
            a.entity_id, e.name AS entity_name, a.location_id, l.name AS location_name,
            (SELECT max(m.created_at) FROM stock_movements m WHERE m.asset_id = a.id AND m.kind IN ('entry','return','transfer')) AS desde,
            pd.pedido_status, pd.pedido_ticket_id
     FROM assets a JOIN entities e ON e.id = a.entity_id LEFT JOIN locations l ON l.id = a.location_id
     LEFT JOIN LATERAL (SELECT tm.status AS pedido_status, tm.ticket_id AS pedido_ticket_id FROM ticket_materials tm
       WHERE (tm.asset_id = a.id OR tm.asset_ids @> ARRAY[a.id]) AND tm.status <> 'cancelado' ORDER BY tm.id DESC LIMIT 1) pd ON TRUE
     WHERE ${where}
     ORDER BY e.name, l.name NULLS LAST, a.name LIMIT 1000`, params);
  const ver = veSegredos(req.user);
  res.json(rows.map((r) => (ver ? r : { ...r, price: undefined })));
});

// Razões de retirada da empresa (perfil de opções dela)
router.get('/reasons', async (req, res) => {
  const perfil = /^\d+$/.test(String(req.query.entity_id || '')) ? await perfilDaEmpresa(req.query.entity_id) : null;
  const { rows } = await query(
    `SELECT r.id, r.name, r.description, r.efeito FROM stock_reasons r WHERE ${doPerfil('r', 1)} AND r.active ORDER BY r.sort_order, r.name`, [perfil]);
  res.json(rows);
});

// Efeito do motivo no item substituído (o que a pessoa pegou foi para trocar outro)
const EFEITOS = { BROKEN: 'Estragado', REPAIR: 'Em conserto', LOST: 'Extraviado', STOCK: 'Volta ao estoque' };

// Itens que podem ter sido substituídos: os com etiqueta do posto de destino (do mesmo tipo primeiro)
router.get('/:id/afetaveis', async (req, res) => {
  if (!has(req.user, 'stock.withdraw')) return res.status(403).json({ error: 'Acesso negado.' });
  const item = await carregarItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
  if (!canAccessEntity(req.user, item.entity_id)) return res.status(403).json({ error: 'Acesso negado.' });
  const local = /^\d+$/.test(String(req.query.location_id || '')) ? req.query.location_id : item.location_id;
  const { rows } = await query(
    `SELECT a.id, a.name, a.asset_tag, a.type, a.status, a.price, l.name AS location_name
     FROM assets a LEFT JOIN locations l ON l.id = a.location_id
     WHERE a.entity_id = $1 AND a.id <> $2 AND a.controle = 'unidade'
       AND a.status IN ('OPERATING','REPAIR','BROKEN') AND a.location_id IS NOT DISTINCT FROM $3
     ORDER BY (a.type = $4) DESC, a.name LIMIT 200`, [item.entity_id, item.id, local, item.type]);
  res.json(veSegredos(req.user) ? rows : rows.map(({ price, ...r }) => r));
});

// Dar baixa: a pessoa pegou o item. Precisa do motivo.
//   { reason_id, note, location_id, quantidade (itens de quantidade), afetado_id | afetado: 'sem_etiqueta' }
router.post('/:id/withdraw', async (req, res) => {
  if (!has(req.user, 'stock.withdraw')) return res.status(403).json({ error: 'Seu perfil não pode dar baixa no estoque.' });
  const item = await carregarItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
  if (!canAccessEntity(req.user, item.entity_id)) return res.status(403).json({ error: 'Esse item não é do estoque da sua empresa.' });
  if (!PODE_PEGAR.includes(item.status)) return res.status(422).json({ error: 'Esse item não está disponível no estoque.' });
  const porQuantidade = item.controle === 'quantidade';
  const qtd = porQuantidade ? parseInt(req.body?.quantidade, 10) || 1 : 1;
  if (porQuantidade && (qtd < 1 || qtd > item.quantity)) {
    return res.status(422).json({ error: item.quantity ? `Tem ${item.quantity} no estoque. Escolha de 1 a ${item.quantity}.` : 'Esse item acabou no estoque.' });
  }
  const reasonId = String(req.body?.reason_id || '');
  const perfil = await perfilDaEmpresa(item.entity_id);
  const razao = /^\d+$/.test(reasonId) ? (await query(
    `SELECT id, name, efeito FROM stock_reasons r WHERE r.id = $2 AND r.active AND ${doPerfil('r', 1)}`, [perfil, reasonId])).rows[0] : null;
  if (!razao) return res.status(422).json({ error: 'Escolha o motivo da retirada.' });
  const nota = String(req.body?.note || '').trim().slice(0, 1000) || null;
  if (/^outro$/i.test(razao.name) && !nota) return res.status(422).json({ error: 'Explique o motivo na observação.' });
  // para onde vai: um posto da mesma empresa (sem escolher = fica no mesmo)
  let destino = item.location_id;
  if (req.body?.location_id) {
    const ok = await query('SELECT id FROM locations WHERE id = $1 AND entity_id = $2', [req.body.location_id, item.entity_id]);
    if (!ok.rows.length) return res.status(422).json({ error: 'Esse local não é da empresa do item.' });
    destino = ok.rows[0].id;
  }
  // item substituído (motivo com efeito): item com etiqueta escolhido, ou "sem etiqueta / não sei"
  let afetado = null;
  if (razao.efeito) {
    if (req.body?.afetado_id) {
      afetado = (await query(`SELECT id, name, asset_tag, status, entity_id, location_id, controle FROM assets WHERE id = $1`, [req.body.afetado_id])).rows[0];
      if (!afetado || String(afetado.entity_id) !== String(item.entity_id) || String(afetado.id) === String(item.id) || afetado.controle !== 'unidade') {
        return res.status(422).json({ error: 'Item substituído inválido.' });
      }
    } else if (req.body?.afetado !== 'sem_etiqueta' && !porQuantidade) {
      return res.status(422).json({ error: 'Diga qual item foi substituído (ou "sem etiqueta / não sei").', afetado_obrigatorio: true });
    }
  }
  const textoMotivo = `Motivo: ${razao.name}${afetado ? ` — substitui ${afetado.asset_tag ? `${afetado.asset_tag} · ` : ''}${afetado.name}` : ''}${nota ? ` — ${nota}` : ''}`;
  const custo = item.price === null || item.price === undefined ? null : Number(item.price) * qtd;
  await withTransaction(async (q) => {
    if (porQuantidade) {
      const upd = await q(`UPDATE assets SET quantity = quantity - $2 WHERE id = $1 AND quantity >= $2 RETURNING quantity`, [item.id, qtd]);
      if (!upd.rows.length) throw Object.assign(new Error('Não tem essa quantidade no estoque agora.'), { status: 409 });
    } else {
      const upd = await q(
        `UPDATE assets SET status = 'OPERATING', responsible_user_id = $2, location_id = $3
         WHERE id = $1 AND status = ANY($4::text[]) RETURNING id`, [item.id, req.user.id, destino, PODE_PEGAR]);
      if (!upd.rows.length) throw Object.assign(new Error('Outra pessoa acabou de pegar esse item.'), { status: 409 });
    }
    await q(
      `INSERT INTO stock_movements (asset_id, kind, user_id, reason_id, reason_name, from_entity_id, to_entity_id, from_location_id, to_location_id, price, note, quantity, replaced_asset_id)
       VALUES ($1,'withdraw',$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11)`,
      [item.id, req.user.id, razao.id, razao.name, item.entity_id, item.location_id, destino, custo, nota, qtd, afetado ? afetado.id : null]);
    await q(
      `INSERT INTO asset_history (asset_id, user_id, action, field, old_value, new_value)
       VALUES ($1,$2,'StockWithdraw','status',$3,$4)`, [item.id, req.user.id, item.status, `${porQuantidade ? `${qtd} un · ` : ''}${textoMotivo}`]);
    if (afetado) {
      // o item substituído muda de estado sozinho (e fica registrado quem o substituiu)
      await q('UPDATE assets SET status = $2 WHERE id = $1', [afetado.id, razao.efeito]);
      await q(`INSERT INTO asset_history (asset_id, user_id, action, field, old_value, new_value) VALUES ($1,$2,'StockReplaced','status',$3,$4)`,
        [afetado.id, req.user.id, afetado.status, `${EFEITOS[razao.efeito]} — substituído por ${item.asset_tag ? `${item.asset_tag} · ` : ''}${item.name} (${razao.name})`]);
      if (razao.efeito === 'STOCK') {
        await q(`INSERT INTO stock_movements (asset_id, kind, user_id, from_entity_id, to_entity_id, from_location_id, to_location_id, note)
                 VALUES ($1,'return',$2,$3,$3,$4,$4,$5)`, [afetado.id, req.user.id, item.entity_id, afetado.location_id, `Voltou ao estoque: trocado por ${item.name}`]);
      }
    }
  }).catch((e) => { if (e.status) { res.status(e.status).json({ error: e.message }); return 'respondido'; } throw e; })
    .then(async (r) => {
      if (r === 'respondido') return;
      await avisarSaida(item, req.user, `${porQuantidade ? `${qtd} un · ` : ''}${textoMotivo}`);
      res.json({ ok: true });
    });
});

// Devolver ao estoque (quem cadastra equipamentos)
router.post('/:id/return', async (req, res) => {
  if (!has(req.user, 'inventory.manage')) return res.status(403).json({ error: 'Seu perfil não pode devolver itens ao estoque.' });
  const item = await carregarItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
  if (!canAccessEntity(req.user, item.entity_id)) return res.status(403).json({ error: 'Acesso negado.' });
  if (item.status === 'STOCK') return res.status(422).json({ error: 'O item já está no estoque.' });
  let destino = item.location_id;
  if (req.body?.location_id) {
    const ok = await query('SELECT id FROM locations WHERE id = $1 AND entity_id = $2', [req.body.location_id, item.entity_id]);
    if (!ok.rows.length) return res.status(422).json({ error: 'Esse local não é da empresa do item.' });
    destino = ok.rows[0].id;
  }
  const nota = String(req.body?.note || '').trim().slice(0, 1000) || null;
  await query(`UPDATE assets SET status = 'STOCK', responsible_user_id = NULL, location_id = $2 WHERE id = $1`, [item.id, destino]);
  await query(
    `INSERT INTO stock_movements (asset_id, kind, user_id, from_entity_id, to_entity_id, from_location_id, to_location_id, price, note)
     VALUES ($1,'return',$2,$3,$3,$4,$5,$6,$7)`, [item.id, req.user.id, item.entity_id, item.location_id, destino, item.price, nota]);
  await query(`INSERT INTO asset_history (asset_id, user_id, action, field, old_value, new_value) VALUES ($1,$2,'StockReturn','status',$3,'STOCK')`,
    [item.id, req.user.id, item.status]);
  res.json({ ok: true });
});

// Transferir para outra unidade (posto e, se for o caso, outra empresa)
router.post('/:id/transfer', async (req, res) => {
  if (!has(req.user, 'inventory.manage')) return res.status(403).json({ error: 'Seu perfil não pode transferir itens.' });
  const item = await carregarItem(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
  if (!canAccessEntity(req.user, item.entity_id)) return res.status(403).json({ error: 'Acesso negado.' });
  const loc = (await query('SELECT id, entity_id, name FROM locations WHERE id = $1', [req.body?.location_id])).rows[0];
  if (!loc) return res.status(422).json({ error: 'Escolha a unidade de destino.' });
  if (!canAccessEntity(req.user, loc.entity_id)) return res.status(403).json({ error: 'Você não pode mandar itens para essa empresa.' });
  if (String(loc.id) === String(item.location_id)) return res.status(422).json({ error: 'O item já está nessa unidade.' });
  const nota = String(req.body?.note || '').trim().slice(0, 1000) || null;
  await query('UPDATE assets SET location_id = $2, entity_id = $3 WHERE id = $1', [item.id, loc.id, loc.entity_id]);
  if (String(loc.entity_id) !== String(item.entity_id)) {
    await query('INSERT INTO asset_customer_history (asset_id, old_entity_id, new_entity_id, user_id, reason) VALUES ($1,$2,$3,$4,$5)',
      [item.id, item.entity_id, loc.entity_id, req.user.id, nota]);
    await query('UPDATE agents SET entity_id = $1 WHERE asset_id = $2', [loc.entity_id, item.id]);
  }
  await query(
    `INSERT INTO stock_movements (asset_id, kind, user_id, from_entity_id, to_entity_id, from_location_id, to_location_id, price, note)
     VALUES ($1,'transfer',$2,$3,$4,$5,$6,$7,$8)`, [item.id, req.user.id, item.entity_id, loc.entity_id, item.location_id, loc.id, item.price, nota]);
  await query(`INSERT INTO asset_history (asset_id, user_id, action, field, old_value, new_value) VALUES ($1,$2,'StockTransfer','location_id',$3,$4)`,
    [item.id, req.user.id, item.location_name || '', loc.name]);
  res.json({ ok: true });
});

// Movimentações (log): do estoque todo ou de um item (?asset_id=)
router.get('/movements', async (req, res) => {
  if (!podeVer(req.user)) return res.status(403).json({ error: 'Seu perfil não vê o estoque de T.I.' });
  const params = [];
  let where = 'm.to_entity_id IS NOT NULL '; // entradas do Estoque da ORCIM (sem empresa) ficam fora
  const ents = entityIdsOf(req.user);
  if (ents !== null) { params.push(ents); where += `AND (m.from_entity_id::text = ANY($1::text[]) OR m.to_entity_id::text = ANY($1::text[])) `; }
  if (/^\d+$/.test(String(req.query.asset_id || ''))) { params.push(req.query.asset_id); where += `AND m.asset_id = $${params.length} `; }
  if (/^\d+$/.test(String(req.query.entity_id || ''))) { params.push(req.query.entity_id); where += `AND (m.from_entity_id = $${params.length} OR m.to_entity_id = $${params.length}) `; }
  const { rows } = await query(
    `SELECT m.*, a.name AS asset_name, a.asset_tag, a.type, u.name AS user_name,
            lf.name AS from_location_name, lt.name AS to_location_name, ef.name AS from_entity_name, et.name AS to_entity_name
     FROM stock_movements m JOIN assets a ON a.id = m.asset_id
     LEFT JOIN users u ON u.id = m.user_id
     LEFT JOIN locations lf ON lf.id = m.from_location_id LEFT JOIN locations lt ON lt.id = m.to_location_id
     LEFT JOIN entities ef ON ef.id = m.from_entity_id LEFT JOIN entities et ON et.id = m.to_entity_id
     WHERE ${where} ORDER BY m.created_at DESC LIMIT 300`, params);
  const ver = veSegredos(req.user);
  res.json(rows.map((r) => (ver ? r : { ...r, price: undefined })));
});

// Relatório (gestores e admin mestre): motivos, custos, categorias e postos
router.get('/report', async (req, res) => {
  if (!has(req.user, 'stock.report')) return res.status(403).json({ error: 'Seu perfil não vê o relatório de inventário.' });
  const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 90, 1), 3660);
  const pA = [];
  let fA = `AND a.entity_id IS NOT NULL ${filtroEmpresas(req.user, pA)}`; // itens da ORCIM (sem empresa) ficam fora
  // valor por empresa: compara todas as empresas que a pessoa vê (sem o filtro de empresa e de posto)
  const pEmp = [...pA]; let fEmp = fA;
  if (req.query.escopo === 'estoque') fEmp += ` AND a.status IN ('STOCK','READY','ORDERED')`;
  if (/^\d+$/.test(String(req.query.entity_id || ''))) { pA.push(req.query.entity_id); fA += ` AND a.entity_id = $${pA.length}`; }
  const pM = [dias];
  let fM = ' AND m.to_entity_id IS NOT NULL';
  const ents = entityIdsOf(req.user);
  if (ents !== null) { pM.push(ents); fM += ` AND m.to_entity_id::text = ANY($${pM.length}::text[])`; }
  if (/^\d+$/.test(String(req.query.entity_id || ''))) { pM.push(req.query.entity_id); fM += ` AND m.to_entity_id = $${pM.length}`; }
  // ?escopo=estoque: só os itens do Estoque de T.I. (Em estoque, Pronto para entregar, Comprado)
  const soEstoque = req.query.escopo === 'estoque';
  if (soEstoque) fA += ` AND a.status IN ('STOCK','READY','ORDERED')`;
  // o ranking de valor por posto compara todos os postos (não usa o filtro de posto)
  const fRank = fA; const pRank = [...pA];
  // ?location_id=: uma localidade (posto)
  if (/^\d+$/.test(String(req.query.location_id || ''))) {
    pA.push(req.query.location_id); fA += ` AND a.location_id = $${pA.length}`;
    pM.push(req.query.location_id); fM += ` AND (m.to_location_id = $${pM.length} OR m.from_location_id = $${pM.length})`;
  }
  const periodo = `m.created_at >= now() - ($1::int * interval '1 day')`;
  const [inv, porStatus, porCategoria, porMotivo, porPosto, porMes, totais, recentes, valorPosto, itensPosto, valorEmpresa] = await Promise.all([
    query(`SELECT COALESCE(sum((CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END)),0)::int AS itens, COALESCE(sum(a.price * (CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END)),0)::float AS valor, COALESCE(sum((CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END)) FILTER (WHERE a.price IS NOT NULL),0)::int AS com_preco
           FROM assets a WHERE a.status NOT IN ('DISPOSED','LOST','BROKEN') ${fA}`, pA),
    query(`SELECT a.status, COALESCE(sum((CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END)),0)::int AS n, COALESCE(sum(a.price * (CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END)),0)::float AS valor FROM assets a WHERE TRUE ${fA} GROUP BY a.status`, pA),
    query(`SELECT a.type, COALESCE(sum((CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END)),0)::int AS n, COALESCE(sum(a.price * (CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END)),0)::float AS valor,
                  COALESCE(sum((CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END)) FILTER (WHERE a.status = 'STOCK'),0)::int AS em_estoque
           FROM assets a WHERE a.status NOT IN ('DISPOSED','LOST','BROKEN') ${fA} GROUP BY a.type ORDER BY valor DESC, n DESC`, pA),
    query(`SELECT COALESCE(m.reason_name, 'Sem motivo') AS motivo, sum(m.quantity)::int AS n, COALESCE(sum(m.price),0)::float AS custo
           FROM stock_movements m WHERE m.kind = 'withdraw' AND ${periodo} ${fM} GROUP BY 1 ORDER BY n DESC, custo DESC`, pM),
    query(`SELECT COALESCE(l.name, 'Sem local') AS posto, e.name AS empresa, sum(m.quantity)::int AS n, COALESCE(sum(m.price),0)::float AS custo
           FROM stock_movements m LEFT JOIN locations l ON l.id = m.to_location_id LEFT JOIN entities e ON e.id = m.to_entity_id
           WHERE m.kind = 'withdraw' AND ${periodo} ${fM} GROUP BY 1, 2 ORDER BY custo DESC, n DESC LIMIT 30`, pM),
    query(`SELECT to_char(date_trunc('month', m.created_at), 'YYYY-MM') AS mes, sum(m.quantity)::int AS n, COALESCE(sum(m.price),0)::float AS custo
           FROM stock_movements m WHERE m.kind = 'withdraw' AND ${periodo} ${fM} GROUP BY 1 ORDER BY 1`, pM),
    query(`SELECT COALESCE(sum(m.quantity) FILTER (WHERE m.kind = 'withdraw'),0)::int AS retiradas,
                  COALESCE(sum(ra.price) FILTER (WHERE m.kind = 'withdraw' AND r.efeito IN ('LOST','BROKEN')),0)::float AS prejuizo,
                  count(ra.id) FILTER (WHERE m.kind = 'withdraw' AND r.efeito IN ('LOST','BROKEN'))::int AS perdidos,
                  COALESCE(sum(m.price) FILTER (WHERE m.kind = 'withdraw'),0)::float AS custo_retiradas,
                  count(*) FILTER (WHERE m.kind = 'transfer')::int AS transferencias,
                  count(*) FILTER (WHERE m.kind IN ('entry','return'))::int AS entradas
           FROM stock_movements m LEFT JOIN stock_reasons r ON r.id = m.reason_id LEFT JOIN assets ra ON ra.id = m.replaced_asset_id
           WHERE ${periodo} ${fM}`, pM),
    query(`SELECT m.id, m.kind, m.created_at, m.reason_name, m.price, m.note, m.quantity, a.id AS asset_id, a.name AS asset_name, a.asset_tag, a.type,
                  u.name AS user_name, lt.name AS to_location_name, lf.name AS from_location_name
           FROM stock_movements m JOIN assets a ON a.id = m.asset_id LEFT JOIN users u ON u.id = m.user_id
           LEFT JOIN locations lt ON lt.id = m.to_location_id LEFT JOIN locations lf ON lf.id = m.from_location_id
           WHERE ${periodo} ${fM} ORDER BY m.created_at DESC LIMIT 25`, pM),
    // valor por posto (o que existe e funciona) e quanto já se perdeu (estragado/extraviado)
    query(`SELECT a.location_id, COALESCE(l.name, 'Sem local') AS posto, e.name AS empresa,
                  COALESCE(sum((CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END)) FILTER (WHERE a.status NOT IN ('DISPOSED','LOST','BROKEN')),0)::int AS n,
                  COALESCE(sum(a.price * (CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END)) FILTER (WHERE a.status NOT IN ('DISPOSED','LOST','BROKEN')),0)::float AS valor,
                  COALESCE(sum(a.price * (CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END)) FILTER (WHERE a.status IN ('LOST','BROKEN')),0)::float AS perdido
           FROM assets a LEFT JOIN locations l ON l.id = a.location_id JOIN entities e ON e.id = a.entity_id
           WHERE a.status <> 'DISPOSED' ${fRank} GROUP BY 1, 2, 3 ORDER BY valor DESC, n DESC LIMIT 100`, pRank),
    // com um posto escolhido: os itens dele, do mais caro para o mais barato
    /^\d+$/.test(String(req.query.location_id || '')) ? query(`SELECT a.id, a.name, a.asset_tag, a.type, a.status, a.controle, a.quantity, a.price,
                  (a.price * (CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END))::float AS total
           FROM assets a WHERE a.status <> 'DISPOSED' ${fA} ORDER BY total DESC NULLS LAST, a.name LIMIT 300`, pA) : Promise.resolve({ rows: [] }),
    query(`SELECT a.entity_id, e.name AS empresa, count(DISTINCT a.location_id)::int AS postos,
                  COALESCE(sum((CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END)) FILTER (WHERE a.status NOT IN ('DISPOSED','LOST','BROKEN')),0)::int AS n,
                  COALESCE(sum(a.price * (CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END)) FILTER (WHERE a.status NOT IN ('DISPOSED','LOST','BROKEN')),0)::float AS valor,
                  COALESCE(sum(a.price * (CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END)) FILTER (WHERE a.status IN ('LOST','BROKEN')),0)::float AS perdido
           FROM assets a JOIN entities e ON e.id = a.entity_id
           WHERE a.status <> 'DISPOSED' ${fEmp} GROUP BY 1, 2 ORDER BY valor DESC, n DESC`, pEmp),
  ]);
  const ver = veSegredos(req.user);
  const semPreco = (lista, campos) => (ver ? lista : lista.map((r) => { const o = { ...r }; campos.forEach((c) => delete o[c]); return o; }));
  res.json({
    dias,
    escopo: soEstoque ? 'estoque' : 'tudo',
    ve_valores: ver,
    inventario: semPreco([inv.rows[0]], ['valor'])[0],
    por_status: semPreco(porStatus.rows, ['valor']),
    por_categoria: semPreco(porCategoria.rows, ['valor']),
    por_motivo: semPreco(porMotivo.rows, ['custo']),
    por_posto: semPreco(porPosto.rows, ['custo']),
    por_mes: semPreco(porMes.rows, ['custo']),
    totais: semPreco([totais.rows[0]], ['custo_retiradas', 'prejuizo'])[0],
    recentes: semPreco(recentes.rows, ['price']),
    valor_por_posto: semPreco(valorPosto.rows, ['valor', 'perdido']),
    valor_por_empresa: semPreco(valorEmpresa.rows, ['valor', 'perdido']),
    itens_posto: semPreco(itensPosto.rows, ['price', 'total']),
  });
});

module.exports = router;
