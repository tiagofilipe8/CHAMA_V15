# Agente PowerShell (sem Node.js)

Alternativa 100% PowerShell ao `agent.js`. Coleta WMI/CIM e fala com a mesma API.

## Requisitos

- Windows 10/11 ou Server 2016+
- **PowerShell 5.1+** (ja vem no Windows)
- **Node.js NAO e necessario**
- Admin apenas para instalar como **servico** (sem admin: usa atalho no logon)

## Arquivos

| Arquivo | Papel |
|---------|--------|
| `Agente.ps1` | Agente (register, heartbeat, inventario, fila) |
| `Install-Agente.ps1` | Instalador (servico / files / uninstall) |
| `instalar-ps.bat` | Atalho amigavel do instalador |
| `desinstalar-ps.bat` | Atalho amigavel do desinstalador |

## Como obter o provision token

1. Abra a UI: `http://localhost:7070`
2. `Inventario` > `Agentes`
3. Botao **Provisionar** (entidade alvo)
4. Copie o token formato `1-XXXXXX-XXXXXX`

O token expira em 24h. Depois do register ele sai do config.

## Instalacao com servico (Admin)

Botao direito em `instalar-ps.bat` > **Executar como administrador**

Ou:

```powershell
# PowerShell como Administrador
cd <pasta agent>
powershell -ExecutionPolicy Bypass -File .\Install-Agente.ps1 `
  -ServerUrl "http://localhost:7070" `
  -ProvisionToken "1-XXXXXX-XXXXXX"
```

Cria servico `OrcimInventoryAgent` (auto start + recuperacao em falha).
Nesse modo o atalho de Startup e removido para evitar dupla execucao.

## Sem Admin (arquivos + logon)

```powershell
powershell -ExecutionPolicy Bypass -File .\Install-Agente.ps1 -FilesOnly `
  -ServerUrl "http://localhost:7070" `
  -ProvisionToken "1-XXXXXX-XXXXXX"

# Testar 1 ciclo agora (sem Admin o caminho e LOCALAPPDATA)
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Orcim\AgentPS\Agente.ps1" -Once
# com Admin:
powershell -ExecutionPolicy Bypass -File "C:\Program Files\Orcim\AgentPS\Agente.ps1" -Once
```

Cria atalho na **Inicializacao** do usuario (`OrcimInventoryAgent.vbs`) -> roda oculto a cada logon.
Sem Admin os arquivos vao para `%LOCALAPPDATA%\Orcim\AgentPS`.

## Teste rapido (sem instalar)

```powershell
# na pasta agent\
powershell -ExecutionPolicy Bypass -File .\Agente.ps1 -Once
```

## Config

`%ProgramData%\Orcim\agent\config.json` (sem BOM):

```json
{
  "server_url": "http://localhost:7070",
  "provision_token": "1-XXXXXX-XXXXXX",
  "interval_seconds": 900,
  "inventory_interval_seconds": 3600
}
```

Estado: `%ProgramData%\Orcim\agent\state.json`  
Log: `%ProgramData%\Orcim\logs\agent-ps.log`  
Fila: `%ProgramData%\Orcim\queue\`

## O que coleta

Mesmo do agente Node:

- OS, CPU, memoria, discos, GPU, rede, placa-mae, BIOS
- Software (registro `Uninstall`)
- Identidade: MachineGuid + serial + MAC -> SHA-256

## Ciclo

1. Register (provision token, 24h) -> cria ativo
2. Heartbeat a cada `interval_seconds` (padrao 15 min)
3. FULL a cada 24h; INCREMENTAL entre FULLs
4. Offline -> fila JSON; reenvio no proximo ciclo

## Desinstalar

```powershell
# Admin
powershell -ExecutionPolicy Bypass -File .\Install-Agente.ps1 -Uninstall
```

Ou botao direito em `desinstalar-ps.bat` > Executar como administrador.

## Comparacao

| | `Agente.ps1` | `agent.js` |
|--|--------------|------------|
| Runtime | PowerShell | Node.js 18+ |
| Dependencias | nenhuma | npm zero-dep (nativo) |
| Servico | `powershell.exe -File` | `node.exe agent.js` |
| API / schema | iguais | iguais |
| Fila offline | iguais | iguais |
