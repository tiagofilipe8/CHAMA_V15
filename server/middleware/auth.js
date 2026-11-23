const jwt = require('jsonwebtoken');
const config = require('../config');
const { query, requestContext, previewPool } = require('../db');
const { ALL_KEYS, roleKeyOf } = require('../permissions');

// ---------------------------------------------------------------------
// Perfis
//   admin       = Administrador Mestre (sempre pode tudo)
//   (admin_local = antigo Administrador Local, convertido em Gestor)
//   moderator   = Moderador
//   technician  = Tecnico
//   client      = client_level 1 -> Usuario | client_level 2 -> Gestor
//
// O que cada perfil pode fazer vem da tabela role_permissions (tela
// "Perfis e permissoes"). Ver server/permissions.js.
// ---------------------------------------------------------------------

const isMaster = (u) => !!u && u.role === 'admin';
// O antigo Administrador Local virou Gestor: quem usa isLocalAdmin agora vale para o Gestor
const isLocalAdmin = (u) => !!u && (u.role === 'admin_local' || (u.role === 'client' && Number(u.client_level) === 2));
const isModerator = (u) => !!u && u.role === 'moderator';
const isTechnician = (u) => !!u && u.role === 'technician';
const isClient = (u) => !!u && u.role === 'client';
const isManager = (u) => isClient(u) && Number(u.client_level) === 2;

// Tem a permissao? (o Administrador Mestre tem todas)
function has(u, perm) {
  if (!u) return false;
  if (isMaster(u)) return true;
  return Array.isArray(u.permissions) && u.permissions.includes(perm);
}

// Ve chamados/inventario de todas as empresas
const seesAll = (u) => isMaster(u) || has(u, 'ticket.view_all');
// Compatibilidade: "equipe" = quem ve todas as empresas
const isStaff = seesAll;
// Ve notas internas
const isTeam = (u) => has(u, 'ticket.internal');

// Empresas do usuario (null = todas)
function entityIdsOf(user) {
  if (!user) return [];
  if (seesAll(user)) return null;
  const ids = new Set();
  if (user.entity_id) ids.add(String(user.entity_id));
  (user.extra_entity_ids || []).forEach((id) => ids.add(String(id)));
  return [...ids];
}

function canAccessEntity(user, entityId) {
  const ids = entityIdsOf(user);
  if (ids === null) return true;
  return entityId != null && ids.includes(String(entityId));
}

// O chamado esta no "territorio" do usuario (todas as empresas, ou a dele)?
function inScope(user, ticket) {
  if (!ticket) return false;
  if (seesAll(user)) return true;
  return has(user, 'ticket.view_company') && canAccessEntity(user, ticket.entity_id);
}

// Observadores foram tirados do sistema (2026-11-23): ninguém vê um chamado por ser "observador".
const isWatcher = () => false;
const isRequester = (user, ticket) => !!ticket && String(ticket.requester_id) === String(user.id);
const isAssigned = (user, ticket) => !!ticket && ticket.assigned_user_id != null
  && String(ticket.assigned_user_id) === String(user.id);

function canViewTicket(user, ticket) {
  if (!ticket) return false;
  return inScope(user, ticket) || isRequester(user, ticket) || isAssigned(user, ticket);
}

// Acoes sobre um chamado
const canTriage = (u, t) => isMaster(u) || (has(u, 'ticket.triage') && inScope(u, t));
const canAssign = (u, t) => isMaster(u) || (has(u, 'ticket.assign') && inScope(u, t));
const canTake = (u, t) => has(u, 'ticket.take') && canViewTicket(u, t) && (!t.assigned_user_id || isAssigned(u, t));
const canManageWatchers = () => false; // observadores tirados do sistema
const canWork = (u, t) => has(u, 'ticket.work') && isAssigned(u, t);
const canStatusAny = (u, t) => isMaster(u) || (has(u, 'ticket.status_any') && inScope(u, t));
const canResolve = (u, t) => canStatusAny(u, t) || canWork(u, t);
const needsApproval = (u) => !isMaster(u) && !has(u, 'ticket.resolve_direct');
const canApprove = (u, t) => has(u, 'ticket.approve') && (isRequester(u, t) || inScope(u, t));
const canCancel = (u, t) => has(u, 'ticket.cancel') && (isRequester(u, t) || inScope(u, t));
const canEditTicket = (u, t) => canTriage(u, t) || canWork(u, t)
  || (isRequester(u, t) && t.status === 1 && has(u, 'ticket.create'));
const canMessage = (u, t) => canViewTicket(u, t);
const canInternal = (u) => has(u, 'ticket.internal');

// Resumo para a tela do chamado (botoes que aparecem)
function ticketAbilities(u, t) {
  return {
    triage: canTriage(u, t),
    assign: canAssign(u, t),
    take: canTake(u, t) && !t.assigned_user_id,
    edit: canEditTicket(u, t),
    status: canStatusAny(u, t) || canWork(u, t),
    resolve: canResolve(u, t),
    needs_approval: needsApproval(u),
    approve: canApprove(u, t),
    cancel: canCancel(u, t),
    internal_notes: canInternal(u),
    manager_note: has(u, 'ticket.manager_note') && inScope(u, t),
    rating: has(u, 'ticket.rating'),
    estimate: canTriage(u, t) || canWork(u, t),
  };
}

