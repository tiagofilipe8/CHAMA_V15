// Fila offline: persiste payloads quando o servidor está inacessível
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { programDataQueue } = require('./paths');

function queueDir() {
  return programDataQueue();
}

function ensure() {
  fs.mkdirSync(queueDir(), { recursive: true });
}

function enqueue(kind, payload) {
  ensure();
  const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const file = path.join(queueDir(), `${kind}-${id}.json`);
  fs.writeFileSync(file, JSON.stringify({ kind, payload, queued_at: new Date().toISOString() }), 'utf8');
  return file;
}

function list() {
  ensure();
  return fs.readdirSync(queueDir())
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(queueDir(), f));
}

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function remove(file) {
  try { fs.unlinkSync(file); } catch (_) {}
}

module.exports = { enqueue, list, read, remove, queueDir };
