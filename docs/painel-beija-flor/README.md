# Painel Beija-Flor

Módulo à parte, com login próprio, para o Grupo Beija-Flor acompanhar as demandas atendidas
pela Orcim e organizar as atividades do técnico do grupo que trabalha junto com a Orcim.

- Tela: `/gbf/` (ex.: `https://<endereço-da-central>/gbf/`)
- API: `/api/gbf/*`

## O que foi alterado na Central

O módulo foi feito para não interferir no que já existe:

| Item | Detalhe |
| --- | --- |
| `server/index.js` | **Uma linha** (`app.use('/api/gbf', require('./gbf'))`), logo depois da rota de inventário |
| `server/gbf/` | Código do módulo (pasta nova) |
| `public/gbf/` | Tela do módulo (pasta nova; usa o `/vendor` já existente) |
| Banco | Só tabelas **novas**, com prefixo `gbf_`, criadas sozinhas na subida (`server/gbf/schema.sql`, idempotente) |

- **Nenhuma tabela da Central é alterada.** O módulo só **lê** `tickets`, `ticket_status_history`,
  `ticket_messages`, `ticket_attachments`, `entities`, `categories`, `users`, `assets` e
  `asset_maintenances`.
- **Os logins são separados.** Os usuários ficam em `gbf_users`. O token do painel é assinado com
  um segredo derivado do `JWT_SECRET` (HMAC) e com `audience` próprio. Por isso um token do painel
  não abre a Central, e um token da Central não abre o painel.
- Não usa socket, e-mail nem WhatsApp da Central. As notificações do painel são internas
  (tabela `gbf_notifications`), com aviso opcional do próprio navegador.

## Funções

- **Visão geral**: mostra
  - demandas em aberto, atrasadas, que vencem em até 4 h, sem técnico e aguardando aprovação;
  - tempo médio e mediano até resolver, até a 1ª resposta e até começar;
  - percentual de prazo cumprido;
  - demandas abertas × resolvidas por dia;
  - distribuição por status, empresa, categoria e técnico da Orcim.
- **Demandas**: lista com filtros e, em cada demanda:
  - linha do tempo de status, tempo em cada etapa e conversa (somente leitura);
  - anexos;
  - atividades nossas ligadas a ela.
- **Manutenções**: equipamentos com manutenção vencida ou nos próximos 60 dias, e manutenções
  realizadas nos últimos 90 dias.
- **Atividades**: quadro (A fazer / Em andamento / Aguardando / Concluídas) com prazo,
  prioridade, responsável, local e ligação com uma demanda da Orcim. Tem histórico e comentários.
- **Notificações** (verificadas a cada minuto):
  - nova demanda;
  - demanda com prazo estourado;
  - demanda resolvida;
  - mudança de status em demanda ligada a uma atividade;
  - atividade atribuída;
  - atividade que vence em 24 h;
  - atividade atrasada;
  - comentários.
- **Usuários** (gestor): papéis *gestor* e *técnico*, com troca de senha obrigatória no primeiro acesso.
- **Configurações** (gestor): escolha das empresas (entities) que o painel acompanha.

### Rotina do técnico (postos, agenda, visitas, checklists, solicitações)

O fluxo central é **Posto → próxima visita → agenda → iniciar visita → checklist → concluir → histórico do posto**.

- **Meu dia** (página inicial do técnico): mostra
  - as visitas de hoje e as atrasadas, com o botão INICIAR VISITA;
  - a visita em andamento;
  - as atividades de hoje e as atrasadas;
  - as solicitações do gestor e as próximas visitas.
- **Postos**: cada posto tem uma ficha com
  - endereço, responsável, telefone e observações;
  - frequência da visita (semanal, quinzenal, mensal, a cada X dias ou sem recorrência);
  - próxima visita, com data e horário;
  - checklist e a empresa correspondente na Central.

  A ficha também mostra as demandas da Orcim abertas para essa empresa, as atividades, as
  solicitações e o histórico de visitas.
- **Agenda**: visualização por dia, semana, mês ou lista. Mostra visitas previstas, visitas
  feitas, atividades e solicitações. Para reagendar, o técnico informa a nova data e o horário,
  sem arrastar nada. Ao reagendar uma visita, muda só a próxima visita do posto.
