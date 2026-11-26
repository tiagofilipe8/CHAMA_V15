// ---------------------------------------------------------------------
// Estoque da ORCIM: regras usadas pela tela da ORCIM e pela entrega de pedidos
//   Item da ORCIM = assets.entity_id IS NULL
// ---------------------------------------------------------------------
const { query } = require('../db');

// Transfere (dentro de uma transação q) um item da ORCIM para empresa + posto.
//   destino 'estoque' -> Estoque de T.I. do posto (STOCK) · 'uso' -> em uso (OPERATING)
//   itens por quantidade podem ir em parte; no estoque do posto somam com o mesmo item (custo médio)
// Devolve o id do equipamento que ficou na empresa.
async function transferir(q, { item, ent, loc, destino, qtd, userId, nota }) {
  const estado = destino === 'uso' ? 'OPERATING' : 'STOCK';
  const porQtd = item.controle === 'quantidade';
  const n = porQtd ? qtd : 1;
  const texto = nota || `Transferido do Estoque da ORCIM para ${ent.name} · ${loc.name} (${destino === 'uso' ? 'em uso' : 'Estoque de T.I.'})`;
  const custo = item.price == null ? null : Number(item.price) * n;
  let alvo = item.id;
  const tudo = !porQtd || n === Number(item.quantity);
  const igual = porQtd && destino === 'estoque' ? (await q(
    `SELECT id FROM assets WHERE entity_id = $1 AND location_id = $2 AND controle = 'quantidade' AND status = 'STOCK' AND upper(name) = upper($3) ORDER BY id LIMIT 1`,
    [ent.id, loc.id, item.name])).rows[0] : null;
  if (igual) {
    await q(`UPDATE assets SET price = CASE WHEN $3::numeric IS NULL THEN price WHEN price IS NULL OR quantity = 0 THEN $3::numeric
               ELSE round((price * quantity + $3::numeric * $2) / (quantity + $2), 2) END, quantity = quantity + $2, updated_at = now() WHERE id = $1`,
    [igual.id, n, item.price]);
    alvo = igual.id;
    if (tudo) await q(`UPDATE assets SET quantity = 0, status = 'DISPOSED', notes = concat_ws(' · ', notes, $2::text) WHERE id = $1`, [item.id, `Somado ao estoque de ${loc.name}`]);
    else await q('UPDATE assets SET quantity = quantity - $2 WHERE id = $1', [item.id, n]);
  } else if (tudo) {
    await q(`UPDATE assets SET entity_id = $2, location_id = $3, status = $4, updated_at = now() WHERE id = $1`, [item.id, ent.id, loc.id, estado]);
  } else {
    await q('UPDATE assets SET quantity = quantity - $2 WHERE id = $1', [item.id, n]);
    const { rows } = await q(
      `INSERT INTO assets (entity_id, location_id, name, type, status, manufacturer, model, notes, price, controle, quantity, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'quantidade',$10,$11) RETURNING id`,
      [ent.id, loc.id, item.name, item.type, estado, item.manufacturer, item.model, 'Veio do Estoque da ORCIM', item.price, n, userId]);
    alvo = rows[0].id;
    await q(`INSERT INTO asset_history (asset_id, user_id, action, field, new_value) VALUES ($1,$2,'AssetCreated','name',$3)`, [alvo, userId, `${item.name} (do Estoque da ORCIM)`]);
  }
  await q(`INSERT INTO stock_movements (asset_id, kind, user_id, from_entity_id, to_entity_id, from_location_id, to_location_id, price, note, quantity)
           VALUES ($1,'transfer',$2,NULL,$3,NULL,$4,$5,$6,$7)`, [alvo, userId, ent.id, loc.id, custo, texto, n]);
  await q(`INSERT INTO asset_history (asset_id, user_id, action, field, old_value, new_value) VALUES ($1,$2,'OrcimTransfer','entity_id','Estoque da ORCIM',$3)`,
    [alvo, userId, `${porQtd ? `${n} un · ` : ''}${ent.name} · ${loc.name}`]);
  return alvo;
}

// nome sem acento, minúsculo, só letras e números
const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const palavras = (s) => normal(s).split(' ').filter((p) => p.length > 2);
// o item da ORCIM serve para o material pedido? (todas as palavras do pedido aparecem no nome, ou o contrário)
function combina(material, nomeItem) {
  const a = palavras(material); const b = palavras(nomeItem);
  if (!a.length || !b.length) return false;
  const nb = ` ${normal(nomeItem)} `; const na = ` ${normal(material)} `;
  const raiz = (p) => p.replace(/(es|s)$/, '');
  return a.every((p) => nb.includes(raiz(p))) || b.every((p) => na.includes(raiz(p)));
}

// Para cada material pedido, o que existe no Estoque da ORCIM que serve:
//   { [material_id]: { disponivel, itens: [{ id, name, asset_tag, controle, quantity }] } }
async function procurar(materiais) {
  const { rows } = await query(
    `SELECT id, name, asset_tag, type, controle, quantity, price FROM assets
     WHERE entity_id IS NULL AND status = 'STOCK' AND (controle = 'unidade' OR quantity > 0) ORDER BY id`);
  const out = {};
  materiais.forEach((m) => {
    const itens = rows.filter((a) => combina(m.name, a.name));
    if (!itens.length) return;
    const disponivel = itens.reduce((s, a) => s + (a.controle === 'quantidade' ? Number(a.quantity) : 1), 0);
    out[m.id] = { disponivel, itens: itens.map(({ price, ...a }) => a) };
  });
  return out;
}

module.exports = { transferir, procurar, combina };
