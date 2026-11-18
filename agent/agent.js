#!/usr/bin/env node
// Orcim Inventory Agent — Windows Service / console
// Coleta inventário via WMI e sincroniza com Central de Serviços.
'use strict';

const os = require('os');
const path = require('path');
const { createClient } = require('./http');
const { collectFull, collectIncremental } = require('./collect');
const { computeFingerprint, deriveAgentId, loadState, saveState, loadConfig, ensureDirs } = require('./identity');
const queue = require('./queue');
const log = require('./logger');

const VERSION = '1.0.0';

let running = false;
let timer = null;
let cfg = null;
let state = null;
let client = null;
let fingerprint = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureRegistered() {
  if (state.agent_token && state.asset_id) {
    client = createClient(state.server_url || cfg.server_url, state.agent_token);
    return true;
  }
  const provision = state.provision_token || cfg.provision_token;
  if (!provision) {
    log.warn('Sem provision_token — configure %PROGRAMDATA%\\Orcim\\agent\\config.json');
    return false;
  }
  if (!fingerprint) fingerprint = await computeFingerprint();
  const agentId = state.agent_id || deriveAgentId(fingerprint.hardware_fingerprint);
  const body = {
    provision_token: provision,
    agent_id: agentId,
    machine_guid: fingerprint.machine_guid,
    hardware_fingerprint: fingerprint.hardware_fingerprint,
    hostname: os.hostname(),
    ip: firstExternalIp(),
    version: VERSION,
  };
  const base = createClient(state.server_url || cfg.server_url, null);
  log.info('Registrando agente...', { agent_id: agentId });
  const res = await base.post('/api/inventory/agents/register', body);
  state.agent_token = res.data.agent_token;
  state.agent_id = res.data.agent_id;
  state.asset_id = res.data.asset_id;
  state.entity_id = res.data.entity_id;
  state.server_url = cfg.server_url;
  state.registered_at = new Date().toISOString();
  // remove provision token do config após sucesso
  if (cfg.provision_token) {
    cfg.provision_token = '';
    try { require('./identity').saveConfig(cfg); } catch (_) {}
  }
  state.provision_token = null;
  saveState(state);
  client = createClient(state.server_url, state.agent_token);
  log.info('Registrado com sucesso', { asset_id: state.asset_id, entity_id: state.entity_id });
  return true;
}

function firstExternalIp() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

async function flushQueue() {
  const files = queue.list();
  if (!files.length) return;
  log.info(`Descarregando fila offline (${files.length} itens)`);
  for (const file of files) {
    const item = queue.read(file);
    if (!item) { queue.remove(file); continue; }
    try {
      if (item.kind === 'heartbeat') {
        await client.post('/api/inventory/agents/heartbeat', item.payload);
      } else if (item.kind === 'inventory') {
        await client.post('/api/inventory/agents/inventory', item.payload);
      }
      queue.remove(file);
    } catch (e) {
      if (e.status === 401) {
        log.error('Token inválido — re-registrando');
        state.agent_token = null;
        saveState(state);
        await ensureRegistered();
        return; // tenta de novo no próximo ciclo
      }
      log.warn('Fila ainda offline', e.message);
      return;
    }
  }
}

async function sendHeartbeat() {
  const payload = {
    version: VERSION,
    hostname: os.hostname(),
    ip: firstExternalIp(),
  };
  try {
    await client.post('/api/inventory/agents/heartbeat', payload);
    state.last_heartbeat = new Date().toISOString();
    saveState(state);
  } catch (e) {
    if (e.status === 401) {
      state.agent_token = null;
      saveState(state);
      await ensureRegistered();
      return;
    }
    queue.enqueue('heartbeat', payload);
    log.warn('Heartbeat offline — enfileirado', e.message);
  }
}

async function sendInventory(type) {
  const payload = type === 'INCREMENTAL' ? await collectIncremental() : await collectFull();
  try {
    await client.post('/api/inventory/agents/inventory', payload);
    state.last_inventory = new Date().toISOString();
    state.inventory_type = payload.type;
    saveState(state);
    log.info(`Inventário ${payload.type} enviado`, {
      software: (payload.software || []).length,
      memory: (payload.memory || []).length,
      storage: (payload.storage || []).length,
    });
  } catch (e) {
    if (e.status === 401) {
      state.agent_token = null;
      saveState(state);
      await ensureRegistered();
      return;
    }
    queue.enqueue('inventory', payload);
    log.warn('Inventário offline — enfileirado', e.message);
  }
}

function shouldFullInventory() {
  if (!state.last_inventory) return true;
  const last = new Date(state.last_inventory).getTime();
  const fullEveryMs = 24 * 3600 * 1000; // FULL diário
  return Date.now() - last > fullEveryMs;
}

async function tick() {
  if (!running) return;
  try {
    if (!client) {
      const ok = await ensureRegistered();
      if (!ok) { scheduleNext(cfg.interval_seconds * 1000); return; }
    }
    await flushQueue();
    await sendHeartbeat();
    if (shouldFullInventory()) await sendInventory('FULL');
    else if (Date.now() - new Date(state.last_inventory || 0).getTime() > (cfg.inventory_interval_seconds || 3600) * 1000) {
      await sendInventory('INCREMENTAL');
    }
    scheduleNext((cfg.interval_seconds || 900) * 1000);
  } catch (e) {
    log.error('Erro no ciclo', e.message);
    scheduleNext(60 * 1000);
  }
}

function scheduleNext(ms) {
  if (!running) return;
  clearTimeout(timer);
  timer = setTimeout(tick, ms);
}

async function main() {
  ensureDirs();
  cfg = loadConfig();
  state = loadState();
  if (!state.server_url) state.server_url = cfg.server_url;
  running = true;
  log.info(`Orcim Inventory Agent v${VERSION} iniciando`, {
    hostname: os.hostname(),
    server: state.server_url,
    node: process.version,
  });
  // coleta identidade em background (não bloqueia registro se falhar)
  computeFingerprint().then((f) => { fingerprint = f; }).catch(() => {});
  await tick();
}

function shutdown() {
  running = false;
  clearTimeout(timer);
  log.info('Agente encerrado');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (require.main === module) {
  main().catch((e) => {
    log.error('Falha fatal', e.stack || e.message);
    process.exit(1);
  });
}

module.exports = { main, shutdown, VERSION };
