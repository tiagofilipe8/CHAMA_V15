# Restauração do projeto em outra máquina

## Requisitos
- Node.js 20+ (LTS)
- PostgreSQL 14+
- npm

## Passos

### 1. Banco de dados
```powershell
# Crie o banco e o usuário (ajuste senha se desejar)
psql -U postgres -c "CREATE USER os_app WITH PASSWORD 'os_app_secret';"
psql -U postgres -c "CREATE DATABASE os_service OWNER os_app;"

# Restaure o dump
psql -U os_app -d os_service -f _backup_db.sql
```

> Se usar outra senha/usuário, ajuste `DB_USER` e `DB_PASSWORD` no `.env`.

### 2. Projeto
1. Copie esta pasta para a máquina de destino (pode excluir `node_modules`, `.wwebjs_cache`, `backups`, `*.log` antes de copiar).
2. Instale as dependências:
```powershell
npm install
```
3. Confira o `.env` (porta, segredo JWT, SMTP/WhatsApp se usar).

### 3. Executar
```powershell
start.bat
```
Ou:
```powershell
node server\index.js
```

Acesse `http://localhost:7070` — login padrão: `admin / admin123`.

### 4. Arquivos enviados
A pasta `uploads/` (fotos de ativos e anexos de chamados) está incluída no backup. Mantenha a mesma estrutura relativa.

### 5. Agente de inventário (opcional)
Copie `agent/` e `C:\ORCIM\agente-powershell-1.0.0.zip` (se existir). Na nova máquina rode `npm install` em `agent/` e siga `README-PS.md` para o agente PowerShell.
