@echo off
REM Orcim Inventory Agent (PowerShell) - Desinstalador
title Orcim - Desinstalar Agente PS
net session >nul 2>&1
if errorlevel 1 (
  echo Execute como Administrador ^(botao direito^).
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Agente.ps1" -Uninstall
pause