function signToken(user, extra = {}) {
  return jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      role: user.role,
      entity_id: user.entity_id,
      client_level: user.client_level,
      name: user.name,
      ...extra,
    },
    config.jwt.secret,
    { expiresIn: extra.preview ? '4h' : config.jwt.expiresIn }
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
    category_mode: row.category_mode || null,
    location_id: row.location_id || null,
    location_name: row.location_name || null,
    extra_entity_ids: row.extra_entity_ids || [],
    permissions: isMaster(row) ? ALL_KEYS.slice() : (row.permissions || []),
    preview: row.preview || null,
    active: row.active,
  };
}

// Consulta padrao de usuario com empresa, posto, empresas extras e permissoes
const USER_SELECT = `
  SELECT u.*, e.name AS entity_name, e.logo AS entity_logo, e.category_mode,
         l.name AS location_name,
         COALESCE((SELECT array_agg(ue.entity_id ORDER BY ue.entity_id)
                   FROM user_entities ue WHERE ue.user_id = u.id), '{}') AS extra_entity_ids,
         COALESCE((SELECT array_agg(rp.permission ORDER BY rp.permission) FROM role_permissions rp
                   WHERE rp.allowed AND rp.role_key = CASE WHEN u.role = 'client'
                         THEN (CASE WHEN u.client_level = 2 THEN 'manager' ELSE 'user' END)
                         ELSE u.role END), '{}') AS permissions
  FROM users u
  LEFT JOIN entities e ON e.id = u.entity_id
  LEFT JOIN locations l ON l.id = u.location_id`;

async function loadUserAndContinue(payload, req, res, next) {
  const { rows } = await query(`${USER_SELECT} WHERE u.id = $1`, [payload.sub]);
  if (!rows.length || !rows[0].active) {
    return res.status(401).json({ error: 'Usuário inativo ou não encontrado.' });
  }
  req.user = rows[0];
  if (payload.preview) {
    req.user.preview = { schema: payload.preview, admin_id: payload.preview_admin, role_label: payload.preview_label };
    // Na previa nao ha anexos (os arquivos iriam para a pasta real de uploads)
    if (req.is && req.is('multipart/form-data')) {
      return res.status(403).json({ error: 'Anexos e fotos ficam desativados na Visualização de Cargos.' });
    }
  }
  next();
}

async function requireAuth(req, res, next) {
  // ja autenticado (varios routers usam requireAuth na mesma requisicao)
  if (req.user) return next();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token não informado.' });

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch {
    return res.status(401).json({ error: 'Sessão expirada ou inválida.' });
  }

  if (payload.preview) {
    // Visualizacao de cargos: tudo desta requisicao acontece na copia do banco
    let pool;
    try { pool = previewPool(payload.preview); } catch {
      return res.status(401).json({ error: 'Prévia inválida.' });
    }
    return requestContext.run({ pool, preview: true, schema: payload.preview }, () => {
      loadUserAndContinue(payload, req, res, next).catch((e) => {
        if (/does not exist|não existe/.test(e.message)) {
          return res.status(401).json({ error: 'A prévia terminou. Volte para a sua conta.' });
        }
        next(e);
      });
    });
  }
  return loadUserAndContinue(payload, req, res, next);
}

// requireRoles('admin') | requireRoles('admin','technician')
function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Permissão negada para este perfil.' });
    }
    next();
  };
}

// requirePermission('inventory.manage')
function requirePermission(perm) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado.' });
    if (!has(req.user, perm)) return res.status(403).json({ error: 'Seu perfil não tem permissão para esta ação.' });
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

// Escopo de visibilidade de chamados (clausula SQL sem "AND" inicial)
//  - ve todas as empresas: tudo
//  - ve a propria empresa: chamados das suas empresas
//  - sempre: os que abriu, os que observa e os atribuidos a ele
function scopeConditions(user, baseIdx = 1) {
  if (seesAll(user)) return { sql: '', params: [], next: baseIdx };
  const idx = baseIdx;
  const mine = `(t.requester_id = $${idx} OR t.assigned_user_id = $${idx})`;
  if (has(user, 'ticket.view_company')) {
    return {
      sql: `(t.entity_id::text = ANY($${idx + 1}::text[]) OR ${mine})`,
      params: [user.id, entityIdsOf(user)],
      next: idx + 2,
    };
  }
  return { sql: mine, params: [user.id], next: idx + 1 };
}

// Compatibilidade com o codigo antigo
async function canModifyTicket(user, ticket, mode = 'update') {
  if (mode === 'approval') return canApprove(user, ticket);
  if (mode === 'assign') return canAssign(user, ticket) || canTake(user, ticket);
  if (mode === 'status') return canStatusAny(user, ticket) || canWork(user, ticket) || canCancel(user, ticket);
  return canMessage(user, ticket);
}

module.exports = {
  USER_SELECT,
  isMaster,
  isLocalAdmin,
  isModerator,
  isTechnician,
  isClient,
  isManager,
  isStaff,
  isTeam,
  seesAll,
  has,
  roleKeyOf,
  entityIdsOf,
  canAccessEntity,
  inScope,
  isWatcher,
  isRequester,
  isAssigned,
  canViewTicket,
  canTriage,
  canAssign,
  canTake,
  canManageWatchers,
  canWork,
  canStatusAny,
  canResolve,
  needsApproval,
  canApprove,
  canCancel,
  canEditTicket,
  canMessage,
  canInternal,
  ticketAbilities,
  signToken,
  publicUser,
  requireAuth,
  requireRoles,
  requirePermission,
  requireClientLevel,
  scopeConditions,
  canModifyTicket,
};
