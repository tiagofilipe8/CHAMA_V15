const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRoles } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Arvore de categorias (com contagem de chamados abertos)
router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT c.*,
            (SELECT count(*) FROM tickets t
             WHERE t.category_id = c.id AND t.status NOT IN (6,7)) AS open_tickets
     FROM categories c ORDER BY c.name`);
  res.json(rows);
});

router.post('/', requireRoles('admin'), async (req, res) => {
  const { name, parent_id, active } = req.body || {};
  if (!name) return res.status(422).json({ error: 'Informe o nome da categoria.' });
  const { rows } = await query(
    `INSERT INTO categories (name, parent_id, active)
     VALUES ($1, $2, COALESCE($3, TRUE)) RETURNING *`,
    [name, parent_id || null, active === undefined ? true : !!active]);
  res.status(201).json(rows[0]);
});

router.patch('/:id', requireRoles('admin'), async (req, res) => {
  const { name, parent_id, active } = req.body || {};
  const fields = [];
  const params = [req.params.id];
  const add = (sql, val) => { params.push(val); fields.push(sql.replace('?', `$${params.length}`)); };
  if (name !== undefined) add('name = ?', name);
  if (parent_id !== undefined) add('parent_id = ?', parent_id || null);
  if (active !== undefined) add('active = ?', !!active);
  if (!fields.length) return res.status(422).json({ error: 'Nenhum campo para atualizar.' });
  try {
    const { rows } = await query(
      `UPDATE categories SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params);
    if (!rows.length) return res.status(404).json({ error: 'Categoria não encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: 'Não foi possível atualizar.', details: err.message });
  }
});

router.delete('/:id', requireRoles('admin'), async (req, res) => {
  const used = await query(`SELECT count(*)::int AS c FROM tickets WHERE category_id = $1`, [req.params.id]);
  if (used.rows[0].c > 0) {
    await query(`UPDATE categories SET active = FALSE WHERE id = $1`, [req.params.id]);
    return res.json({ ok: true, message: 'Categoria possui chamados; foi desativada.' });
  }
  await query(`DELETE FROM categories WHERE id = $1`, [req.params.id]);
  res.json({ ok: true, message: 'Categoria removida.' });
});

module.exports = router;