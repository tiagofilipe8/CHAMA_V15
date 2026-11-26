const express = require('express');
const { query } = require('../db');
const { requireAuth, scopeConditions } = require('../middleware/auth');

// ---------------------------------------------------------------------
// Pedidos (Equipamentos > Pedidos): chamados com pedido de material e a situação de cada item
//   pedido -> comprado -> chegou -> entregue (ou cancelado)
//   ?situacao=pendentes (padrão: falta entregar algum item) | todos
//   ?entity_id=  ?location_id=  ?q=
// ---------------------------------------------------------------------
const router = express.Router();
router.use(requireAuth);

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
                     'status', m.status, 'status_at', m.status_at, 'destino', m.destino, 'asset_id', m.asset_id) ORDER BY m.id)
               FROM ticket_materials m WHERE m.ticket_id = t.id) AS materiais
     FROM tickets t
     JOIN entities e ON e.id = t.entity_id
     LEFT JOIN locations l ON l.id = t.location_id
     LEFT JOIN users u ON u.id = t.requester_id
     LEFT JOIN users a ON a.id = t.assigned_user_id
     WHERE ${conds.join(' AND ')}
     ORDER BY t.created_at DESC LIMIT 300`, params);
  res.json(rows.map((r) => ({ ...r, number: `#${r.id}` })));
});

module.exports = router;