- **Visita**: o checklist do posto é **copiado para a visita**. Por isso, alterar o modelo depois
  não muda o histórico.
  - Cada item recebe OK, NÃO OK ou N/A, com observação opcional, e é salvo a cada toque.
  - A visita também tem observações, pendências e fotos (opcionais).
  - Ao concluir, o sistema atualiza a última visita e calcula **somente a próxima** data pela
    frequência.
  - Uma pendência pode virar atividade do posto.
- **Checklists**: dá para criar, editar, duplicar, ativar ou desativar e reordenar itens (com
  botões de subir e descer), e associar o modelo aos postos.
- **Solicitações**: o gestor abre a solicitação, a TI atende (A fazer → Em andamento → Concluída,
  com a resposta do que foi feito) e o gestor acompanha.
- **Acompanhamento** (página inicial do gestor): mostra
  - o que foi feito no período (visitas, atividades e solicitações);
  - os itens NÃO OK;
  - os postos com visita atrasada;
  - o que está acontecendo agora.
- **Avisos internos**:
  - nova solicitação, para os técnicos;
  - solicitação concluída, para quem pediu;
  - visita concluída, para os gestores;
  - visita prevista para hoje ou atrasada, para os técnicos, uma vez por dia;
  - atividade que vence em 24 h ou atrasada.

As fotos ficam em `uploads/gbf/visitas/<id>/`, já coberto pelo `.gitignore` (`uploads/*`).

Tabelas: `gbf_locations`, `gbf_checklists`, `gbf_checklist_items`, `gbf_visits`,
`gbf_visit_answers`, `gbf_visit_photos` e `gbf_requests`. A tabela `gbf_tasks` ganhou
`location_id` e `visit_id`.

### Como os tempos são calculados

Os tempos vêm do histórico de status. Nada é digitado.

- **Até a 1ª resposta**: da abertura até a primeira mensagem de um técnico ou admin.
- **Até começar**: da abertura até a primeira passagem por "Atribuído" ou "Em andamento".
- **Até resolver**: da abertura até a entrada em "Resolvido" ou "Fechado" depois da última reabertura.
- **Prazo**: é o `due_at` do chamado, que vem do SLA da entidade.

## Primeiro acesso

Na primeira subida com o módulo, o servidor cria o gestor inicial e mostra o login no console:

```
 Painel Beija-Flor: primeiro acesso criado
   usuário: beijaflor
   senha:   <gerada>   (troque no primeiro login)
```

Também dá para definir o login inicial no `.env`, antes da primeira subida:

```
GBF_ADMIN_USER=beijaflor
GBF_ADMIN_PASSWORD=<senha-inicial>
```

Variáveis opcionais: `GBF_JWT_SECRET` (segredo próprio do painel) e `GBF_JWT_EXPIRES_IN`
(o padrão é `12h`).

## Observação encontrada durante a instalação de teste

Num banco **novo**, o `npm run init` falha em `ALTER TABLE assets ...` (`server/schema.sql`,
linha ~199). Isso acontece porque a tabela `assets` só é criada pelo `_migrate_inventory.js`, que
por sua vez depende de `entities` e `users`.

O ambiente de teste foi montado nesta ordem:
1. a parte do `schema.sql` anterior a essas linhas;
2. o `_migrate_inventory.js`;
3. o `npm run init`.

Bancos que já estão em uso não são afetados.

## Publicação própria do grupo (ti.sgogeral.com)

O Grupo Beija-Flor publica esta Central + painel num serviço próprio do Render
(`render.yaml`), com banco próprio. Para isso existem três ajustes, **todos ligados só por
variável de ambiente** — sem as variáveis, a Central funciona exatamente como antes:

| Variável | Efeito |
| --- | --- |
| `GBF_HOME=1` | o endereço raiz (`/`) redireciona para `/gbf/` (`server/index.js`) |
| `WHATSAPP_DISABLED=1` | não inicia o cliente do WhatsApp, que precisa de navegador (`server/services/whatsapp.js`) |
| comando `node server/gbf/instalar-banco.js` | prepara um banco **novo** na ordem certa e **sem** os usuários de demonstração (`admin/admin123`), que não podem ir para a internet |

