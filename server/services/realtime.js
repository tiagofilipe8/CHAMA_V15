const jwt = require('jsonwebtoken');
const config = require('../config');

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
      };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    if (socket.user) {
      socket.join(`user:${socket.user.id}`);
      if (socket.user.entity_id) socket.join(`entity:${socket.user.entity_id}`);
      socket.join(`role:${socket.user.role}`);
      if (socket.user.role === 'client' && socket.user.client_level >= 2) {
        socket.join(`managers:${socket.user.entity_id}`);
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
    io.to(`user:${id}`).emit(event, payload);
  }
}

function emitToEntities(entityIds, event, payload) {
  if (!io) return;
  for (const id of new Set(entityIds)) {
    io.to(`entity:${id}`).emit(event, payload);
  }
}

function emitToManagers(entityIds, event, payload) {
  if (!io) return;
  for (const id of new Set(entityIds)) {
    io.to(`managers:${id}`).emit(event, payload);
  }
}

function emitBroadcastRoles(roles, event, payload) {
  if (!io) return;
  for (const r of roles) io.to(`role:${r}`).emit(event, payload);
}

module.exports = {
  initSocket,
  getIO,
  emitToUsers,
  emitToEntities,
  emitToManagers,
  emitBroadcastRoles,
};