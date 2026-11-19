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
     WHERE n.user_id = $1 AND n.is_read = FALSE
       AND (t.requester_id = $1 OR t.assigned_user_id = $1)`, [req.user.id]);
  res.json({ list: rows, unread: unread.rows[0].c, mine_tickets: mine.rows.map((r) => Number(r.ticket_id)) });
});

// Marca como lidas: todas, ou so as de um chamado (body.ticket_id: ao abrir o chamado)
router.post('/read', requireAuth, async (req, res) => {
  const ticketId = req.body && req.body.ticket_id;
  if (ticketId != null && /^\d+$/.test(String(ticketId))) {
    await query(`UPDATE inapp_notifications SET is_read = TRUE
                 WHERE user_id = $1 AND ticket_id = $2 AND is_read = FALSE`, [req.user.id, ticketId]);
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