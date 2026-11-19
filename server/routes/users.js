const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const {
  requireAuth, publicUser, USER_SELECT, isMaster, isLocalAdmin, isManager, isModerator, has,
} = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const ROLES = ['admin', 'moderator', 'technician', 'client'];

// Quem administra usuarios:
//  - Administrador Mestre: todos
//  - Administrador Local: usuarios da propria empresa (Usuario, Gestor e Admin Local)
//  - Gestor: usuarios da propria empresa (somente Usuario e Gestor) — regra que ja existia
// Gerenciar usuarios: Administrador Mestre (todos) ou quem tem a permissao
// "Gerenciar usuarios da propria empresa" (somente a propria empresa)
const canManageUsers = (u) => isMaster(u) || has(u, 'users.manage');
const scopedToEntity = (u) => !isMaster(u);
const rolesAllowedFor = (u) => {
  if (isMaster(u)) return ROLES;
  // fora o Administrador Mestre, so cria Usuario/Gestor (e Admin Local, se ele mesmo for um)
  if (isLocalAdmin(u)) return ['client'];
  if (has(u, 'users.manage')) return ['client'];
  return [];
};
const roleLabel = (r) => ({
  admin: 'Administrador Mestre', admin_local: 'Administrador Local', moderator: 'Moderador',
  technician: 'Técnico', client: 'Usuário/Gestor',
}[r] || r);

async function checkLocation(locationId, entityId) {
  if (!locationId) return null;
  const { rows } = await query('SELECT entity_id FROM locations WHERE id = $1', [locationId]);
  if (!rows.length) return 'Localização não encontrada.';
  if (!entityId || String(rows[0].entity_id) !== String(entityId)) return 'A localização precisa ser da mesma empresa do usuário.';
  return null;
}

