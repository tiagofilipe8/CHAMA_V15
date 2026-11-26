// Inventário da TI do Beija-Flor.
//
// Duas origens na mesma lista:
//  - itens NOSSOS (gbf_inventario): cadastrados aqui, com a origem que a gente escolhe
//    ("Setor de Compras", doação, transferência...). Só estes podem ser editados.
//  - itens da ORCIM: os equipamentos que a Orcim cadastra no sistema dela e chegam pela cópia
//    (tabela assets). Origem fixa "Orcim" e só consulta (quem altera é a Orcim).
const express = require('express');
const { query } = require('../db');
const { queryCentral } = require('./fonte');
const { ah } = require('./common');

const router = express.Router();

const ESTADOS = {
  OPERATING: 'Operando', REPAIR: 'Em conserto', BROKEN: 'Estragado', ORDERED: 'Comprado - aguardando chegar',
  READY: 'Pronto para entregar', STOCK: 'Em estoque', DISPOSED: 'Descartado', LOST: 'Extraviado',
};
const TIPOS = ['Computador', 'Notebook', 'Monitor', 'Impressora', 'Nobreak', 'Rede (roteador, switch)', 'Celular / tablet',
  'Periférico / acessório', 'Câmera / CFTV', 'Outro'];
const ORIGENS_PADRAO = ['Setor de Compras', 'Doação', 'Transferência entre unidades', 'Locação / comodato'];
const ORCIM = 'Orcim';
// estados da versão antiga da Orcim
const ESTADO_ANTIGO = { ACTIVE: 'OPERATING', MAINTENANCE: 'REPAIR' };
const ROTULO_ANTIGO = { INACTIVE: 'Inativo' };
const TIPO_ORCIM = {
  COMPUTER: 'Computador', NOTEBOOK: 'Notebook', SERVER: 'Servidor', PRINTER: 'Impressora', MONITOR: 'Monitor', UPS: 'Nobreak',
  NETWORK_DEVICE: 'Rede (roteador, switch)', MOBILE_DEVICE: 'Celular / tablet', PERIPHERAL: 'Periférico / acessório', OTHER: 'Outro',
};

const txt = (v, max = 200) => (v === undefined ? undefined : (String(v ?? '').trim().slice(0, max) || null));

function validar(b, novo) {
  const out = {};
  if (novo || b.nome !== undefined) {
    const n = txt(b.nome, 160);
    if (!n) return { erro: 'Informe o nome do item.' };
    out.nome = n;
  }
  for (const [k, max] of [['tipo', 60], ['marca', 80], ['modelo', 120], ['numero_serie', 120], ['patrimonio', 60],
    ['setor', 120], ['responsavel', 120], ['observacoes', 2000]]) {
    if (b[k] !== undefined) out[k] = txt(b[k], max);
  }
  if (novo || b.origem !== undefined) {
    const o = txt(b.origem, 80) || ORIGENS_PADRAO[0];
    if (o.toLowerCase() === ORCIM.toLowerCase()) return { erro: '"Orcim" é a origem dos itens que vêm do sistema da Orcim. Escolha outra.' };
    out.origem = o;
  }
  if (b.estado !== undefined) {
    if (!ESTADOS[b.estado]) return { erro: 'Estado inválido.' };
    out.estado = b.estado;
  }
  if (b.location_id !== undefined) out.location_id = /^\d+$/.test(String(b.location_id || '')) ? Number(b.location_id) : null;
  if (b.preco !== undefined) {
    if (b.preco === null || b.preco === '') out.preco = null;
    else {
      const v = Number(String(b.preco).replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(v) || v < 0) return { erro: 'Preço inválido.' };
      out.preco = Math.round(v * 100) / 100;
    }
  }
  for (const k of ['data_compra', 'garantia_ate']) {
    if (b[k] === undefined) continue;
    if (b[k] && !/^\d{4}-\d{2}-\d{2}$/.test(b[k])) return { erro: 'Data inválida.' };
    out[k] = b[k] || null;
  }
  return { out };
}

const ROTULO = {
  nome: 'nome', tipo: 'tipo', marca: 'marca', modelo: 'modelo', numero_serie: 'nº de série', patrimonio: 'patrimônio',
  setor: 'setor', responsavel: 'responsável', observacoes: 'observações', origem: 'origem', estado: 'estado',
  location_id: 'posto', preco: 'preço', data_compra: 'data da compra', garantia_ate: 'garantia',
};

async function historico(itemId, userId, texto) {
  await query('INSERT INTO gbf_inventario_hist (item_id, user_id, texto) VALUES ($1, $2, $3)', [itemId, userId, texto.slice(0, 1000)]);
}

