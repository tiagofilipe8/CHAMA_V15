// Coleta de inventário via WMI/CIM (PowerShell)
'use strict';

const os = require('os');
const { execJson, execPowerShell } = require('./ps');

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  // Formato .NET /Date(ticks)/ ou /Date(ticks+offset)/
  const m = String(v).match(/^\/Date\((-?\d+)/);
  if (m) {
    const ms = Number(m[1]);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // DMTF WMI: yyyymmddHHMMSS.mmmmsms+ooo
  const dmtf = String(v).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (dmtf) {
    const [, y, mo, d, h, mi, s] = dmtf;
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }
  // yyyy-MM-dd ou ISO
  const s = String(v).trim().slice(0, 19);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseDateOnly(v) {
  const iso = parseDate(v);
  return iso ? iso.slice(0, 10) : null;
}

async function collectOS() {
  try {
    const rows = await execJson(`
      Get-CimInstance Win32_OperatingSystem | ForEach-Object {
        [pscustomobject]@{
          name = $_.Caption
          edition = $_.Edition
          version = $_.Version
          build = $_.BuildNumber
          arch = $_.OSArchitecture
          last_boot = if ($_.LastBootUpTime) { ([datetime]$_.LastBootUpTime).ToString('yyyy-MM-ddTHH:mm:ss') } else { $null }
          domain = $_.Domain
          csname = $_.CSName
        }
      } | ConvertTo-Json -Compress`);
    const r = Array.isArray(rows) ? rows[0] : rows;
    if (!r) return null;
    return {
      name: r.name || null,
      edition: r.edition || null,
      version: r.version || null,
      build: r.build ? String(r.build) : null,
      arch: r.arch || null,
      last_boot: parseDate(r.last_boot),
      domain: r.domain && r.domain !== 'WORKGROUP' ? r.domain : null,
      hostname: r.csname || os.hostname(),
    };
  } catch (_) {
    return {
      name: os.type(),
      version: os.release(),
      arch: os.arch(),
      last_boot: null,
      hostname: os.hostname(),
    };
  }
}

async function collectCPU() {
  try {
    const rows = await execJson(`
      Get-CimInstance Win32_Processor | ForEach-Object {
        [pscustomobject]@{
          manufacturer = $_.Manufacturer
          model = $_.Name
          cores = $_.NumberOfCores
          threads = $_.NumberOfLogicalProcessors
          frequency = $_.MaxClockSpeed
          arch = if ($_.Architecture -eq 9 -or $_.Architecture -eq 12) { 'x64' } else { 'x86' }
        }
      } | ConvertTo-Json -Compress`);
    const r = Array.isArray(rows) ? rows[0] : rows;
    if (!r) return null;
    return {
      manufacturer: (r.manufacturer || '').trim() || null,
      model: (r.model || '').split('@')[0].trim() || null,
      cores: toNum(r.cores),
      threads: toNum(r.threads),
      frequency: toNum(r.frequency),
      arch: r.arch || null,
    };
  } catch (_) {
    return null;
  }
}

async function collectMemory() {
  try {
    const rows = await execJson(`
      Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
        [pscustomobject]@{
          slot = $_.DeviceLocator
          manufacturer = $_.Manufacturer
          part_number = ($_.PartNumber -replace '\\s+', '').Trim()
          serial = $_.SerialNumber
          capacity_gb = if ($_.Capacity) { [math]::Round($_.Capacity / 1GB, 0) } else { $null }
          speed_mhz = $_.Speed
          type = switch -Wildcard ($_.SMBIOSMemoryType) {
            20 { 'DDR' } 21 { 'DDR2' } 24 { 'DDR3' } 26 { 'DDR4' } 34 { 'DDR5' }
            default { $_.SMBIOSMemoryType }
          }
        }
      } | ConvertTo-Json -Compress`);
    if (!rows) return [];
    const arr = Array.isArray(rows) ? rows : [rows];
    return arr.map((m, i) => ({
      slot: m.slot || `Slot ${i + 1}`,
      manufacturer: m.manufacturer || null,
      part_number: m.part_number || null,
      serial: m.serial || null,
      capacity_gb: toNum(m.capacity_gb),
      speed_mhz: toNum(m.speed_mhz),
      type: m.type || null,
    }));
  } catch (_) {
    return [];
  }
}

async function collectStorage() {
  try {
    const rows = await execJson(`
      Get-CimInstance Win32_DiskDrive | ForEach-Object {
        $disk = $_
        $parts = Get-CimInstance -Query "ASSOCIATORS OF {Win32_DiskDrive.DeviceID='$($disk.DeviceID.Replace('\\','\\\\'))'} WHERE AssocClass = Win32_DiskDriveToDiskPartition"
        $logicals = @()
        foreach ($p in @($parts)) {
          $logicals += @(Get-CimInstance -Query "ASSOCIATORS OF {Win32_DiskPartition.DeviceID='$($p.DeviceID.Replace('\\','\\\\'))'} WHERE AssocClass = Win32_LogicalDiskToPartition")
        }
        [pscustomobject]@{
          manufacturer = $disk.Manufacturer
          model = $disk.Model
          serial = $disk.SerialNumber
          capacity_gb = if ($disk.Size) { [math]::Round($disk.Size / 1GB, 1) } else { $null }
          type = if ($disk.MediaType -match 'SSD' -or $disk.Model -match 'SSD|NVMe') { 'SSD' } elseif ($disk.MediaType -match 'Removable') { 'Removable' } else { 'HDD' }
          interface = $disk.InterfaceType
          firmware = $disk.FirmwareRevision
          used_gb = [math]::Round((@($logicals) | Measure-Object -Property Size -Sum).Sum / 1GB, 1)
          free_gb = [math]::Round((@($logicals) | Measure-Object -Property FreeSpace -Sum).Sum / 1GB, 1)
        }
      } | ConvertTo-Json -Compress`);
    if (!rows) return [];
    const arr = Array.isArray(rows) ? rows : [rows];
    return arr.map((s) => ({
      manufacturer: s.manufacturer || null,
      model: s.model || null,
      serial: (s.serial || '').trim() || null,
      capacity_gb: toNum(s.capacity_gb),
      type: s.type || null,
      interface: s.interface || null,
      firmware: s.firmware || null,
      used_gb: toNum(s.used_gb),
      free_gb: toNum(s.free_gb),
    }));
  } catch (_) {
    return [];
  }
}

async function collectGPU() {
  try {
    const rows = await execJson(`
      Get-CimInstance Win32_VideoController | ForEach-Object {
        [pscustomobject]@{
          manufacturer = ($_.AdapterSoftwareVersion -split ' ')[0]
          name = $_.Name
          driver = $_.DriverVersion
          ram_mb = $_.AdapterRAM
        }
      } | ConvertTo-Json -Compress`);
    if (!rows) return [];
    const arr = Array.isArray(rows) ? rows : [rows];
    return arr.map((g) => {
      const name = g.name || '';
      let mfr = 'Unknown';
      if (/nvidia/i.test(name) || /nvidia/i.test(g.manufacturer || '')) mfr = 'NVIDIA';
      else if (/amd|radeon/i.test(name)) mfr = 'AMD';
      else if (/intel/i.test(name)) mfr = 'Intel';
      // AdapterRAM pode vir em bytes (WMI) — normaliza para GB
      let memGb = null;
      const raw = toNum(g.ram_mb);
      if (raw && raw > 0) {
        memGb = raw > 10 * 1024 * 1024 ? Math.round(raw / (1024 * 1024 * 1024)) // bytes
          : raw > 10 * 1024 ? Math.round(raw / 1024) // KB
          : Math.round(raw); // já MB
        if (memGb <= 0) memGb = null;
      }
      return {
        manufacturer: mfr,
        model: name || null,
        memory_gb: memGb,
        driver_version: g.driver || null,
      };
    });
  } catch (_) {
    return [];
  }
}

async function collectNetwork() {
  try {
    const rows = await execJson(`
      Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled } | ForEach-Object {
        [pscustomobject]@{
          name = $_.Description
          mac = $_.MACAddress
          ip = ($_.IPAddress -join ', ')
          speed = $_.Speed
          status = if ($_.IPConnectionStatus -eq 2) { 'Up' } else { 'Down' }
        }
      } | ConvertTo-Json -Compress`);
    if (!rows) return [];
    const arr = Array.isArray(rows) ? rows : [rows];
    return arr.map((n) => ({
      name: n.name || null,
      manufacturer: null,
      model: null,
      mac: n.mac ? n.mac.toUpperCase().replace(/-/g, ':') : null,
      ip: n.ip || null,
      speed_mbps: n.speed ? Math.round(toNum(n.speed) / 1e6) : null,
      status: n.status || null,
    }));
  } catch (_) {
    return [];
  }
}

async function collectMotherboardBios() {
  let motherboard = null;
  let bios = null;
  try {
    const bb = await execJson(`
      Get-CimInstance Win32_BaseBoard | ForEach-Object {
        [pscustomobject]@{ manufacturer = $_.Manufacturer; model = $_.Product; serial = $_.SerialNumber }
      } | ConvertTo-Json -Compress`);
    const r = Array.isArray(bb) ? bb[0] : bb;
    if (r) {
      motherboard = {
        manufacturer: (r.manufacturer || '').trim() || null,
        model: (r.model || '').trim() || null,
        serial: (r.serial || '').trim() || null,
      };
    }
  } catch (_) {}
  try {
    const b = await execJson(`
      Get-CimInstance Win32_BIOS | ForEach-Object {
        [pscustomobject]@{ manufacturer = $_.Manufacturer; version = $_.SMBIOSBIOSVersion; date = if ($_.ReleaseDate) { ([datetime]$_.ReleaseDate).ToString('yyyy-MM-dd') } else { $null } }
      } | ConvertTo-Json -Compress`);
    const r = Array.isArray(b) ? b[0] : b;
    if (r) {
      bios = {
        manufacturer: (r.manufacturer || '').trim() || null,
        version: r.version || null,
        date: parseDateOnly(r.date),
      };
    }
  } catch (_) {}
  return { motherboard, bios };
}

async function collectSoftware() {
  try {
    const rows = await execJson(`
      $paths = @(
        'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
      )
      Get-ItemProperty $paths -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -and -not $_.SystemComponent } |
        ForEach-Object {
          [pscustomobject]@{
            name = $_.DisplayName
            publisher = $_.Publisher
            version = $_.DisplayVersion
            arch = if ($_.PSPath -match 'WOW6432Node') { 'x86' } else { 'x64' }
            install_date = if ($_.InstallDate -match '^\\d{8}$') {
              [datetime]::ParseExact($_.InstallDate, 'yyyyMMdd', $null).ToString('yyyy-MM-dd')
            } else { $null }
            product_id = $_.PSChildName
          }
        } | Sort-Object name -Unique | ConvertTo-Json -Compress`);
    if (!rows) return [];
    const arr = Array.isArray(rows) ? rows : [rows];
    return arr.map((s) => ({
      name: String(s.name || '').slice(0, 300),
      publisher: s.publisher || null,
      version: s.version || null,
      arch: s.arch || null,
      install_date: s.install_date || null,
      product_id: s.product_id || null,
    })).filter((s) => s.name);
  } catch (_) {
    return [];
  }
}

async function collectFull() {
  const [osInfo, cpu, motherboardBios] = await Promise.all([
    collectOS(),
    collectCPU(),
    collectMotherboardBios(),
  ]);
  const [memory, storage, gpu, network, software] = await Promise.all([
    collectMemory(),
    collectStorage(),
    collectGPU(),
    collectNetwork(),
    collectSoftware(),
  ]);
  return {
    type: 'FULL',
    collected_at: new Date().toISOString(),
    hostname: os.hostname(),
    os: osInfo,
    cpu,
    motherboard: motherboardBios.motherboard,
    bios: motherboardBios.bios,
    memory,
    storage,
    gpu,
    network,
    software,
  };
}

// INCREMENTAL: coleta leve (heartbeat-ish) — CPU/OS/memória resumida
async function collectIncremental() {
  const [osInfo, cpu, memory] = await Promise.all([collectOS(), collectCPU(), collectMemory()]);
  const totalMem = memory.reduce((acc, m) => acc + (m.capacity_gb || 0), 0);
  return {
    type: 'INCREMENTAL',
    collected_at: new Date().toISOString(),
    hostname: os.hostname(),
    os: osInfo,
    cpu,
    memory: [{ slot: 'TOTAL', capacity_gb: totalMem || null, type: memory[0]?.type || null }],
    memory_modules: memory.length,
  };
}

module.exports = { collectFull, collectIncremental, collectOS, collectCPU, collectMemory, collectStorage, collectGPU, collectNetwork, collectSoftware, collectMotherboardBios, parseDate, parseDateOnly };
