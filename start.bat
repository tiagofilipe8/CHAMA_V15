@echo off
title Central de Atendimento - OS
cd /d "%~dp0"

if not exist ".env" (
  echo [AVISO] Arquivo .env nao encontrado. Criando a partir do exemplo...
  copy ".env.example" ".env" >nul
)

if not exist "node_modules" (
  echo [AVISO] Instalando dependencias...
  call npm install
)

echo.
echo === Inicializando banco de dados (tabelas + usuario admin) ===
call npm run init
if errorlevel 1 (
  echo.
  echo [ERRO] Falha na inicializacao do banco. Verifique se o PostgreSQL esta ativo.
  pause
  exit /b 1
)

echo.
echo === Iniciando o servidor ===
call npm start
pause