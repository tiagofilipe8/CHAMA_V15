const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRoles, isStaff, has, canAccessEntity } = require('../middleware/auth');
const { perfilDaEmpresa, lerPerfil, doPerfil, travaPadrao, PADRAO_TRAVADO } = require('./optionProfiles');

const router = express.Router();
router.use(requireAuth);

// Categorias:
//   kind = 'complex' -> arvore detalhada (ex.: Rede > Problemas de conexão > DNS)
//   kind = 'simple'  -> lista facil (com icone) que aponta para uma complexa (maps_to_id).
// O chamado sempre fica gravado na categoria complexa, entao os relatorios sao iguais
// para todas as empresas; a simples e so a forma de mostrar para o usuario.

const SELECT = `
  SELECT c.*, chama_category_path(c.id) AS path,
         chama_category_path(c.maps_to_id) AS maps_to_path,
         (SELECT count(*) FROM tickets t
          WHERE (t.category_id = c.id OR t.simple_category_id = c.id) AND t.status NOT IN (6,7)) AS open_tickets
  FROM categories c`;

// Lista de um perfil de opções (?profile_id=; sem ele = Padrão) e opcionalmente ?kind=simple|complex.
// As complexas (arvore antiga) so existem no Padrao.
router.get('/', async (req, res) => {
  const { kind } = req.query;
  const p = await lerPerfil(req.query.profile_id);
  if (p.error) return res.status(404).json({ error: p.error });
  const params = [p.id];
  const conds = [doPerfil('c', 1)];
  if (kind === 'simple' || kind === 'complex') { params.push(kind); conds.push(`c.kind = $${params.length}`); }
  const { rows } = await query(`${SELECT} WHERE ${conds.join(' AND ')} ORDER BY c.kind, c.sort_order, c.name`, params);
  res.json(rows);
});

// Categorias para abrir chamado numa empresa: devolve o modo da empresa e a lista certa.
// A equipe de suporte sempre ve as complexas.
router.get('/for-entity/:entityId', async (req, res) => {
  const { entityId } = req.params;
  if (!canAccessEntity(req.user, entityId)) return res.status(403).json({ error: 'Acesso negado a esta empresa.' });
  const ent = await query('SELECT category_mode FROM entities WHERE id = $1', [entityId]);
  if (!ent.rows.length) return res.status(404).json({ error: 'Empresa não encontrada.' });
  // Só categorias simples, para todos (equipe e usuários)
  // ... do perfil de opções que a empresa usa
  const mode = 'simple';
  const perfil = await perfilDaEmpresa(entityId);
  const { rows } = await query(
    `${SELECT} WHERE c.active AND c.kind = 'simple' AND ${doPerfil('c', 1)} ORDER BY c.sort_order, c.name`, [perfil]);
  res.json({ mode, entity_mode: ent.rows[0].category_mode, profile_id: perfil, categories: rows });
});

function readBody(b = {}) {
  const txt = (v) => (v === undefined ? undefined : (v === null || String(v).trim() === '' ? null : String(v).trim()));
  return {
    name: txt(b.name),
    parent_id: b.parent_id === undefined ? undefined : (b.parent_id || null),
    active: b.active === undefined ? undefined : !!b.active,
    kind: b.kind === undefined ? undefined : (b.kind === 'simple' ? 'simple' : 'complex'),
    maps_to_id: b.maps_to_id === undefined ? undefined : (b.maps_to_id || null),
    icon: txt(b.icon),
    description: txt(b.description),
    examples: txt(b.examples),
    sort_order: b.sort_order === undefined ? undefined : (parseInt(b.sort_order, 10) || 0),
  };
}

async function validate(b, currentKind, selfId) {
  const kind = b.kind || currentKind || 'complex';
  if (kind === 'simple') {
    if (b.parent_id) return 'Categorias simples não têm categoria pai (são uma lista).';
    // categorias simples não apontam mais para complexas (o chamado grava direto nelas)
  } else {
    if (b.maps_to_id) return 'Somente categorias simples apontam para outra categoria.';
    if (b.parent_id) {
      if (selfId && String(b.parent_id) === String(selfId)) return 'Uma categoria não pode ser pai dela mesma.';
      const { rows } = await query('SELECT kind FROM categories WHERE id = $1', [b.parent_id]);
      if (!rows.length || rows[0].kind !== 'complex') return 'A categoria pai precisa ser complexa.';
      if (selfId) {
        // evita ciclos: a nova "mae" nao pode estar abaixo desta categoria
        const loop = await query(
          `WITH RECURSIVE d AS (SELECT id FROM categories WHERE id = $1
             UNION ALL SELECT c.id FROM categories c JOIN d ON c.parent_id = d.id)
           SELECT 1 FROM d WHERE id = $2`, [selfId, b.parent_id]);
        if (loop.rows.length) return 'A categoria pai não pode ser uma subcategoria desta.';
      }
    }
  }
  return null;
}

