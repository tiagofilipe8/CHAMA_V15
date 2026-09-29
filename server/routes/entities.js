const express = require('express');
const multer = require('multer');
const config = require('../config');
const { query } = require('../db');
const { requireAuth, requireRoles } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadsDir),
  filename: (req, file, cb) => {
    const stamp = Date.now();
    const safe = file.originalname.replace(/[^\w.\-]/g, '_').slice(-40);
    cb(null, `${file.fieldname || 'file'}-${stamp}-${safe}`);
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

// Lista entidades
router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT e.*,
            (SELECT count(*) FROM tickets t WHERE t.entity_id = e.id AND t.status NOT IN (6,7)) AS open_tickets,
            (SELECT count(*) FROM users u WHERE u.entity_id = e.id) AS users_count,
            (SELECT count(*) FROM assets a WHERE a.entity_id = e.id AND a.type = 'COMPUTER' AND a.status <> 'DISPOSED') AS computers_count,
            (SELECT count(*) FROM assets a WHERE a.entity_id = e.id AND a.type = 'SERVER' AND a.status <> 'DISPOSED') AS servers_count,
            (SELECT count(*) FROM assets a WHERE a.entity_id = e.id AND a.type = 'NOTEBOOK' AND a.status <> 'DISPOSED') AS notebooks_count
     FROM entities e
     ORDER BY e.name`);
  res.json(rows);
});

// Upload da logomarca do cliente (admin) — retorna apenas a URL
router.post('/upload', requireRoles('admin'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(422).json({ error: 'Envie um arquivo de imagem.' });
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

// Cria entidade (admin)
router.post('/', requireRoles('admin'), async (req, res) => {
  const { name, description, email, phone, address, logo, active, sla_days, sla_hours } = req.body || {};
  if (!name) return res.status(422).json({ error: 'O nome da entidade é obrigatório.' });
  const sd = Math.max(0, parseInt(sla_days, 10) || 0);
  const sh = Math.max(0, Math.min(23, parseInt(sla_hours, 10) || 0));
  try {
    const { rows } = await query(
      `INSERT INTO entities (name, description, email, phone, address, logo, active, sla_days, sla_hours)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, TRUE), $8, $9)
       RETURNING *`, [name, description || null, email || null, phone || null,
                       address || null, logo || null, active === undefined ? true : !!active, sd, sh]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: 'Não foi possível criar a entidade.', details: err.message });
  }
});

router.patch('/:id', requireRoles('admin'), async (req, res) => {
  const id = req.params.id;
  const { name, description, email, phone, address, logo, active, sla_days, sla_hours } = req.body || {};
  const fields = [];
  const params = [id];
  const add = (sql, val) => { params.push(val); fields.push(sql.replace('?', `$${params.length}`)); };
  if (name !== undefined) add('name = ?', name);
  if (description !== undefined) add('description = ?', description);
  if (email !== undefined) add('email = ?', email || null);
  if (phone !== undefined) add('phone = ?', phone || null);
  if (address !== undefined) add('address = ?', address || null);
  if (logo !== undefined) add('logo = ?', logo || null);
  if (active !== undefined) add('active = ?', !!active);
  if (sla_days !== undefined) add('sla_days = ?', Math.max(0, parseInt(sla_days, 10) || 0));
  if (sla_hours !== undefined) add('sla_hours = ?', Math.max(0, Math.min(23, parseInt(sla_hours, 10) || 0)));
  if (!fields.length) return res.status(422).json({ error: 'Nenhum campo para atualizar.' });
  try {
    const { rows } = await query(
      `UPDATE entities SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params);
    if (!rows.length) return res.status(404).json({ error: 'Entidade não encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: 'Não foi possível atualizar a entidade.', details: err.message });
  }
});

router.delete('/:id', requireRoles('admin'), async (req, res) => {
  const { rows } = await query(`SELECT * FROM entities WHERE id = $1`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Entidade não encontrada.' });
  const open = await query(`SELECT count(*)::int AS c FROM tickets WHERE entity_id = $1`, [req.params.id]);
  if (open.rows[0].c > 0) {
    await query(`UPDATE entities SET active = FALSE WHERE id = $1`, [req.params.id]);
    return res.json({ ok: true, message: 'Entidade com chamados foi desativada.' });
  }
  await query(`DELETE FROM entities WHERE id = $1`, [req.params.id]);
  res.json({ ok: true, message: 'Entidade removida.' });
});

module.exports = router;