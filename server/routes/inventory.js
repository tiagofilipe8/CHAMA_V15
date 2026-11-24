const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const regrasArquivo = require('../uploadRules');
const config = require('../config');
const { query } = require('../db');
const {
  requireAuth, scopeConditions, canAccessEntity, isStaff, isMaster, entityIdsOf, has,
} = require('../middleware/auth');

// Inventario: ver exige "Ver o inventario"; criar/editar/excluir exige "Cadastrar e editar equipamentos"
const requireInv = [requireAuth, (req, res, next) => {
  const perm = req.method === 'GET' ? 'inventory.view' : 'inventory.manage';
  // a lista simples de equipamentos tambem serve para escolher o equipamento ao abrir chamado
  if (req.method === 'GET' && req.path === '/assets' && has(req.user, 'ticket.create')) return next();
  if (!has(req.user, perm)) return res.status(403).json({ error: 'Seu perfil não tem permissão para esta ação no inventário.' });
  next();
}];

const router = express.Router();

// Storage para fotos de ativos — reutiliza config.uploadsDir
const assetPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!/^\d+$/.test(String(req.params.id))) return cb(new Error('Equipamento inválido.'));
    const dir = path.join(config.uploadsDir, 'assets', String(req.params.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = regrasArquivo.extensaoSegura(file.originalname);
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, name);
  },
});
const assetPhotoUpload = multer({
  storage: assetPhotoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = regrasArquivo.extensao(file.originalname);
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext) && regrasArquivo.aceitaArquivo(file)) cb(null, true);
    else cb(new Error('Apenas JPEG, PNG e WEBP são permitidos'));
  },
});

// canAccessEntity vem de ../middleware/auth (equipe: todas; admin local/gestor/usuario: as proprias empresas)