router.post('/', requireRoles('admin'), async (req, res) => {
  const b = readBody(req.body);
  if (!b.name) return res.status(422).json({ error: 'Informe o nome da categoria.' });
  // só dá para criar dentro de um perfil de opções (o Padrão não muda)
  const p = await lerPerfil(req.body?.profile_id);
  if (p.error) return res.status(422).json({ error: p.error });
  if (!p.id) return res.status(403).json({ error: PADRAO_TRAVADO });
  const err = await validate(b, null, null);
  if (err) return res.status(422).json({ error: err });
  const kind = 'simple';
  const { rows } = await query(
    `INSERT INTO categories (name, parent_id, active, kind, maps_to_id, icon, description, examples, sort_order, profile_id)
     VALUES ($1, NULL, COALESCE($2, TRUE), $3, NULL, $4, $5, $6, COALESCE($7, 0), $8) RETURNING id`,
    [b.name, b.active, kind, b.icon || null, b.description || null, b.examples || null, b.sort_order, p.id]);
  const full = await query(`${SELECT} WHERE c.id = $1`, [rows[0].id]);
  res.status(201).json(full.rows[0]);
});

router.patch('/:id', requireRoles('admin'), async (req, res) => {
  const cur = await query('SELECT * FROM categories WHERE id = $1', [req.params.id]);
  if (!cur.rows.length) return res.status(404).json({ error: 'Categoria não encontrada.' });
  if (cur.rows[0].profile_id == null) return res.status(403).json({ error: PADRAO_TRAVADO });
  const b = readBody(req.body);
  if (b.kind && b.kind !== cur.rows[0].kind) {
    return res.status(422).json({ error: 'Não é possível trocar o tipo de uma categoria existente. Crie uma nova.' });
  }
  const err = await validate(b, cur.rows[0].kind, req.params.id);
  if (err) return res.status(422).json({ error: err });
  const fields = [];
  const params = [req.params.id];
  for (const k of ['name', 'parent_id', 'active', 'icon', 'description', 'examples', 'sort_order']) {
    if (b[k] !== undefined) { params.push(b[k]); fields.push(`${k} = $${params.length}`); }
  }
  if (b.name === null) return res.status(422).json({ error: 'O nome não pode ficar vazio.' });
  if (!fields.length) return res.status(422).json({ error: 'Nenhum campo para atualizar.' });
  try {
    await query(`UPDATE categories SET ${fields.join(', ')} WHERE id = $1`, params);
    const full = await query(`${SELECT} WHERE c.id = $1`, [req.params.id]);
    res.json(full.rows[0]);
  } catch (e) {
    res.status(400).json({ error: 'Não foi possível atualizar.', details: e.message });
  }
});

router.delete('/:id', requireRoles('admin'), async (req, res) => {
  const trava = await travaPadrao('categories', req.params.id);
  if (trava) return res.status(403).json({ error: trava });
  const used = await query(
    `SELECT (SELECT count(*)::int FROM tickets WHERE category_id = $1 OR simple_category_id = $1) AS t,
            (SELECT count(*)::int FROM categories WHERE maps_to_id = $1 OR parent_id = $1) AS c`, [req.params.id]);
  if (used.rows[0].t > 0 || used.rows[0].c > 0) {
    await query(`UPDATE categories SET active = FALSE WHERE id = $1`, [req.params.id]);
    return res.json({ ok: true, message: 'Categoria em uso (chamados ou outras categorias ligadas a ela); foi desativada.' });
  }
  await query(`DELETE FROM categories WHERE id = $1`, [req.params.id]);
  res.json({ ok: true, message: 'Categoria removida.' });
});

module.exports = router;
