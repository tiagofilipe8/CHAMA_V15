# =====================================================================
# Orcim Inventory Agent - PowerShell puro (sem Node.js)
# Windows 10/11 / Server 2016+
#
# Instalar (Admin):
#   powershell -ExecutionPolicy Bypass -File Install-Agente.ps1 -ProvisionToken "1-XXXXXX-XXXXXX"
#
# Rodar uma vez (teste):
#   powershell -ExecutionPolicy Bypass -File Agente.ps1 -Once
#
# Desinstalar (Admin):
#   powershell -ExecutionPolicy Bypass -File Install-Agente.ps1 -Uninstall
# =====================================================================

[CmdletBinding()]
param(
  [switch]$Once,              # um ciclo e sai (teste)
  [string]$ConfigPath = "",
  [int]$OverrideIntervalSec = 0
)

$ErrorActionPreference = 'Stop'
$Version = '1.0.0-ps'

# ---------------- paths ----------------
function Get-OrcimRoot {
  Join-Path $env:ProgramData 'Orcim'
}
function Get-AgentDir   { Join-Path (Get-OrcimRoot) 'agent' }
function Get-QueueDir   { Join-Path (Get-OrcimRoot) 'queue' }
function Get-LogDir     { Join-Path (Get-OrcimRoot) 'logs' }
function Get-DefaultCfg { Join-Path (Get-AgentDir) 'config.json' }
function Get-StatePath  { Join-Path (Get-AgentDir) 'state.json' }
function Get-LogPath    { Join-Path (Get-LogDir) 'agent-ps.log' }

function Ensure-Dirs {
  foreach ($d in @((Get-AgentDir), (Get-QueueDir), (Get-LogDir))) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
  }
}

function Write-AgentLog {
  param([string]$Level, [string]$Message, [object]$Extra = $null)
  $line = ('[{0}] [{1}] {2}' -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'), $Level, $Message)
  if ($null -ne $Extra) {
    try { $line += ' ' + ($Extra | ConvertTo-Json -Compress -Depth 6) } catch { $line += ' ' + [string]$Extra }
  }
  Write-Host $line
  try { Add-Content -Path (Get-LogPath) -Value $line -Encoding UTF8 } catch {}
}

# ---------------- JSON helpers (sem BOM, sem PS5 quirks) ----------------
function Read-JsonFile {
  param([string]$Path, [hashtable]$Fallback = @{})
  if (-not (Test-Path $Path)) { return $Fallback }
  try {
    $raw = [System.IO.File]::ReadAllText($Path)
    if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 0xFEFF) { $raw = $raw.Substring(1) }
    if ([string]::IsNullOrWhiteSpace($raw)) { return $Fallback }
    return $raw | ConvertFrom-Json
  } catch {
    Write-AgentLog WARN "Falha ao ler JSON $Path : $($_.Exception.Message)"
    return $Fallback
  }
}

function Write-JsonFile {
  param([string]$Path, [object]$Object)
  $json = $Object | ConvertTo-Json -Depth 8
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $json, $utf8)
}

function Get-Prop {
  param($Obj, [string]$Name, $Default = $null)
  if ($null -eq $Obj) { return $Default }
  $p = $Obj.PSObject.Properties[$Name]
  if ($p) { return $p.Value }
  return $Default
}

# ---------------- config / state ----------------
function Get-AgentConfig {
  $path = if ($ConfigPath) { $ConfigPath } else { Get-DefaultCfg }
  $cfg = Read-JsonFile -Path $path -Fallback @{
    server_url = 'http://localhost:7070'
    provision_token = ''
    interval_seconds = 900
    inventory_interval_seconds = 3600
  }
  # normaliza campos
  $o = [ordered]@{
    server_url = [string](Get-Prop $cfg 'server_url' 'http://localhost:7070')
    provision_token = [string](Get-Prop $cfg 'provision_token' '')
    interval_seconds = [int](Get-Prop $cfg 'interval_seconds' 900)
    inventory_interval_seconds = [int](Get-Prop $cfg 'inventory_interval_seconds' 3600)
  }
  if ($OverrideIntervalSec -gt 0) { $o.interval_seconds = $OverrideIntervalSec }
  if ([string]::IsNullOrWhiteSpace($o.server_url)) { $o.server_url = 'http://localhost:7070' }
  $o.server_url = $o.server_url.TrimEnd('/')
  return [pscustomobject]$o
}

