# Orcim Inventory Agent

Agente Windows que coleta inventário de hardware/software via WMI/CIM e envia para a Central de Serviços.

## Requisitos

- Windows 10/11 ou Server 2016+
- Node.js 18+
- Acesso de rede até a Central (`http://localhost:3000` ou URL da implantação)
- Permissão de Administrador para instalar como serviço

## Instalação

```powershell
# A partir da pasta agent\
powershell -ExecutionPolicy Bypass -File install.ps1 -ServerUrl "http://localhost:3000" -ProvisionToken "1-XXXXXX-XXXXXX"
```

Sem token ainda? Instale só os arquivos e configure depois:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -FilesOnly
```

## Provisionamento

1. Na UI: **Inventário → Agentes → Provisionar** (ou no detalhe do ativo: **Gerar token**)
2. Copie o token (formato `1-A1B2C3-D4E5F6`)
3. Cole em `%ProgramData%\Orcim\agent\config.json`:

```json
{
  "server_url": "http://localhost:3000",
  "provision_token": "1-A1B2C3-D4E5F6",
  "interval_seconds": 900,
  "inventory_interval_seconds": 3600
}
```

4. Reinicie o serviço:

```powershell
Restart-Service OrcimInventoryAgent
```

Após o registro, o `provision_token` é limpo do config e um `agent_token` permanente é gravado em `state.json`.

## O que coleta

| Área | Fonte |
|------|--------|
| OS (edição, build, último boot) | `Win32_OperatingSystem` |
| CPU (núcleos, threads, clock) | `Win32_Processor` |
| Memória (slots, capacidade, tipo) | `Win32_PhysicalMemory` |
| Discos (capacidade, interface, serial) | `Win32_DiskDrive` + partições |
| GPU (modelo, driver, VRAM) | `Win32_VideoController` |
| Rede (MAC, IP, velocidade) | `Win32_NetworkAdapterConfiguration` |
| Placa-mãe / BIOS | `Win32_BaseBoard`, `Win32_BIOS` |
| Software instalado | Registro `Uninstall` (não usa `Win32_Product`) |
| Identidade | `MachineGuid` + serial BIOS + MACs (SHA-256) |

## Comportamento

- **Heartbeat** a cada `interval_seconds` (padrão 15 min)
- **Inventário FULL** na primeira execução e depois a cada 24h
- **Inventário INCREMENTAL** entre FULLs (a cada `inventory_interval_seconds`)
- **Fila offline**: se o servidor estiver fora, payloads ficam em `%ProgramData%\Orcim\queue` e são reenviados no próximo ciclo
- **Logs**: `%ProgramData%\Orcim\logs\agent.log`

## Desinstalação

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
```

## Execução em console (teste)

```powershell
node agent.js
```

## Segurança

- Token de provisionamento: SHA-256 no banco, expira em 24h
- Token do agente: SHA-256 no banco, revogável
- Comunicação: HTTP(S) com `Authorization: Bearer`
- Não coleta senhas, cookies ou dados de usuário
