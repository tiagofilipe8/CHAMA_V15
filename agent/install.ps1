# Orcim Inventory Agent - Windows installer
# Install:   powershell -ExecutionPolicy Bypass -File install.ps1 -ServerUrl "http://host:3000" -ProvisionToken "1-XXXXXX"
# Files only:powershell -ExecutionPolicy Bypass -File install.ps1 -FilesOnly
# Uninstall: powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall

param(
  [switch]$Uninstall,
  [switch]$FilesOnly,
  [string]$ServerUrl = "http://localhost:3000",
  [string]$ProvisionToken = "",
  [string]$NodeExe = ""
)

$ErrorActionPreference = "Stop"
$AgentSource = $PSScriptRoot
$InstallRoot = Join-Path $env:ProgramFiles "Orcim\Agent"
$ServiceName = "OrcimInventoryAgent"
$DataRoot = Join-Path $env:ProgramData "Orcim"
$AgentData = Join-Path $DataRoot "agent"

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Find-Node {
  if ($NodeExe -and (Test-Path $NodeExe)) { return $NodeExe }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe"),
    "C:\Users\User\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64\node.exe"
  )
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  throw "Node.js not found. Install Node.js or pass -NodeExe C:\path\node.exe"
}

if ($Uninstall) {
  Write-Host "Removing $ServiceName..."
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($svc) {
    if ($svc.Status -eq 'Running') { Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue }
    & sc.exe delete $ServiceName | Out-Null
    Write-Host "Service deleted."
  } else {
    Write-Host "Service not found."
  }
  Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false -ErrorAction SilentlyContinue
  if (Test-Path $InstallRoot) {
    Remove-Item $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Files removed from $InstallRoot"
  }
  Write-Host "Data in $DataRoot kept (delete manually if desired)."
  exit 0
}

if (-not $FilesOnly -and -not (Test-IsAdmin)) {
  Write-Host ""
  Write-Host "ERROR: Administrator rights required to install the Windows service." -ForegroundColor Red
  Write-Host ""
  Write-Host "How to fix:" -ForegroundColor Yellow
  Write-Host "  1. Close this window"
  Write-Host "  2. Open PowerShell as Administrator (right-click > Run as administrator)"
  Write-Host "  3. Run again:"
  Write-Host "     powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -ServerUrl `"$ServerUrl`" -ProvisionToken `"$ProvisionToken`""
  Write-Host ""
  Write-Host "Tip: for a test without service/admin, use -FilesOnly and run node agent.js manually." -ForegroundColor Yellow
  exit 1
}

$node = Find-Node
Write-Host "Node:   $node"
Write-Host "Source: $AgentSource"
Write-Host "Target: $InstallRoot"
Write-Host "Admin:  $(Test-IsAdmin)"

# Copy agent files
try {
  if (-not (Test-Path $InstallRoot)) { New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null }
  Get-ChildItem $AgentSource -File | Where-Object { $_.Name -ne 'install.ps1' } | ForEach-Object {
    Copy-Item $_.FullName -Destination $InstallRoot -Force
  }
  Write-Host "Files copied."
} catch {
  Write-Host "ERROR: Cannot write to $InstallRoot ($($_.Exception.Message))" -ForegroundColor Red
  Write-Host "Run PowerShell as Administrator, or use -FilesOnly." -ForegroundColor Yellow
  exit 1
}

# Data dirs
New-Item -ItemType Directory -Path $AgentData -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $DataRoot "queue") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $DataRoot "logs") -Force | Out-Null

# Config without BOM (PowerShell 5.1 UTF8 writes BOM and breaks the agent JSON parser)
$cfgPath = Join-Path $AgentData "config.json"
$cfgObj = [ordered]@{
  server_url = $ServerUrl
  provision_token = $ProvisionToken
  interval_seconds = 900
  inventory_interval_seconds = 3600
}
$cfgJson = $cfgObj | ConvertTo-Json
[System.IO.File]::WriteAllText($cfgPath, $cfgJson, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Config written: $cfgPath"

if ($FilesOnly) {
  Write-Host ""
  Write-Host "Files-only install done."
  Write-Host "Run manually: `"$node`" `"$InstallRoot\agent.js`""
  exit 0
}

# --- Create Windows Service ---
# Remove any previous partial install
& sc.exe stop $ServiceName 2>$null | Out-Null
Start-Sleep -Seconds 1
& sc.exe delete $ServiceName 2>$null | Out-Null
Start-Sleep -Seconds 1

# IMPORTANT: sc.exe needs binPath= VALUE with space after =.
# binPath must be a single quoted string containing the full command line.
$binPath = "`"$node`" `"$InstallRoot\agent.js`""
Write-Host "Creating service $ServiceName..."
Write-Host "binPath= $binPath"

$scOut = & sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= "Orcim Inventory Agent" obj= LocalSystem 2>&1
$scCode = $LASTEXITCODE
Write-Host "sc.exe exit=$scCode"
Write-Host ($scOut -join [Environment]::NewLine)

if ($scCode -ne 0) {
  Write-Warning "sc.exe failed (exit $scCode). Falling back to Scheduled Task."
  $action = New-ScheduledTaskAction -Execute $node -Argument "`"$InstallRoot\agent.js`""
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
  Register-ScheduledTask -TaskName $ServiceName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
  Write-Host "Scheduled task '$ServiceName' registered. Start it with:"
  Write-Host "  Start-ScheduledTask -TaskName $ServiceName"
} else {
  Write-Host "Starting service..."
  $startOut = & sc.exe start $ServiceName 2>&1
  Write-Host ($startOut -join [Environment]::NewLine)
  Start-Sleep -Seconds 2
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($svc) { Write-Host "Service status: $($svc.Status)" }
}

Write-Host ""
Write-Host "=== Install done ==="
Write-Host "Service: $ServiceName"
Write-Host "Config:  $cfgPath"
Write-Host "Logs:    $DataRoot\logs\agent.log"
Write-Host "Queue:   $DataRoot\queue"
Write-Host ""
Write-Host "If provision_token was empty:"
Write-Host "  1. Generate token in UI: Inventory > asset > Generate Agent token"
Write-Host "  2. Edit $cfgPath and set provision_token"
Write-Host "  3. Restart-Service $ServiceName"