function Get-AgentState {
  $s = Read-JsonFile -Path (Get-StatePath) -Fallback @{}
  [pscustomobject]@{
    agent_token     = [string](Get-Prop $s 'agent_token' '')
    agent_id        = [string](Get-Prop $s 'agent_id' '')
    asset_id        = Get-Prop $s 'asset_id' $null
    entity_id       = Get-Prop $s 'entity_id' $null
    server_url      = [string](Get-Prop $s 'server_url' '')
    registered_at   = [string](Get-Prop $s 'registered_at' '')
    last_heartbeat  = [string](Get-Prop $s 'last_heartbeat' '')
    last_inventory  = [string](Get-Prop $s 'last_inventory' '')
    inventory_type  = [string](Get-Prop $s 'inventory_type' '')
  }
}

function Save-AgentState {
  param([object]$State)
  Write-JsonFile -Path (Get-StatePath) -Object $State
}

# ---------------- identidade ----------------
function Get-MachineGuid {
  try {
    $v = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid
    return [string]$v
  } catch { return $null }
}

function Get-BiosSerial {
  try {
    $v = (Get-CimInstance Win32_BIOS -ErrorAction Stop).SerialNumber
    if ($v) { return ([string]$v).Trim() }
  } catch {}
  return $null
}

function Get-MacList {
  try {
    $macs = @(Get-CimInstance Win32_NetworkAdapterConfiguration -ErrorAction Stop |
      Where-Object { $_.IPEnabled } |
      ForEach-Object { ([string]$_.MACAddress).ToUpper().Replace(':', '').Replace('-', '') } |
      Where-Object { $_ } |
      Sort-Object)
    return $macs
  } catch { return @() }
}

function Get-HardwareFingerprint {
  $guid = Get-MachineGuid
  $serial = Get-BiosSerial
  $macs = Get-MacList
  $parts = @()
  if ($guid) { $parts += $guid }
  if ($serial) { $parts += $serial }
  $parts += $macs
  $material = [string]::Join('|', $parts)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($material)
    $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
  } finally { $sha.Dispose() }
  [pscustomobject]@{
    machine_guid = $guid
    hardware_fingerprint = $hash
    serial_number = $serial
  }
}

function New-AgentId {
  param([string]$Fingerprint)
  if ([string]::IsNullOrEmpty($Fingerprint)) {
    $Fingerprint = (Get-HardwareFingerprint).hardware_fingerprint
  }
  $short = if ($Fingerprint.Length -ge 16) { $Fingerprint.Substring(0, 16) } else { $Fingerprint }
  return "win-$short"
}

# ---------------- HTTP ----------------
function Invoke-AgentApi {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null,
    [string]$Token = '',
    [int]$TimeoutSec = 30
  )
  $cfg = Get-AgentConfig
  $state = Get-AgentState
  $base = if ($state.server_url) { $state.server_url } else { $cfg.server_url }
  $url = $base.TrimEnd('/') + $Path
  $headers = @{ 'Accept' = 'application/json' }
  if ($Token) { $headers['Authorization'] = "Bearer $Token" }

  $params = @{
    Method = $Method
    Uri = $url
    Headers = $headers
    TimeoutSec = $TimeoutSec
    ErrorAction = 'Stop'
  }
  if ($null -ne $Body) {
    $json = $Body | ConvertTo-Json -Depth 10 -Compress
    $params.ContentType = 'application/json; charset=utf-8'
    $params.Body = [System.Text.Encoding]::UTF8.GetBytes($json)
  }

  try {
    $resp = Invoke-WebRequest @params
    $text = $resp.Content
    if ($text -is [byte[]]) { $text = [System.Text.Encoding]::UTF8.GetString($text) }
    $obj = $null
    if ($text) { try { $obj = $text | ConvertFrom-Json } catch { $obj = $text } }
    return [pscustomobject]@{ ok = $true; status = [int]$resp.StatusCode; data = $obj }
  } catch {
    $status = 0
    $errMsg = $_.Exception.Message
    $data = $null
    # tenta extrair status e body de WebException / HttpResponseException
    $ex = $_.Exception
    while ($ex) {
      if ($ex.PSObject.Properties['Response'] -and $ex.Response) {
        try {
          $stream = $ex.Response.GetResponseStream()
          if ($stream) {
            $reader = New-Object System.IO.StreamReader($stream)
            $bodyText = $reader.ReadToEnd()
            $reader.Close()
            if ($bodyText) { try { $data = $bodyText | ConvertFrom-Json } catch {} }
          }
        } catch {}
        try { $status = [int]$ex.Response.StatusCode } catch {}
        break
      }
      # PowerShell 7 HttpResponseException
      if ($ex.PSObject.Properties['StatusCode'] -and $ex.StatusCode) {
        try { $status = [int]$ex.StatusCode } catch {}
        if ($ex.PSObject.Properties['ErrorDetails'] -and $ex.ErrorDetails -and $ex.ErrorDetails.Message) {
          try { $data = $ex.ErrorDetails.Message | ConvertFrom-Json } catch { $errMsg = $ex.ErrorDetails.Message }
        }
        break
      }
      $ex = $ex.InnerException
    }
    if ($data -and (Get-Prop $data 'error')) { $errMsg = [string](Get-Prop $data 'error') }
    return [pscustomobject]@{ ok = $false; status = $status; data = $data; error = $errMsg }
  }
}

