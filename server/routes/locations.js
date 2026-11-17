const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const {
  requireAuth, isMaster, isLocalAdmin, isStaff, canAccessEntity, entityIdsOf, has,
} = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Localizacoes / postos de cada empresa
//  - leitura: equipe (todas as empresas) e demais usuarios (somente as suas empresas)
//  - criar/editar/desativar: Administrador Mestre (todas) e Administrador Local (a propria)
const canAdmin = (u, entityId) => isMaster(u) || (has(u, 'locations.manage') && String(u.entity_id) === String(entityId));

router.get('/', async (req, res) => {
  const user = req.user;
  const { entity_id, active } = req.query;
  const conds = [];
  const params = [];
  const add = (sql, val) => { params.push(val); conds.push(sql.replace('?', `$${params.length}`)); };
  if (entity_id) {
    if (!canAccessEntity(user, entity_id)) return res.status(403).json({ error: 'Acesso negado a esta empresa.' });
    add('l.entity_id = ?', entity_id);
  } else if (!isStaff(user)) {
    add('l.entity_id::text = ANY(?::text[])', entityIdsOf(user));
  }
  if (active !== undefined) add('l.active = ?', active === 'true');
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT l.*, e.name AS entity_name,
            (SELECT count(*)::int FROM users u WHERE u.location_id = l.id) AS users_count,
            (SELECT u.username FROM users u WHERE u.location_id = l.id AND u.role = 'client' AND u.name = l.name
              ORDER BY u.id LIMIT 1) AS posto_username,
            (SELECT count(*)::int FROM tickets t WHERE t.location_id = l.id AND t.status NOT IN (6,7)) AS open_tickets
     FROM locations l JOIN entities e ON e.id = l.entity_id
     ${where}
     ORDER BY e.name, l.name`, params);
  res.json(rows);
});

function readBody(body) {
  const b = body || {};
  const clean = (v) => (v === undefined ? undefined : (v === null || String(v).trim() === '' ? null : String(v).trim()));
  return {
    name: clean(b.name), code: clean(b.code), address: clean(b.address),
    city: clean(b.city), state: clean(b.state), active: b.active,
  };
}

// Posto = localização + usuário: o próprio posto entra no sistema para abrir chamados.
// O usuário do posto tem o perfil "Usuário" da empresa, o nome do posto e fica ligado a ele.
async function validarUsuarioPosto(pu) {
  if (!pu) return null;
  const username = String(pu.username || '').trim();
  if (!username) return 'Informe o usuário de acesso do posto.';
  if (!/^[\w.@-]{3,}$/.test(username)) return 'O usuário do posto deve ter ao menos 3 letras/números, sem espaços.';
  if (String(pu.password || '').length < 6) return 'A senha do posto deve ter ao menos 6 caracteres.';
  const ex = await query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username]);
  if (ex.rows.length) return 'Esse usuário de acesso já existe. Escolha outro.';
  return null;
}
async function criarUsuarioPosto(pu, loc) {
  const hash = await bcrypt.hash(String(pu.password), 10);
  await query(
    `INSERT INTO users (username, password_hash, name, role, client_level, entity_id, location_id, active)
     VALUES ($1, $2, $3, 'client', 1, $4, $5, TRUE)`,
    [String(pu.username).trim(), hash, loc.name, loc.entity_id, loc.id]);
}

router.post('/', async (req, res) => {
  const user = req.user;
  const entityId = isMaster(user) ? req.body?.entity_id : user.entity_id;
  if (!entityId) return res.status(422).json({ error: 'Informe a empresa.' });
  if (!canAdmin(user, entityId)) return res.status(403).json({ error: 'Sem permissão para criar localizações nesta empresa.' });
  const b = readBody(req.body);
  if (!b.name) return res.status(422).json({ error: 'Informe o nome da localização.' });
  const puErr = await validarUsuarioPosto(req.body?.posto_user);
  if (puErr) return res.status(422).json({ error: puErr });
  try {
    const { rows } = await query(
      `INSERT INTO locations (entity_id, name, code, address, city, state, active)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, TRUE)) RETURNING *`,
      [entityId, b.name, b.code || null, b.address || null, b.city || null, b.state || null,
       b.active === undefined ? true : !!b.active]);
    if (req.body?.posto_user) await criarUsuarioPosto(req.body.posto_user, rows[0]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (String(err.message).includes('uq_locations_entity_name')) {
      return res.status(409).json({ error: 'Já existe uma localização com esse nome nesta empresa.' });
    }
    res.status(400).json({ error: 'Não foi possível criar a localização.', details: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  const { rows: found } = await query('SELECT * FROM locations WHERE id = $1', [req.params.id]);
  if (!found.length) return res.status(404).json({ error: 'Localização não encontrada.' });
  if (!canAdmin(req.user, found[0].entity_id)) return res.status(403).json({ error: 'Sem permissão.' });
  const b = readBody(req.body);
  const fields = [];
  const params = [req.params.id];
  const add = (sql, val) => { params.push(val); fields.push(sql.replace('?', `$${params.length}`)); };
  if (b.name !== undefined) {
    if (!b.name) return res.status(422).json({ error: 'O nome não pode ficar vazio.' });
    add('name = ?', b.name);
  }
  ['code', 'address', 'city', 'state'].forEach((k) => { if (b[k] !== undefined) add(`${k} = ?`, b[k]); });
  if (b.active !== undefined) add('active = ?', !!b.active);
  const pu = req.body?.posto_user;
  if (pu) {
    const puErr = await validarUsuarioPosto(pu);
    if (puErr) return res.status(422).json({ error: puErr });
  }
  if (!fields.length && pu) {
    await criarUsuarioPosto(pu, found[0]);
    return res.json(found[0]);
  }
  if (!fields.length) return res.status(422).json({ error: 'Nenhum campo para atualizar.' });
  try {
    const { rows } = await query(`UPDATE locations SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params);
    if (pu) await criarUsuarioPosto(pu, rows[0]);
    res.json(rows[0]);
  } catch (err) {
    if (String(err.message).includes('uq_locations_entity_name')) {
      return res.status(409).json({ error: 'Já existe uma localização com esse nome nesta empresa.' });
    }
    res.status(400).json({ error: 'Não foi possível atualizar.', details: err.message });
  }
});

// Desativa (localizacoes com chamados ou usuarios nunca sao apagadas)
router.delete('/:id', async (req, res) => {
  const { rows: found } = await query('SELECT * FROM locations WHERE id = $1', [req.params.id]);
  if (!found.length) return res.status(404).json({ error: 'Localização não encontrada.' });
  if (!canAdmin(req.user, found[0].entity_id)) return res.status(403).json({ error: 'Sem permissão.' });
  await query('UPDATE locations SET active = FALSE WHERE id = $1', [req.params.id]);
  res.json({ ok: true, message: 'Localização desativada.' });
});

module.exports = router;
