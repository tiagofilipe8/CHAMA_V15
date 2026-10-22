# Integração Central → Painel Beija-Flor

Módulo que envia ao painel do Grupo Beija-Flor (`https://ti.sgogeral.com`) uma cópia dos dados
desta Central, para o grupo acompanhar os chamados e equipamentos que a Orcim atende para ele.

## O que ele faz e o que não faz

- **Só lê** o banco da Central. Não altera, não apaga e não cria nada aqui (nem tabela).
- **Só faz conexões de saída** (HTTPS para ti.sgogeral.com). Não abre porta e funciona com a
  Central num computador local, atrás de roteador.
- Descobre **sozinho todas as tabelas** do banco, inclusive as que forem criadas em versões
  futuras. Não precisa mexer no módulo quando o sistema mudar.
- A cada minuto manda só o que mudou. A cada 6 horas faz uma conferência completa, para o
  painel tirar o que foi apagado aqui.
- Manda também os arquivos de anexo dos chamados e as fotos dos equipamentos (até 8 MB cada).

**Nunca são enviados:**

- colunas com nome de senha, hash, token, segredo, chave de API, credencial ou SMTP;
- e-mail e telefone dos usuários e o destinatário do log de notificações;
- a tabela `agent_credentials` (credenciais dos agentes de inventário);
- valores de `settings` cuja chave tenha nome de senha/token/segredo (vão como "oculto").

Se quiserem deixar mais alguma tabela de fora: `GBF_SYNC_EXCLUIR=tabela1,tabela2` no `.env`.

## Instalação (3 passos)

1. Copiar esta pasta para `server/integracao-beijaflor/` da Central.
2. No `server/index.js`, logo depois de `maintenanceAlerts.startScheduler();`, colar a linha:

   ```js
   require('./integracao-beijaflor').iniciar(); // envio ao Painel Beija-Flor (só liga com GBF_SYNC_URL + GBF_SYNC_TOKEN)
   ```

3. No `.env` da Central, acrescentar (a chave é enviada pelo Grupo Beija-Flor por outro canal):

   ```
   GBF_SYNC_URL=https://ti.sgogeral.com/api/gbf/sync
   GBF_SYNC_TOKEN=<chave enviada pelo Grupo Beija-Flor>
   ```

Reiniciar a Central. No terminal dela aparece:

```
[integracao-beijaflor] enviando os dados da Central para https://ti.sgogeral.com/api/gbf/sync a cada 60s
```

e, em até um minuto, `N registro(s) enviados ao painel.`

Sem as duas variáveis o módulo fica desligado e não faz nada. Para parar o envio, basta apagar
as duas linhas do `.env` e reiniciar.

## Requisitos

- Node 18 ou mais novo (usa o `fetch` do próprio Node). Não precisa instalar nenhum pacote.
- Usa `server/config.js` (`uploadsDir`) e `server/db.js` (`query`) da própria Central.

## Opcionais no `.env`

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `GBF_SYNC_INTERVALO_S` | `60` | intervalo do envio, em segundos (mínimo 15) |
| `GBF_SYNC_COMPLETO_H` | `6` | intervalo da conferência completa, em horas |
| `GBF_SYNC_EXCLUIR` | — | tabelas a mais para não enviar, separadas por vírgula |

## Se der erro

O módulo nunca derruba a Central: erros aparecem no terminal com o prefixo
`[integracao-beijaflor]` e o envio tenta de novo no minuto seguinte.

- `HTTP 401` — chave errada ou com espaço sobrando no `.env`.
- `fetch failed` / tempo esgotado — sem internet ou ti.sgogeral.com fora do ar; ele retoma sozinho.
- `precisa do Node 18` — atualizar o Node da máquina.
