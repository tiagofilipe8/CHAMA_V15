const express = require('express');
const { query, withTransaction } = require('../db');
const { requireAuth, has, isMaster, entityIdsOf, canAccessEntity, localFixo } = require('../middleware/auth');
const notify = require('../services/notify');

// ---------------------------------------------------------------------
// Itens em manutenção (Equipamentos > Itens em manutenção)
//   Quem vê o inventário do local pede a manutenção de um item (junto com um chamado, pela tela Abrir chamado).
//   Etapas: pedida -> retirada (a TI buscou no local) -> em_conserto -> pronta (consertado, na ORCIM)
//           -> rota (a caminho do local) -> devolvida  |  sem_conserto  |  cancelada
//   O item acompanha: da retirada até voltar fica "Em conserto"; devolvido volta ao estado de antes;
//   sem conserto vira "Estragado". A devolução entra no histórico de manutenções do item.
//   Quem vê: equipe da TI (tudo), gestor (empresas dele), Usuário (só o local do seu cadastro).
// ---------------------------------------------------------------------
const router = express.Router();
router.use(requireAuth);

const ETAPAS = {
  pedida: 'Manutenção pedida', retirada: 'Retirado pela TI', em_conserto: 'Em conserto', pronta: 'Pronto, na ORCIM',
  rota: 'A caminho do local', devolvida: 'Devolvido', sem_conserto: 'Sem conserto', cancelada: 'Cancelada',
};
const FINAIS = ['devolvida', 'sem_conserto', 'cancelada'];
const EM_CONSERTO = ['retirada', 'em_conserto', 'pronta', 'rota'];
const ehEquipe = (u) => isMaster(u) || (has(u, 'dashboard.view') && ['admin', 'moderator', 'technician'].includes(u.role));
const podeAtender = (u) => isMaster(u) || (ehEquipe(u) && has(u, 'inventory.manage'));
const podeVer = (u) => has(u, 'inventory.view') || has(u, 'stock.withdraw');

// filtro do que a pessoa pode ver (alias m = manutencoes)
function escopo(u, params) {
  let sql = '';
  const ents = entityIdsOf(u);
  if (ents !== null) { params.push(ents); sql += ` AND m.entity_id::text = ANY($${params.length}::text[])`; }
  const fixo = localFixo(u);
  if (fixo !== null) { params.push(fixo); sql += ` AND m.location_id = $${params.length}`; }
  return sql;
}

const CAMPOS = `m.id, m.asset_id, m.ticket_id, m.entity_id, m.location_id, m.problema, m.status, m.etapas, m.previsao, m.solucao,
       m.pedido_por, m.created_at, m.status_at, a.name, a.asset_tag, a.type, a.status AS asset_status, a.controle, a.quantity,
       l.name AS location_name, l.latitude, l.longitude, e.name AS entity_name, u.name AS pedido_por_name,
       t.title AS ticket_title, t.status AS ticket_status`;
const JUNTA = `FROM manutencoes m JOIN assets a ON a.id = m.asset_id
       LEFT JOIN locations l ON l.id = m.location_id LEFT JOIN entities e ON e.id = m.entity_id
       LEFT JOIN users u ON u.id = m.pedido_por LEFT JOIN tickets t ON t.id = m.ticket_id`;

// Lista: ?situacao=abertas (padrão) | todas · ?entity_id= · ?location_id=
router.get('/', async (req, res) => {
  if (!podeVer(req.user)) return res.status(403).json({ error: 'Seu perfil não vê os itens em manutenção.' });
  const params = [];
  let where = 'TRUE' + escopo(req.user, params);
  if (req.query.situacao !== 'todas') where += ` AND m.status NOT IN ('devolvida','sem_conserto','cancelada')`;
  if (/^\d+$/.test(String(req.query.entity_id || ''))) { params.push(req.query.entity_id); where += ` AND m.entity_id = $${params.length}`; }
  if (/^\d+$/.test(String(req.query.location_id || ''))) { params.push(req.query.location_id); where += ` AND m.location_id = $${params.length}`; }
  const { rows } = await query(`SELECT ${CAMPOS} ${JUNTA} WHERE ${where} ORDER BY (m.status IN ('devolvida','sem_conserto','cancelada')), m.created_at DESC LIMIT 500`, params);
  res.json({ pode_atender: podeAtender(req.user), etapas: ETAPAS, itens: rows });
});

