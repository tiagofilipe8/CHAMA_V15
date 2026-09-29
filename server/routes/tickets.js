const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { query } = require('../db');
const {
  requireAuth, requireRoles, scopeConditions, canModifyTicket,
} = require('../middleware/auth');
const notify = require('../services/notify');
const settingsStore = require('../services/settingsStore');

const router = express.Router();
// ?token= para links de arquivo (a tag <a>/<img> nao envia Authorization)
router.use((req, res, next) => {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = 'Bearer ' + String(req.query.token);
  }
  next();
});
router.use(requireAuth);

// Storage para anexos de chamados
const attStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(config.uploadsDir, 'tickets', String(req.params.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, path.extname(file.originalname))
      .replace(/[^\w\-\u00C0-\u00FF ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'arquivo';
    cb(null, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${base}${ext}`);
  },
});
const attUpload = multer({
  storage: attStorage,
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const ok = /^(image\/(jpeg|png|webp|gif)|application\/pdf|text\/plain|application\/msword|application\/vnd\.openxmlformats-officedocument\.[\w.]+|application\/vnd\.ms-excel|video\/mp4|audio\/mpeg)$/i.test(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error('Tipo de arquivo não permitido (máx. 15MB)'));
  },
});

const TICKET_SELECT = `
  SELECT t.*,
         u_req.name AS requester_name, u_req.email AS requester_email,
         u_asg.name AS assigned_name,
         e.name AS entity_name,
         c.name AS category_name,
         a.name AS asset_name, a.asset_tag,
         tA.name AS approval_requested_by_name,
         tB.name AS approval_responded_by_name
  FROM tickets t
  JOIN entities e ON e.id = t.entity_id
  LEFT JOIN users u_req ON u_req.id = t.requester_id
  LEFT JOIN users u_asg ON u_asg.id = t.assigned_user_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN assets a ON a.id = t.asset_id
  LEFT JOIN users tA ON tA.id = t.approval_requested_by_id
  LEFT JOIN users tB ON tB.id = t.approval_responded_by_id`;

async function loadTicket(id) {
  const { rows } = await query(`${TICKET_SELECT} WHERE t.id = $1`, [id]);
  return rows[0] || null;
}

function visible(ticket, user) {
  if (user.role === 'admin' || user.role === 'technician') return true;
  if (user.role === 'client') {
    if ((user.client_level || 1) === 2) return ticket.entity_id === user.entity_id;
    return ticket.requester_id === user.id;
  }
  return false;
}

// ---------------------------------------------------------------------
// Lista de chamados (painel, filtros e portal do cliente)
// ---------------------------------------------------------------------
router.get('/', async (req, res) => {
  const { status, priority, entity_id, assigned, requester, q, limit } = req.query;
  const scope = scopeConditions(req.user, 1);
  const conds = [];
  const params = [...scope.params];
  const frag = (sql, val) => {
    const parts = Array.isArray(val) ? val : [val];
    const offset = params.length;
    parts.forEach((v) => params.push(v));
    let i = offset;
    conds.push(sql.replace(/\?/g, () => `$${++i}`));
  };

  if (status === 'open') frag(`t.status NOT IN (6,7)`, []);
  else if (status === 'closed') frag(`t.status IN (6,7)`, []);
  else if (status && /^\d+$/.test(status)) frag(`t.status = ?`, parseInt(status, 10));

  if (priority && /^\d+$/.test(priority)) frag(`t.priority = ?`, parseInt(priority, 10));
  if (entity_id && /^\d+$/.test(entity_id)) frag(`t.entity_id = ?`, parseInt(entity_id, 10));
  if (assigned === 'me' && req.user.role !== 'client') frag(`t.assigned_user_id = ?`, req.user.id);
  else if (assigned && /^\d+$/.test(assigned)) frag(`t.assigned_user_id = ?`, parseInt(assigned, 10));
  else if (assigned === 'none') frag(`t.assigned_user_id IS NULL`, []);
  if (requester === 'me') frag(`t.requester_id = ?`, req.user.id);
  else if (requester && /^\d+$/.test(requester)) frag(`t.requester_id = ?`, parseInt(requester, 10));
  if (q) frag(`(t.title ILIKE ? OR t.description ILIKE ? OR t.number ILIKE ?)`,
    [`%${q}%`, `%${q}%`, `%${q}%`]);

  const where = ['TRUE', ...conds].length > 1 ? ['TRUE', ...conds].join(' AND ') : 'TRUE';
  const lim = Math.min(parseInt(limit, 10) || 200, 500);
  const { rows } = await query(
    `${TICKET_SELECT} WHERE (${where}) ${scope.sql ? 'AND ' + scope.sql : ''} ORDER BY t.updated_at DESC LIMIT ${lim}`, params);
  res.json(rows.map((r) => ({
    ...r, approval: notify.APPROVAL_LABELS[r.approval_status],
  })));
});

// ---------------------------------------------------------------------
// Abertura de chamado
// ---------------------------------------------------------------------
router.post('/', async (req, res) => {
  const { title, description, category_id, priority, entity_id, due_at, asset_id } = req.body || {};
  if (!title || !description) {
    return res.status(422).json({ error: 'Título e descrição são obrigatórios.' });
  }
  const user = req.user;

  let entId = entity_id || null;
  if (user.role === 'client') entId = user.entity_id;
  if (!entId) return res.status(422).json({ error: 'Informe a entidade do chamado.' });

  // SLA da entidade: se não informado, usa dias/horas da entidade
  let finalDueAt = due_at || null;
  if (!finalDueAt) {
    try {
      const ent = await query('SELECT sla_days, sla_hours FROM entities WHERE id = $1', [entId]);
      if (ent.rows.length) {
        const sd = Number(ent.rows[0].sla_days) || 0;
        const sh = Number(ent.rows[0].sla_hours) || 0;
        if (sd || sh) {
          const d = new Date();
          d.setDate(d.getDate() + sd);
          d.setHours(d.getHours() + sh);
          finalDueAt = d.toISOString();
        }
      }
    } catch {}
  }
  let finalAssetId = null;
  if (asset_id) {
    const a = await query('SELECT id, entity_id FROM assets WHERE id=$1', [asset_id]);
    if (!a.rows.length) return res.status(422).json({ error: 'Ativo não encontrado' });
    if (String(a.rows[0].entity_id) !== String(entId)) return res.status(422).json({ error: 'Ativo não pertence à entidade do chamado' });
    finalAssetId = asset_id;
  }
  try {
    const { rows } = await query(
      `INSERT INTO tickets (title, description, category_id, entity_id, requester_id,
                            priority, due_at, asset_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`, [
        String(title).slice(0, 200), String(description), category_id || null,
        entId, user.id,
        Math.min(Math.max(parseInt(priority, 10) || 2, 1), 4),
        finalDueAt,
        finalAssetId,
      ]);
    const ticketId = rows[0].id;
    const num = (await query(
      `UPDATE tickets SET number = 'CH-' || to_char(created_at,'YYYY') || '-' || lpad(id::text,5,'0')
       WHERE id = $1 RETURNING number`, [ticketId])).rows[0].number;

    await query(
      `INSERT INTO ticket_status_history (ticket_id, old_status, new_status, user_id)
       VALUES ($1, NULL, 1, $2)`, [ticketId, user.id]);
    await query(
      `INSERT INTO ticket_messages (ticket_id, user_id, kind, content)
       VALUES ($1, $2, 'comment', $3)`, [ticketId, user.id, description]);

    const ticket = await loadTicket(ticketId);
    await notify.ticketCreated(ticket, await notify.summary(ticket));

    res.status(201).json(ticket);
  } catch (err) {
    res.status(400).json({ error: 'Não foi possível abrir o chamado.', details: err.message });
  }
});

// ---------------------------------------------------------------------
// Detalhe do chamado
// ---------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  const id = req.params.id;
  const ticket = await loadTicket(id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  if (!visible(ticket, req.user)) return res.status(403).json({ error: 'Acesso negado a este chamado.' });

  const [messages, history, atts] = await Promise.all([
    query(`SELECT m.*, u.name AS author_name, u.role AS author_role
           FROM ticket_messages m JOIN users u ON u.id = m.user_id
           WHERE m.ticket_id = $1 ORDER BY m.created_at ASC`, [id]),
    query(`SELECT * FROM ticket_status_history WHERE ticket_id = $1 ORDER BY created_at ASC`, [id]),
    query(`SELECT ta.*, u.name AS uploaded_by_name
           FROM ticket_attachments ta LEFT JOIN users u ON u.id = ta.uploaded_by
           WHERE ta.ticket_id = $1 ORDER BY ta.created_at ASC`, [id]),
  ]);
  res.json({
    ...ticket,
    messages: messages.rows,
    status_history: history.rows,
    attachments: atts.rows,
    approval: notify.APPROVAL_LABELS[ticket.approval_status],
  });
});

// ---------------------------------------------------------------------
// Atualiza o chamado (titulo, descricao, prioridade, categoria, prazo)
// ---------------------------------------------------------------------
router.patch('/:id', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  if (!visible(ticket, req.user)) return res.status(403).json({ error: 'Acesso negado.' });

  const user = req.user;

  if (user.role === 'client' && !(ticket.status === 1 && ticket.requester_id === user.id)) {
    return res.status(403).json({ error: 'Cliente só pode editar o próprio chamado enquanto "Novo".' });
  }
  if (user.role === 'technician' && ticket.assigned_user_id !== user.id) {
    return res.status(403).json({ error: 'Técnico só edita chamados atribuídos a ele.' });
  }

  const { title, description, priority, category_id, due_at, asset_id } = req.body || {};
  const fields = [];
  const params = [req.params.id];
  const add = (sql, val) => { params.push(val); fields.push(sql.replace('?', `$${params.length}`)); };
  if (title !== undefined) add('title = ?', String(title).slice(0, 200));
  if (description !== undefined) add('description = ?', String(description));
  if (priority !== undefined) add('priority = ?', Math.min(Math.max(parseInt(priority, 10) || 2, 1), 4));
  if (category_id !== undefined) add('category_id = ?', category_id || null);
  if (due_at !== undefined) add('due_at = ?', due_at || null);
  if (asset_id !== undefined) {
    if (asset_id) {
      const a = await query('SELECT id, entity_id FROM assets WHERE id=$1', [asset_id]);
      if (!a.rows.length) return res.status(422).json({ error: 'Ativo não encontrado' });
      if (String(a.rows[0].entity_id) !== String(ticket.entity_id)) return res.status(422).json({ error: 'Ativo não pertence à entidade do chamado' });
      add('asset_id = ?', asset_id);
    } else {
      add('asset_id = ?', null);
    }
  }
  if (!fields.length) return res.status(422).json({ error: 'Nenhum campo para atualizar.' });

  const { rows } = await query(
    `UPDATE tickets SET ${fields.join(', ')} WHERE id = $1 RETURNING id`, params);
  await query(
    `INSERT INTO ticket_messages (ticket_id, user_id, kind, content)
     VALUES ($1, $2, 'system', $3)`,
    [req.params.id, user.id, `${user.name} atualizou os dados do chamado.`]);
  const updated = await loadTicket(req.params.id);
  const s = await notify.summary(updated);
  require('../services/realtime').emitBroadcastRoles(['admin', 'technician'], 'ticket:update', s);
  require('../services/realtime').emitToUsers([ticket.requester_id, ticket.assigned_user_id].filter(Boolean), 'ticket:update', s);
  if (ticket.entity_id) require('../services/realtime').emitToEntities([ticket.entity_id], 'ticket:update', s);
  res.json(updated);
});

// ---------------------------------------------------------------------
// Atribuicao de tecnico
// ---------------------------------------------------------------------
router.post('/:id/assign', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  const user = req.user;
  if (user.role === 'client') return res.status(403).json({ error: 'Acesso negado.' });

  let techId = req.body?.user_id || null;
  if (user.role === 'technician') {
    techId = user.id;
    if (ticket.assigned_user_id && ticket.assigned_user_id !== user.id) {
      return res.status(403).json({ error: 'Chamado já está atribuído a outro técnico.' });
    }
  }
  if (user.role === 'admin' && techId) {
    const { rows } = await query(
      `SELECT 1 FROM users WHERE id = $1 AND role = 'technician' AND active = TRUE`, [techId]);
    if (!rows.length) return res.status(422).json({ error: 'Técnico inválido.' });
  }

  const newStatus = ticket.status === 1 ? 2 : ticket.status;
  const { rows } = await query(
    `UPDATE tickets SET assigned_user_id = $2,
       status = CASE WHEN status = 1 THEN 2 ELSE status END
     WHERE id = $1 RETURNING id`, [req.params.id, techId]);
  if (!rows.length) return res.status(404).json({ error: 'Chamado não encontrado.' });

  const changeText = techId
    ? `${user.name} atribuiu o chamado ao técnico.`
    : 'Chamado desatribuído.';
  await query(
    `INSERT INTO ticket_messages (ticket_id, user_id, kind, content, new_status)
     VALUES ($1, $2, 'system', $3, $4)`,
    [req.params.id, user.id, changeText, newStatus !== ticket.status ? newStatus : null]);
  if (newStatus !== ticket.status) {
    await query(
      `INSERT INTO ticket_status_history (ticket_id, old_status, new_status, user_id)
       VALUES ($1, $2, $3, $4)`, [req.params.id, ticket.status, newStatus, user.id]);
  }

  const updated = await loadTicket(req.params.id);
  await notify.ticketAssigned(updated);
  res.json(updated);
});

// ---------------------------------------------------------------------
// Mudanca de status
// ---------------------------------------------------------------------
router.post('/:id/status', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  const user = req.user;
  const { status, comment } = req.body || {};
  const toStatus = parseInt(status, 10);
  if (![1, 2, 3, 4, 5, 6, 7].includes(toStatus)) {
    return res.status(422).json({ error: 'Status inválido.' });
  }
  if (toStatus === ticket.status) {
    return res.status(422).json({ error: 'O chamado já está neste status.' });
  }
  if (!(await canModifyTicket(user, ticket, 'status'))) {
    return res.status(403).json({ error: 'Você não pode alterar o status deste chamado.' });
  }

  const settings = await settingsStore.getAll();

  // Cliente: limites de acao
  if (user.role === 'client') {
    const allowed =
      (toStatus === 7 && ![5, 6, 7].includes(ticket.status)) || // cancelar
      (toStatus === 3 && [5, 6].includes(ticket.status));        // reabrir
    if (!allowed) {
      return res.status(403).json({ error: 'Ação não permitida para cliente nesta etapa.' });
    }
  }

  // Resolucao por tecnico -> solicita aprovacao automaticamente (modelo GLPI)
  if (toStatus === 5 && user.role === 'technician' && settings['app.approval_on_solve']) {
    return res.status(409).json({
      error: 'Para marcar como resolvido, solicite a aprovação do cliente antes.',
      request_approval: true,
    });
  }
  if (toStatus === 5 && user.role === 'admin' && !comment) {
    return res.status(422).json({ error: 'Descreva a solução aplicada no campo "comentário".' });
  }

  const closedAt = toStatus === 6 ? new Date() : null;
  await query(`UPDATE tickets SET status = $1::smallint, closed_at = $2
               WHERE id = $3`, [toStatus, closedAt, req.params.id]);
  await query(
    `INSERT INTO ticket_status_history (ticket_id, old_status, new_status, user_id)
     VALUES ($1, $2, $3, $4)`, [req.params.id, ticket.status, toStatus, user.id]);
  await query(
    `INSERT INTO ticket_messages (ticket_id, user_id, kind, content, new_status)
     VALUES ($1, $2, $3, $4, $5)`,
    [req.params.id, user.id, comment ? 'comment' : 'system',
     comment || `${user.name} alterou o status de "${notify.STATUS_LABELS[ticket.status]}" para "${notify.STATUS_LABELS[toStatus]}".`,
     toStatus]);

  const updated = await loadTicket(req.params.id);
  await notify.statusChanged(updated, user, toStatus);
  res.json(updated);
});

// ---------------------------------------------------------------------
// Solicitacao de aprovacao (solucao proposta)
// ---------------------------------------------------------------------
router.post('/:id/approval', requireRoles('admin', 'technician'), async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  const user = req.user;
  if (user.role === 'technician' && ticket.assigned_user_id !== user.id) {
    return res.status(403).json({ error: 'Apenas o técnico responsável pode solicitar aprovação.' });
  }
  if (ticket.approval_status === 'pending') {
    return res.status(422).json({ error: 'Já existe aprovação pendente.' });
  }
  const solution = String(req.body?.comment || '').trim();
  if (!solution) return res.status(422).json({ error: 'Descreva a solução proposta.' });

  await query(
    `UPDATE tickets SET approval_status = 'pending', approval_requested_by_id = $1,
            approval_comment = $2, approval_requested_at = now(),
            approval_responded_by_id = NULL, approval_responded_at = NULL
     WHERE id = $3`, [user.id, solution, req.params.id]);
  await query(
    `INSERT INTO ticket_messages (ticket_id, user_id, kind, content)
     VALUES ($1, $2, 'approval', $3)`,
    [req.params.id, user.id, `Solicitação de aprovação enviada ao cliente.\n\nSolução proposta: ${solution}`]);

  const updated = await loadTicket(req.params.id);
  await notify.approvalRequested(updated);
  res.json(updated);
});

// ---------------------------------------------------------------------
// Resposta do cliente a aprovacao (aprovar / reprovar)
// ---------------------------------------------------------------------
router.post('/:id/approval/respond', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  const user = req.user;
  if (user.role !== 'client') {
    return res.status(403).json({ error: 'Apenas o cliente pode aprovar ou reprovar a solução.' });
  }
  if (!(await canModifyTicket(user, ticket, 'approval'))) {
    return res.status(403).json({ error: 'Você não pode aprovar/reprovar este chamado.' });
  }
  if (ticket.approval_status !== 'pending') {
    return res.status(422).json({ error: 'Não há aprovação pendente neste chamado.' });
  }
  const decision = req.body?.decision;
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(422).json({ error: 'Decisão inválida.' });
  }
  const note = String(req.body?.comment || '').trim();

  const newStatus = decision === 'approved' ? 6 : 3;
  const closedAt = newStatus === 6 ? new Date() : null;
  await query(
    `UPDATE tickets SET approval_status = $1, approval_responded_by_id = $2,
            approval_responded_at = now(), approval_comment = $3,
            status = $4::smallint, closed_at = $5
     WHERE id = $6`,
    [decision, user.id, note, newStatus, closedAt, req.params.id]);
  await query(
    `INSERT INTO ticket_status_history (ticket_id, old_status, new_status, user_id)
     VALUES ($1, $2, $3, $4)`, [req.params.id, ticket.status, newStatus, user.id]);
  await query(
    `INSERT INTO ticket_messages (ticket_id, user_id, kind, content, new_status)
     VALUES ($1, $2, 'approval', $3, $4)`,
    [req.params.id, user.id,
     `${user.name} ${decision === 'approved' ? 'APROVOU' : 'REPROVOU'} a solução proposta.` +
     `${note ? `\n\n${note}` : ''}`,
     newStatus]);

  const updated = await loadTicket(req.params.id);
  await notify.approvalResponded(updated, decision, user.name);
  res.json(updated);
});

// ---------------------------------------------------------------------
// Mensagens / notas no chamado
//   - cliente gestor: kind 'note' (instrucao/solicitacao)
//   - demais: kind 'comment'
// ---------------------------------------------------------------------
router.post('/:id/messages', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  const user = req.user;
  if (!(await canModifyTicket(user, ticket, 'update'))) {
    return res.status(403).json({ error: 'Você não pode interagir neste chamado.' });
  }
  const content = String(req.body?.content || '').trim();
  if (!content) return res.status(422).json({ error: 'Escreva a mensagem.' });

  let kind = 'comment';
  if (user.role === 'client' && (user.client_level || 1) === 2 && req.body?.kind === 'note') {
    kind = 'note';
  }

  const { rows } = await query(
    `INSERT INTO ticket_messages (ticket_id, user_id, kind, content)
     VALUES ($1, $2, $3, $4) RETURNING *`, [req.params.id, user.id, kind, content]);
  const message = { ...rows[0], user: user };

  // Notifica envolvidos + atualiza painel em tempo real
  const updated = await loadTicket(req.params.id);
  const s = await notify.summary(updated);
  const participants = await notify.getParticipants(ticket.id, ticket.entity_id, user.id);
  await notify.deliver({
    ticket: updated, event: 'comment.added', recipients: participants,
    title: () => `Nova mensagem em ${s.number}`,
    subject: () => `[Mensagem] ${s.number}`,
    message: () => `${user.name} escreveu: ${content}`,
  });
  require('../services/realtime').emitBroadcastRoles(['admin', 'technician'], 'ticket:update', s);
  require('../services/realtime').emitToUsers([ticket.requester_id, ticket.assigned_user_id].filter(Boolean), 'ticket:update', s);
  if (ticket.entity_id) require('../services/realtime').emitToEntities([ticket.entity_id], 'ticket:update', s);

  res.status(201).json(message);
});

// ---------------------------------------------------------------------
// Anexos
// ---------------------------------------------------------------------
router.post('/:id/attachments', (req, res, next) => {
  attUpload.array('files', 10)(req, res, async (err) => {
    if (err) return res.status(422).json({ error: err.message });
    try {
      const ticket = await loadTicket(req.params.id);
      if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
      if (!visible(ticket, req.user)) return res.status(403).json({ error: 'Acesso negado.' });
      if (!req.files?.length) return res.status(422).json({ error: 'Envie ao menos um arquivo.' });
      const inserted = [];
      for (const f of req.files) {
        const storagePath = path.join('uploads', 'tickets', String(ticket.id), f.filename).replace(/\\/g, '/');
        const { rows } = await query(
          `INSERT INTO ticket_attachments (ticket_id, file_name, storage_path, mime_type, file_size, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [ticket.id, f.originalname, storagePath, f.mimetype, f.size, req.user.id]);
        inserted.push(rows[0]);
      }
      await query(
        `INSERT INTO ticket_messages (ticket_id, user_id, kind, content)
         VALUES ($1, $2, 'system', $3)`,
        [ticket.id, req.user.id, `${req.user.name} anexou ${inserted.length} arquivo(s): ${inserted.map(i => i.file_name).join(', ')}`]);
      const s = await notify.summary(await loadTicket(ticket.id));
      require('../services/realtime').emitBroadcastRoles(['admin', 'technician'], 'ticket:update', s);
      require('../services/realtime').emitToUsers([ticket.requester_id, ticket.assigned_user_id].filter(Boolean), 'ticket:update', s);
      if (ticket.entity_id) require('../services/realtime').emitToEntities([ticket.entity_id], 'ticket:update', s);
      res.status(201).json(inserted);
    } catch (e) {
      next(e);
    }
  });
});

