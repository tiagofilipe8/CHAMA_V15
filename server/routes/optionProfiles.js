const express = require('express');
const { query, withTransaction } = require('../db');
const { requireAuth, requireRoles } = require('../middleware/auth');

// ---------------------------------------------------------------------
// Perfis de opções (Categorias, Urgências, Causas de encerramento e Razões de retirada do estoque)
//   - "Padrão" = as opções com profile_id NULL. Não pode ser alterado.
//   - Perfil novo = cópia do Padrão, que depois pode ser editada à vontade.
//   - Cada empresa usa um perfil (entities.option_profile_id; NULL = Padrão).
//   - Apagar um perfil devolve as empresas dele ao Padrão. As opções do perfil
//     ficam guardadas (os chamados antigos continuam apontando para elas).
// ---------------------------------------------------------------------

// Perfil (id) que a empresa usa; null = Padrão. Perfil apagado conta como Padrão.
async function perfilDaEmpresa(entityId) {
  if (!entityId) return null;
  const { rows } = await query(
    `SELECT p.id FROM entities e JOIN option_profiles p ON p.id = e.option_profile_id AND p.deleted_at IS NULL
     WHERE e.id = $1`, [entityId]);
  return rows.length ? String(rows[0].id) : null;
}

// Perfil pedido pelo admin (?profile_id=): '' / 'padrao' / null = Padrão; senão precisa existir.
async function lerPerfil(valor) {
  if (valor === undefined || valor === null || valor === '' || valor === 'padrao' || valor === 'null') return { id: null };
  if (!/^\d+$/.test(String(valor))) return { error: 'Perfil de opções inválido.' };
  const { rows } = await query('SELECT id FROM option_profiles WHERE id = $1 AND deleted_at IS NULL', [valor]);
  if (!rows.length) return { error: 'Perfil de opções não encontrado.' };
  return { id: String(rows[0].id) };
}

// Trecho SQL "a opção é deste perfil" (coluna profile_id da tabela do alias)
const doPerfil = (alias, idx) => `COALESCE(${alias}.profile_id, 0) = COALESCE($${idx}::bigint, 0)`;

const PADRAO_TRAVADO = 'O perfil Padrão não pode ser alterado. Crie um perfil de opções (ele começa como cópia do Padrão) e edite nele.';

// Bloqueia mudanças nas opções do Padrão. Devolve a mensagem de erro, ou null se pode mexer.
async function travaPadrao(tabela, id) {
  const { rows } = await query(`SELECT profile_id FROM ${tabela} WHERE id = $1`, [id]);
  if (!rows.length) return null; // a rota trata o "não encontrado"
  return rows[0].profile_id == null ? PADRAO_TRAVADO : null;
}

const router = express.Router();
router.use(requireAuth);

// Lista: Padrão + perfis, com as empresas que usam cada um e quantas opções têm
router.get('/', requireRoles('admin'), async (req, res) => {
  const [perfis, empresas, contagem] = await Promise.all([
    query('SELECT id, name, description, created_at FROM option_profiles WHERE deleted_at IS NULL ORDER BY name'),
    query(`SELECT e.id, e.name, e.active,
                  CASE WHEN p.id IS NULL THEN NULL ELSE e.option_profile_id END AS perfil
           FROM entities e LEFT JOIN option_profiles p ON p.id = e.option_profile_id AND p.deleted_at IS NULL
           ORDER BY e.name`),
    query(`SELECT 'cat' AS t, profile_id, count(*)::int AS n FROM categories WHERE kind = 'simple' AND active GROUP BY profile_id
           UNION ALL SELECT 'urg', profile_id, count(*)::int FROM impact_levels WHERE active GROUP BY profile_id
           UNION ALL SELECT 'cau', profile_id, count(*)::int FROM resolution_causes WHERE active GROUP BY profile_id`),
  ]);
  const conta = (pid) => {
    const c = { categorias: 0, urgencias: 0, causas: 0 };
    contagem.rows.forEach((r) => {
      if (String(r.profile_id ?? '') !== String(pid ?? '')) return;
      if (r.t === 'cat') c.categorias = r.n; else if (r.t === 'urg') c.urgencias = r.n; else c.causas = r.n;
    });
    return c;
  };
  const empresasDe = (pid) => empresas.rows.filter((e) => String(e.perfil ?? '') === String(pid ?? ''))
    .map((e) => ({ id: e.id, name: e.name, active: e.active }));
  res.json([
    { id: null, name: 'Padrão', padrao: true, description: 'Opções originais do sistema. Não pode ser alterado.',
      empresas: empresasDe(null), ...conta(null) },
    ...perfis.rows.map((p) => ({ ...p, padrao: false, empresas: empresasDe(p.id), ...conta(p.id) })),
  ]);
});

