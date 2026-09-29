@echo off
chcp 65001 >nul
title Orcim Inventory Agent - Instalador
echo.
echo ============================================
echo   Orcim Inventory Agent - INSTALADOR
echo   (botao direito ^> Executar como administrador)
echo ============================================
echo.

net session >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Sem privilegio de Administrador!
  echo.
  echo Como corrigir:
  echo   1. Botao DIREITO neste arquivo
  echo   2. Executar como administrador
  echo.
  pause
  exit /b 1
)
echo [OK] Administrador confirmado.
echo.

set "NODE=C:\Users\User\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64\node.exe"
if not exist "%NODE%" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE%" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not exist "%NODE%" (
  echo [ERRO] Node.js nao encontrado!
  pause
  exit /b 1
)
echo [OK] Node: %NODE%

set "DEST=%ProgramFiles%\Orcim\Agent"
set "DATA=%ProgramData%\Orcim"
set "SVC=OrcimInventoryAgent"
set "SRV=http://localhost:3000"
set "TOK="

set /p SRV=URL da Central [%SRV%]:
set /p TOK=Token provisionamento (1-XXXXXX-XXXXXX):
if "%SRV%"=="" set "SRV=http://localhost:3000"

echo.
echo [1/5] Copiando arquivos...
if not exist "%DEST%" mkdir "%DEST%"
copy /Y "%~dp0*.js" "%DEST%\" >nul
copy /Y "%~dp0package.json" "%DEST%\" >nul
echo       OK

echo [2/5] Pastas de dados...
if not exist "%DATA%\agent" mkdir "%DATA%\agent"
if not exist "%DATA%\queue" mkdir "%DATA%\queue"
if not exist "%DATA%\logs"  mkdir "%DATA%\logs"
echo       OK

echo [3/5] Config...
> "%DATA%\agent\config.json" echo {
>> "%DATA%\agent\config.json" echo   "server_url": "%SRV%",
>> "%DATA%\agent\config.json" echo   "provision_token": "%TOK%",
>> "%DATA%\agent\config.json" echo   "interval_seconds": 900,
>> "%DATA%\agent\config.json" echo   "inventory_interval_seconds": 3600
>> "%DATA%\agent\config.json" echo }
echo       OK

echo [4/5] Servico...
sc stop %SVC% >nul 2>&1
timeout /t 1 /nobreak >nul
sc delete %SVC% >nul 2>&1
timeout /t 1 /nobreak >nul
sc create %SVC% binPath= "\"%NODE%\" \"%DEST%\agent.js\"" start= auto DisplayName= "Orcim Inventory Agent" obj= LocalSystem
if errorlevel 1 (
  echo       sc create falhou, usando tarefa agendada...
  schtasks /create /tn %SVC% /tr "\"%NODE%\" \"%DEST%\agent.js\"" /sc onstart /ru SYSTEM /rl HIGHEST /f
  if errorlevel 1 (
    echo [ERRO] Nao foi possivel criar servico nem tarefa.
    pause
    exit /b 1
  )
  schtasks /run /tn %SVC%
  echo       Tarefa criada e iniciada.
) else (
  sc start %SVC%
  echo       Servico criado e iniciado.
)

echo.
echo ============================================
echo   INSTALACAO CONCLUIDA
echo ============================================
echo Servico: %SVC%
echo Config:  %DATA%\agent\config.json
echo Log:     %DATA%\logs\agent.log
echo.
echo Abra a UI: Inventario ^> Agentes (deve ficar ONLINE)
echo.
pause
