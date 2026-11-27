// Orcim Inventory Agent - identidade estável da máquina
'use strict';

const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execPowerShell } = require('./ps');

function programData() {
  return process.env.PROGRAMDATA || 'C:\\ProgramData';
}

function agentDir() {
  return path.join(programData(), 'Orcim', 'agent');
}

function statePath() {
  return path.join(agentDir(), 'state.json');
}

function configPath() {
  return path.join(agentDir(), 'config.json');
}

function ensureDirs() {
  fs.mkdirSync(agentDir(), { recursive: true });
  fs.mkdirSync(path.join(programData(), 'Orcim', 'queue'), { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      let raw = fs.readFileSync(file, 'utf8');
      // remove BOM do Windows/PowerShell
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      return JSON.parse(raw);
    }
  } catch (_) {}
  return fallback;
}

function writeJson(file, data) {
  ensureDirs();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

async function getMachineGuid() {
  try {
    const out = await execPowerShell(
      `(Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid`
    );
    const m = out.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
    return m ? m[0] : null;
  } catch (_) {
    return null;
  }
}

async function getBiosSerial() {
  try {
    const out = await execPowerShell(`(Get-CimInstance Win32_BIOS).SerialNumber`);
    return (out || '').trim() || null;
  } catch (_) {
    return null;
  }
}

async function getMacAddresses() {
  try {
    const out = await execPowerShell(
      `Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled } | ForEach-Object { $_.MACAddress }`
    );
    return out.split(/\r?\n/).map((s) => s.trim().toUpperCase().replace(/:/g, '')).filter(Boolean).sort();
  } catch (_) {
    return [];
  }
}

// Fingerprint estável: machineGuid + serial + MACs (ordenados)
async function computeFingerprint() {
  const [guid, serial, macs] = await Promise.all([getMachineGuid(), getBiosSerial(), getMacAddresses()]);
  const material = [guid || '', serial || '', ...macs].join('|');
  const hash = crypto.createHash('sha256').update(material).digest('hex');
  return { machine_guid: guid, hardware_fingerprint: hash, serial_number: serial };
}

// agent_id estável por máquina (fingerprint truncado)
function deriveAgentId(fingerprint) {
  return `win-${fingerprint.slice(0, 16)}`;
}

function loadState() {
  return readJson(statePath(), {
    agent_token: null,
    agent_id: null,
    asset_id: null,
    entity_id: null,
    provision_token: null,
    server_url: null,
    registered_at: null,
    last_heartbeat: null,
    last_inventory: null,
    inventory_type: null,
  });
}

function saveState(state) {
  writeJson(statePath(), state);
}

function loadConfig() {
  return readJson(configPath(), {
    server_url: 'http://localhost:7070',
    provision_token: '',
    interval_seconds: 900,
    inventory_interval_seconds: 3600,
  });
}

function saveConfig(cfg) {
  writeJson(configPath(), cfg);
}

module.exports = {
  agentDir,
  statePath,
  configPath,
  ensureDirs,
  readJson,
  writeJson,
  computeFingerprint,
  deriveAgentId,
  loadState,
  saveState,
  loadConfig,
  saveConfig,
  getMachineGuid,
};
