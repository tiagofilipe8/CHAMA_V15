'use strict';

const path = require('path');

function programData() {
  return process.env.PROGRAMDATA || 'C:\\ProgramData';
}

function orcimRoot() {
  return path.join(programData(), 'Orcim');
}

function agentDir() {
  return path.join(orcimRoot(), 'agent');
}

function programDataQueue() {
  return path.join(orcimRoot(), 'queue');
}

function logDir() {
  return path.join(orcimRoot(), 'logs');
}

module.exports = { programData, orcimRoot, agentDir, programDataQueue, logDir };
