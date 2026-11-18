const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db');

function signToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      role: user.role,
      entity_id: user.entity_id,
      client_level: user.client_level,
      name: user.name,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    client_level: row.client_level,
    entity_id: row.entity_id,
    entity_name: row.entity_name || null,
    entity_logo: row.entity_logo || null,
    active: row.active,
  };
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token não informado.' });

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch {
    return res.status(401).json({ error: 'Sessão expirada ou inválida.' });
  }

  const { rows } = await query(
    `SELECT u.*, e.name AS entity_name, e.logo AS entity_logo FROM users u
     LEFT JOIN entities e ON e.id = u.entity_id
     WHERE u.id = $1`, [payload.sub]);
  if (!rows.length || !rows[0].active) {
    return res.status(401).json({ error: 'Usuário inativo ou não encontrado.' });
  }
  req.user = rows[0];
  next();
}

// requireRoles('admin') | requireRoles('admin','technician')
function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Permissão negada para este papel.' });
    }
    next();
  };
}

function requireClientLevel(minLevel) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado.' });
    if (req.user.role === 'client' && (req.user.client_level || 1) < minLevel) {
      return res.status(403).json({ error: 'Seu nível de acesso de cliente não permite esta ação.' });
    }
    next();
  };
}

// Escopo de visibilidade de chamados por papel
// Retorna cláusula SQL (sem "AND" inicial; o chamador insere o conector)
function scopeConditions(user, baseIdx = 1) {
  if (user.role === 'admin' || user.role === 'technician') {
    return { sql: '', params: [], next: baseIdx };
  }
  const idx = baseIdx;
  if (user.role === 'client') {
    if ((user.client_level || 1) === 2) {
      return { sql: `t.entity_id = $${idx}`, params: [user.entity_id], next: idx + 1 };
    }
    return { sql: `t.requester_id = $${idx}`, params: [user.id], next: idx + 1 };
  }
  return { sql: '', params: [], next: baseIdx };
}

// Verifica se o usuario pode alterar um chamado especifico
async function canModifyTicket(user, ticket, mode = 'update') {
  if (user.role === 'admin') return true;

  if (user.role === 'technician') {
    if (mode === 'assign') {
      // tecnico pode assumir qualquer chamado nao atribuido a outro
      return ticket.assigned_user_id === null || ticket.assigned_user_id === user.id;
    }
    // update/status/approval/comentario: apenas chamados atribuidos a ele
    return ticket.assigned_user_id === user.id;
  }

  if (user.role === 'client') {
    const isRequester = ticket.requester_id === user.id;
    const isManager =
      (user.client_level || 1) === 2 && ticket.entity_id === user.entity_id;
    if (mode === 'approval') return isRequester || isManager;
    // interacao geral (comentario, cancelar): requisitante ou gestor da entidade
    return isRequester || isManager;
  }
  return false;
}

module.exports = {
  signToken,
  publicUser,
  requireAuth,
  requireRoles,
  requireClientLevel,
  scopeConditions,
  canModifyTicket,
};