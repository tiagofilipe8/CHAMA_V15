const express = require('express');
const whatsapp = require('../services/whatsapp');
const { requireAuth, requireRoles } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/status', requireRoles('admin'), async (req, res) => {
  const status = whatsapp.getStatus();
  let qr = null;
  if (status.hasQr) qr = await whatsapp.getQrDataUrl().catch(() => null);
  res.json({ ...status, qr });
});

router.post('/disconnect', requireRoles('admin'), async (req, res) => {
  await whatsapp.disconnect();
  res.json({ ok: true });
});

router.post('/reconnect', requireRoles('admin'), async (req, res) => {
  whatsapp.start();
  res.json({ ok: true });
});

router.post('/test', requireRoles('admin'), async (req, res) => {
  const { phone } = req.body || {};
  const message = (req.body && typeof req.body.message === 'string' && req.body.message.trim())
    ? req.body.message.trim() : 'Mensagem de teste do sistema de OS.';
  try {
    const r = await whatsapp.sendTextMessage(phone, message);
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(422).json({ error: err.message, code: err.code || 'WHATSAPP_SEND_ERROR' });
  }
});

module.exports = router;