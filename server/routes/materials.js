const express = require('express');
const { query } = require('../db');
const { requireAuth, isMaster, isLocalAdmin } = require('../middleware/auth');

// Materiais que podem ser pedidos num chamado ("Pedido de material").
//  - leitura: todos os usuários logados (só os ativos; ?all=true para o administrador)
//  - criar/editar/desativar: Administrador Mestre e Administrador Local
const router = express.Router();
router.use(requireAuth);
const podeEditar = (u) => isMaster(u) || isLocalAdmin(u);

router.get('/', async (req, res) => {
  const todos = req.query.all === 'true' && podeEditar(req.user);
  const { rows } = await query(
    `SELECT m.*, (SELECT count(*)::int FROM ticket_materials tm WHERE tm.material_id = m.id) AS pedidos
     FROM materials m ${todos ? '' : 'WHERE m.active'} ORDER BY m.sort_order, m.name`);
  res.json(rows);
});

function ler(b = {}) {
  const txt = (v) => (v === undefined ? undefined : (v === null || String(v).trim() === '' ? null : String(v).trim()));
  return {
    name: txt(b.name), unit: txt(b.unit), description: txt(b.description),
    active: b.active === undefined ? undefined : !!b.active,
    sort_order: b.sort_order === undefined ? undefined : (parseInt(b.sort_order, 10) || 0),
  };
}
const duplicado = (e) => String(e.message).includes('uq_materials_name');

router.post('/', async (req, res) => {
  if (!podeEditar(req.user)) return res.status(403).json({ error: 'Apenas administradores editam a lista de materiais.' });
  const b = ler(req.body);
  if (!b.name) return res.status(422).json({ error: 'Informe o nome do material.' });
  try {
    const { rows } = await query(
      `INSERT INTO materials (name, unit, description, active, sort_order)
       VALUES ($1, $2, $3, COALESCE($4, TRUE), COALESCE($5, 0)) RETURNING *`,
      [b.name, b.unit || null, b.description || null, b.active, b.sort_order]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (duplicado(e)) return res.status(409).json({ error: 'Já existe um material com esse nome.' });
    res.status(400).json({ error: 'Não foi possível salvar.', details: e.message });
  }
});

router.patch('/:id', async (req, res) => {
  if (!podeEditar(req.user)) return res.status(403).json({ error: 'Apenas administradores editam a lista de materiais.' });
  const b = ler(req.body);
  if (b.name === null) return res.status(422).json({ error: 'O nome não pode ficar vazio.' });
  const sets = []; const params = [req.params.id];
  for (const k of ['name', 'unit', 'description', 'active', 'sort_order']) {
    if (b[k] !== undefined) { params.push(b[k]); sets.push(`${k} = $${params.length}`); }
  }
  if (!sets.length) return res.status(422).json({ error: 'Nada para alterar.' });
  try {
    const { rows } = await query(`UPDATE materials SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
    if (!rows.length) return res.status(404).json({ error: 'Material não encontrado.' });
    res.json(rows[0]);
  } catch (e) {
    if (duplicado(e)) return res.status(409).json({ error: 'Já existe um material com esse nome.' });
    res.status(400).json({ error: 'Não foi possível salvar.', details: e.message });
  }
});

// Material já pedido em algum chamado é só desativado (o histórico continua)
router.delete('/:id', async (req, res) => {
  if (!podeEditar(req.user)) return res.status(403).json({ error: 'Apenas administradores editam a lista de materiais.' });
  const usado = await query('SELECT 1 FROM ticket_materials WHERE material_id = $1 LIMIT 1', [req.params.id]);
  if (usado.rows.length) {
    await query('UPDATE materials SET active = FALSE WHERE id = $1', [req.params.id]);
    return res.json({ ok: true, message: 'Material já foi pedido antes; ficou inativo.' });
  }
  await query('DELETE FROM materials WHERE id = $1', [req.params.id]);
  res.json({ ok: true, message: 'Material removido.' });
});

module.exports = router;
