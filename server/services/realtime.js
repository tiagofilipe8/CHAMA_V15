const jwt = require('jsonwebtoken');
const config = require('../config');
const { currentContext } = require('../db');

// Na Visualizacao de cargos os avisos em tempo real ficam isolados: so os
// navegadores conectados com o token daquela previa recebem (salas com prefixo).
function room(name) {
  const ctx = currentContext();
  return ctx && ctx.preview ? `${ctx.schema}:${name}` : name;
}

let io = null;

function initSocket(server) {
  const { Server } = require('socket.io');
  io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = jwt.verify(token, config.jwt.secret);
      socket.user = {
        id: payload.sub,
        role: payload.role,
        entity_id: payload.entity_id,
        client_level: payload.client_level,
        name: payload.name,
        preview: payload.preview || null,
      };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    if (socket.user) {
      const px = socket.user.preview ? `${socket.user.preview}:` : '';
      socket.join(`${px}user:${socket.user.id}`);
      if (socket.user.entity_id) socket.join(`${px}entity:${socket.user.entity_id}`);
      socket.join(`${px}role:${socket.user.role}`);
      if (socket.user.role === 'client' && socket.user.client_level >= 2) {
        socket.join(`${px}managers:${socket.user.entity_id}`);
      }
    }
  });

  return io;
}

function getIO() {
  return io;
}

function emitToUsers(userIds, event, payload) {
  if (!io) return;
  for (const id of new Set(userIds)) {
    io.to(room(`user:${id}`)).emit(event, payload);
  }
}

function emitToEntities(entityIds, event, payload) {
  if (!io) return;
  for (const id of new Set(entityIds)) {
    io.to(room(`entity:${id}`)).emit(event, payload);
  }
}

function emitToManagers(entityIds, event, payload) {
  if (!io) return;
  for (const id of new Set(entityIds)) {
    io.to(room(`managers:${id}`)).emit(event, payload);
  }
}

function emitBroadcastRoles(roles, event, payload) {
  if (!io) return;
  for (const r of roles) io.to(room(`role:${r}`)).emit(event, payload);
}

module.exports = {
  initSocket,
  getIO,
  emitToUsers,
  emitToEntities,
  emitToManagers,
  emitBroadcastRoles,
};