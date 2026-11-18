const express = require('express');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const { query } = require('../db');
const { requireAuth, requireRoles } = require('../middleware/auth');
const settingsStore = require('../services/settingsStore');

const router = express.Router();

// Publico: dados para a tela de login (logo/fundo/nome) e preferencias de voz
router.get('/public', async (req, res) => {
  const s = await settingsStore.getAll();
  res.json({
    app_name: s['app.name'],
    logo: s['app.logo'] ? (s['app.logo'].startsWith('http') ? s['app.logo'] : `${config.publicUrl}${s['app.logo']}`) : '',
    background: s['app.background'] ? (s['app.background'].startsWith('http') ? s['app.background'] : `${config.publicUrl}${s['app.background']}`) : '',
    'app.voice_enabled': s['app.voice_enabled'],
    'app.voice_new_ticket': s['app.voice_new_ticket'],
  });
});

router.use(requireAuth);

router.get('/', requireRoles('admin'), async (req, res) => {
  const s = await settingsStore.getAll(true);
  res.json(s);
});

router.post('/', requireRoles('admin'), async (req, res) => {
  const entries = Object.entries(req.body || {});
  if (!entries.length) return res.status(422).json({ error: 'Nada para salvar.' });
  // Reforca a lista permitida no servidor
  const clean = entries.filter(([k]) => k in settingsStore.ALLOWED_KEYS);
  try {
    await settingsStore.setMany(clean);
    const settings = await settingsStore.getAll(true);
    res.json(settings);
  } catch (err) {
    res.status(400).json({ error: 'Erro ao salvar configurações.', details: err.message });
  }
});

// Upload de logo/fundo (e futuras imagens do sistema)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadsDir),
  filename: (req, file, cb) => {
    const stamp = Date.now();
    const safe = file.originalname.replace(/[^\w.\-]/g, '_').slice(-40);
    cb(null, `${file.fieldname}-${stamp}-${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif|svg\+xml)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Somente imagens são permitidas (PNG, JPG, WEBP, GIF, SVG)'));
  },
});

router.post('/upload', requireRoles('admin'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(422).json({ error: 'Envie um arquivo de imagem.' });
  const key = req.body?.key === 'background' ? 'app.background'
    : req.body?.key === 'logo' ? 'app.logo'
    : null;
  const url = `/uploads/${req.file.filename}`;
  if (key) {
    await query(`INSERT INTO settings (key, value, updated_at)
                 VALUES ($1, $2, now())
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, url]);
    await settingsStore.getAll(true);
  }
  res.json({ key, url });
});

module.exports = router;