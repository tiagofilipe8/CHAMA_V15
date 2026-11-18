# Orcim Inventário

Módulo nativo de gestão de ativos (hardware/software) da Central de Serviços.

## Conceitos

- **Ativo**: equipamento ou item patrimonial vinculado a uma **entidade** (cliente)
- **Agente**: processo Windows que coleta dados do PC e envia via API
- **Snapshot**: inventário enviado em FULL ou INCREMENTAL
- **Histórico**: trilha de mudanças (hardware, software, transferência, fotos)

Fotos ficam no **ativo** (não no cliente) e acompanham transferências de entidade.

## Fluxo

1. Admin/técnico cria ativo **ou** provisiona token de agente
2. Agente Windows registra (`POST /api/inventory/agents/register`) e cria vínculo com ativo
3. Heartbeat periódico + inventário FULL/INCREMENTAL
4. Backend grava `computer_details`, memória, discos, GPU, rede, software e histórico

## API (resumo)

| Método | Rota | Auth |
|--------|------|------|
| GET | `/api/inventory/assets` | usuário |
| POST | `/api/inventory/assets` | usuário |
| GET/PATCH/DELETE | `/api/inventory/assets/:id` | usuário |
| POST | `/api/inventory/assets/:id/photos` | usuário |
| POST | `/api/inventory/assets/:id/transfer` | usuário |
| POST | `/api/inventory/agents/provision` | usuário |
| GET | `/api/inventory/agents` | usuário |
| POST | `/api/inventory/agents/register` | provision token |
| POST | `/api/inventory/agents/heartbeat` | agent token |
| GET | `/api/inventory/agents/config` | agent token |
| POST | `/api/inventory/agents/inventory` | agent token |

## Isolamento por cliente

- Cliente (gestor nível 2) vê apenas ativos da própria entidade
- Upload/foto/transferência exigem `canAccessEntity`
- Técnico/admin acessam todas as entidades

## Segurança do agente

- Provision token: SHA-256 no banco, expira em 24h
- Agent token: SHA-256, revogável (`agent_credentials.revoked`)
- Identidade estável: SHA-256(MachineGuid + serial BIOS + MACs)

## UI

- `#/inventory` — grade de ativos (filtros, busca)
- `#/inventory/:id` — detalhe (hardware, fotos, OS, histórico)
- `#/inventory/agents` — status dos agentes
- Botão **Gerar token Agent** no detalhe do ativo
- Select de ativo em **Novo Chamado** e **Editar OS**

## Agente Windows

Ver [`agent/README.md`](../agent/README.md).
