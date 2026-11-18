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

## Painel Beija-Flor (`/gbf/`)

Módulo à parte (branch `modulo-beijaflor`, que já inclui o `Lucas-Melhorias-UX`), com login
próprio em tabelas `gbf_*` criadas automaticamente na subida. **Não altera nenhuma tabela da
Central** e as integrações externas ficam desligadas sem as variáveis de ambiente.

- **URL:** http://192.168.7.150:3000/gbf/
- **API:** `/api/gbf/*`
- **Primeiro gestor (criado sozinho na primeira subida):**

  | Usuário | Senha |
  | --- | --- |
  | `beijaflor` | gerada — consultar `C:\ORCIM\runtime\app.out.log` (linhas "Painel Beija-Flor: primeiro acesso criado") |

  > Troque a senha no primeiro acesso (`must_change_password` já vem ativo).
  > Para fixar o login/senha inicial, defina no `.env` **antes** da primeira subida:
  > `GBF_ADMIN_USER` e `GBF_ADMIN_PASSWORD`.

- Os tokens do painel e da Central são separados (`audience` próprio): um login não abre o outro.

### Integrações externas (opcionais, desligadas por padrão)

| Variável | Efeito |
| --- | --- |
| `GBF_HOME=1` | raiz `/` redireciona para `/gbf/` |
| `WHATSAPP_DISABLED=1` | não inicia o cliente do WhatsApp |
| `ORCIM_DB_URL` | painel lê o banco da Central por conexão somente leitura (modo externo) |
| `GBF_SYNC_URL` + `GBF_SYNC_TOKEN` | Central **envia** alterações ao painel do grupo a cada minuto (`server/integracao-beijaflor/LEIA-ME.md`) |

Sem essas variáveis, a Central funciona exatamente como antes e o painel lê o próprio banco.

Documentação completa do módulo: `docs/painel-beija-flor/README.md`.

## Recepção de chamados por WhatsApp

O sistema **abre chamados a partir de mensagens de WhatsApp** (`server/whatsapp-inbound.js`)
e **devolve a solução ao solicitante pelo WhatsApp** quando o chamado é resolvido
(`server/services/notify.js`).

### Como funciona

**Coleta guiada (todo mundo: número novo ou cadastrado).** O chamado **só é aberto
depois** de ter todos os dados, nesta ordem:

1. **Nome completo** — se a resposta já trouber a empresa (`João Silva - Empresa X`),
   o passo seguinte é pulado.
2. **Empresa** — aceita qualquer nome (inclusive `particular`).
3. **Descrição do chamado** — precisa detalhar o problema (mín. 2 palavras; "ok",
   "bom dia" e nomes de pessoa são recusados).

O **assunto** do chamado passa a ser o **início da descrição** (sem prefixos).

| Situação | O que acontece |
| --- | --- |
| Primeira mensagem | Responde pedindo o nome completo (nada é aberto ainda) |
| Resposta inválida em qualquer passo | Repete o pedido daquele passo; após 3 tentativas desiste (`blocked`) |
| Contato `blocked` | Só volta a responder quando mandar um nome válido |
| Mensagem após o chamado aberto | **Não entra no chamado** — responde avisando e manda usar o sistema |
| Mensagem começando com **`NOVO`** | Sempre abre **outro** chamado (a mensagem vira a descrição) |
| Telefone da **equipe interna** (admin/técnico) | Responde pedindo para usar o sistema; não abre chamado |

Padrões do chamado aberto por WhatsApp: empresa **"WhatsApp - não identificado"**
(criada sozinha; o técnico redireciona para a empresa certa ao assumir), categoria
**"Outros"**, urgência **"Operação prejudicada"** e data de necessidade = hoje.
Quem já é cadastrado abre na **própria empresa**. A empresa digitada na coleta fica
gravada como texto na descrição (`Empresa informada pelo solicitante: ...`). O número
usado no WhatsApp também fica no chamado (`WhatsApp do solicitante: +55 (31) 99999-9999`).

### Solução de volta pelo WhatsApp

Chamados abertos pelo WhatsApp são marcados internamente (`tickets.via_whatsapp`).
Quando o técnico **resolve** (status *Resolvido*) ou a aprovação é **aprovada**, a
solução é enviada automaticamente para o último número conhecido do solicitante,
com o número e o assunto do chamado. O envio é *best effort*: se o WhatsApp estiver
offline ou o contato não existir, a mudança de status não é afetada e o resultado
fica em `notification_log` (`event = 'resolution.whatsapp'`).

### Atribuir empresa (triagem)

No topo da tela do chamado, quem tem a permissão de triagem vê o botão
**"Atribuir empresa"**: abre um modal com a lista de empresas existentes e move o
chamado para a empresa escolhida (aparece no histórico como *Empresa*). Localização
e equipamento só permanecem se também pertencerem à nova empresa.

Para ligar: em **Configurações → WhatsApp**, escaneie o QR. Desligue o recebimento com
`WHATSAPP_INBOUND=0` no `.env` (o envio continua); desligue tudo com `WHATSAPP_DISABLED=1`.