router.get('/:id/attachments/:attId/file', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT ta.*, t.entity_id FROM ticket_attachments ta JOIN tickets t ON t.id=ta.ticket_id WHERE ta.id=$1 AND ta.ticket_id=$2',
      [req.params.attId, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Anexo não encontrado.' });
    const ticket = await loadTicket(req.params.id);
    if (!ticket || !visible(ticket, req.user)) return res.status(403).json({ error: 'Acesso negado.' });
    const filePath = path.join(config.uploadsDir, 'tickets', String(req.params.id), path.basename(rows[0].storage_path));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo não encontrado no servidor.' });
    const inline = req.query.inline === '1' && /^image\//.test(rows[0].mime_type || '');
    res.type(rows[0].mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(rows[0].file_name)}`);
    res.sendFile(path.resolve(filePath));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/attachments/:attId', async (req, res, next) => {
  try {
    const ticket = await loadTicket(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
    if (!(await canModifyTicket(req.user, ticket, 'update'))) {
      return res.status(403).json({ error: 'Você não pode remover anexos deste chamado.' });
    }
    const { rows } = await query('SELECT * FROM ticket_attachments WHERE id=$1 AND ticket_id=$2', [req.params.attId, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Anexo não encontrado.' });
    try { fs.unlinkSync(path.join(config.uploadsDir, 'tickets', String(req.params.id), path.basename(rows[0].storage_path))); } catch {}
    await query('DELETE FROM ticket_attachments WHERE id=$1', [req.params.attId]);
    await query(
      `INSERT INTO ticket_messages (ticket_id, user_id, kind, content)
       VALUES ($1, $2, 'system', $3)`,
      [ticket.id, req.user.id, `${req.user.name} removeu o anexo "${rows[0].file_name}".`]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;