// Pedir manutenção: { asset_id, problema, ticket_id? }
router.post('/', async (req, res) => {
  const user = req.user;
  if (!has(user, 'inventory.view') && !has(user, 'ticket.create')) return res.status(403).json({ error: 'Seu perfil não pede manutenção.' });
  const b = req.body || {};
  const problema = String(b.problema || '').trim().slice(0, 2000);
  if (!problema) return res.status(422).json({ error: 'Conte o que está acontecendo com o item.' });
  const a = (await query('SELECT id, name, asset_tag, status, entity_id, location_id FROM assets WHERE id = $1', [b.asset_id])).rows[0];
  if (!a || a.entity_id === null) return res.status(404).json({ error: 'Item não encontrado.' });
  if (!canAccessEntity(user, a.entity_id)) return res.status(403).json({ error: 'Esse item não é da sua empresa.' });
  const fixo = localFixo(user);
  if (fixo !== null && String(a.location_id || '') !== String(fixo)) return res.status(403).json({ error: 'Você só pede manutenção de itens do seu local.' });
  if (['DISPOSED', 'LOST', 'ORDERED'].includes(a.status)) return res.status(422).json({ error: 'Esse item não está no local (descartado, extraviado ou ainda não chegou).' });
  const aberta = (await query(`SELECT id FROM manutencoes WHERE asset_id = $1 AND status NOT IN ('devolvida','sem_conserto','cancelada')`, [a.id])).rows[0];
  if (aberta) return res.status(409).json({ error: 'Esse item já está em manutenção.', manutencao_id: aberta.id });
  let ticketId = null;
  if (/^\d+$/.test(String(b.ticket_id || ''))) {
    const t = (await query('SELECT id, asset_id FROM tickets WHERE id = $1', [b.ticket_id])).rows[0];
    if (t && String(t.asset_id || '') === String(a.id)) ticketId = t.id;
  }
  const { rows } = await query(
    `INSERT INTO manutencoes (asset_id, ticket_id, entity_id, location_id, problema, estado_antes, pedido_por, etapas, status_at, status_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, jsonb_build_object('pedida', now()), now(), $7) RETURNING id`,
    [a.id, ticketId, a.entity_id, a.location_id, problema, a.status, user.id]);
  await query(`INSERT INTO asset_history (asset_id, user_id, action, field, new_value) VALUES ($1,$2,'Maintenance','manutencao',$3)`,
    [a.id, user.id, `Manutenção pedida: ${problema.slice(0, 200)}`]);
  // avisa a equipe da TI
  const equipe = await query(`SELECT id FROM users WHERE active AND role IN ('admin','technician') AND id <> $1`, [user.id]);
  const loc = a.location_id ? (await query('SELECT name FROM locations WHERE id = $1', [a.location_id])).rows[0]?.name : null;
  for (const r of equipe.rows) {
    await notify.createInApp(r.id, `Pedido de manutenção: ${a.name}${a.asset_tag ? ` (${a.asset_tag})` : ''}`,
      `${loc ? `${loc} · ` : ''}${problema.slice(0, 200)}`, ticketId, '#/manutencao').catch(() => {});
  }
  res.status(201).json({ id: rows[0].id });
});