### Limitações

- Só **texto** (foto/documento sem legenda é ignorado com pedido de texto).
- Usa WhatsApp Web não oficial (`whatsapp-web.js`): prefira um **número dedicado**
  (risco de bloqueio da conta). A sessão pode pedir novo escaneamento de vez em quando.
- Sem conexão, o chamado é criado mesmo assim e a resposta não sai (o log registra).
- Logs: `C:\ORCIM\runtime\app.out.log` (linhas `[whatsapp-inbound]`).

## O que foi instalado

| Item | Local |
| --- | --- |
| Node.js 24.22.3 (portátil) | `C:\ORCIM\runtime\node` |
| PostgreSQL 17.4 (portátil) | `C:\ORCIM\runtime\pgsql` |
| Dados do PostgreSQL | `C:\ORCIM\runtime\pgdata` |
| Script de subida | `C:\ORCIM\runtime\start-os.ps1` |
| Logs | `C:\ORCIM\runtime\postgres.log`, `app.out.log`, `app.err.log` |
| Configuração | `.env` (na raiz do projeto) |
| Git 2.56 / GitHub CLI 2.104 | `C:\Program Files\Git`, `C:\Program Files\GitHub CLI` |
| Runner do GitHub Actions | `C:\ORCIM\runtime\runner` |

- Banco: `os_service` / usuário `os_app` / senha definida em `.env` (`DB_PASSWORD`).
- Firewall: regra de entrada TCP 3000 liberada para os perfis *Domain* e *Private*.
- Inicialização automática: tarefa agendada **`Central de Atendimento OS`** no **início do Windows** (executa como `SISTEMA`, sem precisar de login). Ela sobe o PostgreSQL e a aplicação.

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

## Integração com GitHub (CI/CD)

- **Repositório:** https://github.com/tiagofilipe8/chama-v15 (privado)
- **Runner local:** serviço do Windows `actions.runner.tiagofilipe8-chama-v15.lan-runner` (início automático, conta `LocalSystem`), instalado em `C:\ORCIM\runtime\runner`.
- **Workflow:** `.github/workflows/deploy.yml` — dispara a cada `push` na branch `main`.

### O que o deploy faz

1. Aciona a tarefa agendada para garantir PostgreSQL + aplicação no ar.
2. Atualiza a pasta da aplicação com o token temporário do job (`.env`, `uploads/`, `backups/` e `node_modules/` **não** são tocados).
3. `npm install` (se houver mudança em `package.json`/lock).
4. `npm run init` + `_migrate_inventory.js` (idempotentes).
5. Reinicia a aplicação **via Agendador de Tarefas** — assim os processos ficam fora da árvore do job e não são encerrados pela limpeza do runner.
6. Healthcheck em `/healthz`; a run só é considerada verde se responder 200.

### Como publicar uma alteração

```powershell
# Em uma cópia de desenvolvimento do repositório:
git add .
git commit -m "Descricao da mudanca"
git push origin main
# -> o deploy roda sozinho; acompanhe em
#    https://github.com/tiagofilipe8/chama-v15/actions
```

> **Importante:** a pasta `C:\ORCIM\IA\PROJETO\CHAMA_V15-main` é o **alvo de deploy**. Não edite o código nela diretamente — as alterações serão sobrescritas no próximo push. Clone o repositório em outra pasta para desenvolver.

### Operação

```powershell
# Status do runner
Get-Service "actions.runner.tiagofilipe8-chama-v15.lan-runner"

# Logs do runner
Get-ChildItem C:\ORCIM\runtime\runner\_diag | Sort-Object LastWriteTime -Descending | Select-Object -First 3

# Últimas execuções de deploy
gh run list --repo tiagofilipe8/chama-v15

# Disparar um deploy manualmente (sem push)
gh workflow run "Deploy (LAN)" --repo tiagofilipe8/chama-v15
```


## Observações

- O endereço `192.168.7.150` é o IP atual da máquina. Se o IP mudar (DHCP), atualize `PUBLIC_URL` no `.env` e reinicie a aplicação.
- Para acessar de outros computadores, eles precisam estar na mesma rede e o perfil de rede do Windows deve ser *Privado* ou *Domínio* (a regra do firewall não vale para o perfil *Público*).
- Notificações por WhatsApp Web exigem navegador (Edge/Chrome) e a sessão escaneada nesta máquina. O **Google Chrome foi detectado** em `C:\Program Files\Google\Chrome\Application\chrome.exe`; basta escanear o QR em *Configurações → WhatsApp*. Sem isso, as notificações in-app continuam funcionando.
- Correção aplicada em `server/schema.sql`: a tabela base `assets` passou a ser criada no schema (antes ela dependia de `_migrate_inventory.js`, o que quebrava a instalação do zero). Após `npm run init`, execute `node _migrate_inventory.js` para complementar o inventário.
- Para e-mail, preencha `SMTP_*` no `.env` e reinicie.
