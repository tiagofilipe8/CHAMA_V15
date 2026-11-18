// =====================================================================
// Integração Central -> Painel Beija-Flor (ti.sgogeral.com)
//
// O QUE FAZ: a cada minuto envia ao painel do Grupo Beija-Flor uma cópia do que mudou em
// TODAS as tabelas do banco da Central (descobertas automaticamente, inclusive as criadas no
// futuro). Só LÊ o banco e só faz conexões de SAÍDA: não altera nada aqui, não abre porta e
// funciona com a Central num computador local.
//
// O QUE NÃO VAI: senhas, hashes, tokens, chaves e segredos (por nome de coluna), e-mail e
// telefone de usuários, destinatários do log de notificações, tabela de credenciais dos
// agentes e valores de configuração com nome de senha/token.
//
// COMO LIGAR (no .env da Central):
//   GBF_SYNC_URL=https://ti.sgogeral.com/api/gbf/sync
//   GBF_SYNC_TOKEN=<chave enviada pelo Grupo Beija-Flor>
// Sem essas variáveis o módulo não faz nada.
// Opcionais: GBF_SYNC_INTERVALO_S (60), GBF_SYNC_COMPLETO_H (6), GBF_SYNC_EXCLUIR (tabelas a mais, separadas por vírgula).
//
// Instalação: uma linha no server/index.js -> require('./integracao-beijaflor').iniciar();
// =====================================================================
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { query } = require('../db');

const VERSAO = 2;
const URL_DESTINO = (process.env.GBF_SYNC_URL || '').replace(/\/$/, '');
const TOKEN = process.env.GBF_SYNC_TOKEN || '';
const INTERVALO_MS = Math.max(15, Number(process.env.GBF_SYNC_INTERVALO_S) || 60) * 1000;
const COMPLETO_MS = Math.max(0.01, Number(process.env.GBF_SYNC_COMPLETO_H) || 6) * 3600e3;
const TIPO = 'application/x-gbf-sync+json';
const MAX_LOTE_LINHAS = 500;
const MAX_LOTE_BYTES = 3 * 1024 * 1024; // lotes até ~3 MB de JSON
const MAX_ARQUIVO = 8 * 1024 * 1024;

// ---------------------------------------------------------------- Privacidade
const TABELAS_FORA = new Set(['agent_credentials', 'session', 'sessions',
  ...String(process.env.GBF_SYNC_EXCLUIR || '').split(',').map((s) => s.trim()).filter(Boolean)]);
const COLUNA_SENSIVEL = /(password|passwd|senha|token|secret|segredo|hash|api_?key|credential|private_?key|smtp|(^|[._])pass($|[._]))/i;
const COLUNAS_PESSOAIS = { users: ['email', 'phone'], notification_log: ['recipient'] };
// Tabelas chave/valor: o VALOR some quando a chave tem nome de segredo
const CHAVE_VALOR = { settings: { chave: 'key', valor: 'value' } };

const colunaEnviada = (tabela, coluna) => !COLUNA_SENSIVEL.test(coluna) && !(COLUNAS_PESSOAIS[tabela] || []).includes(coluna);

function limparLinha(tabela, linha) {
  const kv = CHAVE_VALOR[tabela];
  if (kv && COLUNA_SENSIVEL.test(String(linha[kv.chave] || ''))) linha[kv.valor] = '(oculto pela integração)';
  for (const [k, v] of Object.entries(linha)) {
    if (v instanceof Date) linha[k] = v.toISOString();
    else if (Buffer.isBuffer(v)) delete linha[k]; // binário não vai
  }
  return linha;
}

// ---------------------------------------------------------------- Descoberta
async function descobrirTabelas() {
  const { rows } = await query(
    `SELECT c.relname AS nome,
            (SELECT json_agg(json_build_object('nome', a.attname, 'tipo', format_type(a.atttypid, a.atttypmod)) ORDER BY a.attnum)
               FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS colunas,
            (SELECT json_agg(a.attname ORDER BY k.ord)
               FROM pg_index i
               CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
              WHERE i.indrelid = c.oid AND i.indisprimary) AS pk
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT LIKE 'gbf\\_%'
     ORDER BY c.relname`);
  const tabelas = rows
    .filter((t) => !TABELAS_FORA.has(t.nome) && Array.isArray(t.pk) && t.pk.length)
    .map((t) => {
      const colunas = t.colunas.filter((c) => colunaEnviada(t.nome, c.nome) || t.pk.includes(c.nome));
      const nomes = colunas.map((c) => c.nome);
      const idInteiro = t.pk.length === 1 && /^(integer|bigint|smallint)$/.test(t.colunas.find((c) => c.nome === t.pk[0])?.tipo || '');
      let modo = 'completo';                              // só na conferência completa
      if (nomes.includes('updated_at')) modo = 'alteracao'; // o que mudou desde o último envio
      else if (idInteiro) modo = 'novos';                  // registros novos (edições na conferência)
      return { nome: t.nome, colunas, pk: t.pk, modo };
    });
  return emOrdemDeDependencia(tabelas);
}