# ---------------- fila offline ----------------
function Add-QueueItem {
  param([string]$Kind, [object]$Payload)
  Ensure-Dirs
  $id = '{0}-{1}' -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(), ([guid]::NewGuid().ToString('N').Substring(0, 8))
  $file = Join-Path (Get-QueueDir) "$Kind-$id.json"
  Write-JsonFile -Path $file -Object ([pscustomobject]@{
    kind = $Kind
    payload = $Payload
    queued_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  })
  Write-AgentLog WARN "Enfileirado offline: $Kind -> $file"
  return $file
}

function Get-QueueItems {
  Ensure-Dirs
  Get-ChildItem -Path (Get-QueueDir) -Filter '*.json' -File -ErrorAction SilentlyContinue |
    Sort-Object Name |
    ForEach-Object { $_.FullName }
}

function Send-Queue {
  param([string]$Token)
  $files = Get-QueueItems
  if (-not $files) { return }
  Write-AgentLog INFO ("Descarregando fila ({0} itens)" -f $files.Count)
  foreach ($f in $files) {
    $item = Read-JsonFile -Path $f -Fallback $null
    if (-not $item) { Remove-Item $f -Force -ErrorAction SilentlyContinue; continue }
    $kind = [string](Get-Prop $item 'kind' '')
    $payload = Get-Prop $item 'payload' $null
    $path = switch ($kind) {
      'heartbeat' { '/api/inventory/agents/heartbeat' }
      'inventory' { '/api/inventory/agents/inventory' }
      default { $null }
    }
    if (-not $path) { Remove-Item $f -Force -ErrorAction SilentlyContinue; continue }
    $r = Invoke-AgentApi -Method POST -Path $path -Body $payload -Token $Token
    if ($r.ok) {
      Remove-Item $f -Force -ErrorAction SilentlyContinue
      Write-AgentLog INFO "Fila enviada: $kind"
    } elseif ($r.status -eq 401) {
      Write-AgentLog ERROR 'Token invalido na fila - re-registro necessario'
      return
    } else {
      Write-AgentLog WARN "Fila ainda falhou ($kind): $($r.error)"
      return
    }
  }
}

