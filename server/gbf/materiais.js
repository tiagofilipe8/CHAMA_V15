// Pedidos de material: o gestor pede para um posto, a TI do grupo separa e entrega.
// AGUARDANDO -> SEPARANDO -> ENTREGUE (ou CANCELADO).
// A lista de materiais vem de Administração > Materiais (tabela materials da Central, no mesmo banco).
const express = require('express');
const { query, withTransaction } = require('../db');
const { ah, notificar, usuariosAtivos } = require('./common');
const { requireGestor } = require('./auth');

const router = express.Router();
const STATUS = { aguardando: 'Aguardando', separando: 'Separando', entregue: 'Entregue', cancelado: 'Cancelado' };
const URGENCIA = { 1: 'Requisição', 2: 'Operação prejudicada', 3: 'Parada iminente', 4: 'Operação parada' };
const numero = (id) => `M-${String(id).padStart(4, '0')}`;
const dataOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const HOJE = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;

const SELECT = `
  SELECT m.*, m.needed_by::text AS needed_by, l.name AS location_name,
         ur.name AS requested_by_name, uh.name AS handled_by_name,
         (m.status IN ('aguardando','separando') AND m.needed_by IS NOT NULL AND m.needed_by < ${HOJE}) AS atrasado,
         COALESCE((SELECT json_agg(json_build_object('material_id', i.material_id, 'name', i.name, 'unit', i.unit, 'quantity', i.quantity) ORDER BY i.id)
                   FROM gbf_material_request_items i WHERE i.request_id = m.id), '[]'::json) AS itens
  FROM gbf_material_requests m
  LEFT JOIN gbf_locations l ON l.id = m.location_id
  LEFT JOIN gbf_users ur ON ur.id = m.requested_by
  LEFT JOIN gbf_users uh ON uh.id = m.handled_by`;

const fmt = (m) => ({
  ...m,
  numero: numero(m.id),
  status_label: STATUS[m.status],
  priority_label: URGENCIA[m.priority],
  resumo_itens: (m.itens || []).map((i) => `${i.quantity} ${i.name}`).join(', '),
  tempo_entrega: m.delivered_at ? Math.round((new Date(m.delivered_at) - new Date(m.created_at)) / 1000) : null,
});

async function carregar(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await query(`${SELECT} WHERE m.id = $1`, [id]);
  return rows[0] ? fmt(rows[0]) : null;
}

// Lista de materiais ativos (Administração > Materiais)
router.get('/catalogo', ah(async (req, res) => {
  try {
    const { rows } = await query('SELECT id, name, unit FROM materials WHERE active ORDER BY sort_order, name');
    res.json(rows);
  } catch {
    res.json([]); // banco sem a tabela de materiais: só itens digitados
  }
}));

// Pedidos: em aberto primeiro (atrasados no topo), depois os últimos fechados
router.get('/pedidos', ah(async (req, res) => {
  const situacao = String(req.query.situacao || 'todos');
  const params = [];
  const filtros = [];
  if (situacao === 'abertos') filtros.push(`m.status IN ('aguardando','separando')`);
  if (/^\d+$/.test(String(req.query.posto || ''))) { params.push(req.query.posto); filtros.push(`m.location_id = $${params.length}`); }
  const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 60, 1), 300);
  const { rows } = await query(
    `${SELECT} ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
     ORDER BY (m.status IN ('aguardando','separando')) DESC,
              COALESCE(m.status IN ('aguardando','separando') AND m.needed_by < ${HOJE}, FALSE) DESC,
              m.priority DESC, m.created_at DESC
     LIMIT ${limite}`, params);
  res.json(rows.map(fmt));
}));

router.get('/pedidos/:id', ah(async (req, res) => {
  const m = await carregar(req.params.id);
  if (!m) return res.status(404).json({ error: 'Pedido não encontrado.' });
  res.json(m);
}));

