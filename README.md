# Sistema de Ordens de Serviço (Central de Atendimento TI)

Sistema web de chamados/ordens de serviço para empresas de TI, com controle de acesso por papéis e níveis, painel em tempo real com voz, e notificações por e-mail e WhatsApp (conexão local via WhatsApp Web).

## Requisitos

- Node.js 18+ (testado com v24)
- PostgreSQL 14+ (testado com 17)

> No Windows: `winget install OpenJS.NodeJS.LTS` e `winget install PostgreSQL.PostgreSQL.17`.

## Configuração

1. Copie `.env.example` para `.env` e preencha (banco, JWT, SMTP e WhatsApp):

```bash
cp .env.example .env          # Windows: copy .env.example .env
```

| Variável | Descrição |
| --- | --- |
| `PORT` | Porta HTTP (padrão 3000) |
| `DB_*` | Conexão PostgreSQL (banco `os_service`, usuário `os_app`) |
| `JWT_SECRET` | Segredo do JWT (**troque em produção**) |
| `PUBLIC_URL` | URL pública (usada nos links de e-mail/WhatsApp) |
| `SMTP_*` | Servidor SMTP para e-mails de notificação |
| `WHATSAPP_*` | WhatsApp Cloud API (token, phone id, verify token) |

2. Crie o banco e o usuário no PostgreSQL (uma vez):

```sql
CREATE ROLE os_app LOGIN PASSWORD 'os_app_secret';
CREATE DATABASE os_service OWNER os_app;
```

3. Execute `npm run init` — cria tabelas, quantidades de categorias e usuários demo, e configurações padrão. É idempotente (pode rodar toda vez que o servidor subir).

## Executando

```bash
npm start         # ou: npm run dev (recarrega automaticamente)
# Iniciar tudo de uma vez (cria .env, instala dependências, inicializa o banco e sobe):
start.bat         # Windows
./start.sh        # Linux/macOS
```

Acesse `http://localhost:3000`.

## Contas demo (criadas pelo seed)

| Usuário | Senha | Papel |
| --- | --- | --- |
| `admin` | `admin123` | Administrador |
| `tecnico1` | `tecnico123` | Técnico |
| `cliente1` | `cliente123` | Cliente nível 1 (requisitante) |
| `gestor1` | `gestor123` | Cliente nível 2 (gestor da entidade) |

**Controle de acesso e visibilidade**

- **Administrador**: tudo (usuários, entidades, categorias, configurações, todos os chamados).
- **Técnico**: todos os chamados; altera apenas os que estão atribuídos a ele; pode assumir chamados sem responsável.
- **Cliente nível 1 (Requisitante)**: abre chamados e acompanha **apenas os seus**.
- **Cliente nível 2 (Gestor)**: vê **toda a entidade** e aprova/reprova soluções dos chamados da entidade.

**Fluxo de aprovação**: ao marcar um chamado como *Resolvido*, o sistema solicita aprovação do requisitante/gestor. Aprovar fecha o chamado; reprovar o retorna a *Em andamento*. A renuncia (`admin`) confirma que um chamado aberto não precisa de aprovação.

## WhatsApp (conexão local — WhatsApp Web)

O sistema envia notificações para os telefones cadastrados em `users.phone` usando uma sessão de **WhatsApp Web** aberta no próprio computador do servidor (via `whatsapp-web.js` + Edge/Chrome). Não depende de API paga da Meta.

1. Abra **Configurações → WhatsApp (conexão local)** logado como **admin**.
2. Escaneie o **QR code** exibido com o WhatsApp do celular (Configurações ➜ Aparelhos conectados ➜ Conectar um aparelho).
3. Ative o toggle **“Enviar notificações por WhatsApp”** no card *Notificações* e salve.
4. A sessão fica gravada na pasta `.wwebjs/` e reutilizada nas próximas inicializações. Use *Desconectar*/ *Conectar* para trocar de conta ou gerar novo QR.

Avisos importantes:

- O número usado é o da conta de WhatsApp que escaneou o QR.
- O PC do servidor precisa ficar ligado (a sessão é local).
- Mensagens em massa podem levar a **bloqueio/banimento** da conta pelo WhatsApp.
- O computador precisa ter **Edge ou Chrome** instalado (usado em modo silencioso).

As notificações também são registradas em `notification_log` (status de envio) e ficam disponíveis como notificações in-app (sino) e via Socket.IO, mesmo sem SMTP/WhatsApp configurados.

## Estrutura

```
server/            API Express + Socket.IO
  schema.sql       Estrutura do banco
  init.js          Cria schema, seed e configurações padrão
  middleware/      JWT, papéis e escopo de visibilidade
  routes/          auth, users, entities, categories, tickets, dashboard, settings, notifications
  services/        mailer (SMTP), whatsapp (WhatsApp Web local), realtime (Socket.IO), notify (dispatcher), settingsStore
public/            Frontend (sem build — abra /app.html)
  index.html       Login (logo/fundo dinâmicos a partir das configurações)
  app.html         Shell (sidebar, sino, voz, relógio)
  js/              ui, api, voice, app (roteamento hash), views/*
uploads/           Arquivos enviados pelas configurações (logo, fundo)
```

## API (resumo)

- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/password`
- `GET|POST /api/tickets`, `GET|PATCH /api/tickets/:id`, `POST /api/tickets/:id/messages`, atribuição, status, aprovação (`/approval`, `/approval/respond`)
- `GET /api/dashboard` (contadores + chamados abertos em tempo real)
- `GET|POST /api/users`, `/api/entities`, `/api/categories` (rotas administrativas)
- `GET /api/settings/public`, `PATCH /api/settings/save`, `POST /api/settings/upload`
- `GET /api/notifications`, `POST /api/notifications/read-all`, `GET|POST /api/notifications/webhook` (WhatsApp)

Todos os endpoints exigem `Authorization: Bearer <token>` (exceto login, settings/public e webhook).