// Mudar a etapa (TI) ou cancelar (quem pediu, enquanto a TI não buscou): { status, previsao?, solucao? }
router.patch('/:id(\\d+)', async (req, res) => {
  const user = req.user;
  const params = [req.params.id];
  const m = (await query(`SELECT m.*, a.name, a.asset_tag, a.status AS asset_status FROM manutencoes m JOIN assets a ON a.id = m.asset_id
                          WHERE m.id = $1${escopo(user, params)}`, params)).rows[0];
  if (!m) return res.status(404).json({ error: 'Manutenção não encontrada.' });
  const b = req.body || {};
  const novo = b.status !== undefined ? String(b.status) : m.status;
  if (!ETAPAS[novo]) return res.status(422).json({ error: 'Etapa inválida.' });
  const quemPediuCancela = novo === 'cancelada' && m.status === 'pedida' && String(m.pedido_por) === String(user.id);
  if (!podeAtender(user) && !quemPediuCancela) return res.status(403).json({ error: 'Só a equipe da TI muda a etapa da manutenção.' });
  if (FINAIS.includes(m.status) && novo !== m.status) return res.status(422).json({ error: 'Essa manutenção já terminou.' });
  if (b.previsao !== undefined && b.previsao && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.previsao))) return res.status(422).json({ error: 'Data prevista inválida.' });
  const mudou = novo !== m.status;
  const solucao = b.solucao !== undefined ? (String(b.solucao).trim().slice(0, 2000) || null) : m.solucao;
  try {
    await withTransaction(async (q) => {
      // trava a linha: duas pessoas mudando ao mesmo tempo
      const agora = (await q('SELECT status FROM manutencoes WHERE id = $1 FOR UPDATE', [m.id])).rows[0];
      if (agora.status !== m.status) throw Object.assign(new Error('Essa manutenção mudou agora há pouco. Recarregue a página.'), { status: 409 });
      await q(`UPDATE manutencoes SET status = $2, previsao = $3, solucao = $4,
                 status_at = CASE WHEN $5 THEN now() ELSE status_at END, status_by = CASE WHEN $5 THEN $6 ELSE status_by END,
                 etapas = CASE WHEN $5 THEN etapas || jsonb_build_object($2::text, now()) ELSE etapas END WHERE id = $1`,
      [m.id, novo, b.previsao !== undefined ? (b.previsao || null) : m.previsao, solucao, mudou, user.id]);
      if (!mudou) return;
      // o item acompanha a etapa
      let estado = null;
      if (EM_CONSERTO.includes(novo)) estado = 'REPAIR';
      else if (novo === 'devolvida') estado = m.estado_antes && !['REPAIR', 'BROKEN'].includes(m.estado_antes) ? m.estado_antes : 'OPERATING';
      else if (novo === 'sem_conserto') estado = 'BROKEN';
      else if (novo === 'cancelada' && m.asset_status === 'REPAIR') estado = m.estado_antes && m.estado_antes !== 'REPAIR' ? m.estado_antes : 'OPERATING';
      if (estado && estado !== m.asset_status) {
        await q('UPDATE assets SET status = $2, updated_at = now() WHERE id = $1', [m.asset_id, estado]);
        await q(`INSERT INTO asset_history (asset_id, user_id, action, field, old_value, new_value) VALUES ($1,$2,'AssetUpdated','status',$3,$4)`,
          [m.asset_id, user.id, m.asset_status, estado]);
      }
      if (novo === 'devolvida' || novo === 'sem_conserto') {
        await q('INSERT INTO asset_maintenances (asset_id, performed_at, description, created_by) VALUES ($1, CURRENT_DATE, $2, $3)',
          [m.asset_id, `${novo === 'devolvida' ? 'Manutenção' : 'Sem conserto'}${m.ticket_id ? ` (chamado #${m.ticket_id})` : ''}: ${m.problema}${solucao ? ` — ${solucao}` : ''}`.slice(0, 2000), user.id]);
      }
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    throw e;
  }
  // quem pediu acompanha cada etapa
  if (mudou && m.pedido_por && String(m.pedido_por) !== String(user.id)) {
    await notify.createInApp(m.pedido_por, `Manutenção de ${m.name}: ${ETAPAS[novo].toLowerCase()}`,
      `${m.name}${m.asset_tag ? ` (${m.asset_tag})` : ''} · ${ETAPAS[novo]}`, m.ticket_id, '#/manutencao').catch(() => {});
  }
  res.json({ ok: true });
});

module.exports = router;
module.exports.ETAPAS = ETAPAS;
