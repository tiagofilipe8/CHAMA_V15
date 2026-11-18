@echo off
REM Orcim Inventory Agent (PowerShell) - Instalador
REM Botao direito > Executar como administrador para servico Windows
title Orcim Inventory Agent - Instalador PS
echo.
echo ============================================
echo   Orcim Inventory Agent (PowerShell)
echo   SEM Node.js
echo ============================================
echo.
echo  1^) Gere o token na UI:
echo     http://localhost:3000  ^>  Inventario ^> Agentes
echo     botao Provisionar  ^>  copie o token (1-XXXXXX-XXXXXX)
echo.
echo  2^) Cole o token abaixo quando pedir.
echo.

net session >nul 2>&1
if errorlevel 1 (
  echo [AVISO] Sem Administrador - instala SEM servico ^(so arquivos + logon^).
  echo         Para servico Windows: botao direito ^> Executar como administrador.
  echo.
  set "ADMIN=0"
) else (
  echo [OK] Administrador confirmado - vai criar o servico.
  set "ADMIN=1"
)

set "SRV=http://localhost:3000"
set "TOK="
set /p SRV=URL da Central [%SRV%]:
set /p TOK=Token provisionamento ^(1-XXXXXX-XXXXXX^):
if "%SRV%"=="" set "SRV=http://localhost:3000"

echo.
if "%ADMIN%"=="1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Agente.ps1" -ServerUrl "%SRV%" -ProvisionToken "%TOK%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Agente.ps1" -FilesOnly -ServerUrl "%SRV%" -ProvisionToken "%TOK%"
)

echo.
echo ============================================
echo Proximos passos:
echo   Testar 1 ciclo:
echo     powershell -ExecutionPolicy Bypass -File "%%LOCALAPPDATA%%\Orcim\AgentPS\Agente.ps1" -Once
echo   (com Admin o caminho e %%ProgramFiles%%\Orcim\AgentPS\Agente.ps1)
echo   Log:
echo     %%ProgramData%%\Orcim\logs\agent-ps.log
echo   UI: Inventario ^> Agentes  ^(ONLINE^)
echo ============================================
pause
