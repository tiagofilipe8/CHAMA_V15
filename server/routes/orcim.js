const express = require('express');
const { query, withTransaction } = require('../db');
const { requireAuth, has, entityIdsOf } = require('../middleware/auth');
const orcimEstoque = require('../services/orcimEstoque');

// ---------------------------------------------------------------------
// Estoque da ORCIM: itens que a ORCIM registra no próprio estoque (sem empresa ainda)
// e depois transfere para uma empresa e posto (Estoque de T.I. do posto ou já em uso).
//   Item da ORCIM = assets.entity_id IS NULL
//   Só quem cuida do inventário e vê todas as empresas (equipe da ORCIM / admin mestre)
// ---------------------------------------------------------------------
const router = express.Router();
router.use(requireAuth);

const TIPOS = ['COMPUTER', 'NOTEBOOK', 'SERVER', 'PRINTER', 'MONITOR', 'UPS', 'NETWORK_DEVICE', 'MOBILE_DEVICE', 'PERIPHERAL', 'OTHER'];
const ESTADOS_ORCIM = ['STOCK', 'ORDERED', 'REPAIR', 'BROKEN'];
const podeOrcim = (u) => has(u, 'inventory.manage') && entityIdsOf(u) === null;
const veSegredos = (u) => has(u, 'inventory.secrets');
const UN = "(CASE WHEN a.controle = 'quantidade' THEN a.quantity ELSE 1 END)";

router.use((req, res, next) => (podeOrcim(req.user) ? next() : res.status(403).json({ error: 'Só a equipe da ORCIM mexe no Estoque da ORCIM.' })));

const limpar = (a, u) => { if (veSegredos(u)) return a; const { price, ...r } = a; return r; };

async function carregar(id) {
  const { rows } = await query('SELECT * FROM assets WHERE id = $1 AND entity_id IS NULL', [id]);
  return rows[0] || null;
}