async function saveExtraEntities(userId, ids, mainEntityId) {
  await query('DELETE FROM user_entities WHERE user_id = $1', [userId]);
  const clean = [...new Set((ids || []).map(String).filter((x) => /^\d+$/.test(x) && x !== String(mainEntityId || '')))];
  for (const id of clean) {
    await query('INSERT INTO user_entities (user_id, entity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, id]);
  }
}

// Lista usuarios com filtros
router.get('/', async (req, res) => {
  const user = req.user;
  const { role, entity_id, location_id, active, q } = req.query;
  // Moderador e admin local podem listar os tecnicos (para atribuir chamados)
  // quem pode atribuir tecnico precisa da lista de tecnicos
  const listingTechs = role === 'technician' && has(user, 'ticket.assign');
  if (!canManageUsers(user) && !listingTechs) {
    return res.status(403).json({ error: 'Acesso restrito a administradores e gestores.' });
  }
  const conds = [];
  const params = [];
  const add = (sql, val) => { params.push(val); conds.push(sql.replace('?', `$${params.length}`)); };

  if (scopedToEntity(user) && !listingTechs) {
    // admin local / gestor: só usuários da própria empresa
    if (entity_id && String(entity_id) !== String(user.entity_id)) {
      return res.status(403).json({ error: 'Você só pode visualizar usuários da própria empresa.' });
    }
    add(`u.entity_id = ?`, user.entity_id);
  } else if (entity_id) {
    add(`u.entity_id = ?`, entity_id);
  }
  if (role) add(`u.role = ?`, role);
  if (location_id) add(`u.location_id = ?`, location_id);
  if (active !== undefined) add(`u.active = ?`, active === 'true');
  if (q) {
    const like = `%${q}%`;
    params.push(like, like, like);
    conds.push(`(u.name ILIKE $${params.length-2} OR u.username ILIKE $${params.length-1} OR u.email ILIKE $${params.length})`);
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await query(`${USER_SELECT} ${where} ORDER BY u.name`, params);
  if (listingTechs) {
    return res.json(rows.map((r) => ({ id: r.id, name: r.name, username: r.username, role: r.role, active: r.active })));
  }
  res.json(rows.map(publicUser));
});

// Cria usuario
router.post('/', async (req, res) => {
  const user = req.user;
  if (!canManageUsers(user)) return res.status(403).json({ error: 'Apenas administradores e gestores podem criar usuários.' });
  const {
    username, password, name, email, phone, role, client_level, entity_id, active,
    location_id, extra_entity_ids,
  } = req.body || {};

  if (scopedToEntity(user)) {
    // Admin local / gestor: todos os dados obrigatórios e travado na própria empresa
    const missing = [];
    if (!username || !String(username).trim()) missing.push('usuário');
    if (!password) missing.push('senha');
    if (!name || !String(name).trim()) missing.push('nome');
    if (!email || !String(email).trim()) missing.push('e-mail');
    if (!phone || !String(phone).trim()) missing.push('telefone/WhatsApp');
    if (!role) missing.push('perfil');
    if (missing.length) return res.status(422).json({ error: `Campos obrigatórios: ${missing.join(', ')}.` });
    if (entity_id != null && String(entity_id) !== String(user.entity_id)) {
      return res.status(403).json({ error: 'Você só pode criar usuários para a própria empresa.' });
    }
  } else if (!username || !password || !name) {
    return res.status(422).json({ error: 'Usuário, senha e nome são obrigatórios.' });
  }
  if (String(password).length < 6) {
    return res.status(422).json({ error: 'A senha deve ter ao menos 6 caracteres.' });
  }
  const r = String(role || 'client');
  if (!ROLES.includes(r)) return res.status(422).json({ error: 'Perfil inválido.' });
  if (!rolesAllowedFor(user).includes(r)) {
    return res.status(403).json({ error: `Você não pode criar usuários com o perfil ${roleLabel(r)}.` });
  }
  if (phone) {
    const d = String(phone).replace(/\D/g, '');
    if (d.length !== 11) return res.status(422).json({ error: 'Telefone deve conter 11 dígitos no formato (xx) xxxxxxxxx.' });
  }
  const finalEntityId = scopedToEntity(user) ? user.entity_id : (entity_id || null);
  if (r === 'admin_local' && !finalEntityId) {
    return res.status(422).json({ error: 'O Administrador Local precisa estar ligado a uma empresa.' });
  }
  const locErr = await checkLocation(location_id, finalEntityId);
  if (locErr) return res.status(422).json({ error: locErr });
  try {
    const exists = await query(`SELECT 1 FROM users WHERE username = $1`, [String(username).trim()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Nome de usuário já em uso.' });
    const hash = await bcrypt.hash(String(password), 10);
    const level = r === 'client' ? (parseInt(client_level, 10) === 2 ? 2 : 1) : 1;
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, name, email, phone, role, client_level, entity_id, location_id, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, TRUE))
       RETURNING id`, [String(username).trim(), hash, name, email || null, phone || null,
                       r, level, finalEntityId, location_id || null,
                       active === undefined ? true : !!active]);
    const newId = rows[0].id;
    if (isMaster(user) && r === 'client' && level === 2 && Array.isArray(extra_entity_ids)) {
      await saveExtraEntities(newId, extra_entity_ids, finalEntityId);
    }
    const full = await query(`${USER_SELECT} WHERE u.id = $1`, [newId]);
    res.status(201).json({ user: publicUser(full.rows[0]) });
  } catch (err) {
    res.status(400).json({ error: 'Não foi possível criar o usuário.', details: err.message });
  }
});

// Atualiza usuario
router.patch('/:id', async (req, res) => {
  const actor = req.user;
  if (!canManageUsers(actor)) return res.status(403).json({ error: 'Permissão negada.' });
  const id = req.params.id;
  const target = await query(`SELECT * FROM users WHERE id = $1`, [id]);
  if (!target.rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const t = target.rows[0];
  if (scopedToEntity(actor)) {
    if (String(t.entity_id) !== String(actor.entity_id)) return res.status(403).json({ error: 'Você só pode editar usuários da própria empresa.' });
    if (!rolesAllowedFor(actor).includes(t.role)) return res.status(403).json({ error: `Você não pode editar usuários com o perfil ${roleLabel(t.role)}.` });
  }
  const {
    name, email, phone, role, client_level, entity_id, active, password, location_id, extra_entity_ids,
  } = req.body || {};
  if (role !== undefined) {
    if (!ROLES.includes(String(role))) return res.status(422).json({ error: 'Perfil inválido.' });
    if (!rolesAllowedFor(actor).includes(String(role))) {
      return res.status(403).json({ error: `Você não pode definir o perfil ${roleLabel(role)}.` });
    }
  }
  if (scopedToEntity(actor) && entity_id != null && String(entity_id) !== String(actor.entity_id)) {
    return res.status(403).json({ error: 'Você não pode mover o usuário para outra empresa.' });
  }
  if (phone !== undefined && phone !== null && String(phone).trim() !== '') {
    const d = String(phone).replace(/\D/g, '');
    if (d.length !== 11) return res.status(422).json({ error: 'Telefone deve conter 11 dígitos no formato (xx) xxxxxxxxx.' });
  }
  const newEntity = entity_id !== undefined ? (scopedToEntity(actor) ? actor.entity_id : (entity_id || null)) : t.entity_id;
  const newRole = role !== undefined ? String(role) : t.role;
  if (newRole === 'admin_local' && !newEntity) {
    return res.status(422).json({ error: 'O Administrador Local precisa estar ligado a uma empresa.' });
  }
  if (location_id !== undefined) {
    const locErr = await checkLocation(location_id, newEntity);
    if (locErr) return res.status(422).json({ error: locErr });
  }
  const fields = [];
  const params = [id];
  const add = (sql, val) => { params.push(val); fields.push(sql.replace('?', `$${params.length}`)); };

  if (name !== undefined) add('name = ?', name);
  if (email !== undefined) add('email = ?', email || null);
  if (phone !== undefined) add('phone = ?', phone || null);
  if (role !== undefined) add('role = ?', newRole);
  if (client_level !== undefined) add('client_level = ?', parseInt(client_level, 10) === 2 ? 2 : 1);
  if (entity_id !== undefined) add('entity_id = ?', newEntity);
  if (location_id !== undefined) add('location_id = ?', location_id || null);
  // trocou de empresa sem informar posto: limpa o posto antigo
  if (entity_id !== undefined && location_id === undefined && String(newEntity || '') !== String(t.entity_id || '')) {
    add('location_id = ?', null);
  }
  if (active !== undefined) add('active = ?', !!active);
  if (password) add('password_hash = ?', await bcrypt.hash(String(password), 10));

  if (!fields.length && extra_entity_ids === undefined) return res.status(422).json({ error: 'Nenhum campo para atualizar.' });
  try {
    if (fields.length) {
      const { rows } = await query(`UPDATE users SET ${fields.join(', ')} WHERE id = $1 RETURNING id`, params);
      if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    if (isMaster(actor) && extra_entity_ids !== undefined) {
      const finalLevel = client_level !== undefined ? (parseInt(client_level, 10) === 2 ? 2 : 1) : t.client_level;
      const keep = newRole === 'client' && finalLevel === 2;
      await saveExtraEntities(id, keep ? extra_entity_ids : [], newEntity);
    }
    const full = await query(`${USER_SELECT} WHERE u.id = $1`, [id]);
    res.json({ user: publicUser(full.rows[0]) });
  } catch (err) {
    res.status(400).json({ error: 'Não foi possível atualizar.', details: err.message });
  }
});

// Desativar / Ativar (soft) e Excluir (hard)
router.delete('/:id', async (req, res) => {
  const actor = req.user;
  if (!canManageUsers(actor)) return res.status(403).json({ error: 'Permissão negada.' });
  const id = req.params.id;
  const hard = req.query.hard === 'true' || req.query.hard === '1';
  if (String(id) === String(actor.id)) {
    return res.status(422).json({ error: 'Você não pode remover o próprio usuário.' });
  }
  const { rows } = await query(`SELECT * FROM users WHERE id = $1`, [id]);
  if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (scopedToEntity(actor)) {
    if (String(rows[0].entity_id) !== String(actor.entity_id)) return res.status(403).json({ error: `Você só pode ${hard ? 'excluir' : 'desativar'} usuários da própria empresa.` });
    if (!rolesAllowedFor(actor).includes(rows[0].role)) return res.status(403).json({ error: `Você não pode ${hard ? 'excluir' : 'desativar'} usuários com o perfil ${roleLabel(rows[0].role)}.` });
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
