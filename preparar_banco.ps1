# ============================================================
#  CHAMA_V15 - Preparar banco de dados local (PostgreSQL)
#  Chamado pelo preparar_banco.bat. Nao guarda senhas em lugar
#  nenhum alem do arquivo .env (que NAO vai para o GitHub).
# ============================================================
param([string]$Pasta)

# 'Continue': no Windows PowerShell 5.1, 'Stop' quebra quando o psql escreve avisos
$ErrorActionPreference = 'Continue'
$Pasta = (Resolve-Path $Pasta).Path

$DB_HOST = 'localhost'
$DB_PORT = '5432'
$DB_NAME = 'os_service'
$DB_USER = 'os_app'

function Texto-Simples($seguro) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Escrever-Utf8SemBom($caminho, $conteudo) {
    [IO.File]::WriteAllText($caminho, $conteudo, (New-Object Text.UTF8Encoding $false))
}
function Erro($msg) {
    Write-Host ""
    Write-Host "[ERRO] $msg" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "   CHAMA_V15 - Preparar banco de dados" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# ---------- 1. Conferir se esta na pasta certa ----------
if (-not (Test-Path (Join-Path $Pasta 'package.json'))) {
    Erro "Este atalho precisa estar dentro da pasta do projeto CHAMA_V15 (onde fica o package.json)."
}

# ---------- 2. Encontrar o PostgreSQL ----------
$psql = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
        Sort-Object { [int](($_.Directory.Parent.Name) -replace '\D', '') } -Descending |
        Select-Object -First 1
if (-not $psql) {
    $cmd = Get-Command psql -ErrorAction SilentlyContinue
    if ($cmd) { $psql = Get-Item $cmd.Source }
}
if (-not $psql) {
    Erro "PostgreSQL nao encontrado. Instale o PostgreSQL (https://www.postgresql.org/download/windows/) e rode este atalho de novo."
}
$psql = $psql.FullName
Write-Host "[OK] PostgreSQL encontrado: $psql" -ForegroundColor Green

# ---------- 3. Senha do administrador (postgres) ----------
Write-Host ""
Write-Host "Digite a senha do usuario 'postgres' (a que voce escolheu ao INSTALAR o PostgreSQL)."
Write-Host "(Ao digitar, nada aparece na tela. E normal.)"
$senhaAdmin = Texto-Simples (Read-Host 'Senha do postgres' -AsSecureString)

$env:PGPASSWORD = $senhaAdmin
$env:PGCLIENTENCODING = 'UTF8'
try {
    & $psql -h $DB_HOST -p $DB_PORT -U postgres -d postgres -tAc "SELECT 1" *> $null
    if ($LASTEXITCODE -ne 0) {
        Erro "Nao consegui entrar no PostgreSQL. Confira a senha do 'postgres' e se o servico do PostgreSQL esta ligado."
    }
    Write-Host "[OK] Conectado ao PostgreSQL." -ForegroundColor Green

    # ---------- 4. Senha do usuario do sistema (os_app) ----------
    Write-Host ""
    Write-Host "Agora escolha a senha do usuario do sistema '$DB_USER'."
    Write-Host "Dica: use so letras e numeros (sem espacos, aspas ou #). Ela vai para o arquivo .env."
    while ($true) {
        $s1 = Texto-Simples (Read-Host "Nova senha do $DB_USER" -AsSecureString)
        $s2 = Texto-Simples (Read-Host "Repita a senha" -AsSecureString)
        if ([string]::IsNullOrEmpty($s1)) { Write-Host "A senha nao pode ficar vazia." -ForegroundColor Yellow; continue }
        if ($s1 -ne $s2) { Write-Host "As senhas nao conferem. Tente de novo." -ForegroundColor Yellow; continue }
        break
    }
    $senhaApp = $s1

    # ---------- 5. Criar usuario e banco ----------
    $senhaSql = $senhaApp.Replace("'", "''")
    $sql = @"
SELECT 'CREATE ROLE $DB_USER LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER')\gexec
ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$senhaSql';
SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_USER' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$DB_NAME')\gexec
ALTER DATABASE $DB_NAME OWNER TO $DB_USER;
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
\c $DB_NAME
GRANT ALL ON SCHEMA public TO $DB_USER;
"@
    $tmp = Join-Path $env:TEMP ("chama_banco_" + [guid]::NewGuid().ToString('N') + ".sql")
    try {
        Escrever-Utf8SemBom $tmp $sql
        & $psql -h $DB_HOST -p $DB_PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f $tmp *> $null
        if ($LASTEXITCODE -ne 0) { Erro "Falha ao criar o usuario/banco no PostgreSQL." }
    } finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
    Write-Host "[OK] Usuario '$DB_USER' e banco '$DB_NAME' prontos." -ForegroundColor Green

    # Teste de login com o usuario do sistema
    $env:PGPASSWORD = $senhaApp
    & $psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -tAc "SELECT 1" *> $null
    if ($LASTEXITCODE -ne 0) { Erro "O banco foi criado, mas o login com '$DB_USER' falhou." }
    Write-Host "[OK] Login com '$DB_USER' testado." -ForegroundColor Green
}
finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