// Lista do Estoque da ORCIM (com o que já foi transferido recentemente)
router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.name, a.asset_tag, a.type, a.status, a.controle, a.quantity, a.price, a.manufacturer, a.model,
            a.serial_number, a.notes, a.created_at, a.updated_at, u.name AS criado_por
     FROM assets a LEFT JOIN users u ON u.id = a.created_by
     WHERE a.entity_id IS NULL AND a.status <> 'DISPOSED'
     ORDER BY a.type, a.name`);
  const enviados = await query(
    `SELECT m.id, m.created_at, m.quantity, m.price, m.note, a.id AS asset_id, a.name, a.asset_tag, a.type,
            e.name AS empresa, l.name AS posto, us.name AS quem
     FROM stock_movements m JOIN assets a ON a.id = m.asset_id
     LEFT JOIN entities e ON e.id = m.to_entity_id LEFT JOIN locations l ON l.id = m.to_location_id
     LEFT JOIN users us ON us.id = m.user_id
     WHERE m.kind = 'transfer' AND m.from_entity_id IS NULL AND m.to_entity_id IS NOT NULL
     ORDER BY m.created_at DESC LIMIT 30`);
  const tot = await query(
    `SELECT COALESCE(sum(${UN}),0)::int AS itens, COALESCE(sum(a.price * ${UN}),0)::float AS valor
     FROM assets a WHERE a.entity_id IS NULL AND a.status NOT IN ('DISPOSED','LOST','BROKEN')`);
  const ver = veSegredos(req.user);
  res.json({
    itens: rows.map((a) => limpar(a, req.user)),
    enviados: ver ? enviados.rows : enviados.rows.map(({ price, ...r }) => r),
    totais: ver ? tot.rows[0] : { itens: tot.rows[0].itens },
  });
});

function lerCorpo(b, atual = null) {
  const out = {};
  const txt = (k, max = 200, upper = false) => {
    if (b[k] === undefined) return;
    const v = String(b[k] ?? '').trim().slice(0, max);
    out[k] = v ? (upper ? v.toUpperCase() : v) : null;
  };
  txt('name', 200, true); txt('asset_tag', 60, true); txt('manufacturer', 120, true); txt('model', 120, true);
  txt('serial_number', 120, true); txt('notes', 2000);
  if (b.type !== undefined) { if (!TIPOS.includes(b.type)) return { erro: 'Categoria inválida.' }; out.type = b.type; }
  if (b.status !== undefined) { if (!ESTADOS_ORCIM.includes(b.status)) return { erro: 'Estado inválido.' }; out.status = b.status; }
  if (b.price !== undefined) {
    const p = b.price === null || b.price === '' ? null : Number(String(b.price).replace(',', '.'));
    if (p !== null && (!Number.isFinite(p) || p < 0 || p >= 1e10)) return { erro: 'Preço inválido.' };
    out.price = p;
  }
  const controle = b.controle !== undefined ? (b.controle === 'quantidade' ? 'quantidade' : 'unidade') : (atual ? atual.controle : 'unidade');
  let qtd = atual ? atual.quantity : 1;
  if (b.quantity !== undefined && b.quantity !== '' && b.quantity !== null) qtd = parseInt(b.quantity, 10);
  if (controle === 'unidade') qtd = 1;
  if (!Number.isInteger(qtd) || qtd < 0 || qtd > 100000) return { erro: 'Quantidade inválida.' };
  if (b.controle !== undefined || !atual) out.controle = controle;
  if (b.quantity !== undefined || b.controle !== undefined || !atual) out.quantity = qtd;
  return { out };
}

// Para os materiais pedidos: o que já existe no Estoque da ORCIM ({ materiais: [{ id, name }] })
router.post('/procurar', async (req, res) => {
  const lista = Array.isArray(req.body?.materiais) ? req.body.materiais.slice(0, 300).filter((m) => m && m.id && m.name) : [];
  res.json(await orcimEstoque.procurar(lista));
});

// Registrar item no Estoque da ORCIM
router.post('/', async (req, res) => {
  const b = req.body || {};
  if (b.price !== undefined && b.price !== '' && b.price !== null && !veSegredos(req.user)) return res.status(403).json({ error: 'Seu perfil não pode informar preço.' });
  const { out, erro } = lerCorpo({ status: 'STOCK', type: 'OTHER', ...b });
  if (erro) return res.status(422).json({ error: erro });
  if (!out.name) return res.status(422).json({ error: 'Informe o nome do item.' });
  try {
    const a = await withTransaction(async (q) => {
      const { rows } = await q(
        `INSERT INTO assets (entity_id, name, asset_tag, type, status, manufacturer, model, serial_number, notes, price, controle, quantity, created_by)
         VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [out.name, out.asset_tag || null, out.type, out.status, out.manufacturer || null, out.model || null, out.serial_number || null,
          out.notes || null, out.price ?? null, out.controle, out.quantity, req.user.id]);
      await q(`INSERT INTO asset_history (asset_id, user_id, action, field, new_value) VALUES ($1,$2,'AssetCreated','name',$3)`,
        [rows[0].id, req.user.id, `${out.name} (Estoque da ORCIM)`]);
      await q(`INSERT INTO stock_movements (asset_id, kind, user_id, price, note, quantity) VALUES ($1,'entry',$2,$3,'Entrou no Estoque da ORCIM',$4)`,
        [rows[0].id, req.user.id, out.price == null ? null : out.price * out.quantity, out.quantity]);
      return rows[0];
    });
    res.status(201).json(limpar(a, req.user));
  } catch (e) {
    if (String(e.message).includes('asset_tag') || String(e.message).includes('duplicate')) return res.status(409).json({ error: 'Essa etiqueta já está cadastrada.' });
    throw e;
  }
});