# ---------------- register / heartbeat ----------------
function Register-Agent {
  param([string]$ProvisionToken)
  $fp = Get-HardwareFingerprint
  $agentId = New-AgentId -Fingerprint $fp.hardware_fingerprint
  $hostname = $env:COMPUTERNAME
  $ip = $null
  try {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.AddressState -eq 'Preferred' } |
      Select-Object -First 1).IPAddress
  } catch {}
  if (-not $ip) { $ip = '127.0.0.1' }

  $body = @{
    provision_token = $ProvisionToken
    agent_id = $agentId
    machine_guid = $fp.machine_guid
    hardware_fingerprint = $fp.hardware_fingerprint
    hostname = $hostname
    ip = $ip
    version = $Version
  }
  Write-AgentLog INFO "Registrando agente..." @{ agent_id = $agentId }
  $r = Invoke-AgentApi -Method POST -Path '/api/inventory/agents/register' -Body $body
  if (-not $r.ok) {
    Write-AgentLog ERROR "Register falhou: $($r.error)" @{ status = $r.status }
    return $false
  }
  $d = $r.data
  $state = Get-AgentState
  $state.agent_token = [string](Get-Prop $d 'agent_token' '')
  $state.agent_id = [string](Get-Prop $d 'agent_id' $agentId)
  $state.asset_id = Get-Prop $d 'asset_id' $null
  $state.entity_id = Get-Prop $d 'entity_id' $null
  $cfg = Get-AgentConfig
  $state.server_url = $cfg.server_url
  $state.registered_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  Save-AgentState -State $state

  # limpa provision_token do config apos sucesso
  $cfgPath = if ($ConfigPath) { $ConfigPath } else { Get-DefaultCfg }
  if ($cfg.provision_token) {
    $cfg2 = [ordered]@{
      server_url = $cfg.server_url
      provision_token = ''
      interval_seconds = $cfg.interval_seconds
      inventory_interval_seconds = $cfg.inventory_interval_seconds
    }
    Write-JsonFile -Path $cfgPath -Object ([pscustomobject]$cfg2)
  }
  Write-AgentLog INFO "Registrado com sucesso" @{ asset_id = $state.asset_id; entity_id = $state.entity_id }
  return $true
}

function Send-Heartbeat {
  param([string]$Token)
  $hostname = $env:COMPUTERNAME
  $ip = $null
  try {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -ne '127.0.0.1' } |
      Select-Object -First 1).IPAddress
  } catch {}
  $body = @{ version = $Version; hostname = $hostname; ip = $ip }
  $r = Invoke-AgentApi -Method POST -Path '/api/inventory/agents/heartbeat' -Body $body -Token $Token
  if ($r.ok) {
    $state = Get-AgentState
    $state.last_heartbeat = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    Save-AgentState -State $state
    return $true
  }
  if ($r.status -eq 401) { return 'unauthorized' }
  Add-QueueItem -Kind 'heartbeat' -Payload $body | Out-Null
  Write-AgentLog WARN "Heartbeat offline: $($r.error)"
  return $false
}

# ---------------- coleta ----------------
function Get-OrNull($v) {
  if ($null -eq $v) { return $null }
  $s = [string]$v
  if ([string]::IsNullOrWhiteSpace($s)) { return $null }
  return $s
}

function Get-NumOrNull($v) {
  if ($null -eq $v -or $v -eq '') { return $null }
  try {
    $n = [double]$v
    if ([double]::IsNaN($n) -or [double]::IsInfinity($n)) { return $null }
    if ($n -eq [math]::Truncate($n)) { return [int]$n }
    return $n
  } catch { return $null }
}

function ConvertTo-IsoDate {
  param($Value)
  if ($null -eq $Value -or $Value -eq '') { return $null }
  # .NET /Date(ticks)/
  $m = [regex]::Match([string]$Value, '^/Date\((-?\d+)')
  if ($m.Success) {
    try {
      $ms = [long]$m.Groups[1].Value
      return ([datetime]::new(1970,1,1,0,0,0,[DateTimeKind]::Utc)).AddMilliseconds($ms).ToString('yyyy-MM-dd')
    } catch { return $null }
  }
  # DMTF yyyymmdd...
  $m2 = [regex]::Match([string]$Value, '^(\d{4})(\d{2})(\d{2})')
  if ($m2.Success) { return '{0}-{1}-{2}' -f $m2.Groups[1].Value, $m2.Groups[2].Value, $m2.Groups[3].Value }
  if ($Value -is [datetime]) { return ([datetime]$Value).ToString('yyyy-MM-dd') }
  $s = ([string]$Value).Trim()
  $m3 = [regex]::Match($s, '^(\d{4}-\d{2}-\d{2})')
  if ($m3.Success) { return $m3.Groups[1].Value }
  try { return ([datetime]$s).ToString('yyyy-MM-dd') } catch { return $null }
}