// Equipamentos da Orcim (cópia). Versões da Central sem alguma coluna: tenta a consulta mais simples.
async function itensOrcim() {
  const postos = (await query('SELECT id, name, central_location_id FROM gbf_locations WHERE central_location_id IS NOT NULL')).rows;
  const postoDoLocal = new Map(postos.map((p) => [String(p.central_location_id), p]));
  let rows = [];
  try {
    rows = (await queryCentral(
      `SELECT a.id, a.name, a.type, a.status, a.manufacturer, a.model, a.serial_number, a.asset_tag, a.location AS local_txt,
              a.department, a.location_id, a.price::float AS price, a.purchase_date::text AS purchase_date, a.updated_at,
              l.name AS local_nome
       FROM assets a LEFT JOIN locations l ON l.id = a.location_id`)).rows;
  } catch {
    try {
      rows = (await queryCentral(
        `SELECT id, name, type, status, manufacturer, model, serial_number, asset_tag, location AS local_txt, department,
                purchase_date::text AS purchase_date, updated_at FROM assets`)).rows;
    } catch { return []; }
  }
  return rows.map((a) => {
    const posto = a.location_id ? postoDoLocal.get(String(a.location_id)) : null;
    return {
      id: `orcim-${a.id}`, orcim_id: a.id, origem: ORCIM, somente_leitura: true,
      nome: a.name, tipo: TIPO_ORCIM[a.type] || a.type, marca: a.manufacturer, modelo: a.model, numero_serie: a.serial_number, patrimonio: a.asset_tag,
      estado: ESTADOS[a.status] ? a.status : (ESTADO_ANTIGO[a.status] || null),
      estado_txt: ESTADOS[a.status] || ESTADOS[ESTADO_ANTIGO[a.status]] || ROTULO_ANTIGO[a.status] || a.status || '—',
      location_id: posto ? posto.id : null, posto: posto ? posto.name : (a.local_nome || a.local_txt || null),
      setor: a.department, preco: a.price ?? null, data_compra: a.purchase_date, atualizado_em: a.updated_at,
    };
  });
}

async function itensNossos(id = null) {
  const { rows } = await query(
    `SELECT i.*, i.preco::float AS preco, i.data_compra::text AS data_compra, i.garantia_ate::text AS garantia_ate,
            l.name AS posto, u.name AS criado_por
     FROM gbf_inventario i LEFT JOIN gbf_locations l ON l.id = i.location_id LEFT JOIN gbf_users u ON u.id = i.created_by
     ${id ? 'WHERE i.id = $1' : ''} ORDER BY i.nome`, id ? [id] : []);
  return rows.map((i) => ({ ...i, estado_txt: ESTADOS[i.estado] || i.estado, atualizado_em: i.updated_at, somente_leitura: false }));
}

router.get('/opcoes', ah(async (req, res) => {
  const usadas = (await query('SELECT DISTINCT origem FROM gbf_inventario ORDER BY origem')).rows.map((r) => r.origem);
  res.json({ estados: ESTADOS, tipos: TIPOS, origens: [...new Set([...ORIGENS_PADRAO, ...usadas])] });
}));

router.get('/', ah(async (req, res) => {
  const [nossos, orcim] = await Promise.all([itensNossos(), itensOrcim()]);
  res.json({ estados: ESTADOS, itens: [...nossos, ...orcim], orcim_ok: orcim.length > 0 });
}));

router.get('/orcim/:id', ah(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Item não encontrado.' });
  const item = (await itensOrcim()).find((x) => String(x.orcim_id) === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
  let manutencoes = [];
  try {
    manutencoes = (await queryCentral(
      'SELECT description, created_at FROM asset_maintenances WHERE asset_id = $1 ORDER BY created_at DESC LIMIT 30', [req.params.id])).rows;
  } catch { /* sem histórico */ }
  res.json({ ...item, historico: manutencoes.map((m) => ({ texto: m.description, created_at: m.created_at, quem: 'Orcim' })) });
}));

router.get('/:id', ah(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Item não encontrado.' });
  const item = (await itensNossos(req.params.id))[0];
  if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
  const hist = (await query(
    `SELECT h.texto, h.created_at, u.name AS quem FROM gbf_inventario_hist h LEFT JOIN gbf_users u ON u.id = h.user_id
     WHERE h.item_id = $1 ORDER BY h.created_at DESC LIMIT 100`, [item.id])).rows;
  res.json({ ...item, historico: hist });
}));

router.post('/', ah(async (req, res) => {
  const { erro, out } = validar(req.body || {}, true);
  if (erro) return res.status(422).json({ error: erro });
  if (!out.estado) out.estado = 'OPERATING';
  out.created_by = req.gbfUser.id;
  const cols = Object.keys(out);
  const { rows } = await query(
    `INSERT INTO gbf_inventario (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
    cols.map((c) => out[c]));
  await historico(rows[0].id, req.gbfUser.id, `Cadastrou o item (origem: ${out.origem}; estado: ${ESTADOS[out.estado]}).`);
  res.status(201).json({ id: rows[0].id });
}));

router.patch('/:id', ah(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Item não encontrado.' });
  const antes = (await itensNossos(req.params.id))[0];
  if (!antes) return res.status(404).json({ error: 'Item não encontrado.' });
  const { erro, out } = validar(req.body || {}, false);
  if (erro) return res.status(422).json({ error: erro });
  const mudou = Object.keys(out).filter((k) => String(out[k] ?? '') !== String(antes[k] ?? ''));
  if (!mudou.length) return res.json({ ok: true });
  await query(
    `UPDATE gbf_inventario SET ${mudou.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
    [antes.id, ...mudou.map((c) => out[c])]);
  let postoNovo = null;
  if (mudou.includes('location_id') && out.location_id) postoNovo = (await query('SELECT name FROM gbf_locations WHERE id = $1', [out.location_id])).rows[0]?.name;
  const partes = mudou.map((k) => {
    if (k === 'estado') return `estado: ${ESTADOS[antes.estado] || '—'} → ${ESTADOS[out.estado]}`;
    if (k === 'location_id') return `posto: ${antes.posto || '—'} → ${postoNovo || '—'}`;
    if (k === 'origem') return `origem: ${antes.origem} → ${out.origem}`;
    if (k === 'observacoes') return 'observações';
    return `${ROTULO[k]}: ${out[k] ?? '—'}`;
  });
  await historico(antes.id, req.gbfUser.id, `Alterou ${partes.join('; ')}.`);
  res.json({ ok: true });
}));

module.exports = router;
module.exports.ESTADOS = ESTADOS;
