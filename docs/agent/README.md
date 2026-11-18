# Orcim Inventory Agent

Agente Windows sem dependências npm. Coleta via PowerShell/CIM e fala com `/api/inventory/agents/*`.

## Arquivos

| Arquivo | Papel |
|---------|--------|
| `agent.js` | Loop principal (register → heartbeat → inventário → fila) |
| `identity.js` | MachineGuid, fingerprint, `state.json`, `config.json` |
| `collect.js` | WMI/CIM: OS, CPU, RAM, discos, GPU, rede, BIOS, software |
| `http.js` | Cliente HTTP(S) nativo do Node |
| `queue.js` | Fila offline em `%ProgramData%\Orcim\queue` |
| `ps.js` | Execução de PowerShell com timeout |
| `logger.js` | Log em `%ProgramData%\Orcim\logs\agent.log` |
| `install.ps1` | Instala/desinstala serviço Windows |

## Instalação rápida

```powershell
# 1) Gere token na UI: Inventário > detalhe do ativo > Gerar token Agent
# 2) Instale
powershell -ExecutionPolicy Bypass -File agent\install.ps1 `
  -ServerUrl "http://localhost:3000" `
  -ProvisionToken "1-XXXXXX-XXXXXX"
```

Sem token:

```powershell
powershell -ExecutionPolicy Bypass -File agent\install.ps1 -FilesOnly
# edite C:\ProgramData\Orcim\agent\config.json
Restart-Service OrcimInventoryAgent
```

## Config (`%ProgramData%\Orcim\agent\config.json`)

```json
{
  "server_url": "http://localhost:3000",
  "provision_token": "1-XXXXXX-XXXXXX",
  "interval_seconds": 900,
  "inventory_interval_seconds": 3600
}
```

Após o register, `provision_token` é limpo e o `agent_token` vai para `state.json`.

## Ciclo de vida

1. **Register** (uma vez) com provision token → cria agente + ativo automático
2. **Heartbeat** a cada `interval_seconds` (padrão 15 min)
3. **FULL** na primeira vez e a cada 24h
4. **INCREMENTAL** entre FULLs
5. Offline → payloads na fila; reenvio no próximo ciclo
6. Token 401 → limpa token e re-registra se houver novo provision

## Coleta

- OS: `Win32_OperatingSystem` (caption, build, arch, last_boot)
- CPU: `Win32_Processor`
- RAM: `Win32_PhysicalMemory` (slot, GB, MHz, DDRn)
- Discos: `Win32_DiskDrive` + partições (HDD/SSD, interface, serial)
- GPU: `Win32_VideoController` (VRAM normalizada para GB)
- Rede: `Win32_NetworkAdapterConfiguration` (IP enabled)
- Placa-mãe/BIOS: `Win32_BaseBoard`, `Win32_BIOS`
- Software: chaves de registro `Uninstall` (evita `Win32_Product`/MSI repair)

## Desinstalar

```powershell
powershell -ExecutionPolicy Bypass -File agent\install.ps1 -Uninstall
```

## Teste em console

```powershell
cd agent
node agent.js
```

Logs: `C:\ProgramData\Orcim\logs\agent.log`