## Ler os dados da Central da Orcim a partir do servidor do grupo (somente leitura)

No `ti.sgogeral.com` o painel tem banco próprio. Para mostrar as demandas reais, ele lê o
banco da Central da Orcim por uma **conexão separada e somente leitura**, configurada na
variável `ORCIM_DB_URL`. Sem essa variável, o painel lê o próprio banco (modo de sempre).

- **Lê** da Orcim: `tickets`, `ticket_status_history`, `ticket_messages`,
  `ticket_attachments`, `entities`, `categories`, `users`, `assets`, `asset_maintenances`.
- **Grava** só no banco do grupo, em tabelas `gbf_*`. Toda sessão da conexão da Orcim abre com
  `default_transaction_read_only = on`, além do usuário já ser somente leitura.
- Anexos de chamados ficam no disco do servidor da Orcim: o painel lista os anexos, mas o
  download é feito pela Central deles.

### O que a Orcim precisa fazer (uma vez)

1. Criar um usuário **somente leitura** no PostgreSQL da Central (troque a senha):

   ```sql
   CREATE ROLE painel_gbf LOGIN PASSWORD '<senha-forte>';
   GRANT CONNECT ON DATABASE os_service TO painel_gbf;
   GRANT USAGE ON SCHEMA public TO painel_gbf;
   GRANT SELECT ON tickets, ticket_status_history, ticket_messages, ticket_attachments,
                   entities, categories, users, assets, asset_maintenances TO painel_gbf;
   ```

2. Deixar o PostgreSQL acessível pela internet **só para os IPs de saída do Render** (o grupo
   informa a lista): liberar a porta no firewall/roteador e no `pg_hba.conf`
   (`hostssl os_service painel_gbf <ip>/32 scram-sha-256`), com SSL ligado no Postgres.
3. Mandar ao grupo, **por canal separado**: endereço público (IP ou domínio), porta, nome do
   banco e a senha do `painel_gbf`.

### O que o grupo faz em seguida

No serviço `ti-painel` do Render, criar a variável
`ORCIM_DB_URL=postgres://painel_gbf:<senha>@<endereço>:<porta>/os_service` e, se o banco
exigir SSL, `ORCIM_DB_SSL=1`. Depois do deploy, **Configurações** mostra
"Conectado ao banco da Orcim · N chamados" ou o motivo do erro.

## Envio automático para o painel do grupo (caminho escolhido)

A Central continua sendo **a fonte de tudo**. O próprio servidor da Central **envia** ao
painel do grupo (`ti.sgogeral.com`) o que mudou, a cada minuto (`server/gbf/sync.js`).

- **Só conexão de saída:** funciona com a Central num computador local, sem abrir porta e sem
  expor o banco.
- **Não altera nada na Central:** só lê e envia.
- **O que vai:**
  - empresas, categorias, chamados, histórico, mensagens, anexos (inclusive os arquivos, até
    8 MB), equipamentos e manutenções;
  - usuários **sem** senha, e-mail e telefone.
- **Exclusões:** a cada 6 horas há uma conferência completa, para o painel refletir também o
  que foi apagado.
- **Desligado por padrão:** sem as variáveis abaixo, nada é enviado.

### O que a Orcim faz (uma vez)

1. Juntar o branch `modulo-beijaflor` no sistema.
2. No `.env` da Central, acrescentar (o grupo envia a chave por canal separado):

   ```
   GBF_SYNC_URL=https://ti.sgogeral.com/api/gbf/sync
   GBF_SYNC_TOKEN=<chave enviada pelo grupo>
   ```

3. Reiniciar a Central. No log aparece
   `[gbf-sync] enviando dados da Central para https://ti.sgogeral.com/api/gbf/sync a cada 60s`.
   Em até 1 minuto, o painel mostra em **Configurações** "Último envio recebido: …".

Opcionais: `GBF_SYNC_INTERVALO_S` (padrão 60) e `GBF_SYNC_COMPLETO_H` (padrão 6).
