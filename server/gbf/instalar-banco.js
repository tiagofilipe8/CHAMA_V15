// Prepara um banco NOVO da Central para subir num servidor (ex.: Render), sem dados de demonstração.
//
// O `npm run init` da Central não serve para banco vazio: o schema.sql faz
// ALTER TABLE assets antes de a tabela existir (ela nasce no _migrate_inventory.js),
// e o seed cria usuários com senha padrão (admin/admin123), que não podem ir para a internet.
//
// Ordem: parte do schema.sql anterior ao inventário -> _migrate_inventory.js -> schema.sql inteiro.
// Idempotente: em banco que já tem a tabela "assets", só reaplica o schema.sql (CREATE/ALTER IF NOT EXISTS).
// Uso: node server/gbf/instalar-banco.js && node server/index.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pool } = require('../db');

const RAIZ = path.join(__dirname, '..', '..');

(async () => {
  const sql = fs.readFileSync(path.join(RAIZ, 'server', 'schema.sql'), 'utf8');
  const { rows } = await pool.query(`SELECT to_regclass('public.assets') AS t`);
  if (!rows[0].t) {
    console.log('[instalar-banco] Banco novo: criando tabelas da Central...');
    await pool.query(sql.split('-- Migracao: data programada')[0]);
    execFileSync(process.execPath, ['_migrate_inventory.js'], { cwd: RAIZ, stdio: 'inherit' });
  }
  await pool.query(sql);
  console.log('[instalar-banco] Banco pronto (sem dados de demonstração).');
  await pool.end();
})().catch((e) => {
  console.error('[instalar-banco] ERRO:', e.message);
  process.exit(1);
});
