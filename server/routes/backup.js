const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
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

// Importar um backup (.sql) enviado do computador: troca TODO o banco pelo do arquivo
const tmpDir = path.join(backup.backupsDir, '_recebidos');
const recebe = multer({
  dest: tmpDir,
  limits: { fileSize: 1024 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (/\.sql$/i.test(file.originalname) ? cb(null, true) : cb(new Error('Envie o arquivo .sql do backup.'))),
});
async function responderImportacao(res, origem) {
  try {
    const r = await backup.importBackup(origem);
    res.json(r);
  } catch (err) {
    console.error('[backup] importação:', err.message);
    res.status(err.publico ? 422 : 500).json({
      error: err.publico ? err.message : 'Falha ao importar o backup. Verifique se o psql está acessível ao servidor.',
      seguranca: err.seguranca || null,
      details: err.publico ? undefined : String(err?.message || err),
    });
  }
}

router.post('/import', requireRoles('admin'), (req, res) => {
  fs.mkdirSync(tmpDir, { recursive: true });
  recebe.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo grande demais (máximo 1 GB).' : err.message;
      return res.status(422).json({ error: msg });
    }
    if (!req.file) return res.status(422).json({ error: 'Envie o arquivo .sql do backup.' });
    if (String(req.body?.confirmacao || '').trim().toUpperCase() !== 'IMPORTAR') {
      fs.unlink(req.file.path, () => {});
      return res.status(422).json({ error: 'Digite IMPORTAR para confirmar.' });
    }
    try { await responderImportacao(res, req.file.path); } finally { fs.unlink(req.file.path, () => {}); }
  });
});

// Restaurar um dos backups guardados no servidor
router.post('/restore/:name', requireRoles('admin'), async (req, res) => {
  const name = backup.safeName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Nome de backup inválido.' });
  if (String(req.body?.confirmacao || '').trim().toUpperCase() !== 'IMPORTAR') return res.status(422).json({ error: 'Digite IMPORTAR para confirmar.' });
  const file = backup.filePath(name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Backup não encontrado.' });
  await responderImportacao(res, file);
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