# ---------- 6. Criar/atualizar o arquivo .env ----------
$envPath = Join-Path $Pasta '.env'
$exemplo = Join-Path $Pasta '.env.example'

if (Test-Path $envPath) {
    $linhas = [Collections.Generic.List[string]]@(Get-Content $envPath -Encoding UTF8)
    Write-Host "[OK] .env ja existia - atualizando os dados do banco." -ForegroundColor Green
} elseif (Test-Path $exemplo) {
    $linhas = [Collections.Generic.List[string]]@(Get-Content $exemplo -Encoding UTF8)
    Write-Host "[OK] .env criado a partir do .env.example." -ForegroundColor Green
} else {
    $linhas = New-Object Collections.Generic.List[string]
    Write-Host "[AVISO] .env.example nao encontrado - criando .env so com os dados do banco." -ForegroundColor Yellow
}

function Valor-Atual($chave) {
    foreach ($l in $linhas) {
        if ($l -match "^\s*$chave\s*=(.*)$") { return $Matches[1].Trim().Trim('"').Trim("'") }
    }
    return $null
}
function Definir($chave, $valor) {
    if ($valor -match '[\s#"''`]') { $valor = '"' + $valor.Replace('"', '\"') + '"' }
    $nova = "$chave=$valor"
    for ($i = 0; $i -lt $linhas.Count; $i++) {
        if ($linhas[$i] -match "^\s*$chave\s*=") { $linhas[$i] = $nova; return }
    }
    $linhas.Add($nova)
}

Definir 'DB_HOST' $DB_HOST
Definir 'DB_PORT' $DB_PORT
Definir 'DB_NAME' $DB_NAME
Definir 'DB_USER' $DB_USER
Definir 'DB_PASSWORD' $senhaApp

# JWT_SECRET: gera um novo so se estiver vazio ou parecer um texto de exemplo
$jwt = Valor-Atual 'JWT_SECRET'
if ([string]::IsNullOrWhiteSpace($jwt) -or $jwt.Length -lt 24 -or $jwt -match '(?i)troque|altere|seu_|sua_|exemplo|example|change|secret_here|xxx') {
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    Definir 'JWT_SECRET' (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
    Write-Host "[OK] JWT_SECRET gerado automaticamente." -ForegroundColor Green
}

Escrever-Utf8SemBom $envPath (($linhas -join "`r`n") + "`r`n")
Write-Host "[OK] Arquivo .env salvo em: $envPath" -ForegroundColor Green

# ---------- 7. Garantir que o .env NAO va para o GitHub ----------
$gi = Join-Path $Pasta '.gitignore'
$protegido = $false
if (Test-Path $gi) {
    $protegido = [bool](Get-Content $gi | Where-Object { $_.Trim() -match '^/?\.env$' })
}
if (-not $protegido) {
    Add-Content -Path $gi -Value "`r`n.env" -Encoding UTF8
    Write-Host "[OK] '.env' adicionado ao .gitignore (para a senha nunca ir pro GitHub)." -ForegroundColor Green
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Banco pronto! Agora rode: reiniciar_sistema.bat" -ForegroundColor Cyan
Write-Host " (as tabelas sao criadas sozinhas na 1a vez)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
exit 0
