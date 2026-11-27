const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const config = require('../config');
const whatsapp = require('../services/whatsapp');

const router = express.Router();

// Notificacoes in-app do usuario
router.get('/', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM inapp_notifications
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [req.user.id]);
  const unread = await query(
    `SELECT count(*)::int AS c FROM inapp_notifications
     WHERE user_id = $1 AND is_read = FALSE`, [req.user.id]);
  // "Meus chamados" com novidade: os que eu abri ou que estao comigo e tem notificacao nao lida
  const mine = await query(
    `SELECT DISTINCT n.ticket_id FROM inapp_notifications n
     JOIN tickets t ON t.id = n.ticket_id
     WHERE n.user_id = $1 AND n.is_read = FALSE AND n.link IS DISTINCT FROM '#/meus-pedidos'
       AND (t.requester_id = $1 OR t.assigned_user_id = $1)`, [req.user.id]);
  // "Meus pedidos" com novidade: pedidos de material meus que mudaram de situação (comprado, chegou, entregue...)
  const pedidos = await query(
    `SELECT DISTINCT n.ticket_id FROM inapp_notifications n
     WHERE n.user_id = $1 AND n.is_read = FALSE AND n.link = '#/meus-pedidos' AND n.ticket_id IS NOT NULL`, [req.user.id]);
  // desde quando cada chamado tem novidade (o aviso mais antigo não lido): ao abrir o chamado,
  //   o que mudou depois disso (mensagens, etapa do pedido, técnico) pisca de leve
  const desde = await query(
    `SELECT n.ticket_id, min(n.created_at) AS desde FROM inapp_notifications n
     WHERE n.user_id = $1 AND n.is_read = FALSE AND n.ticket_id IS NOT NULL GROUP BY n.ticket_id`, [req.user.id]);
  res.json({ list: rows, unread: unread.rows[0].c, mine_tickets: mine.rows.map((r) => Number(r.ticket_id)), mine_orders: pedidos.rows.map((r) => Number(r.ticket_id)),
    novidade_desde: Object.fromEntries(desde.rows.map((r) => [String(r.ticket_id), r.desde])) });
});

// Marca como lidas: todas, ou so as de um chamado (body.ticket_id: ao abrir o chamado)
router.post('/read', requireAuth, async (req, res) => {
  // { pedidos: true } marca como vistos os avisos de pedido (todos, ou só de um chamado com ticket_id)
  if (req.body && req.body.pedidos) {
    const tid = /^\d+$/.test(String(req.body.ticket_id || '')) ? req.body.ticket_id : null;
    await query(`UPDATE inapp_notifications SET is_read = TRUE
                 WHERE user_id = $1 AND link = '#/meus-pedidos' AND is_read = FALSE ${tid ? 'AND ticket_id = $2' : ''}`, tid ? [req.user.id, tid] : [req.user.id]);
    return res.json({ ok: true });
  }
  const ticketId = req.body && req.body.ticket_id;
  const notifId = req.body && req.body.id;
  if (ticketId != null && /^\d+$/.test(String(ticketId))) {
    await query(`UPDATE inapp_notifications SET is_read = TRUE
                 WHERE user_id = $1 AND ticket_id = $2 AND is_read = FALSE`, [req.user.id, ticketId]);
  } else if (notifId != null && /^\d+$/.test(String(notifId))) {
    // so uma notificacao (ex.: aviso de manutencao, sem chamado)
    await query(`UPDATE inapp_notifications SET is_read = TRUE WHERE user_id = $1 AND id = $2`, [req.user.id, notifId]);
  } else {
    await query(`UPDATE inapp_notifications SET is_read = TRUE WHERE user_id = $1`, [req.user.id]);
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Webhook do WhatsApp Cloud API (Meta)
//  GET  -> verificacao inicial (entregar o verify token)
//  POST -> mensagens recebidas / status de envio
// ---------------------------------------------------------------------
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

router.post('/webhook', (req, res) => {
  // Sempre responder 200 imediatamente (Meta exige)
  res.status(200).end();
  const body = req.body || {};

  const entry = body.entry && body.entry[0];
  const change = entry && entry.changes && entry.changes[0];
  const msg = change && change.value && change.value.messages && change.value.messages[0];

  if (msg) {
    const from = msg.from;
    const text = (msg.text && msg.text.body) || '';
    query(`INSERT INTO notification_log (channel, event, recipient, subject, status, error)
           VALUES ('whatsapp', 'whatsapp.inbound', $1, $2, 'sent', NULL)`,
      [from, text]).catch(() => {});
    console.log(`[whatsapp] Mensagem recebida de ${from}: ${text}`);
  }
});

module.exports = router;