function ConvertTo-IsoDateTime {
  param($Value)
  if ($null -eq $Value -or $Value -eq '') { return $null }
  $m = [regex]::Match([string]$Value, '^/Date\((-?\d+)')
  if ($m.Success) {
    try {
      $ms = [long]$m.Groups[1].Value
      return ([datetime]::new(1970,1,1,0,0,0,[DateTimeKind]::Utc)).AddMilliseconds($ms).ToString('yyyy-MM-ddTHH:mm:ss')
    } catch { return $null }
  }
  if ($Value -is [datetime]) { return ([datetime]$Value).ToString('yyyy-MM-ddTHH:mm:ss') }
  try {
    $d = [datetime]::Parse([string]$Value)
    return $d.ToString('yyyy-MM-ddTHH:mm:ss')
  } catch { return $null }
}

function Get-InventorySoftware {
  $paths = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $list = @()
  foreach ($p in $paths) {
    try {
      $items = Get-ItemProperty -Path $p -ErrorAction SilentlyContinue
      foreach ($it in @($items)) {
        if (-not $it.DisplayName) { continue }
        if ($it.SystemComponent) { continue }
        $arch = if ($p -match 'WOW6432Node') { 'x86' } else { 'x64' }
        $inst = $null
        if ($it.InstallDate -match '^\d{8}$') {
          $inst = '{0}-{1}-{2}' -f $it.InstallDate.Substring(0,4), $it.InstallDate.Substring(4,2), $it.InstallDate.Substring(6,2)
        }
        $list += [pscustomobject]@{
          name = ([string]$it.DisplayName).Trim()
          publisher = Get-OrNull $it.Publisher
          version = Get-OrNull $it.DisplayVersion
          arch = $arch
          install_date = $inst
          product_id = Get-OrNull $it.PSChildName
        }
      }
    } catch {}
  }
  # dedupe por nome+versao
  $list | Where-Object { $_.name } | Sort-Object name -Unique
}

function Get-InventoryMemory {
  $mods = @()
  try {
    $dims = @(Get-CimInstance Win32_PhysicalMemory -ErrorAction Stop)
    $i = 0
    foreach ($d in $dims) {
      $i++
      $type = switch ([int]$d.SMBIOSMemoryType) {
        20 { 'DDR' } 21 { 'DDR2' } 24 { 'DDR3' } 26 { 'DDR4' } 34 { 'DDR5' }
        default { if ($d.SMBIOSMemoryType) { [string]$d.SMBIOSMemoryType } else { $null } }
      }
      $cap = $null
      if ($d.Capacity) { $cap = [int][math]::Round([double]$d.Capacity / 1GB, 0) }
      $mods += [pscustomobject]@{
        slot = Get-OrNull $d.DeviceLocator
        manufacturer = Get-OrNull $d.Manufacturer
        part_number = if ($d.PartNumber) { ([string]$d.PartNumber).Replace(' ', '').Trim() } else { $null }
        serial = Get-OrNull $d.SerialNumber
        capacity_gb = $cap
        speed_mhz = Get-NumOrNull $d.Speed
        type = $type
      }
      if (-not $mods[-1].slot) { $mods[-1].slot = "Slot $i" }
    }
  } catch {}
  return ,$mods
}

function Get-InventoryStorage {
  $disks = @()
  try {
    $drives = @(Get-CimInstance Win32_DiskDrive -ErrorAction Stop)
    foreach ($disk in $drives) {
      $type = 'HDD'
      $mt = [string]$disk.MediaType
      $model = [string]$disk.Model
      if ($mt -match 'SSD' -or $model -match 'SSD|NVMe') { $type = 'SSD' }
      elseif ($mt -match 'Removable') { $type = 'Removable' }
      $cap = $null
      if ($disk.Size) { $cap = [math]::Round([double]$disk.Size / 1GB, 1) }
      $disks += [pscustomobject]@{
        manufacturer = Get-OrNull $disk.Manufacturer
        model = Get-OrNull $disk.Model
        serial = if ($disk.SerialNumber) { ([string]$disk.SerialNumber).Trim() } else { $null }
        capacity_gb = $cap
        type = $type
        interface = Get-OrNull $disk.InterfaceType
        firmware = Get-OrNull $disk.FirmwareRevision
      }
    }
  } catch {}
  return ,$disks
}