// Novo pedido (gestor)
router.post('/pedidos', requireGestor, ah(async (req, res) => {
  const u = req.gbfUser;
  const b = req.body || {};
  const itensIn = Array.isArray(b.itens) ? b.itens : [];
  let catalogo = new Map();
  try {
    const { rows } = await query('SELECT id, name, unit FROM materials');
    catalogo = new Map(rows.map((r) => [String(r.id), r]));
  } catch { /* sem tabela de materiais */ }

  const itens = [];
  for (const i of itensIn) {
    const qtd = parseInt(i?.quantity, 10);
    if (!Number.isFinite(qtd) || qtd < 1 || qtd > 9999) return res.status(422).json({ error: 'Informe a quantidade de cada item (de 1 a 9999).' });
    const doCatalogo = i?.material_id !== undefined && i?.material_id !== null && i?.material_id !== '' ? catalogo.get(String(i.material_id)) : null;
    if (i?.material_id && !doCatalogo) return res.status(422).json({ error: 'Um dos materiais não existe mais na lista.' });
    const nome = doCatalogo ? doCatalogo.name : String(i?.name || '').trim().slice(0, 120);
    if (!nome) return res.status(422).json({ error: 'Escolha o material ou escreva o nome do item.' });
    itens.push({ material_id: doCatalogo ? Number(doCatalogo.id) : null, name: nome, unit: doCatalogo ? doCatalogo.unit : (String(i?.unit || '').trim().slice(0, 20) || null), quantity: qtd });
  }
  if (!itens.length) return res.status(422).json({ error: 'Adicione pelo menos um item ao pedido.' });

  let locationId = null;
  if (b.location_id !== undefined && b.location_id !== null && b.location_id !== '') {
    const l = await query('SELECT id FROM gbf_locations WHERE id = $1 AND active', [b.location_id]);
    if (!l.rows.length) return res.status(422).json({ error: 'Posto inválido.' });
    locationId = l.rows[0].id;
  }
  if (b.needed_by && !dataOk(b.needed_by)) return res.status(422).json({ error: 'Data inválida.' });
  const prioridade = Math.min(Math.max(parseInt(b.priority, 10) || 1, 1), 4);

  const id = await withTransaction(async (q) => {
    const { rows } = await q(
      `INSERT INTO gbf_material_requests (location_id, needed_by, priority, notes, requested_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [locationId, b.needed_by || null, prioridade, String(b.notes || '').trim().slice(0, 1000) || null, u.id]);
    for (const i of itens) {
      await q('INSERT INTO gbf_material_request_items (request_id, material_id, name, unit, quantity) VALUES ($1, $2, $3, $4, $5)',
        [rows[0].id, i.material_id, i.name, i.unit, i.quantity]);
    }
    return rows[0].id;
  });
  const m = await carregar(id);
  await notificar((await usuariosAtivos('tecnico')).filter((x) => x !== u.id), {
    kind: 'material', title: `Pedido de material ${m.numero}${m.location_name ? ` — ${m.location_name}` : ''}`,
    message: m.resumo_itens + (m.needed_by ? ` · até ${m.needed_by.split('-').reverse().join('/')}` : ''),
    link: '#/materiais',
  });
  res.status(201).json(m);
}));

// Mudar a situação: separando / entregue (TI) ou cancelado (gestor ou quem pediu)
router.patch('/pedidos/:id', ah(async (req, res) => {
  const u = req.gbfUser;
  const m = await carregar(req.params.id);
  if (!m) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const novo = String(req.body?.status || '');
  if (!STATUS[novo]) return res.status(422).json({ error: 'Situação inválida.' });
  if (['entregue', 'cancelado'].includes(m.status)) return res.status(409).json({ error: `Este pedido já está ${STATUS[m.status].toLowerCase()}.` });
  if (novo === 'cancelado' && u.role !== 'gestor' && m.requested_by !== u.id) {
    return res.status(403).json({ error: 'Só o gestor pode cancelar um pedido.' });
  }
  const sets = ['status = $2', 'updated_at = now()'];
  if (novo === 'separando') sets.push('handled_by = $3', 'started_at = COALESCE(started_at, now())');
  if (novo === 'entregue') sets.push('handled_by = COALESCE(handled_by, $3)', 'started_at = COALESCE(started_at, now())', 'delivered_at = now()');
  if (novo === 'aguardando') sets.push('handled_by = NULL', 'started_at = NULL');
  const params = [m.id, novo];
  if (['separando', 'entregue'].includes(novo)) params.push(u.id);
  await query(`UPDATE gbf_material_requests SET ${sets.join(', ')} WHERE id = $1`, params);
  const atual = await carregar(m.id);
  if (novo === 'entregue' && m.requested_by && m.requested_by !== u.id) {
    await notificar([m.requested_by], {
      kind: 'material', title: `Material entregue: ${atual.numero}${atual.location_name ? ` — ${atual.location_name}` : ''}`,
      message: `${atual.resumo_itens} · entregue por ${u.name}`, link: '#/materiais',
    });
  }
  res.json(atual);
}));

module.exports = { router, numero, STATUS };
