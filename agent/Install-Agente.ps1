# Orcim Inventory Agent (PowerShell) - Instalador
# Nao requer Node.js. Requer Administrator para o servico Windows.
#
# Instalar com servico:
#   powershell -ExecutionPolicy Bypass -File Install-Agente.ps1 -ProvisionToken "1-XXXXXX-XXXXXX"
# Somente arquivos (sem admin):
#   powershell -ExecutionPolicy Bypass -File Install-Agente.ps1 -FilesOnly -ProvisionToken "1-XXXXXX-XXXXXX"
# Desinstalar:
#   powershell -ExecutionPolicy Bypass -File Install-Agente.ps1 -Uninstall

[CmdletBinding()]
param(
  [switch]$Uninstall,
  [switch]$FilesOnly,
  [string]$ServerUrl = 'http://localhost:3000',
  [string]$ProvisionToken = '',
  [string]$ServiceName = 'OrcimInventoryAgent'
)

$ErrorActionPreference = 'Stop'
$Source = $PSScriptRoot
$DataRoot = Join-Path $env:ProgramData 'Orcim'
$AgentData = Join-Path $DataRoot 'agent'
$QueueDir = Join-Path $DataRoot 'queue'
$LogDir = Join-Path $DataRoot 'logs'

# Program Files so com Admin; sem Admin (FilesOnly) usa LOCALAPPDATA
$InstallRootAdmin = Join-Path $env:ProgramFiles 'Orcim\AgentPS'
$InstallRootUser = Join-Path $env:LOCALAPPDATA 'Orcim\AgentPS'

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-Utf8NoBom {
  param([string]$Path, [string]$Text)
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $utf8)
}

function Remove-StartupShortcut {
  $startup = [Environment]::GetFolderPath('Startup')
  Remove-Item (Join-Path $startup 'OrcimInventoryAgent.vbs') -Force -ErrorAction SilentlyContinue
}