function Get-InventoryGPU {
  $gpus = @()
  try {
    $cards = @(Get-CimInstance Win32_VideoController -ErrorAction Stop)
    foreach ($c in $cards) {
      $name = [string]$c.Name
      $mfr = 'Unknown'
      if ($name -match 'NVIDIA') { $mfr = 'NVIDIA' }
      elseif ($name -match 'AMD|Radeon') { $mfr = 'AMD' }
      elseif ($name -match 'Intel') { $mfr = 'Intel' }
      $memGb = $null
      if ($c.AdapterRAM) {
        $raw = [double]$c.AdapterRAM
        # WMI AdapterRAM costuma vir em bytes (ou KB depending)
        if ($raw -gt 10MB * 1024) { $memGb = [int][math]::Round($raw / 1GB, 0) }   # bytes
        elseif ($raw -gt 10MB) { $memGb = [int][math]::Round($raw / 1MB, 0) }        # KB
        else { $memGb = [int][math]::Round($raw, 0) }                                 # MB
        if ($memGb -le 0) { $memGb = $null }
      }
      $gpus += [pscustomobject]@{
        manufacturer = $mfr
        model = Get-OrNull $name
        memory_gb = $memGb
        driver_version = Get-OrNull $c.DriverVersion
      }
    }
  } catch {}
  return ,$gpus
}

function Get-InventoryNetwork {
  $nics = @()
  try {
    $cfgs = @(Get-CimInstance Win32_NetworkAdapterConfiguration -ErrorAction Stop | Where-Object { $_.IPEnabled })
    foreach ($n in $cfgs) {
      $mac = $null
      if ($n.MACAddress) { $mac = ([string]$n.MACAddress).ToUpper().Replace('-', ':') }
      $ips = @()
      if ($n.IPAddress) { $ips = @($n.IPAddress | Where-Object { $_ -notmatch ':' }) } # IPv4
      if (-not $ips -and $n.IPAddress) { $ips = @($n.IPAddress) }
      $status = if ($n.IPConnectionStatus -eq 2) { 'Up' } else { 'Down' }
      $speed = $null
      if ($n.Speed) { try { $speed = [int][math]::Round([double]$n.Speed / 1e6, 0) } catch {} }
      $nics += [pscustomobject]@{
        name = Get-OrNull $n.Description
        manufacturer = $null
        model = $null
        mac = $mac
        ip = ($ips -join ', ')
        speed_mbps = $speed
        status = $status
      }
    }
  } catch {}
  return ,$nics
}

function Get-InventoryFull {
  Write-AgentLog INFO 'Coletando inventario FULL (WMI/CIM)...'
  $os = $null; $cpu = $null; $bb = $null; $bios = $null
  try {
    $o = Get-CimInstance Win32_OperatingSystem
    $os = [pscustomobject]@{
      name = Get-OrNull $o.Caption
      edition = Get-OrNull $o.OperatingSystemSKU
      version = Get-OrNull $o.Version
      build = if ($o.BuildNumber) { [string]$o.BuildNumber } else { $null }
      arch = Get-OrNull $o.OSArchitecture
      last_boot = if ($o.LastBootUpTime) { ([datetime]$o.LastBootUpTime).ToString('yyyy-MM-ddTHH:mm:ss') } else { $null }
      domain = if ($o.Domain -and $o.Domain -ne 'WORKGROUP') { $o.Domain } else { $null }
      hostname = $env:COMPUTERNAME
    }
    # Caption melhor que SKU para edition
    $os.edition = Get-OrNull $o.Caption
  } catch { $os = [pscustomobject]@{ name = [System.Environment]::OSVersion.VersionString; hostname = $env:COMPUTERNAME } }

  try {
    $c = Get-CimInstance Win32_Processor | Select-Object -First 1
    $cpu = [pscustomobject]@{
      manufacturer = Get-OrNull $c.Manufacturer
      model = if ($c.Name) { (([string]$c.Name) -split '@')[0].Trim() } else { $null }
      cores = Get-NumOrNull $c.NumberOfCores
      threads = Get-NumOrNull $c.NumberOfLogicalProcessors
      frequency = Get-NumOrNull $c.MaxClockSpeed
      arch = if ([int]$c.Architecture -in @(9,12)) { 'x64' } else { 'x86' }
    }
    # fix model string
    if ($c.Name) { $cpu.model = (([string]$c.Name) -split '@')[0].Trim() }
  } catch {}

  try {
    $b = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
    $bb = [pscustomobject]@{
      manufacturer = Get-OrNull $b.Manufacturer
      model = Get-OrNull $b.Product
      serial = Get-OrNull $b.SerialNumber
    }
  } catch {}
  try {
    $bio = Get-CimInstance Win32_BIOS | Select-Object -First 1
    $bios = [pscustomobject]@{
      manufacturer = Get-OrNull $bio.Manufacturer
      version = Get-OrNull $bio.SMBIOSBIOSVersion
      date = if ($bio.ReleaseDate) { ConvertTo-IsoDate $bio.ReleaseDate } else { $null }
    }
  } catch {}

  $mem = Get-InventoryMemory
  $sto = Get-InventoryStorage
  $gpu = Get-InventoryGPU
  $net = Get-InventoryNetwork
  $sw  = Get-InventorySoftware

  return [pscustomobject]@{
    type = 'FULL'
    collected_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    hostname = $env:COMPUTERNAME
    os = $os
    cpu = $cpu
    motherboard = $bb
    bios = $bios
    memory = $mem
    storage = $sto
    gpu = $gpu
    network = $net
    software = $sw
  }
}

