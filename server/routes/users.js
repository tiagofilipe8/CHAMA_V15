const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { requireAuth, requireRoles, publicUser } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function isManager(user) { return user && user.role === 'client' && Number(user.client_level) === 2; }
function isAdmin(user) { return user && user.role === 'admin'; }

// Lista usuarios com filtros — admin vê todos, gestor vê apenas da própria entidade
router.get('/', async (req, res) => {
  const user = req.user;
  if (!isAdmin(user) && !isManager(user)) return res.status(403).json({ error: 'Acesso restrito a administradores e gestores.' });
  const { role, entity_id, active, q } = req.query;
  const conds = [];
  const params = [];
  const add = (sql, val) => { params.push(val); conds.push(sql.replace('?', `$${params.length}`)); };

  if (isManager(user)) {
    // gestor só vê usuários da própria entidade
    add(`u.entity_id = ?`, user.entity_id);
    if (entity_id && String(entity_id) !== String(user.entity_id)) {
      return res.status(403).json({ error: 'Gestor só pode visualizar usuários da própria entidade.' });
    }
  } else {
    if (entity_id) add(`u.entity_id = ?`, entity_id);
  }
  if (role) add(`u.role = ?`, role);
  if (active !== undefined) add(`u.active = ?`, active === 'true');
  if (q) {
    const like = `%${q}%`;
    params.push(like, like, like);
    conds.push(`(u.name ILIKE $${params.length-2} OR u.username ILIKE $${params.length-1} OR u.email ILIKE $${params.length})`);
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT u.*, e.name AS entity_name FROM users u
     LEFT JOIN entities e ON e.id = u.entity_id
     ${where}
     ORDER BY u.name`, params);
  res.json(rows.map(publicUser));
});

// Cria usuario — admin livre, gestor apenas para própria entidade e com todos os dados obrigatórios
router.post('/', async (req, res) => {
  const user = req.user;
  if (!isAdmin(user) && !isManager(user)) return res.status(403).json({ error: 'Apenas administradores e gestores podem criar usuários.' });
  const { username, password, name, email, phone, role, client_level, entity_id, active } = req.body || {};

  // Gestor: todos os dados obrigatórios e travado na própria entidade
  if (isManager(user)) {
    const missing = [];
    if (!username || !String(username).trim()) missing.push('usuário');
    if (!password) missing.push('senha');
    if (!name || !String(name).trim()) missing.push('nome');
    if (!email || !String(email).trim()) missing.push('e-mail');
    if (!phone || !String(phone).trim()) missing.push('telefone/WhatsApp');
    if (!role) missing.push('papel');
    if (entity_id == null || String(entity_id).trim() === '') missing.push('entidade');
    if (missing.length) return res.status(422).json({ error: `Campos obrigatórios: ${missing.join(', ')}.` });
    if (String(entity_id) !== String(user.entity_id)) return res.status(403).json({ error: 'Gestor só pode criar usuários para a própria entidade.' });
    if (String(role) === 'admin') return res.status(403).json({ error: 'Gestor não pode criar administradores.' });
  } else {
    if (!username || !password || !name) {
      return res.status(422).json({ error: 'Usuário, senha e nome são obrigatórios.' });
    }
  }
  if (String(password).length < 6) {
    return res.status(422).json({ error: 'A senha deve ter ao menos 6 caracteres.' });
  }
  const r = String(role || 'client');
  if (!['admin', 'technician', 'client'].includes(r)) {
    return res.status(422).json({ error: 'Papel inválido.' });
  }
  // Gestor só pode criar client (requisitante ou gestor da mesma entidade)
  if (isManager(user) && r !== 'client') {
    return res.status(403).json({ error: 'Gestor só pode criar usuários do tipo Cliente.' });
  }
  if (phone) {
    const d = String(phone).replace(/\D/g, '');
    if (d.length !== 11) return res.status(422).json({ error: 'Telefone deve conter 11 dígitos no formato (xx) xxxxxxxxx.' });
  }
  try {
    const exists = await query(`SELECT 1 FROM users WHERE username = $1`, [String(username).trim()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Nome de usuário já em uso.' });
    const hash = await bcrypt.hash(String(password), 10);
    const finalEntityId = isManager(user) ? user.entity_id : (entity_id || null);
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, name, email, phone, role, client_level, entity_id, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, TRUE))
       RETURNING *`, [String(username).trim(), hash, name, email || null, phone || null,
                       r, r === 'client' ? (parseInt(client_level, 10) === 2 ? 2 : 1) : 1,
                       finalEntityId,
                       active === undefined ? true : !!active]);
    res.status(201).json({ user: publicUser(rows[0]) });
  } catch (err) {
    res.status(400).json({ error: 'Não foi possível criar o usuário.', details: err.message });
  }
});