// Editar item que ainda está na ORCIM
router.patch('/:id', async (req, res) => {
  const atual = await carregar(req.params.id);
  if (!atual) return res.status(404).json({ error: 'Item não está no Estoque da ORCIM.' });
  const b = req.body || {};
  if (b.price !== undefined && !veSegredos(req.user)) return res.status(403).json({ error: 'Seu perfil não pode mudar preço.' });
  const { out, erro } = lerCorpo(b, atual);
  if (erro) return res.status(422).json({ error: erro });
  if (out.name === null) return res.status(422).json({ error: 'O nome não pode ficar vazio.' });
  const campos = Object.keys(out);
  if (!campos.length) return res.json(limpar(atual, req.user));
  const params = [atual.id, ...campos.map((k) => out[k])];
  try {
    const { rows } = await query(`UPDATE assets SET ${campos.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, params);
    for (const k of campos) {
      if (String(atual[k] ?? '') !== String(out[k] ?? '')) {
        await query(`INSERT INTO asset_history (asset_id, user_id, action, field, old_value, new_value) VALUES ($1,$2,'AssetUpdated',$3,$4,$5)`,
          [atual.id, req.user.id, k, k === 'price' ? '•••' : String(atual[k] ?? ''), k === 'price' ? '•••' : String(out[k] ?? '')]);
      }
    }
    res.json(limpar(rows[0], req.user));
  } catch (e) {
    if (String(e.message).includes('asset_tag') || String(e.message).includes('duplicate')) return res.status(409).json({ error: 'Essa etiqueta já está cadastrada.' });
    throw e;
  }
});

// Tirar do Estoque da ORCIM (cadastrado por engano / descartado): marca como Descartado
router.delete('/:id', async (req, res) => {
  const atual = await carregar(req.params.id);
  if (!atual) return res.status(404).json({ error: 'Item não está no Estoque da ORCIM.' });
  await query(`UPDATE assets SET status = 'DISPOSED', updated_at = now() WHERE id = $1`, [atual.id]);
  await query(`INSERT INTO asset_history (asset_id, user_id, action, field, old_value, new_value) VALUES ($1,$2,'AssetUpdated','status',$3,'DISPOSED')`,
    [atual.id, req.user.id, atual.status]);
  res.json({ ok: true });
});

// Transferir para uma empresa: { entity_id, location_id, destino: 'estoque' | 'uso', quantidade }
//   estoque -> Estoque de T.I. do posto (Em estoque); uso -> já em uso no posto (Operando)
//   itens por quantidade podem ir em parte; no estoque do posto somam com o mesmo item que já está lá
router.post('/:id/transferir', async (req, res) => {
  const item = await carregar(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não está no Estoque da ORCIM.' });
  if (!['STOCK', 'ORDERED'].includes(item.status)) return res.status(422).json({ error: 'Só dá para transferir item em estoque ou a caminho.' });
  const b = req.body || {};
  const ent = /^\d+$/.test(String(b.entity_id || '')) ? (await query('SELECT id, name FROM entities WHERE id = $1 AND active', [b.entity_id])).rows[0] : null;
  if (!ent) return res.status(422).json({ error: 'Escolha a empresa.' });
  const loc = /^\d+$/.test(String(b.location_id || '')) ? (await query('SELECT id, name FROM locations WHERE id = $1 AND entity_id = $2', [b.location_id, ent.id])).rows[0] : null;
  if (!loc) return res.status(422).json({ error: 'Escolha o posto da empresa.' });
  const destino = b.destino === 'uso' ? 'uso' : 'estoque';
  const porQtd = item.controle === 'quantidade';
  const qtd = porQtd ? parseInt(b.quantidade, 10) || item.quantity : 1;
  if (porQtd && (qtd < 1 || qtd > item.quantity)) return res.status(422).json({ error: `Tem ${item.quantity} no Estoque da ORCIM. Escolha de 1 a ${item.quantity}.` });
  const nota = String(b.note || '').trim().slice(0, 500) || null;
  const texto = `Transferido do Estoque da ORCIM para ${ent.name} · ${loc.name} (${destino === 'uso' ? 'em uso' : 'Estoque de T.I.'})${nota ? ` — ${nota}` : ''}`;
  const resultado = await withTransaction((q) => orcimEstoque.transferir(q, { item, ent, loc, destino, qtd, userId: req.user.id, nota: texto }));
  res.json({ ok: true, asset_id: resultado });
});

module.exports = router;
