// Prepara um banco NOVO da Central para subir num servidor (ex.: Render), sem dados de demonstração.
//
// O `npm run init` da Central não serve para banco vazio: o schema.sql faz
// ALTER TABLE assets antes de a tabela existir (ela nasce no _migrate_inventory.js),
// e o seed cria usuários com senha padrão (admin/admin123), que não podem ir para a internet.
//
// Ordem: parte do schema.sql anterior ao inventário -> _migrate_inventory.js -> schema.sql inteiro.
// Idempotente: em banco que já tem a tabela "assets", só reaplica o schema.sql (CREATE/ALTER IF NOT EXISTS).
// Depois grava as permissões e configurações padrão que ainda não existem (nunca sobrescreve)
// e apaga as cópias temporárias da Visualização de cargos, como o init.js faz.
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

  // Configurações padrão (as mesmas do seed do init.js). Sem elas, cada opção que falta vale
  // "desligado" (voz, avisos, aprovação ao resolver...). Só grava o que falta: o que foi
  // salvo em Configurações nunca é sobrescrito. O e-mail do administrador fica de fora
  // (no seed ele é um endereço de exemplo).
  const padroes = {
    'app.name': 'Central de Serviços',
    'app.logo': '',
    'app.background': '',
    'app.notify_email': 'true',
    'app.notify_whatsapp': 'false',
    'app.voice_enabled': 'true',
    'app.voice_new_ticket': 'true',
    'app.refresh_interval': '30000',
    'app.notify_techs_new': 'true',
    'app.notify_clients': 'true',
    'app.approval_on_solve': 'true',
  };
  const conf = await pool.query(
    `INSERT INTO settings (key, value)
     SELECT * FROM unnest($1::text[], $2::text[])
     ON CONFLICT (key) DO NOTHING`,
    [Object.keys(padroes), Object.values(padroes)]);
  if (conf.rowCount) console.log(`[instalar-banco] Configurações padrão gravadas: ${conf.rowCount}.`);

  // Cópias da "Visualização de cargos" que ficaram abertas (schemas preview_N): são
  // temporárias e não servem depois que o servidor reinicia. O init.js faz o mesmo.
  const previas = await pool.query("SELECT nspname FROM pg_namespace WHERE nspname ~ '^preview_[0-9]+$'");
  for (const r of previas.rows) await pool.query(`DROP SCHEMA IF EXISTS ${r.nspname} CASCADE`);
  if (previas.rows.length) console.log(`[instalar-banco] Prévias antigas apagadas: ${previas.rows.length}.`);

  console.log('[instalar-banco] Banco pronto (sem dados de demonstração).');
  await pool.end();
})().catch((e) => {
  console.error('[instalar-banco] ERRO:', e.message);
  process.exit(1);
});
