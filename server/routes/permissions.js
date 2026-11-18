const express = require('express');
const { query, pool, previewPool, closePreviewPool, isPreview } = require('../db');
const {
  requireAuth, requireRoles, signToken, publicUser, USER_SELECT, isMaster,
} = require('../middleware/auth');
const { ROLE_KEYS, PERMISSIONS, MASTER_ONLY, DEFAULTS, ALL_KEYS } = require('../permissions');

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------------
// Perfis e permissoes (somente Administrador Mestre)
// ---------------------------------------------------------------------
router.get('/', requireRoles('admin'), async (req, res) => {
  const { rows } = await query('SELECT role_key, permission, allowed FROM role_permissions');
  const matrix = {};
  ROLE_KEYS.forEach((r) => { matrix[r.key] = {}; });
  rows.forEach((r) => { if (matrix[r.role_key]) matrix[r.role_key][r.permission] = r.allowed; });
  res.json({ roles: ROLE_KEYS, permissions: PERMISSIONS, master_only: MASTER_ONLY, defaults: DEFAULTS, matrix });
});

// Salva a matriz inteira: { matrix: { technician: { 'ticket.create': true, ... }, ... } }
router.put('/', requireRoles('admin'), async (req, res) => {
  const matrix = req.body?.matrix || {};
  let changed = 0;
  for (const r of ROLE_KEYS) {
    const perms = matrix[r.key];
    if (!perms) continue;
    for (const key of ALL_KEYS) {
      if (perms[key] === undefined) continue;
      const { rowCount } = await query(
        `INSERT INTO role_permissions (role_key, permission, allowed, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (role_key, permission) DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = now()
         WHERE role_permissions.allowed IS DISTINCT FROM EXCLUDED.allowed`,
        [r.key, key, !!perms[key]]);
      changed += rowCount;
    }
  }
  res.json({ ok: true, changed });
});

// ---------------------------------------------------------------------
// Visualizacao de cargos
//   Cria uma COPIA do banco num schema separado (preview_<id do admin>),
//   cria la um usuario provisorio com o perfil escolhido e devolve um token
//   de previa. Tudo o que for feito com esse token fica so na copia; e-mail,
//   WhatsApp, avisos em tempo real e anexos ficam desligados.
// ---------------------------------------------------------------------
async function buildPreviewSchema(schema) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.query(`CREATE SCHEMA ${schema}`);
    const { rows: tables } = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
    for (const { table_name: t } of tables) {
      await client.query(
        `CREATE TABLE ${schema}."${t}" (LIKE public."${t}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
      await client.query(`INSERT INTO ${schema}."${t}" SELECT * FROM public."${t}"`);
    }
    // sequencias proprias (para nao consumir a numeracao do banco real)
    const { rows: cols } = await client.query(
      `SELECT table_name, column_name, column_default FROM information_schema.columns
       WHERE table_schema = $1 AND column_default LIKE 'nextval(%'`, [schema]);
    for (const c of cols) {
      const seq = `${c.table_name}_${c.column_name}_seq`.slice(0, 60);
      await client.query(`CREATE SEQUENCE ${schema}."${seq}"`);
      await client.query(
        `SELECT setval('${schema}."${seq}"', COALESCE((SELECT max("${c.column_name}") FROM ${schema}."${c.table_name}"), 0) + 1, false)`);
      await client.query(
        `ALTER TABLE ${schema}."${c.table_name}" ALTER COLUMN "${c.column_name}" SET DEFAULT nextval('${schema}."${seq}"')`);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

router.post('/preview', requireRoles('admin'), async (req, res) => {
  if (isPreview()) return res.status(422).json({ error: 'Você já está numa prévia.' });
  const roleKey = String(req.body?.role_key || '');
  const role = ROLE_KEYS.find((r) => r.key === roleKey);
  if (!role) return res.status(422).json({ error: 'Escolha o perfil.' });
  const entityId = req.body?.entity_id ? parseInt(req.body.entity_id, 10) : null;
  let locationId = req.body?.location_id ? parseInt(req.body.location_id, 10) : null;
  if (entityId && !locationId) {
    // sem posto escolhido: usa o primeiro posto da empresa (se houver)
    const l = await query('SELECT id FROM locations WHERE entity_id = $1 AND active ORDER BY name LIMIT 1', [entityId]);
    if (l.rows.length) locationId = l.rows[0].id;
  }
  if (['admin_local', 'manager', 'user'].includes(roleKey) && !entityId) {
    return res.status(422).json({ error: 'Escolha a empresa para ver como este perfil.' });
  }
  const schema = `preview_${parseInt(req.user.id, 10)}`;
  try {
    await closePreviewPool(schema);
    await buildPreviewSchema(schema);
    const p = previewPool(schema);
    const { rows } = await p.query(
      `INSERT INTO users (username, password_hash, name, email, role, client_level, entity_id, location_id, active)
       VALUES ($1, '!', $2, NULL, $3, $4, $5, $6, TRUE) RETURNING id`,
      [`previa_${roleKey}_${Date.now()}`, `Prévia: ${role.label}`, role.role, role.client_level || 1,
       entityId, locationId]);
    const full = await p.query(`${USER_SELECT} WHERE u.id = $1`, [rows[0].id]);
    const u = full.rows[0];
    u.preview = { schema, role_label: role.label };
    const token = signToken(u, { preview: schema, preview_admin: req.user.id, preview_label: role.label });
    res.status(201).json({ token, user: publicUser(u) });
  } catch (e) {
    console.error('[preview]', e);
    res.status(500).json({ error: 'Não foi possível criar a prévia.', details: e.message });
  }
});

// Encerra a previa e apaga a copia
router.delete('/preview', async (req, res) => {
  // chamado com o token real do admin (ou com o proprio token de previa)
  const adminId = req.user.preview ? req.user.preview.admin_id : req.user.id;
  if (!req.user.preview && !isMaster(req.user)) return res.status(403).json({ error: 'Permissão negada.' });
  const schema = `preview_${parseInt(adminId, 10)}`;
  await closePreviewPool(schema);
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  res.json({ ok: true });
});

module.exports = router;
