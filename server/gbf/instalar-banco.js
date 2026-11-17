// Prepara um banco NOVO da Central para subir num servidor (ex.: Render), sem dados de demonstração.
//
// O `npm run init` da Central não serve para banco vazio: o schema.sql faz
// ALTER TABLE assets antes de a tabela existir (ela nasce no _migrate_inventory.js),
// e o seed cria usuários com senha padrão (admin/admin123), que não podem ir para a internet.
//
// Ordem: parte do schema.sql anterior ao inventário -> _migrate_inventory.js -> schema.sql inteiro.
// Idempotente: em banco que já tem a tabela "assets", só reaplica o schema.sql (CREATE/ALTER IF NOT EXISTS).
// Depois grava as permissões padrão dos perfis que ainda não existem (nunca sobrescreve).
// Uso: node server/gbf/instalar-banco.js && node server/index.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pool } = require('../db');
const { ROLE_KEYS, ALL_KEYS, DEFAULTS } = require('../permissions');

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

  // Permissões padrão de cada perfil (Perfis e permissões). Sem elas, só o administrador
  // mestre consegue usar a Central. Só insere o que falta: o que já foi marcado ou
  // desmarcado na tela nunca é sobrescrito (mesma regra do ensurePermissions do init.js).
  const perfis = [];
  const permissoes = [];
  const liberado = [];
  for (const r of ROLE_KEYS) {
    for (const perm of ALL_KEYS) {
      perfis.push(r.key);
      permissoes.push(perm);
      liberado.push((DEFAULTS[r.key] || []).includes(perm));
    }
  }
  const novas = await pool.query(
    `INSERT INTO role_permissions (role_key, permission, allowed)
     SELECT * FROM unnest($1::text[], $2::text[], $3::boolean[])
     ON CONFLICT (role_key, permission) DO NOTHING`,
    [perfis, permissoes, liberado]);
  if (novas.rowCount) console.log(`[instalar-banco] Permissões padrão gravadas: ${novas.rowCount}.`);

  console.log('[instalar-banco] Banco pronto (sem dados de demonstração).');
  await pool.end();
})().catch((e) => {
  console.error('[instalar-banco] ERRO:', e.message);
  process.exit(1);
});