// Normaliza datas vindas do agente (evita /Date(...)/ e formatos WMI inválidos)
function sanitizeDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^\/Date\((-?\d+)/);
  if (m) {
    const d = new Date(Number(m[1]));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const dmtf = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (dmtf) return `${dmtf[1]}-${dmtf[2]}-${dmtf[3]}`;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function sanitizeTz(v) {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^\/Date\((-?\d+)/);
  if (m) {
    const d = new Date(Number(m[1]));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ------------------- ASSETS -------------------

// Lista ativos com filtros
router.get('/assets', requireInv, async (req, res) => {
  const { entity_id, type, status, q, limit } = req.query;
  const user = req.user;
  const conds = [];
  const params = [];
  const add = (sql, val) => { params.push(val); conds.push(sql.replace('?', `$${params.length}`)); };
  if (entity_id) {
    if (!canAccessEntity(user, entity_id)) return res.status(403).json({ error: 'Acesso negado a esta entidade' });
    add('a.entity_id = ?', entity_id);
  } else if (!isStaff(user)) {
    // fora da equipe: apenas as empresas do usuario
    add('a.entity_id::text = ANY(?::text[])', entityIdsOf(user));
  }
  if (type) add('a.type = ?', type);
  if (status) add('a.status = ?', status);
  if (q) {
    const like = `%${q}%`;
    params.push(like, like, like, like);
    conds.push(`(a.name ILIKE $${params.length-3} OR a.asset_tag ILIKE $${params.length-2} OR a.serial_number ILIKE $${params.length-1} OR a.model ILIKE $${params.length})`);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const lim = Math.min(parseInt(limit,10)||100, 500);
  const { rows } = await query(
    `SELECT a.*, e.name AS entity_name, u.name AS responsible_name,
            (SELECT count(*) FROM asset_photos ap WHERE ap.asset_id=a.id)::int AS photos_count,
            COALESCE(
              a.primary_photo_id,
              (SELECT ap.id FROM asset_photos ap WHERE ap.asset_id=a.id ORDER BY ap.is_primary DESC, ap.created_at ASC LIMIT 1)
            ) AS display_photo_id,
            ag.status AS agent_status, ag.last_seen_at AS agent_last_seen
     FROM assets a
     JOIN entities e ON e.id=a.entity_id
     LEFT JOIN users u ON u.id=a.responsible_user_id
     LEFT JOIN agents ag ON ag.asset_id=a.id
     ${where}
     ORDER BY a.updated_at DESC LIMIT ${lim}`, params);
  res.json(rows);
});

// Detalhe do ativo
router.get('/assets/:id', requireInv, async (req, res) => {
  const { rows } = await query(
    `SELECT a.*, e.name AS entity_name, u.name AS responsible_name
     FROM assets a
     JOIN entities e ON e.id=a.entity_id
     LEFT JOIN users u ON u.id=a.responsible_user_id
     WHERE a.id=$1`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Ativo não encontrado' });
  const asset = rows[0];
  if (!canAccessEntity(req.user, asset.entity_id)) return res.status(403).json({ error: 'Acesso negado' });
  // hardware
  const [details, mem, storage, gpu, net, software, photos, history, agent, tickets, maints] = await Promise.all([
    query('SELECT * FROM computer_details WHERE asset_id=$1', [asset.id]),
    query('SELECT * FROM computer_memory WHERE asset_id=$1 ORDER BY slot', [asset.id]),
    query('SELECT * FROM computer_storage WHERE asset_id=$1', [asset.id]),
    query('SELECT * FROM computer_gpu WHERE asset_id=$1', [asset.id]),
    query('SELECT * FROM computer_network_interfaces WHERE asset_id=$1', [asset.id]),
    query('SELECT * FROM computer_software WHERE asset_id=$1 ORDER BY name', [asset.id]),
    query('SELECT ap.*, u.name AS uploaded_by_name FROM asset_photos ap LEFT JOIN users u ON u.id=ap.uploaded_by WHERE ap.asset_id=$1 ORDER BY ap.is_primary DESC, ap.created_at ASC', [asset.id]),
    query('SELECT h.*, u.name AS user_name FROM asset_history h LEFT JOIN users u ON u.id=h.user_id WHERE h.asset_id=$1 ORDER BY h.created_at DESC LIMIT 100', [asset.id]),
    query('SELECT * FROM agents WHERE asset_id=$1', [asset.id]),
    query(`SELECT t.id, ('#' || t.id) AS number, t.title, t.status, t.priority FROM tickets t WHERE t.asset_id=$1 ORDER BY t.updated_at DESC LIMIT 20`, [asset.id]),
    query(`SELECT m.*, u.name AS created_by_name
           FROM asset_maintenances m
           LEFT JOIN users u ON u.id=m.created_by
           WHERE m.asset_id=$1
           ORDER BY m.performed_at DESC, m.created_at DESC`, [asset.id]),
  ]);
  res.json({
    ...asset,
    computer: details.rows[0] || null,
    memory: mem.rows,
    storage: storage.rows,
    gpu: gpu.rows,
    network: net.rows,
    software: software.rows,
    photos: photos.rows,
    history: history.rows,
    agent: agent.rows[0] || null,
    tickets: tickets.rows,
    maintenances: maints.rows,
  });
});

// Criar ativo
router.post('/assets', requireInv, async (req, res) => {
  const user = req.user;
  const { entity_id, asset_tag, name, type, status, manufacturer, model, serial_number, description, location, department, responsible_user_id, purchase_date, warranty_expiration, next_maintenance_date, next_maintenance_notes, notes, mac_address, memory_info, hd_info, cpu_info, os_info, license_info, ip_address, webcam, eth_port, toner, cilindro } = req.body || {};
  let entId = entity_id;
  if (!isStaff(user) && !(entId && canAccessEntity(user, entId))) entId = user.entity_id;
  if (!entId) return res.status(422).json({ error: 'Entidade é obrigatória' });
  if (!canAccessEntity(user, entId)) return res.status(403).json({ error: 'Acesso negado a esta entidade' });
  if (!name) return res.status(422).json({ error: 'Nome do ativo é obrigatório' });
  if (next_maintenance_date && !(next_maintenance_notes && String(next_maintenance_notes).trim())) {
    return res.status(422).json({ error: 'Informe o que será feito na próxima manutenção (obrigatório com a data)' });
  }
  const t = String(type || 'OTHER');
  if (!['COMPUTER','NOTEBOOK','SERVER','PRINTER','MONITOR','UPS','NETWORK_DEVICE','MOBILE_DEVICE','OTHER'].includes(t)) return res.status(422).json({ error: 'Tipo inválido' });
  try {
    const { rows } = await query(
      `INSERT INTO assets (entity_id, asset_tag, name, type, status, manufacturer, model, serial_number, description, location, department, responsible_user_id, purchase_date, warranty_expiration, next_maintenance_date, next_maintenance_notes, notes, mac_address, memory_info, hd_info, cpu_info, os_info, license_info, ip_address, webcam, eth_port, toner, cilindro, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29) RETURNING *`,
      [entId, asset_tag||null, name, t, status||'ACTIVE', manufacturer||null, model||null, serial_number||null, description||null, location||null, department||null, responsible_user_id||null, purchase_date||null, warranty_expiration||null, next_maintenance_date||null, next_maintenance_notes||null, notes||null, mac_address||null, memory_info||null, hd_info||null, cpu_info||null, os_info||null, license_info||null, ip_address||null,
       webcam === true || webcam === false ? webcam : null,
       eth_port === true || eth_port === false ? eth_port : null,
       toner||null, cilindro||null, user.id]);
    await query(`INSERT INTO asset_history (asset_id, user_id, action, field, new_value) VALUES ($1,$2,'AssetCreated','name',$3)`, [rows[0].id, user.id, name]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (String(e.message).includes('duplicate key') || String(e.message).includes('asset_tag')) return res.status(409).json({ error: 'Patrimônio já cadastrado' });
    res.status(400).json({ error: 'Erro ao criar ativo', details: e.message });
  }
});

// Atualizar ativo
router.patch('/assets/:id', requireInv, async (req, res) => {
  const { rows } = await query('SELECT * FROM assets WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Ativo não encontrado' });
  const asset = rows[0];
  if (!canAccessEntity(req.user, asset.entity_id)) return res.status(403).json({ error: 'Acesso negado' });
  const fields = ['name','asset_tag','type','status','manufacturer','model','serial_number','description','location','department','responsible_user_id','purchase_date','warranty_expiration','next_maintenance_date','next_maintenance_notes','notes','mac_address','memory_info','hd_info','cpu_info','os_info','license_info','ip_address','webcam','eth_port','toner','cilindro'];
  const params = [req.params.id];
  const sets = [];
  const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  // preserva boolean false (nao vira null)
  for (const f of fields) if (req.body[f] !== undefined) add(f, req.body[f] === false ? false : (req.body[f] || null));
  const effDate = req.body.next_maintenance_date !== undefined ? req.body.next_maintenance_date : asset.next_maintenance_date;
  const effNotes = req.body.next_maintenance_notes !== undefined ? req.body.next_maintenance_notes : asset.next_maintenance_notes;
  if (effDate && !(effNotes && String(effNotes).trim())) {
    return res.status(422).json({ error: 'Informe o que será feito na próxima manutenção (obrigatório com a data)' });
  }
  if (req.body.next_maintenance_date !== undefined
      && String(asset.next_maintenance_date || '') !== String(req.body.next_maintenance_date || '')) {
    add('maintenance_alert_notified_date', null);
  }
  // transferência de entidade
  if (req.body.entity_id !== undefined && String(req.body.entity_id) !== String(asset.entity_id)) {
    if (!canAccessEntity(req.user, req.body.entity_id)) return res.status(403).json({ error: 'Acesso negado à nova entidade' });
    add('entity_id', req.body.entity_id);
    await query(`INSERT INTO asset_customer_history (asset_id, old_entity_id, new_entity_id, user_id, reason) VALUES ($1,$2,$3,$4,$5)`, [asset.id, asset.entity_id, req.body.entity_id, req.user.id, req.body.transfer_reason||null]);
    await query(`INSERT INTO asset_history (asset_id, user_id, action, field, old_value, new_value) VALUES ($1,$2,'AssetTransferred','entity_id',$3,$4)`, [asset.id, req.user.id, asset.entity_id, req.body.entity_id]);
  }
  if (!sets.length) return res.status(422).json({ error: 'Nenhum campo para atualizar' });
  // registra histórico de mudanças
  for (const f of fields) if (req.body[f] !== undefined && String(req.body[f]||'') !== String(asset[f]||'')) {
    await query(`INSERT INTO asset_history (asset_id, user_id, action, field, old_value, new_value) VALUES ($1,$2,'AssetUpdated',$3,$4,$5)`, [asset.id, req.user.id, f, String(asset[f]||''), String(req.body[f]||'')]);
  }
  const { rows: updated } = await query(`UPDATE assets SET ${sets.join(', ')} WHERE id=$1 RETURNING *`, params);
  res.json(updated[0]);
});

// Excluir ativo
router.delete('/assets/:id', requireInv, async (req, res) => {
  const { rows } = await query('SELECT * FROM assets WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Ativo não encontrado' });
  if (!canAccessEntity(req.user, rows[0].entity_id)) return res.status(403).json({ error: 'Acesso negado' });
  await query('DELETE FROM assets WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ------------------- FOTOS -------------------

router.post('/assets/:id/photos', requireInv, assetPhotoUpload.single('photo'), async (req, res) => {
  const assetId = req.params.id;
  const { rows } = await query('SELECT * FROM assets WHERE id=$1', [assetId]);
  if (!rows.length) { regrasArquivo.apagarGravados([req.file].filter(Boolean)); return res.status(404).json({ error: 'Ativo não encontrado' }); }
  if (!canAccessEntity(req.user, rows[0].entity_id)) { regrasArquivo.apagarGravados([req.file].filter(Boolean)); return res.status(403).json({ error: 'Acesso negado' }); }
  if (!req.file) return res.status(422).json({ error: 'Envie uma foto' });
  const ruim = regrasArquivo.conferirGravados([req.file]);
  if (ruim) return res.status(422).json({ error: ruim });
  const caption = req.body.caption || null;
  const isPrimary = req.body.is_primary === 'true' || req.body.is_primary === true;
  if (isPrimary) await query('UPDATE asset_photos SET is_primary=false WHERE asset_id=$1', [assetId]);
  const storagePath = path.join('uploads','assets',String(assetId), req.file.filename).replace(/\\/g,'/');
  const { rows: photo } = await query(
    `INSERT INTO asset_photos (asset_id, file_name, storage_path, mime_type, file_size, caption, is_primary, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [assetId, req.file.originalname, storagePath, req.file.mimetype, req.file.size, caption, isPrimary, req.user.id]);
  if (isPrimary) await query('UPDATE assets SET primary_photo_id=$1 WHERE id=$2', [photo[0].id, assetId]);
  await query(`INSERT INTO asset_history (asset_id, user_id, action, field, new_value) VALUES ($1,$2,'PhotoAdded','photo',$3)`, [assetId, req.user.id, caption||req.file.originalname]);
  res.status(201).json(photo[0]);
});

router.get('/assets/:id/photos', requireInv, async (req, res) => {
  const { rows } = await query('SELECT * FROM assets WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Ativo não encontrado' });
  if (!canAccessEntity(req.user, rows[0].entity_id)) return res.status(403).json({ error: 'Acesso negado' });
  const { rows: photos } = await query('SELECT ap.*, u.name AS uploaded_by_name FROM asset_photos ap LEFT JOIN users u ON u.id=ap.uploaded_by WHERE ap.asset_id=$1 ORDER BY ap.is_primary DESC, ap.created_at ASC', [req.params.id]);
  res.json(photos);
});

router.delete('/assets/:assetId/photos/:photoId', requireInv, async (req, res) => {
  const { rows } = await query('SELECT a.* FROM assets a JOIN asset_photos ap ON ap.asset_id=a.id WHERE ap.id=$1', [req.params.photoId]);
  if (!rows.length) return res.status(404).json({ error: 'Foto não encontrada' });
  if (!canAccessEntity(req.user, rows[0].entity_id)) return res.status(403).json({ error: 'Acesso negado' });
  const { rows: p } = await query('SELECT * FROM asset_photos WHERE id=$1', [req.params.photoId]);
  if (!p.length) return res.status(404).json({ error: 'Foto não encontrada' });
  try { fs.unlinkSync(path.join(config.uploadsDir, 'assets', String(req.params.assetId), path.basename(p[0].storage_path))); } catch {}
  await query('DELETE FROM asset_photos WHERE id=$1', [req.params.photoId]);
  await query(`INSERT INTO asset_history (asset_id, user_id, action, field, old_value) VALUES ($1,$2,'PhotoRemoved','photo',$3)`, [req.params.assetId, req.user.id, p[0].caption||p[0].file_name]);
  res.json({ ok: true });
});

router.post('/assets/:assetId/photos/:photoId/primary', requireInv, async (req, res) => {
  const { rows } = await query('SELECT a.* FROM assets a JOIN asset_photos ap ON ap.asset_id=a.id WHERE ap.id=$1', [req.params.photoId]);
  if (!rows.length) return res.status(404).json({ error: 'Foto não encontrada' });
  if (!canAccessEntity(req.user, rows[0].entity_id)) return res.status(403).json({ error: 'Acesso negado' });
  await query('UPDATE asset_photos SET is_primary=false WHERE asset_id=$1', [req.params.assetId]);
  await query('UPDATE asset_photos SET is_primary=true WHERE id=$1', [req.params.photoId]);
  await query('UPDATE assets SET primary_photo_id=$1 WHERE id=$2', [req.params.photoId, req.params.assetId]);
  res.json({ ok: true });
});

// Servir foto com autorização (header Bearer ou ?token= — <img> nao envia header)
router.get('/assets/:assetId/photos/:photoId/file', async (req, res, next) => {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = 'Bearer ' + String(req.query.token);
  }
  return requireAuth(req, res, async () => {
    try {
      const { rows } = await query('SELECT a.entity_id, ap.storage_path, ap.mime_type FROM asset_photos ap JOIN assets a ON a.id=ap.asset_id WHERE ap.id=$1 AND ap.asset_id=$2', [req.params.photoId, req.params.assetId]);
      if (!rows.length) return res.status(404).json({ error: 'Foto não encontrada' });
      if (!canAccessEntity(req.user, rows[0].entity_id)) return res.status(403).json({ error: 'Acesso negado' });
      const filePath = path.join(config.uploadsDir, 'assets', String(req.params.assetId), path.basename(rows[0].storage_path));
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado' });
      res.type(rows[0].mime_type).sendFile(path.resolve(filePath));
    } catch (err) {
      next(err);
    }
  });
});

// ------------------- AGENTES -------------------

// Provisionamento - gera token para instalação
router.post('/agents/provision', requireInv, async (req, res) => {
  const { entity_id } = req.body || {};
  let entId = entity_id;
  if (!isStaff(req.user) && !(entId && canAccessEntity(req.user, entId))) entId = req.user.entity_id;
  if (!entId) return res.status(422).json({ error: 'Entidade é obrigatória' });
  if (!canAccessEntity(req.user, entId)) return res.status(403).json({ error: 'Acesso negado' });
  const token = `${entId}-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + 24*3600*1000);
  await query(`INSERT INTO agent_credentials (entity_id, provision_token_hash, provision_expires_at) VALUES ($1,$2,$3)`, [entId, hash, expires]);
  res.json({ token, entity_id: entId, expires_at: expires });
});

// Listar agentes
router.get('/agents', requireInv, async (req, res) => {
  const user = req.user;
  const cond = [];
  const params = [];
  if (!isStaff(user)) {
    cond.push(`ag.entity_id::text = ANY($${params.length+1}::text[])`);
    params.push(entityIdsOf(user));
  } else if (req.query.entity_id) {
    cond.push(`ag.entity_id = $${params.length+1}`);
    params.push(req.query.entity_id);
  }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const { rows } = await query(
    `SELECT ag.*, a.name AS asset_name, a.asset_tag, e.name AS entity_name
     FROM agents ag
     LEFT JOIN assets a ON a.id=ag.asset_id
     LEFT JOIN entities e ON e.id=ag.entity_id
     ${where}
     ORDER BY ag.last_seen_at DESC NULLS LAST`, params);
  res.json(rows);
});

// Agent auth middleware
async function requireAgentAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!token) return res.status(401).json({ error: 'Token do agente não informado' });
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const { rows } = await query(
    `SELECT ac.id AS credential_id, ac.entity_id AS credential_entity_id, ag.*
     FROM agent_credentials ac
     JOIN agents ag ON ag.id=ac.agent_id
     WHERE ac.token_hash=$1 AND ac.revoked=false`, [hash]);
  if (!rows.length) return res.status(401).json({ error: 'Credencial inválida' });
  req.agent = rows[0];
  next();
}

// Registro do agente (via provision token)
router.post('/agents/register', async (req, res) => {
  const { provision_token, agent_id, machine_guid, hardware_fingerprint, hostname, ip, version } = req.body || {};
  if (!provision_token || !agent_id) return res.status(422).json({ error: 'provision_token e agent_id são obrigatórios' });
  const phash = crypto.createHash('sha256').update(provision_token).digest('hex');
  const { rows } = await query('SELECT * FROM agent_credentials WHERE provision_token_hash=$1 AND provision_expires_at > now() AND revoked=false', [phash]);
  if (!rows.length) return res.status(401).json({ error: 'Token de provisionamento inválido ou expirado' });
  const prov = rows[0];
  // verifica se agent já existe
  let agent;
  const existing = await query('SELECT * FROM agents WHERE agent_id=$1', [agent_id]);
  if (existing.rows.length) {
    agent = existing.rows[0];
    await query('UPDATE agents SET machine_guid=$1, hardware_fingerprint=$2, hostname=$3, ip=$4, version=$5, last_seen_at=now(), status=$6 WHERE id=$7',
      [machine_guid||agent.machine_guid, hardware_fingerprint||agent.hardware_fingerprint, hostname||agent.hostname, ip||agent.ip, version||agent.version, 'ONLINE', agent.id]);
  } else {
    const ins = await query(
      `INSERT INTO agents (agent_id, machine_guid, hardware_fingerprint, hostname, ip, version, status, last_seen_at, entity_id)
       VALUES ($1,$2,$3,$4,$5,$6,'ONLINE',now(),$7) RETURNING *`,
      [agent_id, machine_guid||null, hardware_fingerprint||null, hostname||null, ip||null, version||null, prov.entity_id]);
    agent = ins.rows[0];
    // cria asset automaticamente se não existir vínculo
    const assetIns = await query(
      `INSERT INTO assets (entity_id, name, type, status, last_seen_at, created_by)
       VALUES ($1,$2,'COMPUTER','ACTIVE',now(),NULL) RETURNING *`,
      [prov.entity_id, hostname || `PC-${agent_id.slice(0,8)}`]);
    await query('UPDATE agents SET asset_id=$1 WHERE id=$2', [assetIns.rows[0].id, agent.id]);
    agent.asset_id = assetIns.rows[0].id;
  }
  // gera credencial permanente para o agente
  const agentToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(agentToken).digest('hex');
  await query('UPDATE agent_credentials SET token_hash=$1, agent_id=$2, entity_id=$3, provision_token_hash=NULL, provision_expires_at=NULL WHERE id=$4', [tokenHash, agent.id, prov.entity_id, prov.id]);
  res.json({ agent_token: agentToken, agent_id: agent.agent_id, asset_id: agent.asset_id, entity_id: prov.entity_id });
});

// Heartbeat
router.post('/agents/heartbeat', requireAgentAuth, async (req, res) => {
  const { version, hostname, ip } = req.body || {};
  await query('UPDATE agents SET last_seen_at=now(), status=$1, version=COALESCE($2, version), hostname=COALESCE($3, hostname), ip=COALESCE($4, ip) WHERE id=$5',
    ['ONLINE', version||null, hostname||null, ip||null, req.agent.id]);
  res.json({ ok: true, interval: 15*60 });
});

// Config para agente
router.get('/agents/config', requireAgentAuth, async (req, res) => {
  res.json({ interval: 15*60, version: '1.0.0' });
});

// Inventário (FULL ou INCREMENTAL)
router.post('/agents/inventory', requireAgentAuth, async (req, res) => {
  const agent = req.agent;
  const { type, hostname, os, cpu, memory, storage, gpu, motherboard, bios, network, software } = req.body || {};
  const assetId = agent.asset_id;
  if (!assetId) return res.status(422).json({ error: 'Agente sem ativo vinculado' });
  // atualiza last_seen e computer_details
  await query('UPDATE agents SET last_seen_at=now(), last_inventory_at=now(), status=$1 WHERE id=$2', ['ONLINE', agent.id]);
  await query('UPDATE assets SET last_seen_at=now() WHERE id=$1', [assetId]);

  // Upsert computer_details
  await query(
    `INSERT INTO computer_details (asset_id, hostname, domain, os_name, os_edition, os_version, os_build, os_arch, last_boot, cpu_manufacturer, cpu_model, cpu_cores, cpu_threads, cpu_frequency_mhz, cpu_arch, motherboard_manufacturer, motherboard_model, motherboard_serial, bios_manufacturer, bios_version, bios_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (asset_id) DO UPDATE SET hostname=EXCLUDED.hostname, domain=EXCLUDED.domain, os_name=EXCLUDED.os_name, os_edition=EXCLUDED.os_edition, os_version=EXCLUDED.os_version, os_build=EXCLUDED.os_build, os_arch=EXCLUDED.os_arch, last_boot=EXCLUDED.last_boot, cpu_manufacturer=EXCLUDED.cpu_manufacturer, cpu_model=EXCLUDED.cpu_model, cpu_cores=EXCLUDED.cpu_cores, cpu_threads=EXCLUDED.cpu_threads, cpu_frequency_mhz=EXCLUDED.cpu_frequency_mhz, cpu_arch=EXCLUDED.cpu_arch, motherboard_manufacturer=EXCLUDED.motherboard_manufacturer, motherboard_model=EXCLUDED.motherboard_model, motherboard_serial=EXCLUDED.motherboard_serial, bios_manufacturer=EXCLUDED.bios_manufacturer, bios_version=EXCLUDED.bios_version, bios_date=EXCLUDED.bios_date`,
    [assetId, hostname||null, os?.domain||null, os?.name||null, os?.edition||null, os?.version||null, os?.build?String(os.build):null, os?.arch||null, sanitizeTz(os?.last_boot),
     cpu?.manufacturer||null, cpu?.model||null, cpu?.cores||null, cpu?.threads||null, cpu?.frequency||null, cpu?.arch||null,
     motherboard?.manufacturer||null, motherboard?.model||null, motherboard?.serial||null,
     bios?.manufacturer||null, bios?.version||null, sanitizeDate(bios?.date)]);

  // Substitui coleções (simplificado: delete e reinsere) — para INCREMENTAL, compara e registra histórico
  const prevMem = await query('SELECT * FROM computer_memory WHERE asset_id=$1', [assetId]);
  await query('DELETE FROM computer_memory WHERE asset_id=$1', [assetId]);
  for (const m of (memory||[])) {
    await query('INSERT INTO computer_memory (asset_id, slot, manufacturer, part_number, serial, capacity_gb, speed_mhz, type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [assetId, m.slot||null, m.manufacturer||null, m.part_number||null, m.serial||null, m.capacity_gb||null, m.speed_mhz||null, m.type||null]);
  }
  if (JSON.stringify(prevMem.rows) !== JSON.stringify(memory||[])) {
    await query(`INSERT INTO asset_history (asset_id, agent_id, action, field, old_value, new_value) VALUES ($1,$2,'HardwareChanged','memory',$3,$4)`, [assetId, agent.id, JSON.stringify(prevMem.rows).slice(0,2000), JSON.stringify(memory||[]).slice(0,2000)]);
  }

  await query('DELETE FROM computer_storage WHERE asset_id=$1', [assetId]);
  for (const s of (storage||[])) {
    await query('INSERT INTO computer_storage (asset_id, manufacturer, model, serial, capacity_gb, type, interface, firmware) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [assetId, s.manufacturer||null, s.model||null, s.serial||null, s.capacity_gb||null, s.type||null, s.interface||null, s.firmware||null]);
  }
  await query('DELETE FROM computer_gpu WHERE asset_id=$1', [assetId]);
  for (const g of (gpu||[])) {
    await query('INSERT INTO computer_gpu (asset_id, manufacturer, model, memory_gb, driver_version) VALUES ($1,$2,$3,$4,$5)',
      [assetId, g.manufacturer||null, g.model||null, g.memory_gb||null, g.driver_version||null]);
  }
  await query('DELETE FROM computer_network_interfaces WHERE asset_id=$1', [assetId]);
  for (const n of (network||[])) {
    await query('INSERT INTO computer_network_interfaces (asset_id, name, manufacturer, model, mac, ip, speed_mbps, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [assetId, n.name||null, n.manufacturer||null, n.model||null, n.mac||null, n.ip||null, n.speed_mbps||null, n.status||null]);
  }
  // Software — compara para histórico
  const prevSw = await query('SELECT name, version FROM computer_software WHERE asset_id=$1', [assetId]);
  const prevMap = new Map(prevSw.rows.map(r=> [r.name, r.version]));
  await query('DELETE FROM computer_software WHERE asset_id=$1', [assetId]);
  for (const sw of (software||[])) {
    try { await query('INSERT INTO computer_software (asset_id, name, publisher, version, arch, install_date, product_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [assetId, sw.name, sw.publisher||null, sw.version||null, sw.arch||null, sanitizeDate(sw.install_date), sw.product_id||null]); } catch {}
    if (!prevMap.has(sw.name)) await query(`INSERT INTO asset_history (asset_id, agent_id, action, field, new_value) VALUES ($1,$2,'SoftwareInstalled','software',$3)`, [assetId, agent.id, `${sw.name} ${sw.version||''}`.trim()]);
    else if (prevMap.get(sw.name) !== sw.version) await query(`INSERT INTO asset_history (asset_id, agent_id, action, field, old_value, new_value) VALUES ($1,$2,'SoftwareUpdated','software',$3,$4)`, [assetId, agent.id, `${sw.name} ${prevMap.get(sw.name)}`, `${sw.name} ${sw.version}`]);
  }
  for (const [name, ver] of prevMap) if (!(software||[]).find(s=>s.name===name)) {
    await query(`INSERT INTO asset_history (asset_id, agent_id, action, field, old_value) VALUES ($1,$2,'SoftwareRemoved','software',$3)`, [assetId, agent.id, `${name} ${ver}`]);
  }

  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
  await query('INSERT INTO inventory_snapshots (asset_id, agent_id, type, payload_hash, payload) VALUES ($1,$2,$3,$4,$5)', [assetId, agent.id, type||'FULL', payloadHash, JSON.stringify(req.body)]);

  res.json({ ok: true });
});

// ------------------- HISTORICO DE MANUTENCOES -------------------

function canEditMaintenance(user, row) {
  return isMaster(user) || String(user.id) === String(row.created_by);
}

// Listar manutencoes do ativo
router.get('/assets/:id/maintenances', requireInv, async (req, res) => {
  const { rows } = await query('SELECT * FROM assets WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Ativo não encontrado' });
  if (!canAccessEntity(req.user, rows[0].entity_id)) return res.status(403).json({ error: 'Acesso negado' });
  const { rows: list } = await query(
    `SELECT m.*, u.name AS created_by_name
     FROM asset_maintenances m
     LEFT JOIN users u ON u.id=m.created_by
     WHERE m.asset_id=$1
     ORDER BY m.performed_at DESC, m.created_at DESC`, [req.params.id]);
  res.json(list);
});

// Registrar manutencao realizada
router.post('/assets/:id/maintenances', requireInv, async (req, res) => {
  const { rows } = await query('SELECT * FROM assets WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Ativo não encontrado' });
  if (!canAccessEntity(req.user, rows[0].entity_id)) return res.status(403).json({ error: 'Acesso negado' });
  const { performed_at, description } = req.body || {};
  const desc = (description || '').trim();
  if (!desc) return res.status(422).json({ error: 'Descreva o que foi feito na manutenção' });
  const when = performed_at || new Date().toISOString().slice(0, 10);
  try {
    const { rows: created } = await query(
      `INSERT INTO asset_maintenances (asset_id, performed_at, description, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, when, desc, req.user.id]);
    await query(
      `INSERT INTO asset_history (asset_id, user_id, action, field, new_value)
       VALUES ($1,$2,'MaintenancePerformed','maintenance',$3)`,
      [req.params.id, req.user.id, desc.slice(0, 500)]);
    const { rows: full } = await query(
      `SELECT m.*, u.name AS created_by_name
       FROM asset_maintenances m LEFT JOIN users u ON u.id=m.created_by
       WHERE m.id=$1`, [created[0].id]);
    res.status(201).json(full[0]);
  } catch (e) {
    res.status(400).json({ error: 'Erro ao registrar manutenção', details: e.message });
  }
});

// Alterar manutencao — somente quem criou ou admin
router.patch('/assets/:assetId/maintenances/:id', requireInv, async (req, res) => {
  const { rows } = await query('SELECT * FROM assets WHERE id=$1', [req.params.assetId]);
  if (!rows.length) return res.status(404).json({ error: 'Ativo não encontrado' });
  if (!canAccessEntity(req.user, rows[0].entity_id)) return res.status(403).json({ error: 'Acesso negado' });
  const { rows: m } = await query(
    'SELECT * FROM asset_maintenances WHERE id=$1 AND asset_id=$2',
    [req.params.id, req.params.assetId]);
  if (!m.length) return res.status(404).json({ error: 'Manutenção não encontrada' });
  if (!canEditMaintenance(req.user, m[0])) {
    return res.status(403).json({ error: 'Somente o autor da nota ou um administrador pode alterá-la' });
  }
  const { performed_at, description } = req.body || {};
  const sets = [];
  const params = [req.params.id];
  if (performed_at !== undefined) {
    if (!performed_at) return res.status(422).json({ error: 'Data da manutenção inválida' });
    params.push(performed_at);
    sets.push(`performed_at = $${params.length}`);
  }
  if (description !== undefined) {
    const desc = String(description || '').trim();
    if (!desc) return res.status(422).json({ error: 'Descreva o que foi feito na manutenção' });
    params.push(desc);
    sets.push(`description = $${params.length}`);
  }
  if (!sets.length) return res.status(422).json({ error: 'Nenhum campo para atualizar' });
  sets.push(`updated_at = now()`);
  const { rows: updated } = await query(
    `UPDATE asset_maintenances SET ${sets.join(', ')} WHERE id=$1 RETURNING *`, params);
  const { rows: full } = await query(
    `SELECT m.*, u.name AS created_by_name
     FROM asset_maintenances m LEFT JOIN users u ON u.id=m.created_by
     WHERE m.id=$1`, [updated[0].id]);
  res.json(full[0]);
});

// Histórico do ativo
router.get('/assets/:id/history', requireInv, async (req, res) => {
  const { rows } = await query('SELECT * FROM assets WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Ativo não encontrado' });
  if (!canAccessEntity(req.user, rows[0].entity_id)) return res.status(403).json({ error: 'Acesso negado' });
  const { rows: hist } = await query('SELECT h.*, u.name AS user_name FROM asset_history h LEFT JOIN users u ON u.id=h.user_id WHERE h.asset_id=$1 ORDER BY h.created_at DESC LIMIT 200', [req.params.id]);
  res.json(hist);
});

// Transferência de ativo entre entidades (histórico acompanha)
router.post('/assets/:id/transfer', requireInv, async (req, res) => {
  const { rows } = await query('SELECT * FROM assets WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Ativo não encontrado' });
  if (!canAccessEntity(req.user, rows[0].entity_id)) return res.status(403).json({ error: 'Acesso negado' });
  const { new_entity_id, reason } = req.body || {};
  if (!new_entity_id) return res.status(422).json({ error: 'Nova entidade é obrigatória' });
  if (String(new_entity_id) === String(rows[0].entity_id)) return res.status(422).json({ error: 'Ativo já está nesta entidade' });
  await query('UPDATE assets SET entity_id=$1 WHERE id=$2', [new_entity_id, req.params.id]);
  await query('INSERT INTO asset_customer_history (asset_id, old_entity_id, new_entity_id, user_id, reason) VALUES ($1,$2,$3,$4,$5)', [req.params.id, rows[0].entity_id, new_entity_id, req.user.id, reason||null]);
  await query(`INSERT INTO asset_history (asset_id, user_id, action, field, old_value, new_value) VALUES ($1,$2,'AssetTransferred','entity_id',$3,$4)`, [req.params.id, req.user.id, rows[0].entity_id, new_entity_id]);
  // atualiza agente
  await query('UPDATE agents SET entity_id=$1 WHERE asset_id=$2', [new_entity_id, req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