function Get-InventoryIncremental {
  $os = $null; $cpu = $null; $mem = @()
  try {
    $o = Get-CimInstance Win32_OperatingSystem
    $os = [pscustomobject]@{
      name = Get-OrNull $o.Caption
      version = Get-OrNull $o.Version
      build = if ($o.BuildNumber) { [string]$o.BuildNumber } else { $null }
      arch = Get-OrNull $o.OSArchitecture
      last_boot = if ($o.LastBootUpTime) { ([datetime]$o.LastBootUpTime).ToString('yyyy-MM-ddTHH:mm:ss') } else { $null }
      hostname = $env:COMPUTERNAME
    }
  } catch {}
  try {
    $c = Get-CimInstance Win32_Processor | Select-Object -First 1
    $cpu = [pscustomobject]@{
      manufacturer = Get-OrNull $c.Manufacturer
      model = if ($c.Name) { (([string]$c.Name) -split '@')[0].Trim() } else { $null }
      cores = Get-NumOrNull $c.NumberOfCores
      threads = Get-NumOrNull $c.NumberOfLogicalProcessors
      frequency = Get-NumOrNull $c.MaxClockSpeed
    }
  } catch {}
  $mods = Get-InventoryMemory
  $total = 0
  foreach ($m in $mods) { if ($m.capacity_gb) { $total += [int]$m.capacity_gb } }
  $mem = @([pscustomobject]@{ slot = 'TOTAL'; capacity_gb = if ($total -gt 0) { $total } else { $null }; type = if ($mods.Count) { $mods[0].type } else { $null } })

  return [pscustomobject]@{
    type = 'INCREMENTAL'
    collected_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    hostname = $env:COMPUTERNAME
    os = $os
    cpu = $cpu
    memory = $mem
    memory_modules = $mods.Count
  }
}

function Send-Inventory {
  param([string]$Token, [string]$Type = 'FULL')
  $payload = if ($Type -eq 'INCREMENTAL') { Get-InventoryIncremental } else { Get-InventoryFull }
  $r = Invoke-AgentApi -Method POST -Path '/api/inventory/agents/inventory' -Body $payload -Token $Token -TimeoutSec 60
  if ($r.ok) {
    $state = Get-AgentState
    $state.last_inventory = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $state.inventory_type = $payload.type
    Save-AgentState -State $state
    $swCount = 0; $memCount = 0; $stoCount = 0
    if ($payload.PSObject.Properties['software'] -and $payload.software) { $swCount = @($payload.software).Count }
    if ($payload.PSObject.Properties['memory'] -and $payload.memory) { $memCount = @($payload.memory).Count }
    if ($payload.PSObject.Properties['storage'] -and $payload.storage) { $stoCount = @($payload.storage).Count }
    Write-AgentLog INFO "Inventario $($payload.type) enviado" @{ software = $swCount; memory = $memCount; storage = $stoCount }
    return $true
  }
  if ($r.status -eq 401) { return 'unauthorized' }
  Add-QueueItem -Kind 'inventory' -Payload $payload | Out-Null
  Write-AgentLog WARN "Inventario offline (enfileirado): $($r.error)"
  return $false
}