// Cria um perfil novo, copiando todas as opções ativas do Padrão
router.post('/', requireRoles('admin'), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim() || null;
  if (!name) return res.status(422).json({ error: 'Dê um nome ao perfil.' });
  if (name.toLowerCase() === 'padrão' || name.toLowerCase() === 'padrao') return res.status(422).json({ error: 'Esse nome é do perfil Padrão. Escolha outro.' });
  const dup = await query('SELECT 1 FROM option_profiles WHERE deleted_at IS NULL AND lower(name) = lower($1)', [name]);
  if (dup.rows.length) return res.status(422).json({ error: 'Já existe um perfil com esse nome.' });
  try {
    const criado = await withTransaction(async (q) => {
      const { rows } = await q(
        'INSERT INTO option_profiles (name, description) VALUES ($1, $2) RETURNING *', [name, description]);
      const pid = rows[0].id;
      await q(
        `INSERT INTO categories (name, parent_id, active, kind, maps_to_id, icon, description, examples, sort_order, is_material, profile_id)
         SELECT name, NULL, TRUE, kind, maps_to_id, icon, description, examples, sort_order, is_material, $1
         FROM categories WHERE profile_id IS NULL AND kind = 'simple' AND active`, [pid]);
      await q(
        `INSERT INTO impact_levels (name, description, examples, priority, sort_order, active, profile_id)
         SELECT name, description, examples, priority, sort_order, TRUE, $1
         FROM impact_levels WHERE profile_id IS NULL AND active`, [pid]);
      await q(
        `INSERT INTO resolution_causes (name, description, sort_order, active, neutral, profile_id)
         SELECT name, description, sort_order, TRUE, neutral, $1
         FROM resolution_causes WHERE profile_id IS NULL AND active`, [pid]);
      await q(
        `INSERT INTO stock_reasons (name, description, sort_order, active, profile_id)
         SELECT name, description, sort_order, TRUE, $1
         FROM stock_reasons WHERE profile_id IS NULL AND active`, [pid]);
      return rows[0];
    });
    res.status(201).json({ ...criado, padrao: false, empresas: [] });
  } catch (err) {
    res.status(400).json({ error: 'Não foi possível criar o perfil.', details: err.message });
  }
});

// Renomeia / descrição
router.patch('/:id', requireRoles('admin'), async (req, res) => {
  const p = await lerPerfil(req.params.id);
  if (p.error) return res.status(404).json({ error: p.error });
  if (!p.id) return res.status(403).json({ error: PADRAO_TRAVADO });
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : undefined;
  if (name === '') return res.status(422).json({ error: 'O nome não pode ficar vazio.' });
  if (name && ['padrão', 'padrao'].includes(name.toLowerCase())) return res.status(422).json({ error: 'Esse nome é do perfil Padrão. Escolha outro.' });
  if (name) {
    const dup = await query('SELECT 1 FROM option_profiles WHERE deleted_at IS NULL AND lower(name) = lower($1) AND id <> $2', [name, p.id]);
    if (dup.rows.length) return res.status(422).json({ error: 'Já existe um perfil com esse nome.' });
  }
  const description = req.body?.description !== undefined ? (String(req.body.description).trim() || null) : undefined;
  const { rows } = await query(
    `UPDATE option_profiles SET name = COALESCE($2, name),
       description = CASE WHEN $3::boolean THEN $4 ELSE description END, updated_at = now()
     WHERE id = $1 RETURNING *`, [p.id, name || null, description !== undefined, description ?? null]);
  res.json(rows[0]);
});

// Apaga: as empresas voltam ao Padrão; as opções ficam guardadas para os chamados antigos
router.delete('/:id', requireRoles('admin'), async (req, res) => {
  const p = await lerPerfil(req.params.id);
  if (p.error) return res.status(404).json({ error: p.error });
  if (!p.id) return res.status(403).json({ error: 'O perfil Padrão não pode ser apagado.' });
  const emp = await query('UPDATE entities SET option_profile_id = NULL WHERE option_profile_id = $1 RETURNING name', [p.id]);
  await query('UPDATE option_profiles SET deleted_at = now() WHERE id = $1', [p.id]);
  res.json({
    ok: true,
    empresas: emp.rows.map((r) => r.name),
    message: emp.rowCount
      ? `Perfil apagado. ${emp.rowCount === 1 ? 'A empresa que usava ele voltou' : `As ${emp.rowCount} empresas que usavam ele voltaram`} para o Padrão.`
      : 'Perfil apagado.',
  });
});

module.exports = router;
module.exports.perfilDaEmpresa = perfilDaEmpresa;
module.exports.lerPerfil = lerPerfil;
module.exports.doPerfil = doPerfil;
module.exports.travaPadrao = travaPadrao;
module.exports.PADRAO_TRAVADO = PADRAO_TRAVADO;