// Atualiza usuario — gestor só pode editar usuários da própria entidade
router.patch('/:id', async (req, res) => {
  const actor = req.user;
  if (!isAdmin(actor) && !isManager(actor)) return res.status(403).json({ error: 'Permissão negada.' });
  const id = req.params.id;
  const target = await query(`SELECT * FROM users WHERE id = $1`, [id]);
  if (!target.rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (isManager(actor)) {
    if (String(target.rows[0].entity_id) !== String(actor.entity_id)) return res.status(403).json({ error: 'Gestor só pode editar usuários da própria entidade.' });
    if (target.rows[0].role === 'admin') return res.status(403).json({ error: 'Gestor não pode editar administradores.' });
  }
  const { name, email, phone, role, client_level, entity_id, active, password } = req.body || {};
  if (isManager(actor)) {
    if (role && String(role) === 'admin') return res.status(403).json({ error: 'Gestor não pode promover a administrador.' });
    if (entity_id != null && String(entity_id) !== String(actor.entity_id)) return res.status(403).json({ error: 'Gestor não pode mover usuário para outra entidade.' });
  }
  if (phone !== undefined && phone !== null && String(phone).trim() !== '') {
    const d = String(phone).replace(/\D/g, '');
    if (d.length !== 11) return res.status(422).json({ error: 'Telefone deve conter 11 dígitos no formato (xx) xxxxxxxxx.' });
  }
  const fields = [];
  const params = [id];
  const add = (sql, val) => { params.push(val); fields.push(sql.replace('?', `$${params.length}`)); };

  if (name !== undefined) add('name = ?', name);
  if (email !== undefined) add('email = ?', email || null);
  if (phone !== undefined) add('phone = ?', phone || null);
  if (role !== undefined) add('role = ?', role);
  if (client_level !== undefined) add('client_level = ?', parseInt(client_level, 10) === 2 ? 2 : 1);
  if (entity_id !== undefined) add('entity_id = ?', isManager(actor) ? actor.entity_id : (entity_id || null));
  if (active !== undefined) add('active = ?', !!active);
  if (password) add('password_hash = ?', await bcrypt.hash(String(password), 10));

  if (!fields.length) return res.status(422).json({ error: 'Nenhum campo para atualizar.' });
  try {
    const { rows } = await query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params);
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    res.status(400).json({ error: 'Não foi possível atualizar.', details: err.message });
  }
});

// Desativar / Ativar (soft) e Excluir (hard) — gestor só para própria entidade
router.delete('/:id', async (req, res) => {
  const actor = req.user;
  if (!isAdmin(actor) && !isManager(actor)) return res.status(403).json({ error: 'Permissão negada.' });
  const id = req.params.id;
  const hard = req.query.hard === 'true' || req.query.hard === '1';
  if (Number(id) === actor.id) {
    return res.status(422).json({ error: 'Você não pode remover o próprio usuário.' });
  }
  const { rows } = await query(`SELECT * FROM users WHERE id = $1`, [id]);
  if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (isManager(actor)) {
    if (String(rows[0].entity_id) !== String(actor.entity_id)) return res.status(403).json({ error: `Gestor só pode ${hard ? 'excluir' : 'desativar'} usuários da própria entidade.` });
    if (rows[0].role === 'admin') return res.status(403).json({ error: `Gestor não pode ${hard ? 'excluir' : 'desativar'} administradores.` });
  }
  if (hard) {
    try {
      await query(`DELETE FROM users WHERE id = $1`, [id]);
      return res.json({ ok: true, message: 'Usuário excluído permanentemente.' });
    } catch (err) {
      // FK — usuário com chamados não pode ser excluído permanentemente
      if (String(err.message).includes('violates foreign key') || String(err.message).includes('is still referenced')) {
        return res.status(409).json({ error: 'Usuário possui chamados vinculados e não pode ser excluído. Desative-o.' });
      }
      throw err;
    }
  }
  await query(`UPDATE users SET active = FALSE WHERE id = $1`, [id]);
  res.json({ ok: true, message: 'Usuário desativado.' });
});

module.exports = router;