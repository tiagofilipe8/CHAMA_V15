// Execução de comandos PowerShell com timeout
'use strict';

const { execFile } = require('child_process');

function execPowerShell(script, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) {
          if (err.killed) return reject(new Error('PowerShell timeout'));
          return reject(new Error(stderr || err.message));
        }
        resolve((stdout || '').trim());
      }
    );
  });
}

// Converte saída PowerShell (JSON) em objeto
async function execJson(script, timeoutMs = 30000) {
  const out = await execPowerShell(script, timeoutMs);
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch (_) {
    // PowerShell às vezes junta objetos sem array — tenta envolver
    try {
      return JSON.parse('[' + out.replace(/\}\s*\{/g, '},{') + ']');
    } catch (e) {
      throw new Error('Saída JSON inválida do PowerShell: ' + out.slice(0, 200));
    }
  }
}

module.exports = { execPowerShell, execJson };