# ---------------- ciclo principal ----------------
function Test-NeedsFullInventory {
  $state = Get-AgentState
  if ([string]::IsNullOrEmpty($state.last_inventory)) { return $true }
  try {
    $last = [datetime]::Parse($state.last_inventory).ToUniversalTime()
    return (([datetime]::UtcNow - $last).TotalHours -ge 24)
  } catch { return $true }
}

function Test-NeedsIncremental {
  param([int]$IntervalSec)
  $state = Get-AgentState
  if ([string]::IsNullOrEmpty($state.last_inventory)) { return $false }
  try {
    $last = [datetime]::Parse($state.last_inventory).ToUniversalTime()
    return (([datetime]::UtcNow - $last).TotalSeconds -ge $IntervalSec)
  } catch { return $false }
}

function Ensure-Registered {
  $state = Get-AgentState
  $cfg = Get-AgentConfig
  if ($state.agent_token -and $state.asset_id) { return $true }
  $prov = $cfg.provision_token
  if ([string]::IsNullOrWhiteSpace($prov)) {
    Write-AgentLog WARN "Sem provision_token - configure $(Get-DefaultCfg)"
    return $false
  }
  return (Register-Agent -ProvisionToken $prov)
}

function Invoke-AgentCycle {
  $cfg = Get-AgentConfig

  if (-not (Ensure-Registered)) { return }

  # re-le state APOS register (token novo)
  $state = Get-AgentState
  $token = $state.agent_token
  if ([string]::IsNullOrWhiteSpace($token)) {
    Write-AgentLog ERROR 'Sem agent_token apos register'
    return
  }

  Send-Queue -Token $token

  $hb = Send-Heartbeat -Token $token
  if ([string]$hb -eq 'unauthorized') {
    Write-AgentLog ERROR 'Token 401 - limpando state para re-registro'
    $state.agent_token = ''
    Save-AgentState -State $state
    return
  }

  if (Test-NeedsFullInventory) {
    $inv = Send-Inventory -Token $token -Type 'FULL'
    if ([string]$inv -eq 'unauthorized') {
      $state = Get-AgentState
      $state.agent_token = ''
      Save-AgentState -State $state
    }
  } elseif (Test-NeedsIncremental -IntervalSec $cfg.inventory_interval_seconds) {
    $inv = Send-Inventory -Token $token -Type 'INCREMENTAL'
    if ([string]$inv -eq 'unauthorized') {
      $state = Get-AgentState
      $state.agent_token = ''
      Save-AgentState -State $state
    }
  }
}

function Start-OrcimAgent {
  Ensure-Dirs
  $cfg = Get-AgentConfig
  Write-AgentLog INFO "Orcim Inventory Agent (PowerShell) v$Version iniciando" @{
    hostname = $env:COMPUTERNAME
    server = $cfg.server_url
    interval = $cfg.interval_seconds
    once = [bool]$Once
  }

  if ($Once) {
    try { Invoke-AgentCycle } catch { Write-AgentLog ERROR "Erro no ciclo: $($_.Exception.Message)" }
    Write-AgentLog INFO 'Ciclo unico concluido.'
    return
  }

  while ($true) {
    try { Invoke-AgentCycle } catch { Write-AgentLog ERROR "Erro no ciclo: $($_.Exception.Message)" }
    $cfg = Get-AgentConfig
    $wait = [math]::Max(30, [int]$cfg.interval_seconds)
    Write-AgentLog DEBUG "Proximo ciclo em ${wait}s"
    Start-Sleep -Seconds $wait
  }
}

# entry
try {
  Start-OrcimAgent
} catch {
  Write-AgentLog ERROR "Falha fatal: $($_.Exception.Message)"
  exit 1
}
