const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');
const config = require('./config');

const baseOptions = {
  host: config.db.host,
  port: config.db.port,
  database: config.db.name,
  user: config.db.user,
  password: config.db.password,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

const pool = new Pool(baseOptions);

pool.on('error', (err) => {
  console.error('[db] Erro inesperado no pool:', err.message);
});

// ---------------------------------------------------------------------
// Visualizacao de cargos (previa)
//   Cada previa roda numa COPIA do banco, num schema separado
//   (ex.: preview_1). As requisicoes feitas com o token de previa usam um
//   pool cujo search_path aponta para essa copia, entao nada do que acontece
//   la afeta os dados reais. O contexto da requisicao e guardado no
//   AsyncLocalStorage, e query() escolhe o pool certo sozinho.
// ---------------------------------------------------------------------
const requestContext = new AsyncLocalStorage();
const previewPools = new Map();

function previewPool(schema) {
  if (!/^preview_\d+$/.test(schema)) throw new Error('Schema de prévia inválido');
  if (!previewPools.has(schema)) {
    const p = new Pool({ ...baseOptions, max: 4, options: `-c search_path=${schema},public` });
    p.on('error', (err) => console.error('[db] Erro no pool de prévia:', err.message));
    previewPools.set(schema, p);
  }
  return previewPools.get(schema);
}

async function closePreviewPool(schema) {
  const p = previewPools.get(schema);
  if (p) {
    previewPools.delete(schema);
    await p.end().catch(() => {});
  }
}

function currentContext() {
  return requestContext.getStore() || null;
}

function isPreview() {
  return !!(currentContext() && currentContext().preview);
}

const query = (text, params) => {
  const ctx = currentContext();
  return (ctx && ctx.pool ? ctx.pool : pool).query(text, params);
};

// Executa fn(q) numa transacao (no banco certo, real ou da previa)
async function withTransaction(fn) {
  const ctx = currentContext();
  const client = await (ctx && ctx.pool ? ctx.pool : pool).connect();
  try {
    await client.query('BEGIN');
    const out = await fn((text, params) => client.query(text, params));
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  pool, query, withTransaction, requestContext, previewPool, closePreviewPool, currentContext, isPreview,
};
