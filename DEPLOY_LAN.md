# Deploy em rede local (LAN)

Sistema publicado nesta máquina e acessível pela rede interna.

## Acesso

- **URL:** http://192.168.7.150:3000
- **Healthcheck:** http://192.168.7.150:3000/healthz

### Contas iniciais (seed)

| Usuário | Senha | Papel |
| --- | --- | --- |
| `admin` | `admin123` | Administrador |
| `tecnico1` | `tecnico123` | Técnico |
| `cliente1` | `cliente123` | Cliente nível 1 |
| `gestor1` | `gestor123` | Cliente nível 2 |

> Troque as senhas após o primeiro acesso (menu de alteração de senha).

## O que foi instalado

| Item | Local |
| --- | --- |
| Node.js 24.22.3 (portátil) | `C:\ORCIM\runtime\node` |
| PostgreSQL 17.4 (portátil) | `C:\ORCIM\runtime\pgsql` |
| Dados do PostgreSQL | `C:\ORCIM\runtime\pgdata` |
| Script de subida | `C:\ORCIM\runtime\start-os.ps1` |
| Logs | `C:\ORCIM\runtime\postgres.log`, `app.out.log`, `app.err.log` |
| Configuração | `.env` (na raiz do projeto) |

- Banco: `os_service` / usuário `os_app` / senha definida em `.env` (`DB_PASSWORD`).
- Firewall: regra de entrada TCP 3000 liberada para os perfis *Domain* e *Private*.
- Inicialização automática: tarefa agendada `Central de Atendimento OS` (disparada no logon do Windows, com privilégios elevados).

## Comandos úteis

```powershell
# Subir tudo manualmente (banco + aplicação)
powershell -NoProfile -ExecutionPolicy Bypass -File C:\ORCIM\runtime\start-os.ps1

# Status do PostgreSQL
C:\ORCIM\runtime\pgsql\bin\pg_isready.exe -h 127.0.0.1 -p 5432

# Parar a aplicação (node)
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# Parar o PostgreSQL
C:\ORCIM\runtime\pgsql\bin\pg_ctl.exe -D C:\ORCIM\runtime\pgdata stop
```

## Observações

- O endereço `192.168.7.150` é o IP atual da máquina. Se o IP mudar (DHCP), atualize `PUBLIC_URL` no `.env` e reinicie a aplicação.
- Para acessar de outros computadores, eles precisam estar na mesma rede e o perfil de rede do Windows deve ser *Privado* ou *Domínio* (a regra do firewall não vale para o perfil *Público*).
- Notificações por WhatsApp Web exigem navegador (Edge/Chrome) e a sessão escaneada nesta máquina. O **Google Chrome foi detectado** em `C:\Program Files\Google\Chrome\Application\chrome.exe`; basta escanear o QR em *Configurações → WhatsApp*. Sem isso, as notificações in-app continuam funcionando.
- Correção aplicada em `server/schema.sql`: a tabela base `assets` passou a ser criada no schema (antes ela dependia de `_migrate_inventory.js`, o que quebrava a instalação do zero). Após `npm run init`, execute `node _migrate_inventory.js` para complementar o inventário.
- Para e-mail, preencha `SMTP_*` no `.env` e reinicie.
