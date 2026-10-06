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
