@echo off
REM Orcim Inventory Agent - Desinstalador (Executar como administrador)
set "SVC=OrcimInventoryAgent"
set "DEST=%ProgramFiles%\Orcim\Agent"

echo Parando servico...
sc stop %SVC% >nul 2>&1
timeout /t 1 /nobreak >nul
echo Removendo servico...
sc delete %SVC% >nul 2>&1
echo Removendo tarefa agendada (se existir)...
schtasks /delete /tn %SVC% /f >nul 2>&1
echo Removendo arquivos...
if exist "%DEST%" rmdir /s /q "%DEST%"
echo.
echo Desinstalado. Dados em %%ProgramData%%\Orcim mantidos.
pause