function New-StartupShortcut {
  param([string]$ScriptPath)
  $startup = [Environment]::GetFolderPath('Startup')
  $vbs = Join-Path $startup 'OrcimInventoryAgent.vbs'
  $vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$ScriptPath""", 0, False
"@
  Write-Utf8NoBom -Path $vbs -Text $vbsContent
  return $vbs
}

function Get-InstallRoot {
  # Admin pode escolher Program Files; sem Admin vai para LOCALAPPDATA
  if ((Test-IsAdmin) -and -not $FilesOnly) { return $InstallRootAdmin }
  if (Test-IsAdmin) { return $InstallRootAdmin }
  return $InstallRootUser
}

# Resolve InstallRoot cedo (usado tambem no uninstall)
$InstallRoot = Get-InstallRoot
$AgentScript = Join-Path $InstallRoot 'Agente.ps1'

# ---------------- Desinstalar ----------------
if ($Uninstall) {
  Write-Host "Removendo $ServiceName..."
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($svc) {
    if ($svc.Status -eq 'Running') { Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue }
    & sc.exe delete $ServiceName | Out-Null
    Write-Host "Servico removido (ou aguardando delete no reboot)."
  } else {
    Write-Host "Servico nao encontrado."
  }
  Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-StartupShortcut
  foreach ($root in @($InstallRootAdmin, $InstallRootUser)) {
    if (Test-Path $root) {
      Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
      Write-Host "Arquivos removidos: $root"
    }
  }
  # legado Node
  $legacy = Join-Path $env:ProgramFiles 'Orcim\Agent'
  if (Test-Path $legacy) {
    $ans = Read-Host "Remover tambem agente Node antigo em $legacy? (y/N)"
    if ($ans -eq 'y' -or $ans -eq 'Y') {
      Remove-Item $legacy -Recurse -Force -ErrorAction SilentlyContinue
      Write-Host "Legado removido: $legacy"
    }
  }
  Write-Host "Dados em $DataRoot mantidos."
  exit 0
}

# ---------------- Admin check ----------------
if (-not $FilesOnly -and -not (Test-IsAdmin)) {
  Write-Host ''
  Write-Host 'ERRO: Administrator rights required.' -ForegroundColor Red
  Write-Host ''
  Write-Host 'Como corrigir:' -ForegroundColor Yellow
  Write-Host '  1. Feche esta janela'
  Write-Host '  2. PowerShell > botao direito > Executar como administrador'
  Write-Host '  3. Rode novamente:'
  Write-Host "     powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -ProvisionToken `"$ProvisionToken`""
  Write-Host ''
  Write-Host 'Sem admin? Use -FilesOnly (instala em LOCALAPPDATA).' -ForegroundColor Yellow
  exit 1
}

# ---------------- Validacoes ----------------
if ([string]::IsNullOrWhiteSpace($ProvisionToken)) {
  Write-Host ''
  Write-Host 'AVISO: sem -ProvisionToken.' -ForegroundColor Yellow
  Write-Host '  O agente NAO vai conseguir registrar ate ter um token.'
  Write-Host '  Gere em: UI > Inventario > Agentes > Provisionar'
  Write-Host '  Ou edite depois: %ProgramData%\Orcim\agent\config.json'
  Write-Host ''
  if (-not $FilesOnly) {
    $cont = Read-Host 'Continuar assim mesmo? (y/N)'
    if ($cont -ne 'y' -and $cont -ne 'Y') { exit 1 }
  }
}

if ([string]::IsNullOrWhiteSpace($ServerUrl)) { $ServerUrl = 'http://localhost:3000' }

$InstallRoot = Get-InstallRoot
$AgentScript = Join-Path $InstallRoot 'Agente.ps1'

Write-Host "Fonte:   $Source"
Write-Host "Destino: $InstallRoot"
Write-Host "Admin:   $(Test-IsAdmin)"
Write-Host "Modo:    $(if ($FilesOnly) { 'FilesOnly (sem servico)' } else { 'Servico Windows' })"
Write-Host "Server:  $ServerUrl"
Write-Host "Token:   $(if ($ProvisionToken) { $ProvisionToken } else { '(vazio)' })"
Write-Host ''

# ---------------- Copia scripts ----------------
try {
  if (-not (Test-Path $InstallRoot)) { New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null }
  Copy-Item (Join-Path $Source 'Agente.ps1') -Destination $InstallRoot -Force
  if (Test-Path (Join-Path $Source 'README-PS.md')) {
    Copy-Item (Join-Path $Source 'README-PS.md') -Destination $InstallRoot -Force
  }
  Write-Host "Arquivos copiados."
} catch {
  Write-Host "ERRO ao copiar: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Rode como Administrador ou use -FilesOnly.' -ForegroundColor Yellow
  exit 1
}

# ---------------- Pastas + config (sem BOM) ----------------
foreach ($d in @($AgentData, $QueueDir, $LogDir)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

# Preserva token/state existentes se reinstalando sem informar token
$cfgPath = Join-Path $AgentData 'config.json'
$existingToken = ''
if (Test-Path $cfgPath) {
  try {
    $prev = [System.IO.File]::ReadAllText($cfgPath) | ConvertFrom-Json
    if ($prev -and $prev.PSObject.Properties['provision_token']) { $existingToken = [string]$prev.provision_token }
  } catch {}
}
$effectiveToken = if (-not [string]::IsNullOrWhiteSpace($ProvisionToken)) { $ProvisionToken } else { $existingToken }

$cfgJson = @"
{
  "server_url": "$ServerUrl",
  "provision_token": "$effectiveToken",
  "interval_seconds": 900,
  "inventory_interval_seconds": 3600
}
"@
Write-Utf8NoBom -Path $cfgPath -Text $cfgJson
Write-Host "Config: $cfgPath"

if ($FilesOnly) {
  # Sem servico: atalho no logon do usuario (substitui eventual atalho do agente Node)
  $vbs = New-StartupShortcut -ScriptPath $AgentScript
  Write-Host "Atalho Startup: $vbs"
  Write-Host ''
  Write-Host 'Instalacao (somente arquivos) concluida.'
  Write-Host 'Testar agora (1 ciclo):'
  Write-Host "  powershell -ExecutionPolicy Bypass -File `"$AgentScript`" -Once"
  Write-Host 'Rodar em loop (janela oculta via Startup no proximo logon):'
  Write-Host "  powershell -ExecutionPolicy Bypass -File `"$AgentScript`""
  exit 0
}

# ---------------- Servico Windows ----------------
# Evita dupla execucao: no modo servico, remove atalho Startup
Remove-StartupShortcut

$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path $psExe)) { $psExe = 'powershell.exe' }

& sc.exe stop $ServiceName 2>$null | Out-Null
Start-Sleep -Seconds 1
& sc.exe delete $ServiceName 2>$null | Out-Null
Start-Sleep -Seconds 1

# binPath com aspas internas (formato exigido pelo sc.exe)
$inner = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $AgentScript + '"'
$binPath = '"' + $psExe + '" ' + $inner

Write-Host "Criando servico $ServiceName..."
Write-Host "binPath= $binPath"

# sc.exe: cada "arg=" precisa do valor como proximo argumento; Start-Process evita requote do PS
$scArgs = @(
  'create', $ServiceName,
  'binPath=', $binPath,
  'start=', 'auto',
  'DisplayName=', 'Orcim Inventory Agent (PS)',
  'obj=', 'LocalSystem'
)
$p = Start-Process -FilePath 'sc.exe' -ArgumentList $scArgs -Wait -PassThru -NoNewWindow
$scCode = $p.ExitCode

if ($scCode -ne 0) {
  Write-Warning "sc create falhou (exit $scCode). Usando Tarefa Agendada no logon..."
  Remove-StartupShortcut
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$AgentScript`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -RunLevel Highest
  Register-ScheduledTask -TaskName $ServiceName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
  Write-Host "Tarefa '$ServiceName' criada e iniciada."
} else {
  # descricao + recuperacao em caso de falha
  & sc.exe description $ServiceName "Orcim Inventory Agent - coleta de inventario (PowerShell)" | Out-Null
  & sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null

  Write-Host "Iniciando servico..."
  $startOut = & sc.exe start $ServiceName 2>&1
  Write-Host ($startOut -join [Environment]::NewLine)
  Start-Sleep -Seconds 3
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($svc) { Write-Host "Status: $($svc.Status)" }
}

Write-Host ''
Write-Host '=== Instalacao concluida (agente PowerShell, sem Node) ==='
Write-Host "Servico: $ServiceName"
Write-Host "Script:  $AgentScript"
Write-Host "Config:  $cfgPath"
Write-Host "Log:     $LogDir\agent-ps.log"
Write-Host ''
Write-Host 'Verificar:'
Write-Host "  Get-Content `"$LogDir\agent-ps.log`" -Tail 20"
Write-Host '  UI: Inventario > Agentes (ONLINE)'
if ([string]::IsNullOrWhiteSpace($effectiveToken)) {
  Write-Host ''
  Write-Host 'IMPORTANTE: provision_token vazio - gere na UI e edite config.json' -ForegroundColor Yellow
}
