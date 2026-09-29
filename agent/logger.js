// Logging simples do agente
'use strict';

const fs = require('fs');
const path = require('path');
const { logDir } = require('./paths');

function ensure() {
  try { fs.mkdirSync(logDir(), { recursive: true }); } catch (_) {}
}

function log(level, msg, extra) {
  ensure();
  const line = `[${new Date().toISOString()}] [${level}] ${msg}` +
    (extra !== undefined ? ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '');
  console.log(line);
  try {
    fs.appendFileSync(path.join(logDir(), 'agent.log'), line + '\n', 'utf8');
  } catch (_) {}
}

module.exports = {
  info: (m, e) => log('INFO', m, e),
  warn: (m, e) => log('WARN', m, e),
  error: (m, e) => log('ERROR', m, e),
  debug: (m, e) => log('DEBUG', m, e),
};
