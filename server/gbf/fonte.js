// De onde o painel LÊ os dados da Central (tickets, entities, users, assets...).
//
// - Sem ORCIM_DB_URL: o painel roda dentro da própria Central e lê o mesmo banco (padrão).
// - Com ORCIM_DB_URL: o painel roda num servidor nosso (ex.: ti.sgogeral.com) e lê o banco
//   da Orcim por uma conexão separada, SOMENTE LEITURA. As tabelas gbf_* ficam no banco local.
//   ORCIM_DB_SSL=1 liga SSL (sem validar certificado) quando o banco da Orcim exigir.
//
// Como os dois bancos podem ser diferentes, nenhuma consulta pode juntar (JOIN) tabela da
// Central com tabela gbf_*: cada lado é consultado à parte e o resultado é combinado em JS.
const { Pool } = require('pg');
const db = require('../db');

const URL_EXTERNA = process.env.ORCIM_DB_URL || '';
const externa = !!URL_EXTERNA;

let pool = db.pool;
if (externa) {
  pool = new Pool({
    connectionString: URL_EXTERNA,
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: process.env.ORCIM_DB_SSL === '1' ? { rejectUnauthorized: false } : undefined,
  });
  pool.on('error', (err) => console.error('[gbf] banco da Orcim:', err.message));
  // Garantia extra além do usuário somente leitura: toda sessão nasce em modo leitura
  pool.on('connect', (c) => c.query('SET default_transaction_read_only = on').catch(() => {}));
}

const queryCentral = (text, params) => pool.query(text, params);

async function statusCentral() {
  if (!externa) return { externa: false, ok: true };
  try {
    const { rows } = await pool.query('SELECT count(*)::int AS chamados FROM tickets');
    return { externa: true, ok: true, chamados: rows[0].chamados };
  } catch (e) {
    return { externa: true, ok: false, erro: e.message };
  }
}

module.exports = { queryCentral, centralExterna: externa, statusCentral };
