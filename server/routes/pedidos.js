const express = require('express');
const { query } = require('../db');
const { requireAuth, scopeConditions, has } = require('../middleware/auth');

// ---------------------------------------------------------------------
// Pedidos (Equipamentos > Pedidos): chamados com pedido de material e a situação de cada item
//   pedido -> comprado -> chegou -> entregue (ou cancelado)
//   ?situacao=pendentes (padrão: falta entregar algum item) | todos
//   ?entity_id=  ?location_id=  ?q=
// ---------------------------------------------------------------------
const router = express.Router();
router.use(requireAuth);

// Meus pedidos: os pedidos de material dos chamados que eu abri (sem preço) e quais tiveram novidade
router.get('/meus', async (req, res) => {
  const { rows } = await query(
    `SELECT t.id, t.title, t.status, t.created_at, t.needed_by, l.name AS location_name, a.name AS assigned_name,
            EXISTS (SELECT 1 FROM inapp_notifications n WHERE n.user_id = $1 AND n.ticket_id = t.id AND n.link = '#/meus-pedidos' AND n.is_read = FALSE) AS novidade,
            (SELECT json_agg(json_build_object('id', m.id, 'name', m.name, 'unit', m.unit, 'quantity', m.quantity,
                     'status', m.status, 'status_at', m.status_at, 'destino', m.destino, 'location_name', lm.name,
                     'etapas', m.etapas, 'previsao', m.previsao, 'origem_orcim', m.origem_orcim, 'origem_local', m.origem_local, 'asset_type', m.asset_type, 'location_id', m.location_id) ORDER BY m.id)
               FROM ticket_materials m LEFT JOIN locations lm ON lm.id = m.location_id WHERE m.ticket_id = t.id) AS materiais
     FROM tickets t
     LEFT JOIN locations l ON l.id = t.location_id
     LEFT JOIN users a ON a.id = t.assigned_user_id
     WHERE t.requester_id = $1 AND t.status <> 7 AND EXISTS (SELECT 1 FROM ticket_materials tm WHERE tm.ticket_id = t.id)
     ORDER BY novidade DESC, t.created_at DESC LIMIT 200`, [req.user.id]);
  res.json(rows.map((r) => ({ ...r, number: `#${r.id}` })));
});

router.get('/', async (req, res) => {
  const scope = scopeConditions(req.user, 1);
  const params = [...scope.params];
  const conds = ['EXISTS (SELECT 1 FROM ticket_materials tm WHERE tm.ticket_id = t.id)', 't.status <> 7'];
  if (scope.sql) conds.push(scope.sql);
  if (/^\d+$/.test(String(req.query.entity_id || ''))) { params.push(req.query.entity_id); conds.push(`t.entity_id = $${params.length}`); }
  if (/^\d+$/.test(String(req.query.location_id || ''))) { params.push(req.query.location_id); conds.push(`t.location_id = $${params.length}`); }
  if (req.query.situacao !== 'todos') {
    conds.push(`EXISTS (SELECT 1 FROM ticket_materials tm WHERE tm.ticket_id = t.id AND tm.status NOT IN ('entregue','cancelado'))`);
  }
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    conds.push(`(t.title ILIKE $${params.length} OR EXISTS (SELECT 1 FROM ticket_materials tm WHERE tm.ticket_id = t.id AND tm.name ILIKE $${params.length}))`);
  }
  const { rows } = await query(
    `SELECT t.id, t.title, t.status, t.created_at, t.needed_by, t.entity_id, t.location_id, t.requester_id,
            e.name AS entity_name, l.name AS location_name, u.name AS requester_name, a.name AS assigned_name,
            (SELECT json_agg(json_build_object('id', m.id, 'name', m.name, 'unit', m.unit, 'quantity', m.quantity,
                     'status', m.status, 'status_at', m.status_at, 'destino', m.destino, 'asset_id', m.asset_id,
                     'asset_ids', m.asset_ids, 'asset_type', m.asset_type, 'price', m.price,
                     'location_id', m.location_id, 'location_name', lm.name, 'etapas', m.etapas, 'previsao', m.previsao, 'origem_orcim', m.origem_orcim, 'origem_local', m.origem_local) ORDER BY m.id)
               FROM ticket_materials m LEFT JOIN locations lm ON lm.id = m.location_id WHERE m.ticket_id = t.id) AS materiais
     FROM tickets t
     JOIN entities e ON e.id = t.entity_id
     LEFT JOIN locations l ON l.id = t.location_id
     LEFT JOIN users u ON u.id = t.requester_id
     LEFT JOIN users a ON a.id = t.assigned_user_id
     WHERE ${conds.join(' AND ')}
     ORDER BY t.created_at DESC LIMIT 300`, params);
  // preço só para quem pode ver (gestor, técnico, admin mestre)
  const vePreco = has(req.user, 'inventory.secrets');
  res.json(rows.map((r) => ({
    ...r, number: `#${r.id}`,
    materiais: vePreco ? r.materiais : (r.materiais || []).map(({ price, ...m }) => m),
  })));
});

module.exports = router;
