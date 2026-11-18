const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRoles } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Niveis de urgencia ("Isso está afetando a operação?")
router.get('/', async (req, res) => {
  const onlyActive = req.query.all !== 'true';
  const { rows } = await query(
    `SELECT * FROM impact_levels ${onlyActive ? 'WHERE active' : ''} ORDER BY sort_order, id`);
  res.json(rows);
});

function readBody(b = {}) {
  return {
    name: b.name !== undefined ? String(b.name).trim() : undefined,
    description: b.description !== undefined ? (String(b.description).trim() || null) : undefined,
    examples: b.examples !== undefined ? (String(b.examples).trim() || null) : undefined,
    priority: b.priority !== undefined ? Math.min(Math.max(parseInt(b.priority, 10) || 2, 1), 4) : undefined,
    sort_order: b.sort_order !== undefined ? (parseInt(b.sort_order, 10) || 0) : undefined,
    active: b.active !== undefined ? !!b.active : undefined,
  };
}

router.post('/', requireRoles('admin'), async (req, res) => {
  const b = readBody(req.body);
  if (!b.name) return res.status(422).json({ error: 'Informe o nome.' });
  try {
    const { rows } = await query(
      `INSERT INTO impact_levels (name, description, examples, priority, sort_order, active)
       VALUES ($1, $2, $3, COALESCE($4, 2), COALESCE($5, 0), COALESCE($6, TRUE)) RETURNING *`,
      [b.name, b.description || null, b.examples || null, b.priority, b.sort_order, b.active]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: 'Não foi possível criar (o nome já existe?).', details: err.message });
  }
});

router.patch('/:id', requireRoles('admin'), async (req, res) => {
  const b = readBody(req.body);
  const fields = [];
  const params = [req.params.id];
  for (const k of ['name', 'description', 'examples', 'priority', 'sort_order', 'active']) {
    if (b[k] !== undefined) { params.push(b[k]); fields.push(`${k} = $${params.length}`); }
  }
  if (b.name === '') return res.status(422).json({ error: 'O nome não pode ficar vazio.' });
  if (!fields.length) return res.status(422).json({ error: 'Nenhum campo para atualizar.' });
  try {
    const { rows } = await query(`UPDATE impact_levels SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params);
    if (!rows.length) return res.status(404).json({ error: 'Nível não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: 'Não foi possível atualizar.', details: err.message });
  }
});

// Desativa (chamados antigos continuam com o nivel registrado)
router.delete('/:id', requireRoles('admin'), async (req, res) => {
  await query('UPDATE impact_levels SET active = FALSE WHERE id = $1', [req.params.id]);
  res.json({ ok: true, message: 'Nível desativado.' });
});

module.exports = router;
