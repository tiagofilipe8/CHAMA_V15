@echo off
REM ============================================================
REM  CHAMA_V15 - Reiniciar o sistema
REM  Fecha o que estiver rodando na porta 3000, confere tudo,
REM  atualiza as dependencias e inicia de novo (start.bat).
REM ============================================================
setlocal
title CHAMA_V15 - Sistema
cd /d "%~dp0"

echo =============================================
echo    CHAMA_V15 - Reiniciando o sistema
echo =============================================
echo.

REM ---------- 1. Node.js instalado? ----------
where node >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado. Instale o Node.js LTS em https://nodejs.org
    echo        e depois FECHE e abra este atalho de novo.
    goto :fim
)
for /f "delims=" %%V in ('node -v') do echo [OK] Node.js %%V

REM ---------- 2. Arquivo .env existe? ----------
if not exist ".env" (
    echo [ERRO] Arquivo .env nao encontrado.
    echo        Rode primeiro o atalho preparar_banco.bat
    goto :fim
)
echo [OK] Arquivo .env encontrado

REM ---------- 3. PostgreSQL ligado? ----------
set "PGREADY="
for /d %%D in ("C:\Program Files\PostgreSQL\*") do (
    if exist "%%D\bin\pg_isready.exe" set "PGREADY=%%D\bin\pg_isready.exe"
)
if defined PGREADY (
    "%PGREADY%" -h localhost -p 5432 >nul 2>&1
    if errorlevel 1 (
        echo [AVISO] O PostgreSQL parece desligado. Tentando ligar...
        powershell -NoProfile -Command "Get-Service postgresql* | Start-Service" >nul 2>&1
        timeout /t 3 >nul
        "%PGREADY%" -h localhost -p 5432 >nul 2>&1
        if errorlevel 1 (
            echo [ERRO] O PostgreSQL continua desligado.
            echo        Abra o menu Iniciar, digite "Servicos", procure "postgresql",
            echo        clique com o botao direito e escolha "Iniciar". Depois rode este atalho de novo.
            goto :fim
        )
    )
    echo [OK] PostgreSQL ligado
) else (
    echo [AVISO] Nao achei o PostgreSQL em C:\Program Files\PostgreSQL - continuando mesmo assim.
)

REM ---------- 4. Fechar o sistema se ja estiver rodando ----------
echo.
echo Fechando versao antiga do sistema (porta 3000), se houver...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
timeout /t 2 >nul

REM ---------- 5. Instalar/atualizar dependencias ----------
echo.
echo Instalando/atualizando dependencias (npm install)...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo [ERRO] O npm install falhou. Veja a mensagem acima.
    goto :fim
)

REM ---------- 6. Iniciar ----------
echo.
echo =============================================
echo  Iniciando... Abra no navegador:
echo      http://localhost:3000
echo  Para PARAR o sistema: feche esta janela.
echo =============================================
echo.
if exist "start.bat" (
    call "start.bat"
) else (
    call npm start
)

:fim
echo.
pause
