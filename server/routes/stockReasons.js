const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { lerPerfil, doPerfil, travaPadrao, PADRAO_TRAVADO } = require('./optionProfiles');

// Razões de retirada do Estoque de T.I. (por perfil de opções, como as causas de encerramento)
//   ?profile_id= (sem = Padrão) · ?all=true inclui as desativadas
const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const p = await lerPerfil(req.query.profile_id);
  if (p.error) return res.status(404).json({ error: p.error });
  const { rows } = await query(
    `SELECT r.*, (SELECT count(*)::int FROM stock_movements m WHERE m.reason_id = r.id) AS usos
     FROM stock_reasons r WHERE ${doPerfil('r', 1)} ${req.query.all === 'true' ? '' : 'AND r.active'}
     ORDER BY r.sort_order, r.id`, [p.id]);
  res.json(rows);
});

function readBody(b = {}) {
  return {
    name: b.name !== undefined ? String(b.name).trim().slice(0, 120) : undefined,
    description: b.description !== undefined ? (String(b.description).trim().slice(0, 500) || null) : undefined,
    sort_order: b.sort_order !== undefined ? (parseInt(b.sort_order, 10) || 0) : undefined,
    active: b.active !== undefined ? !!b.active : undefined,
  };
}

router.post('/', requireRoles('admin'), async (req, res) => {
  const b = readBody(req.body);
  if (!b.name) return res.status(422).json({ error: 'Informe o nome.' });
  const p = await lerPerfil(req.body?.profile_id);
  if (p.error) return res.status(422).json({ error: p.error });
  if (!p.id) return res.status(403).json({ error: PADRAO_TRAVADO });
  try {
    const { rows } = await query(
      `INSERT INTO stock_reasons (name, description, sort_order, active, profile_id)
       VALUES ($1, $2, COALESCE($3, 0), COALESCE($4, TRUE), $5) RETURNING *`,
      [b.name, b.description || null, b.sort_order, b.active, p.id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: 'Não foi possível criar (o nome já existe neste perfil?).', details: err.message });
  }
});

router.patch('/:id', requireRoles('admin'), async (req, res) => {
  const trava = await travaPadrao('stock_reasons', req.params.id);
  if (trava) return res.status(403).json({ error: trava });
  const b = readBody(req.body);
  if (b.name === '') return res.status(422).json({ error: 'O nome não pode ficar vazio.' });
  const fields = [];
  const params = [req.params.id];
  for (const k of ['name', 'description', 'sort_order', 'active']) {
    if (b[k] !== undefined) { params.push(b[k]); fields.push(`${k} = $${params.length}`); }
  }
  if (!fields.length) return res.status(422).json({ error: 'Nenhum campo para atualizar.' });
  try {
    const { rows } = await query(`UPDATE stock_reasons SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params);
    if (!rows.length) return res.status(404).json({ error: 'Razão não encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: 'Não foi possível atualizar.', details: err.message });
  }
});

// Desativa (as retiradas antigas continuam com o motivo registrado)
router.delete('/:id', requireRoles('admin'), async (req, res) => {
  const trava = await travaPadrao('stock_reasons', req.params.id);
  if (trava) return res.status(403).json({ error: trava });
  await query('UPDATE stock_reasons SET active = FALSE WHERE id = $1', [req.params.id]);
  res.json({ ok: true, message: 'Razão desativada.' });
});

module.exports = router;
