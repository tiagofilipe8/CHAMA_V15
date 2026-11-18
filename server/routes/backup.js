const express = require('express');
const fs = require('fs');
const backup = require('../services/backup');
const { requireAuth, requireRoles } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', requireRoles('admin'), async (req, res) => {
  const list = backup.listBackups();
  res.json(list);
});

router.post('/create', requireRoles('admin'), async (req, res) => {
  try {
    const info = await backup.createBackup();
    res.status(201).json(info);
  } catch (err) {
    res.status(500).json({
      error: 'Falha ao gerar o backup. Verifique se o pg_dump está acessível ao servidor.',
      details: String(err?.message || err),
    });
  }
});

router.get('/download/:name', requireRoles('admin'), async (req, res) => {
  const name = backup.safeName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Nome de backup inválido.' });
  const file = backup.filePath(name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Backup não encontrado.' });
  res.download(file, name);
});

router.delete('/:name', requireRoles('admin'), async (req, res) => {
  const name = backup.safeName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Nome de backup inválido.' });
  try {
    await backup.deleteBackup(name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao remover o backup.', details: String(err?.message || err) });
  }
});

module.exports = router;