// Pais antes dos filhos (chaves estrangeiras), para o painel conseguir gravar na ordem
async function emOrdemDeDependencia(tabelas) {
  const { rows } = await query(
    `SELECT c.conrelid::regclass::text AS filho, c.confrelid::regclass::text AS pai
     FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid <> c.confrelid`);
  const nomes = new Set(tabelas.map((t) => t.nome));
  const pais = new Map(tabelas.map((t) => [t.nome, new Set()]));
  for (const r of rows) {
    const filho = r.filho.replace(/^public./, '').replace(/"/g, '');
    const pai = r.pai.replace(/^public./, '').replace(/"/g, '');
    if (nomes.has(filho) && nomes.has(pai)) pais.get(filho).add(pai);
  }
  const saida = [];
  const visitado = new Set();
  const visitar = (nome, pilha = new Set()) => {
    if (visitado.has(nome) || pilha.has(nome)) return; // ciclo: segue a ordem alfabética
    pilha.add(nome);
    for (const p of pais.get(nome)) visitar(p, pilha);
    visitado.add(nome);
    saida.push(tabelas.find((t) => t.nome === nome));
  };
  for (const t of tabelas) visitar(t.nome);
  return saida;
}

// ---------------------------------------------------------------- Envio
async function chamar(metodo, rota, corpo) {
  const r = await fetch(`${URL_DESTINO}${rota}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Integracao-Versao': String(VERSAO), ...(corpo ? { 'Content-Type': TIPO } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${rota}: HTTP ${r.status} ${j.error || ''}`.trim());
  return j;
}

// Manda linhas em lotes que respeitam limite de quantidade e de tamanho
async function enviarLinhas(t, linhas) {
  let lote = [];
  let bytes = 0;
  const despachar = async () => {
    if (!lote.length) return;
    await chamar('POST', '/lote', { tabela: t.nome, pk: t.pk, linhas: lote });
    lote = []; bytes = 0;
  };
  for (const l of linhas) {
    const tam = Buffer.byteLength(JSON.stringify(l));
    if (lote.length && (bytes + tam > MAX_LOTE_BYTES || lote.length >= MAX_LOTE_LINHAS)) await despachar();
    lote.push(l); bytes += tam;
  }
  await despachar();
}

const selecionar = (t) => t.colunas.map((c) => `"${c.nome}"`).join(', ');
const ordem = (t) => t.pk.map((c) => `"${c}"`).join(', ');

async function enviarIncremental(t, cursor) {
  let total = 0;
  if (t.modo === 'alteracao') {
    // _cursor: updated_at com microssegundos (o Date do JS corta em ms)
    for (let pagina = 0; pagina < 1000; pagina += 1) {
      const { rows } = await query(
        `SELECT ${selecionar(t)}, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS _cursor
         FROM "${t.nome}" WHERE ($1::timestamptz IS NULL OR updated_at > $1::timestamptz)
         ORDER BY updated_at, ${ordem(t)} LIMIT ${MAX_LOTE_LINHAS} OFFSET $2`,
        [cursor?.ts || null, pagina * MAX_LOTE_LINHAS]);
      if (!rows.length) break;
      await enviarLinhas(t, rows.map((r) => limparLinha(t.nome, r)));
      await enviarArquivos(t.nome, rows);
      total += rows.length;
      if (rows.length < MAX_LOTE_LINHAS) break;
    }
  } else if (t.modo === 'novos') {
    let ultimo = Number(cursor?.id || 0);
    for (let volta = 0; volta < 1000; volta += 1) {
      const { rows } = await query(
        `SELECT ${selecionar(t)} FROM "${t.nome}" WHERE "${t.pk[0]}" > $1 ORDER BY "${t.pk[0]}" LIMIT ${MAX_LOTE_LINHAS}`, [ultimo]);
      if (!rows.length) break;
      await enviarLinhas(t, rows.map((r) => limparLinha(t.nome, r)));
      await enviarArquivos(t.nome, rows);
      total += rows.length;
      ultimo = Number(rows[rows.length - 1][t.pk[0]]);
      if (rows.length < MAX_LOTE_LINHAS) break;
    }
  }
  return total;
}

// Conferência completa: reenvia tudo das tabelas sem data de alteração (pega edições)
// e manda a lista de chaves de todas, para o painel apagar o que sumiu daqui
async function conferenciaCompleta(tabelas) {
  const chaves = {};
  for (const t of tabelas) {
    {
      // tabelas com data de alteração só reenviam as linhas sem data (o incremental não as vê)
      const filtro = t.modo === 'alteracao' ? 'WHERE updated_at IS NULL' : '';
      for (let pagina = 0; pagina < 1000; pagina += 1) {
        const { rows } = await query(
          `SELECT ${selecionar(t)} FROM "${t.nome}" ${filtro} ORDER BY ${ordem(t)} LIMIT ${MAX_LOTE_LINHAS} OFFSET $1`, [pagina * MAX_LOTE_LINHAS]);
        if (!rows.length) break;
        await enviarLinhas(t, rows.map((r) => limparLinha(t.nome, r)));
        if (rows.length < MAX_LOTE_LINHAS) break;
      }
    }
    const { rows } = await query(`SELECT ${t.pk.map((c) => `"${c}"::text AS "${c}"`).join(', ')} FROM "${t.nome}"`);
    chaves[t.nome] = rows.map((r) => t.pk.map((c) => r[c]).join('|'));
  }
  return chamar('POST', '/completo', { chaves });
}

// Arquivos em disco: anexos de chamados e fotos de equipamentos
const ARQUIVOS = {
  ticket_attachments: (l) => path.join('tickets', String(l.ticket_id), path.basename(String(l.storage_path || ''))),
  asset_photos: (l) => path.join('assets', String(l.asset_id), path.basename(String(l.storage_path || ''))),
};
async function enviarArquivos(tabela, linhas) {
  const caminho = ARQUIVOS[tabela];
  if (!caminho) return;
  for (const l of linhas) {
    const relativo = caminho(l);
    try {
      const arq = path.join(config.uploadsDir, relativo);
      if (fs.statSync(arq).size > MAX_ARQUIVO) continue;
      await chamar('POST', '/arquivo', { caminho: relativo.split(path.sep).join('/'), base64: fs.readFileSync(arq).toString('base64') });
    } catch { /* arquivo ausente no disco: segue */ }
  }
}

let enviando = false;
async function ciclo() {
  if (enviando) return;
  enviando = true;
  try {
    const tabelas = await descobrirTabelas();
    const estado = await chamar('GET', '/estado');
    await chamar('POST', '/esquema', {
      versao: VERSAO,
      tabelas: tabelas.map((t) => ({ nome: t.nome, pk: t.pk, modo: t.modo, colunas: t.colunas })),
    });
    let total = 0;
    for (const t of tabelas) {
      // uma tabela com problema não trava as outras
      try { total += await enviarIncremental(t, estado.cursores?.[t.nome]); } catch (e) { console.error(`[integracao-beijaflor] ${t.nome}: ${e.message}`); }
    }
    const ultimo = estado.completo_em ? new Date(estado.completo_em).getTime() : 0;
    if (Date.now() - ultimo > COMPLETO_MS) {
      const r = await conferenciaCompleta(tabelas);
      console.log(`[integracao-beijaflor] conferência completa enviada (${tabelas.length} tabelas)${Object.keys(r.apagados || {}).length ? `; removidos no painel: ${JSON.stringify(r.apagados)}` : ''}`);
    }
    if (total) console.log(`[integracao-beijaflor] ${total} registro(s) enviados ao painel.`);
  } catch (e) {
    console.error('[integracao-beijaflor] envio falhou:', e.message);
  } finally {
    enviando = false;
  }
}

let timer = null;
function iniciar() {
  if (timer || !URL_DESTINO || !TOKEN) return;
  if (typeof fetch !== 'function') {
    console.error('[integracao-beijaflor] precisa do Node 18 ou mais novo (fetch). Envio desligado.');
    return;
  }
  console.log(`[integracao-beijaflor] enviando os dados da Central para ${URL_DESTINO} a cada ${INTERVALO_MS / 1000}s`);
  setTimeout(ciclo, 8000);
  timer = setInterval(ciclo, INTERVALO_MS);
  if (timer.unref) timer.unref();
}

module.exports = { iniciar, ciclo, descobrirTabelas, VERSAO };
