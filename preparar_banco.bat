@echo off
REM ============================================================
REM  CHAMA_V15 - Preparar banco de dados (rodar 1 vez por PC)
REM  Cria o usuario os_app, o banco os_service e o arquivo .env
REM ============================================================
title CHAMA_V15 - Preparar banco
cd /d "%~dp0"

if not exist "%~dp0preparar_banco.ps1" (
    echo [ERRO] O arquivo preparar_banco.ps1 precisa estar na mesma pasta deste atalho.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preparar_banco.ps1" -Pasta "%~dp0."

echo.
pause
