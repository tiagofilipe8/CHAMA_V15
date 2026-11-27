const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { perfilDaEmpresa, lerPerfil, doPerfil, travaPadrao, PADRAO_TRAVADO } = require('./optionProfiles');

const router = express.Router();
router.use(requireAuth);

// Causas usadas no encerramento do chamado (erro do usuário, acidente, etc.)
// Lista do perfil de opções: ?entity_id= (o perfil que a empresa usa) ou ?profile_id=;
// sem nenhum dos dois = Padrão. ?all=true inclui as desativadas.
router.get('/', async (req, res) => {
  const onlyActive = req.query.all !== 'true';
  let perfil = null;
  if (req.query.entity_id && /^\d+$/.test(req.query.entity_id)) perfil = await perfilDaEmpresa(req.query.entity_id);
  else {
    const p = await lerPerfil(req.query.profile_id);
    if (p.error) return res.status(404).json({ error: p.error });
    perfil = p.id;
  }
  const { rows } = await query(
    `SELECT rc.* FROM resolution_causes rc WHERE ${doPerfil('rc', 1)} ${onlyActive ? 'AND rc.active' : ''}
     ORDER BY rc.sort_order, rc.id`, [perfil]);
  res.json(rows);
});

function readBody(b = {}) {
  return {
    name: b.name !== undefined ? String(b.name).trim() : undefined,
    description: b.description !== undefined ? (String(b.description).trim() || null) : undefined,
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
      `INSERT INTO resolution_causes (name, description, sort_order, active, profile_id)
       VALUES ($1, $2, COALESCE($3, 0), COALESCE($4, TRUE), $5) RETURNING *`,
      [b.name, b.description || null, b.sort_order, b.active, p.id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: 'Não foi possível criar (o nome já existe neste perfil?).', details: err.message });
  }
});

router.patch('/:id', requireRoles('admin'), async (req, res) => {
  const trava = await travaPadrao('resolution_causes', req.params.id);
  if (trava) return res.status(403).json({ error: trava });
  const b = readBody(req.body);
  const fields = [];
  const params = [req.params.id];
  for (const k of ['name', 'description', 'sort_order', 'active']) {
    if (b[k] !== undefined) { params.push(b[k]); fields.push(`${k} = $${params.length}`); }
  }
  if (b.name === '') return res.status(422).json({ error: 'O nome não pode ficar vazio.' });
  if (!fields.length) return res.status(422).json({ error: 'Nenhum campo para atualizar.' });
  try {
    const { rows } = await query(`UPDATE resolution_causes SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params);
    if (!rows.length) return res.status(404).json({ error: 'Causa não encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: 'Não foi possível atualizar.', details: err.message });
  }
});

// Desativa (chamados antigos continuam com a causa registrada)
router.delete('/:id', requireRoles('admin'), async (req, res) => {
  const trava = await travaPadrao('resolution_causes', req.params.id);
  if (trava) return res.status(403).json({ error: trava });
  await query('UPDATE resolution_causes SET active = FALSE WHERE id = $1', [req.params.id]);
  res.json({ ok: true, message: 'Causa desativada.' });
});

module.exports = router;
