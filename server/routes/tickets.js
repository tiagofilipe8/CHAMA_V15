const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { query } = require('../db');
const {
  requireAuth, scopeConditions, canViewTicket, canTriage, canAccessEntity, seesAll, has,
  isMaster, isLocalAdmin, isModerator, canAssign, canTake, canManageWatchers, canWork,
  canStatusAny, canResolve, needsApproval, canApprove, canCancel, canEditTicket, canMessage,
  canInternal, inScope, ticketAbilities, isRequester,
} = require('../middleware/auth');
const notify = require('../services/notify');
const settingsStore = require('../services/settingsStore');
const realtime = require('../services/realtime');

const router = express.Router();
// ?token= para links de arquivo (a tag <a>/<img> nao envia Authorization)
router.use((req, res, next) => {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = 'Bearer ' + String(req.query.token);
  }
  next();
});
router.use(requireAuth);

// Empresa temporaria usada pelos chamados abertos pelo WhatsApp. Enquanto o
// chamado estiver nela, o encerramento exige que a empresa seja atribuida.
const EMPRESA_PADRAO_WHATSAPP = 'WhatsApp - não identificado';

function empresaPadraoWhatsApp(ticket) {
  return !!ticket && !!ticket.via_whatsapp
    && String(ticket.entity_name || '').trim() === EMPRESA_PADRAO_WHATSAPP;
}

// Chamado do WhatsApp ainda sem empresa real nao pode ser resolvido/fechado.
function exigeEmpresaNoEncerramento(ticket) {
  return empresaPadraoWhatsApp(ticket);
}

// Quem pode trocar a empresa: triagem, ou o tecnico que assumiu um chamado
// do WhatsApp ainda na empresa padrao (obrigatorio antes de resolver).
function podeAtribuirEmpresa(ticket, user) {
  return canTriage(user, ticket)
    || (empresaPadraoWhatsApp(ticket) && canWork(user, ticket));
}

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
      .replace(/[^\w\-À-ÿ ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'arquivo';
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
         u_mod.name AS moderator_name,
         e.name AS entity_name, e.category_mode,
         c.name AS category_name, chama_category_path(t.category_id) AS category_path,
         sc.id AS display_simple_id, sc.name AS simple_category_name, sc.icon AS simple_category_icon,
         l.name AS location_name, l.code AS location_code,
         il.name AS impact_name, il.description AS impact_description,
         rc.name AS resolution_cause_name, u_res.name AS resolved_by_name,
         a.name AS asset_name, a.asset_tag,
         tA.name AS approval_requested_by_name,
         tB.name AS approval_responded_by_name,
         COALESCE((SELECT array_agg(w.user_id ORDER BY w.created_at)
                   FROM ticket_watchers w WHERE w.ticket_id = t.id), '{}') AS watcher_ids
  FROM tickets t
  JOIN entities e ON e.id = t.entity_id
  LEFT JOIN users u_req ON u_req.id = t.requester_id
  LEFT JOIN users u_asg ON u_asg.id = t.assigned_user_id
  LEFT JOIN users u_mod ON u_mod.id = t.assigned_moderator_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN categories sc ON sc.id = COALESCE(t.simple_category_id, chama_simple_for(t.category_id))
  LEFT JOIN locations l ON l.id = t.location_id
  LEFT JOIN impact_levels il ON il.id = t.impact_id
  LEFT JOIN resolution_causes rc ON rc.id = t.resolution_cause_id
  LEFT JOIN users u_res ON u_res.id = t.resolved_by_id
  LEFT JOIN assets a ON a.id = t.asset_id
  LEFT JOIN users tA ON tA.id = t.approval_requested_by_id
  LEFT JOIN users tB ON tB.id = t.approval_responded_by_id`;

async function loadTicket(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await query(`${TICKET_SELECT} WHERE t.id = $1`, [id]);
  return rows[0] || null;
}

// Categoria exibida para quem esta vendo o chamado:
// usuarios de empresa no modo simples veem a categoria simples (ex.: "Internet ou rede");
// a equipe ve a categoria complexa completa (ex.: "Rede > Problemas de conexão > DNS").
function decorate(ticket, user) {
  // quem faz triagem ou ve todas as empresas ve a categoria complexa (detalhada)
  const simpleView = !(seesAll(user) || has(user, 'ticket.triage'))
    && ticket.category_mode === 'simple' && ticket.simple_category_name;
  const out = { ...ticket };
  if (!has(user, 'ticket.rating')) {
    // a nota dada ao usuario e a causa sao informacoes internas da equipe
    delete out.requester_rating;
    delete out.requester_rating_comment;
    delete out.resolution_cause_id;
    delete out.resolution_cause_name;
  }
  return {
    ...out,
    approval: notify.APPROVAL_LABELS[ticket.approval_status],
    display_category: simpleView
      ? `${ticket.simple_category_icon ? ticket.simple_category_icon + ' ' : ''}${ticket.simple_category_name}`
      : (ticket.category_path || ticket.category_name || null),
  };
}

async function addHistory(ticketId, userId, action, oldValue = null, newValue = null) {
  await query(
    `INSERT INTO ticket_history (ticket_id, user_id, action, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5)`,
    [ticketId, userId || null, action,
      oldValue === null || oldValue === undefined ? null : String(oldValue),
      newValue === null || newValue === undefined ? null : String(newValue)]);
}

function emitUpdate(ticket, s) {
  realtime.emitBroadcastRoles(['admin', 'moderator', 'technician'], 'ticket:update', s);
  realtime.emitToUsers([ticket.requester_id, ticket.assigned_user_id, ...(ticket.watcher_ids || [])]
    .filter(Boolean), 'ticket:update', s);
  if (ticket.entity_id) realtime.emitToEntities([ticket.entity_id], 'ticket:update', s);
}

// Quem faz triagem (admin, admin local, moderador) vira o moderador do chamado
async function claimModerator(ticket, user) {
  if (!ticket.assigned_moderator_id && (isModerator(user) || isLocalAdmin(user) || isMaster(user) || has(user, 'ticket.triage'))) {
    await query('UPDATE tickets SET assigned_moderator_id = $1 WHERE id = $2', [user.id, ticket.id]);
    await addHistory(ticket.id, user.id, 'moderator', null, user.name);
  }
}

// ----------------------------- validacoes -----------------------------

// Resolve a categoria: aceita uma simples (grava na complexa correspondente)
// ou uma complexa. Retorna { category_id, simple_category_id } ou { error }.
async function resolveCategory(categoryId, simpleCategoryId) {
  const id = simpleCategoryId || categoryId;
  if (!id) return { category_id: null, simple_category_id: null };
  const { rows } = await query('SELECT id, kind, maps_to_id, active FROM categories WHERE id = $1', [id]);
  if (!rows.length || !rows[0].active) return { error: 'Categoria inválida.' };
  const c = rows[0];
  // Só categorias simples: o chamado grava direto na simples escolhida
  if (c.kind === 'simple') return { category_id: c.id, simple_category_id: c.id };
  return { category_id: c.id, simple_category_id: null };
}

async function resolveImpact(impactId) {
  if (!impactId) return null;
  const { rows } = await query('SELECT id, name, priority FROM impact_levels WHERE id = $1 AND active', [impactId]);
  return rows[0] || null;
}

async function resolveLocation(locationId, entityId) {
  const { rows } = await query('SELECT id, name, entity_id, active FROM locations WHERE id = $1', [locationId]);
  if (!rows.length || !rows[0].active) return { error: 'Localização inválida.' };
  if (String(rows[0].entity_id) !== String(entityId)) return { error: 'A localização não pertence à empresa do chamado.' };
  return { location: rows[0] };
}

function validDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(v));
}

// ----------------------------- encerramento -----------------------------
const EQUIPMENT_ACTIONS = {
  repaired: 'Reparado / consertado no local',
  adjusted: 'Configurado / ajustado (sem troca de peça)',
  part_replaced: 'Peça trocada',
  replaced: 'Equipamento substituído por outro',
  sent_external: 'Enviado para manutenção externa',
  no_change: 'Nenhuma alteração no equipamento',
  discarded: 'Equipamento descartado / sem conserto',
  no_equipment: 'Não envolveu equipamento',
};

// Formulario de encerramento: o que aconteceu, causa, acao no equipamento e nota do usuario
async function readResolution(body = {}) {
  const notes = String(body.resolution_notes || body.comment || '').trim();
  if (notes.length < 5) return { error: 'Descreva o que aconteceu e o que foi feito.' };
  const causeId = body.resolution_cause_id;
  if (!causeId) return { error: 'Escolha a causa do problema.' };
  const c = await query('SELECT id, name FROM resolution_causes WHERE id = $1 AND active', [causeId]);
  if (!c.rows.length) return { error: 'Causa inválida.' };
  const action = String(body.equipment_action || '');
  if (!EQUIPMENT_ACTIONS[action]) return { error: 'Informe o que aconteceu com o equipamento.' };
  const rating = body.requester_rating;
  if (rating === undefined || rating === null || rating === '' || !/^[0-5]$/.test(String(rating))) {
    return { error: 'Dê uma nota de 0 a 5 estrelas para o usuário.' };
  }
  return {
    notes, cause: c.rows[0], action, rating: parseInt(rating, 10),
    ratingComment: String(body.requester_rating_comment || '').trim() || null,
  };
}

async function saveResolution(ticket, user, r) {
  await query(
    `UPDATE tickets SET resolution_notes = $2, resolution_cause_id = $3, equipment_action = $4,
            requester_rating = $5, requester_rating_comment = $6, resolved_by_id = $7
     WHERE id = $1`,
    [ticket.id, r.notes, r.cause.id, r.action, r.rating, r.ratingComment, user.id]);
  await addHistory(ticket.id, user.id, 'resolution', null, `${r.cause.name} · ${EQUIPMENT_ACTIONS[r.action]}`);
  // registra no historico de manutencoes do equipamento vinculado
  if (ticket.asset_id && !['no_change', 'no_equipment'].includes(r.action)) {
    await query(
      `INSERT INTO asset_maintenances (asset_id, description, created_by) VALUES ($1, $2, $3)`,
      [ticket.asset_id, `${ticket.number}: ${EQUIPMENT_ACTIONS[r.action]} — ${r.notes}`, user.id]).catch(() => {});
  }
}

// ---------------------------------------------------------------------
// Lista de chamados (painel, filtros e portal do cliente)
// ---------------------------------------------------------------------
router.get('/', async (req, res) => {
  const {
    status, priority, entity_id, assigned, requester, q, limit,
    watching, location_id, impact_id, category_id,
  } = req.query;
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
  if (impact_id && /^\d+$/.test(impact_id)) frag(`t.impact_id = ?`, impact_id);
  if (entity_id && /^\d+$/.test(entity_id)) frag(`t.entity_id = ?`, parseInt(entity_id, 10));
  if (location_id && /^\d+$/.test(location_id)) frag(`t.location_id = ?`, location_id);
  if (category_id && /^\d+$/.test(category_id)) {
    // inclui as subcategorias
    frag(`t.category_id IN (WITH RECURSIVE d AS (SELECT id FROM categories WHERE id = ?
           UNION ALL SELECT c.id FROM categories c JOIN d ON c.parent_id = d.id) SELECT id FROM d)`, category_id);
  }
  if (assigned === 'me') frag(`t.assigned_user_id = ?`, req.user.id);
  else if (assigned && /^\d+$/.test(assigned)) frag(`t.assigned_user_id = ?`, parseInt(assigned, 10));
  else if (assigned === 'none') frag(`t.assigned_user_id IS NULL`, []);
  if (requester === 'me') frag(`t.requester_id = ?`, req.user.id);
  else if (requester && /^\d+$/.test(requester)) frag(`t.requester_id = ?`, parseInt(requester, 10));
  // "Meus chamados": os que eu abri e os que estao comigo (tecnico)
  if (req.query.mine === 'me') frag(`(t.requester_id = ? OR t.assigned_user_id = ?)`, [req.user.id, req.user.id]);
  if (watching === 'me') {
    frag(`EXISTS (SELECT 1 FROM ticket_watchers w2 WHERE w2.ticket_id = t.id AND w2.user_id = ?)`, req.user.id);
  }
  if (q) frag(`(t.title ILIKE ? OR t.description ILIKE ? OR t.number ILIKE ?)`,
    [`%${q}%`, `%${q}%`, `%${q}%`]);

  const where = ['TRUE', ...conds].join(' AND ');
  const lim = Math.min(parseInt(limit, 10) || 200, 500);
  const { rows } = await query(
    `${TICKET_SELECT} WHERE (${where}) ${scope.sql ? 'AND ' + scope.sql : ''} ORDER BY t.updated_at DESC LIMIT ${lim}`, params);
  res.json(rows.map((r) => decorate(r, req.user)));
});

// ---------------------------------------------------------------------
// Calendario (data em que o solicitante precisa do chamado resolvido)
// ---------------------------------------------------------------------
function rangeFrom(req) {
  const { from, to } = req.query;
  if (!validDate(from) || !validDate(to)) return null;
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (days < 0 || days > 62) return null;
  return [from, to];
}

// Carga por dia, para o calendario de "Novo chamado": quantos chamados ainda
// nao resolvidos (de todas as empresas) precisam ficar prontos em cada dia.
// So numeros: nenhum detalhe dos chamados de outras pessoas.
router.get('/calendar/load', async (req, res) => {
  const range = rangeFrom(req);
  if (!range) return res.status(422).json({ error: 'Período inválido.' });
  const { rows } = await query(
    `SELECT to_char(needed_by, 'YYYY-MM-DD') AS day, count(*)::int AS n
     FROM tickets WHERE needed_by BETWEEN $1 AND $2 AND status IN (1,2,3,4)
     GROUP BY 1`, range);
  const out = {};
  rows.forEach((r) => { out[r.day] = r.n; });
  res.json(out);
});

// Chamados que o usuario ve, pela data de necessidade (painel)
router.get('/calendar', async (req, res) => {
  const range = rangeFrom(req);
  if (!range) return res.status(422).json({ error: 'Período inválido.' });
  const scope = scopeConditions(req.user, 3);
  const params = [...range, ...scope.params];
  const conds = ['t.needed_by IS NOT NULL', 't.status NOT IN (7)'];
  if (req.query.entity_id && /^\d+$/.test(req.query.entity_id)) {
    params.push(parseInt(req.query.entity_id, 10)); conds.push(`t.entity_id = $${params.length}`);
  }
  const scopeSql = scope.sql ? `AND ${scope.sql}` : '';
  const { rows } = await query(
    `${TICKET_SELECT} WHERE ${conds.join(' AND ')}
       AND ((t.needed_by BETWEEN $1 AND $2) OR (t.needed_by < $1 AND t.status IN (1,2,3,4) AND $1 <= CURRENT_DATE))
       ${scopeSql}
     ORDER BY t.needed_by, t.priority DESC LIMIT 1000`, params);
  res.json(rows.map((r) => decorate(r, req.user)));
});

// ---------------------------------------------------------------------
// Abertura de chamado
// ---------------------------------------------------------------------
router.post('/', async (req, res) => {
  const {
    title, category_id, simple_category_id, priority, entity_id, due_at, asset_id,
    impact_id, needed_by, location_id, materials,
  } = req.body || {};
  // Pedido de material: itens da lista (o texto vira opcional)
  const itensPedidos = Array.isArray(materials)
    ? materials.map((m) => ({ id: parseInt(m.material_id, 10), qtd: parseInt(m.quantity, 10) }))
      .filter((m) => m.id > 0 && m.qtd > 0 && m.qtd <= 999)
    : [];
  let description = req.body?.description;
  let materiaisOk = [];
  if (itensPedidos.length) {
    const { rows } = await query('SELECT id, name, unit FROM materials WHERE active AND id = ANY($1::bigint[])',
      [itensPedidos.map((m) => m.id)]);
    const mapa = new Map(rows.map((r) => [r.id, r]));
    materiaisOk = itensPedidos.filter((m) => mapa.has(String(m.id)) || mapa.has(m.id))
      .map((m) => ({ ...(mapa.get(String(m.id)) || mapa.get(m.id)), qtd: m.qtd }));
    const lista = materiaisOk.map((m) => `- ${m.qtd} ${m.unit || 'un'} · ${m.name}`).join('\n');
    const obs = String(description || '').trim();
    description = `Pedido de material:\n${lista}${obs ? `\n\nObservações: ${obs}` : ''}`;
  }
  if (!description || !String(description).trim()) {
    const cid = parseInt(simple_category_id || category_id, 10);
    const mat = cid ? (await query('SELECT is_material FROM categories WHERE id = $1', [cid])).rows[0] : null;
    return res.status(422).json({ error: mat?.is_material ? 'Escolha pelo menos um material da lista.' : 'Conte o que está acontecendo.' });
  }
  const user = req.user;
  if (!has(user, 'ticket.create')) return res.status(403).json({ error: 'Seu perfil não pode abrir chamados.' });

  // Empresa do chamado: a equipe escolhe; os demais abrem para a propria empresa
  // (o gestor pode escolher entre as empresas que acompanha)
  let entId = entity_id || null;
  if (!seesAll(user)) {
    entId = entId && canAccessEntity(user, entId) ? entId : user.entity_id;
  }
  if (!entId) return res.status(422).json({ error: 'Informe a empresa do chamado.' });

  // Categoria (obrigatoria)
  const cat = await resolveCategory(category_id, simple_category_id);
  if (cat.error) return res.status(422).json({ error: cat.error });
  if (!cat.category_id) return res.status(422).json({ error: 'Escolha a categoria do chamado.' });
  const catMat = await query('SELECT is_material FROM categories WHERE id = $1', [cat.simple_category_id || cat.category_id]);
  if (catMat.rows[0]?.is_material && !materiaisOk.length) {
    return res.status(422).json({ error: 'Escolha pelo menos um material da lista.' });
  }

  // Urgencia (obrigatoria). Compatibilidade: se vier so a prioridade antiga, converte.
  let impact = await resolveImpact(impact_id);
  if (!impact && priority) {
    const { rows } = await query(
      'SELECT id, name, priority FROM impact_levels WHERE active AND priority = $1 ORDER BY sort_order LIMIT 1',
      [Math.min(Math.max(parseInt(priority, 10) || 2, 1), 4)]);
    impact = rows[0] || null;
  }
  if (!impact) return res.status(422).json({ error: 'Informe se isso está afetando a operação (urgência).' });

  // Localizacao: informada, ou o posto do usuario; obrigatoria se a empresa tem postos
  let locId = location_id || null;
  if (!locId && user.location_id && String(user.entity_id) === String(entId)) locId = user.location_id;
  if (locId) {
    const loc = await resolveLocation(locId, entId);
    if (loc.error) return res.status(422).json({ error: loc.error });
  } else {
    const { rows } = await query('SELECT 1 FROM locations WHERE entity_id = $1 AND active LIMIT 1', [entId]);
    if (rows.length) return res.status(422).json({ error: 'Informe onde está acontecendo (localização).' });
  }

  if (!needed_by) return res.status(422).json({ error: 'Marque no calendário a data em que você precisa disso resolvido.' });
  if (!validDate(needed_by)) return res.status(422).json({ error: 'Data de necessidade inválida.' });
  if (String(needed_by) < new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10)) {
    return res.status(422).json({ error: 'A data de necessidade não pode ser no passado.' });
  }

  // SLA da entidade: se não informado, usa dias/horas da entidade
  let finalDueAt = ((seesAll(user) || has(user, 'ticket.triage')) && due_at) || null;
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
  // Titulo opcional: sem titulo, usa a categoria + o inicio da descricao
  let finalTitle = String(title || '').trim().slice(0, 200);
  if (!finalTitle) {
    const { rows: cn } = await query('SELECT name FROM categories WHERE id = $1',
      [cat.simple_category_id || cat.category_id]);
    const first = materiaisOk.length
      ? materiaisOk.map((m) => `${m.qtd}x ${m.name}`).join(', ')
      : String(description).trim().split(/\r?\n/)[0];
    finalTitle = `${cn[0] ? cn[0].name + ': ' : ''}${first.length > 70 ? first.slice(0, 70) + '…' : first}`.slice(0, 200);
  }
  try {
    const { rows } = await query(
      `INSERT INTO tickets (title, description, category_id, simple_category_id, entity_id, requester_id,
                            priority, impact_id, due_at, asset_id, location_id, needed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`, [
        finalTitle, String(description), cat.category_id, cat.simple_category_id,
        entId, user.id, impact.priority, impact.id,
        finalDueAt, finalAssetId, locId, needed_by || null,
      ]);
    const ticketId = rows[0].id;
    await query(
      `UPDATE tickets SET number = to_char(created_at,'YYYY') || '-' || lpad(id::text,5,'0')
       WHERE id = $1 RETURNING number`, [ticketId]);

    await query(
      `INSERT INTO ticket_status_history (ticket_id, old_status, new_status, user_id)
       VALUES ($1, NULL, 1, $2)`, [ticketId, user.id]);
    await query(
      `INSERT INTO ticket_messages (ticket_id, user_id, kind, content)
       VALUES ($1, $2, 'comment', $3)`, [ticketId, user.id, description]);
    for (const m of materiaisOk) {
      await query(`INSERT INTO ticket_materials (ticket_id, material_id, name, unit, quantity) VALUES ($1, $2, $3, $4, $5)`,
        [ticketId, m.id, m.name, m.unit || null, m.qtd]);
    }
    await addHistory(ticketId, user.id, 'created', null, impact.name);

    const ticket = await loadTicket(ticketId);
    await notify.ticketCreated(ticket, await notify.summary(ticket));

    res.status(201).json(decorate(ticket, user));
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
  if (!canViewTicket(req.user, ticket)) return res.status(403).json({ error: 'Acesso negado a este chamado.' });

  const team = canInternal(req.user);
  const seesRating = has(req.user, 'ticket.rating');
  const [messages, history, atts, events, watchers, mats] = await Promise.all([
    query(`SELECT m.*, u.name AS author_name, u.role AS author_role
           FROM ticket_messages m JOIN users u ON u.id = m.user_id
           WHERE m.ticket_id = $1 ${team ? '' : "AND m.kind <> 'internal'"}
           ORDER BY m.created_at ASC`, [id]),
    query(`SELECT * FROM ticket_status_history WHERE ticket_id = $1 ORDER BY created_at ASC`, [id]),
    query(`SELECT ta.*, u.name AS uploaded_by_name
           FROM ticket_attachments ta LEFT JOIN users u ON u.id = ta.uploaded_by
           WHERE ta.ticket_id = $1 ORDER BY ta.created_at ASC`, [id]),
    query(`SELECT h.*, u.name AS user_name FROM ticket_history h
           LEFT JOIN users u ON u.id = h.user_id
           WHERE h.ticket_id = $1 ${seesRating ? '' : "AND h.action <> 'resolution'"}
           ORDER BY h.created_at ASC, h.id ASC`, [id]),
    query(`SELECT w.user_id AS id, u.name, u.role, u.client_level, l.name AS location_name, w.created_at
           FROM ticket_watchers w JOIN users u ON u.id = w.user_id
           LEFT JOIN locations l ON l.id = u.location_id
           WHERE w.ticket_id = $1 ORDER BY w.created_at`, [id]),
    query(`SELECT name, unit, quantity FROM ticket_materials WHERE ticket_id = $1 ORDER BY id`, [id]),
  ]);
  let requesterRating = null;
  if (seesRating) {
    const { rows } = await query(
      `SELECT round(avg(requester_rating)::numeric, 1) AS avg, count(*)::int AS count
       FROM tickets WHERE requester_id = $1 AND requester_rating IS NOT NULL`, [ticket.requester_id]);
    requesterRating = rows[0];
  }
  res.json({
    ...decorate(ticket, req.user),
    equipment_action_label: EQUIPMENT_ACTIONS[ticket.equipment_action] || null,
    requester_rating_summary: requesterRating,
    messages: messages.rows,
    status_history: history.rows,
    history: events.rows,
    watchers: watchers.rows,
    materials: mats.rows,
    attachments: atts.rows,
    can: ticketAbilities(req.user, ticket),
  });
});

// ---------------------------------------------------------------------
// Atualiza o chamado (titulo, descricao, categoria, urgencia, posto, datas, ativo)
// ---------------------------------------------------------------------
router.patch('/:id', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  if (!canViewTicket(req.user, ticket)) return res.status(403).json({ error: 'Acesso negado.' });

  const user = req.user;
  const triage = canTriage(user, ticket);
  const isAssignedTech = canWork(user, ticket);

  if (!canEditTicket(user, ticket)) {
    return res.status(403).json({ error: 'Você não pode editar este chamado (o solicitante só edita enquanto ele está "Novo").' });
  }
  const support = triage || isAssignedTech; // pode mexer em previsao e prazo (SLA)

  const {
    title, description, priority, category_id, simple_category_id, due_at, asset_id,
    impact_id, location_id, needed_by, estimated_at, entity_id,
  } = req.body || {};
  const fields = [];
  const params = [req.params.id];
  const changes = []; // [acao, antes, depois]
  const add = (sql, val) => { params.push(val); fields.push(sql.replace('?', `$${params.length}`)); };

  if (title !== undefined && String(title) !== ticket.title) {
    add('title = ?', String(title).slice(0, 200));
    changes.push(['title', ticket.title, String(title).slice(0, 200)]);
  }
  if (description !== undefined && String(description) !== ticket.description) {
    add('description = ?', String(description));
    changes.push(['description', null, null]);
  }
  if (category_id !== undefined || simple_category_id !== undefined) {
    const cat = await resolveCategory(category_id, simple_category_id);
    if (cat.error) return res.status(422).json({ error: cat.error });
    if (!cat.category_id) return res.status(422).json({ error: 'O chamado precisa de uma categoria.' });
    if (String(cat.category_id) !== String(ticket.category_id)
        || String(cat.simple_category_id || '') !== String(ticket.simple_category_id || '')) {
      add('category_id = ?', cat.category_id);
      add('simple_category_id = ?', cat.simple_category_id);
      const np = (await query('SELECT chama_category_path($1) AS p', [cat.category_id])).rows[0].p;
      if (String(cat.category_id) !== String(ticket.category_id)) {
        changes.push(['category', ticket.category_path, np]);
      }
    }
  }
  if (impact_id !== undefined) {
    const impact = await resolveImpact(impact_id);
    if (!impact) return res.status(422).json({ error: 'Urgência inválida.' });
    if (String(impact.id) !== String(ticket.impact_id)) {
      add('impact_id = ?', impact.id);
      add('priority = ?', impact.priority);
      changes.push(['impact', ticket.impact_name, impact.name]);
    }
  } else if (priority !== undefined && support) {
    const p = Math.min(Math.max(parseInt(priority, 10) || 2, 1), 4);
    if (p !== ticket.priority) {
      add('priority = ?', p);
      changes.push(['priority', notify.PRIORITY_LABELS[ticket.priority], notify.PRIORITY_LABELS[p]]);
    }
  }
  // ---------------------- empresa do chamado (triagem) ----------------------
  // Usado pelo botao "Atribuir empresa" da barra superior do chamado.
  let entAlvo = ticket.entity_id;
  if (entity_id !== undefined) {
    if (!podeAtribuirEmpresa(ticket, user)) {
      return res.status(403).json({ error: 'Somente a equipe de triagem pode mudar a empresa do chamado.' });
    }
    const ent = await query('SELECT id, name FROM entities WHERE id = $1 AND active',
      [parseInt(entity_id, 10)]);
    if (!ent.rows.length) return res.status(422).json({ error: 'Empresa inválida.' });
    if (exigeEmpresaNoEncerramento(ticket)
        && String(ent.rows[0].name).trim() === EMPRESA_PADRAO_WHATSAPP) {
      return res.status(422).json({ error: 'Escolha uma empresa real para este chamado do WhatsApp.' });
    }
    if (String(ent.rows[0].id) !== String(ticket.entity_id)) {
      add('entity_id = ?', ent.rows[0].id);
      changes.push(['entity', ticket.entity_name, ent.rows[0].name]);
      entAlvo = ent.rows[0].id;
      // localizacao e equipamento so permanecem se pertencerem a nova empresa
      if (ticket.location_id) {
        const loc = await query(
          'SELECT id FROM locations WHERE id = $1 AND entity_id = $2 AND active',
          [ticket.location_id, entAlvo]);
        if (!loc.rows.length) {
          add('location_id = ?', null);
          changes.push(['location', ticket.location_name, null]);
        }
      }
      if (ticket.asset_id) {
        const a = await query('SELECT id FROM assets WHERE id = $1 AND entity_id = $2',
          [ticket.asset_id, entAlvo]);
        if (!a.rows.length) {
          add('asset_id = ?', null);
          changes.push(['asset', ticket.asset_name, null]);
        }
      }
    }
  }
  if (location_id !== undefined) {
    if (location_id) {
      const loc = await resolveLocation(location_id, entAlvo);
      if (loc.error) return res.status(422).json({ error: loc.error });
      if (String(location_id) !== String(ticket.location_id)) {
        add('location_id = ?', location_id);
        changes.push(['location', ticket.location_name, loc.location.name]);
      }
    } else if (ticket.location_id) {
      add('location_id = ?', null);
      changes.push(['location', ticket.location_name, null]);
    }
  }
  if (needed_by !== undefined) {
    if (needed_by && !validDate(needed_by)) return res.status(422).json({ error: 'Data de necessidade inválida.' });
    const old = ticket.needed_by ? new Date(ticket.needed_by).toISOString().slice(0, 10) : null;
    if ((needed_by || null) !== old) {
      add('needed_by = ?', needed_by || null);
      changes.push(['needed_by', old, needed_by || null]);
    }
  }
  if (estimated_at !== undefined) {
    if (!support) return res.status(403).json({ error: 'Somente a equipe de suporte define a previsão.' });
    if (estimated_at && Number.isNaN(Date.parse(estimated_at))) return res.status(422).json({ error: 'Previsão inválida.' });
    const nv = estimated_at ? new Date(estimated_at).toISOString() : null;
    const ov = ticket.estimated_at ? new Date(ticket.estimated_at).toISOString() : null;
    if (nv !== ov) {
      add('estimated_at = ?', nv);
      changes.push(['estimated_at', ov, nv]);
    }
  }
  if (due_at !== undefined && support) {
    const nv = due_at ? new Date(due_at).toISOString() : null;
    const ov = ticket.due_at ? new Date(ticket.due_at).toISOString() : null;
    if (nv !== ov) {
      add('due_at = ?', nv);
      changes.push(['due_at', ov, nv]);
    }
  }
  if (asset_id !== undefined) {
    if (asset_id) {
      const a = await query('SELECT id, entity_id, name FROM assets WHERE id=$1', [asset_id]);
      if (!a.rows.length) return res.status(422).json({ error: 'Ativo não encontrado' });
      if (String(a.rows[0].entity_id) !== String(entAlvo)) return res.status(422).json({ error: 'Ativo não pertence à entidade do chamado' });
      if (String(asset_id) !== String(ticket.asset_id)) {
        add('asset_id = ?', asset_id);
        changes.push(['asset', ticket.asset_name, a.rows[0].name]);
      }
    } else if (ticket.asset_id) {
      add('asset_id = ?', null);
      changes.push(['asset', ticket.asset_name, null]);
    }
  }
  if (!fields.length) return res.status(422).json({ error: 'Nenhuma alteração para salvar.' });

  await query(`UPDATE tickets SET ${fields.join(', ')} WHERE id = $1`, params);
  for (const [action, oldV, newV] of changes) await addHistory(ticket.id, user.id, action, oldV, newV);
  if (triage) await claimModerator(ticket, user);
  await query(
    `INSERT INTO ticket_messages (ticket_id, user_id, kind, content)
     VALUES ($1, $2, 'system', $3)`,
    [req.params.id, user.id, `${user.name} atualizou os dados do chamado.`]);

  const updated = await loadTicket(req.params.id);
  if (changes.some((c) => c[0] === 'estimated_at')) {
    await notify.estimateChanged(updated, user);
  }
  emitUpdate(updated, await notify.summary(updated));
  res.json(decorate(updated, user));
});

// ---------------------------------------------------------------------
// Atribuicao de tecnico
// ---------------------------------------------------------------------
router.post('/:id/assign', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  const user = req.user;
  const triage = canAssign(user, ticket);
  if (!triage && !canTake(user, ticket)) {
    return res.status(403).json({ error: 'Seu perfil não pode atribuir técnicos neste chamado.' });
  }

  let techId = req.body?.user_id || null;
  if (!triage) {
    // so pode assumir para si um chamado sem responsavel
    techId = user.id;
    if (ticket.assigned_user_id && String(ticket.assigned_user_id) !== String(user.id)) {
      return res.status(403).json({ error: 'Chamado já está atribuído a outro técnico.' });
    }
  }
  let techName = null;
  if (techId) {
    const { rows } = await query(
      `SELECT name FROM users WHERE id = $1 AND role = 'technician' AND active = TRUE`, [techId]);
    if (!rows.length) return res.status(422).json({ error: 'Técnico inválido.' });
    techName = rows[0].name;
  }

  const newStatus = ticket.status === 1 && techId ? 2 : ticket.status;
  const changed = String(techId || '') !== String(ticket.assigned_user_id || '');
  await query(
    `UPDATE tickets SET assigned_user_id = $2::bigint,
       status = $3::smallint,
       assigned_at = CASE WHEN $4::boolean THEN (CASE WHEN $2::bigint IS NULL THEN NULL ELSE now() END)
                          ELSE assigned_at END
     WHERE id = $1`, [req.params.id, techId, newStatus, changed]);

  const changeText = techId
    ? `${user.name} atribuiu o chamado ao técnico ${techName}.`
    : 'Chamado desatribuído.';
  await query(
    `INSERT INTO ticket_messages (ticket_id, user_id, kind, content, new_status)
     VALUES ($1, $2, 'system', $3, $4)`,
    [req.params.id, user.id, changeText, newStatus !== ticket.status ? newStatus : null]);
  if (newStatus !== ticket.status) {
    await query(
      `INSERT INTO ticket_status_history (ticket_id, old_status, new_status, user_id)
       VALUES ($1, $2, $3, $4)`, [req.params.id, ticket.status, newStatus, user.id]);
    await addHistory(ticket.id, user.id, 'status', notify.STATUS_LABELS[ticket.status], notify.STATUS_LABELS[newStatus]);
  }
  if (changed) await addHistory(ticket.id, user.id, 'technician', ticket.assigned_name, techName);
  if (triage) await claimModerator(ticket, user);

  const updated = await loadTicket(req.params.id);
  await notify.ticketAssigned(updated);
  res.json(decorate(updated, user));
});

// ---------------------------------------------------------------------
// Observadores
// ---------------------------------------------------------------------
// Sugestoes de observadores: pessoas da mesma empresa (mesmo posto primeiro) e equipe
router.get('/:id/watcher-candidates', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  if (!canManageWatchers(req.user, ticket)) return res.status(403).json({ error: 'Seu perfil não pode gerenciar observadores.' });
  const { rows } = await query(
    `SELECT u.id, u.name, u.role, u.client_level, l.name AS location_name,
            (u.location_id IS NOT DISTINCT FROM $2::bigint AND $2::bigint IS NOT NULL) AS same_location
     FROM users u LEFT JOIN locations l ON l.id = u.location_id
     WHERE u.active
       AND u.id <> $3
       AND u.id NOT IN (SELECT user_id FROM ticket_watchers WHERE ticket_id = $4)
       AND (u.entity_id = $1
            OR u.id IN (SELECT user_id FROM user_entities WHERE entity_id = $1)
            OR u.role IN ('admin', 'moderator', 'technician'))
     ORDER BY same_location DESC, (u.entity_id = $1) DESC, u.name
     LIMIT 300`,
    [ticket.entity_id, ticket.location_id, ticket.requester_id, ticket.id]);
  res.json(rows);
});

router.post('/:id/watchers', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  const user = req.user;
  if (!canManageWatchers(user, ticket)) return res.status(403).json({ error: 'Seu perfil não pode gerenciar observadores.' });
  const watcherId = req.body?.user_id;
  if (!watcherId) return res.status(422).json({ error: 'Escolha a pessoa.' });
  const { rows } = await query(
    `SELECT u.id, u.name, u.role FROM users u
     WHERE u.id = $1 AND u.active
       AND (u.entity_id = $2
            OR u.id IN (SELECT user_id FROM user_entities WHERE entity_id = $2)
            OR u.role IN ('admin', 'moderator', 'technician'))`, [watcherId, ticket.entity_id]);
  if (!rows.length) return res.status(422).json({ error: 'Usuário inválido para observar este chamado.' });
  const ins = await query(
    `INSERT INTO ticket_watchers (ticket_id, user_id, added_by) VALUES ($1, $2, $3)
     ON CONFLICT (ticket_id, user_id) DO NOTHING RETURNING id`, [ticket.id, watcherId, user.id]);
  if (ins.rows.length) {
    await addHistory(ticket.id, user.id, 'watcher_added', null, rows[0].name);
    await query(
      `INSERT INTO ticket_messages (ticket_id, user_id, kind, content) VALUES ($1, $2, 'system', $3)`,
      [ticket.id, user.id, `${user.name} adicionou ${rows[0].name} como observador(a).`]);
    await claimModerator(ticket, user);
    const updated = await loadTicket(ticket.id);
    await notify.watcherAdded(updated, rows[0], user);
    emitUpdate(updated, await notify.summary(updated));
  }
  res.status(201).json({ ok: true });
});

router.delete('/:id/watchers/:userId', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  const user = req.user;
  if (!canManageWatchers(user, ticket)) return res.status(403).json({ error: 'Seu perfil não pode gerenciar observadores.' });
  const { rows } = await query(
    `DELETE FROM ticket_watchers w USING users u
     WHERE w.ticket_id = $1 AND w.user_id = $2 AND u.id = w.user_id RETURNING u.name`,
    [ticket.id, req.params.userId]);
  if (!rows.length) return res.status(404).json({ error: 'Observador não encontrado.' });
  await addHistory(ticket.id, user.id, 'watcher_removed', rows[0].name, null);
  await query(
    `INSERT INTO ticket_messages (ticket_id, user_id, kind, content) VALUES ($1, $2, 'system', $3)`,
    [ticket.id, user.id, `${user.name} removeu ${rows[0].name} dos observadores.`]);
  emitUpdate(ticket, await notify.summary(ticket));
  res.json({ ok: true });
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
  const triage = canTriage(user, ticket);
  const full = canStatusAny(user, ticket) || canWork(user, ticket);
  if (!full) {
    // quem so pode cancelar/reabrir os proprios chamados
    const allowed = canCancel(user, ticket) && (
      (toStatus === 7 && ![5, 6, 7].includes(ticket.status)) || // cancelar
      (toStatus === 3 && [5, 6].includes(ticket.status)));      // reabrir
    if (!allowed) {
      return res.status(403).json({ error: 'Você não pode alterar o status deste chamado.' });
    }
  }

  // Chamado do WhatsApp sem empresa real: atribuir empresa antes de resolver.
  if ([5, 6].includes(toStatus) && exigeEmpresaNoEncerramento(ticket)) {
    return res.status(422).json({
      error: 'Este chamado veio pelo WhatsApp e ainda está sem empresa. Atribua uma empresa antes de resolver.',
      entity_required: true,
    });
  }

  const settings = await settingsStore.getAll();

  // Quem nao pode resolver direto -> solicita aprovacao do solicitante (modelo GLPI)
  if (toStatus === 5 && needsApproval(user) && settings['app.approval_on_solve']) {
    return res.status(409).json({
      error: 'Para marcar como resolvido, solicite a aprovação do cliente antes.',
      request_approval: true,
    });
  }
  let resolution = null;
  if (toStatus === 5) {
    resolution = await readResolution(req.body);
    if (resolution.error) return res.status(422).json({ error: resolution.error, resolution_form: true });
  }

  const closedAt = toStatus === 6 ? new Date() : null;
  await query(
    `UPDATE tickets SET status = $1::smallint, closed_at = $2,
       resolved_at = CASE WHEN $1::smallint = 5 THEN now()
                          WHEN $1::smallint = 6 THEN COALESCE(resolved_at, now())
                          WHEN $1::smallint IN (1,2,3,4) THEN NULL ELSE resolved_at END
     WHERE id = $3`, [toStatus, closedAt, req.params.id]);
  await query(
    `INSERT INTO ticket_status_history (ticket_id, old_status, new_status, user_id)
     VALUES ($1, $2, $3, $4)`, [req.params.id, ticket.status, toStatus, user.id]);
  if (resolution) await saveResolution(ticket, user, resolution);
  const reopened = [5, 6].includes(ticket.status) && toStatus === 3;
  await addHistory(ticket.id, user.id, reopened ? 'reopened' : 'status',
    notify.STATUS_LABELS[ticket.status], notify.STATUS_LABELS[toStatus]);
  await query(
    `INSERT INTO ticket_messages (ticket_id, user_id, kind, content, new_status)
     VALUES ($1, $2, $3, $4, $5)`,
    [req.params.id, user.id, (comment || resolution) ? 'comment' : 'system',
     resolution ? `Chamado resolvido.\n\nO que foi feito: ${resolution.notes}`
       : comment || `${user.name} alterou o status de "${notify.STATUS_LABELS[ticket.status]}" para "${notify.STATUS_LABELS[toStatus]}".`,
     toStatus]);
  if (triage) await claimModerator(ticket, user);

  const updated = await loadTicket(req.params.id);
  await notify.statusChanged(updated, user, toStatus);
  if (toStatus === 5 && resolution) {
    await notify.solutionToWhatsApp(updated, resolution.notes).catch((e) =>
      console.log('[tickets] aviso whatsapp da solucao falhou:', e.message));
  }
  res.json(decorate(updated, user));
});

// ---------------------------------------------------------------------
// Solicitacao de aprovacao (solucao proposta)
// ---------------------------------------------------------------------
router.post('/:id/approval', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  const user = req.user;
  if (!canResolve(user, ticket)) {
    return res.status(403).json({ error: 'Apenas o técnico responsável ou a triagem pode registrar a solução.' });
  }
  if (ticket.approval_status === 'pending') {
    return res.status(422).json({ error: 'Já existe aprovação pendente.' });
  }
  if (exigeEmpresaNoEncerramento(ticket)) {
    return res.status(422).json({
      error: 'Este chamado veio pelo WhatsApp e ainda está sem empresa. Atribua uma empresa antes de resolver.',
      entity_required: true,
    });
  }
  const resolution = await readResolution(req.body);
  if (resolution.error) return res.status(422).json({ error: resolution.error, resolution_form: true });
  const solution = resolution.notes;

  await query(
    `UPDATE tickets SET approval_status = 'pending', approval_requested_by_id = $1,
            approval_comment = $2, approval_requested_at = now(),
            approval_responded_by_id = NULL, approval_responded_at = NULL
     WHERE id = $3`, [user.id, solution, req.params.id]);
  await query(
    `INSERT INTO ticket_messages (ticket_id, user_id, kind, content)
     VALUES ($1, $2, 'approval', $3)`,
    [req.params.id, user.id, `Solicitação de aprovação enviada ao cliente.\n\nSolução proposta: ${solution}`]);
  await addHistory(ticket.id, user.id, 'solution', null, solution);
  await saveResolution(ticket, user, resolution);

  const updated = await loadTicket(req.params.id);
  await notify.approvalRequested(updated);
  res.json(decorate(updated, user));
});

// ---------------------------------------------------------------------
// Resposta do cliente a aprovacao (aprovar / reprovar)
// ---------------------------------------------------------------------
router.post('/:id/approval/respond', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  const user = req.user;
  if (!canApprove(user, ticket)) {
    return res.status(403).json({ error: 'Você não pode aprovar/reprovar este chamado.' });
  }
  if (ticket.approval_status !== 'pending') {
    return res.status(422).json({ error: 'Não há aprovação pendente neste chamado.' });
  }
  const decision = req.body?.decision;
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(422).json({ error: 'Decisão inválida.' });
  }
  if (decision === 'approved' && exigeEmpresaNoEncerramento(ticket)) {
    return res.status(422).json({
      error: 'Este chamado veio pelo WhatsApp e ainda está sem empresa. A equipe precisa atribuir uma empresa antes de fechar.',
      entity_required: true,
    });
  }
  const note = String(req.body?.comment || '').trim();

  const newStatus = decision === 'approved' ? 6 : 3;
  const closedAt = newStatus === 6 ? new Date() : null;
  await query(
    `UPDATE tickets SET approval_status = $1, approval_responded_by_id = $2,
            approval_responded_at = now(), approval_comment = $3,
            status = $4::smallint, closed_at = $5,
            resolved_at = CASE WHEN $4::smallint = 6 THEN COALESCE(resolved_at, now()) ELSE NULL END
     WHERE id = $6`,
    [decision, user.id, note, newStatus, closedAt, req.params.id]);
  await query(
    `INSERT INTO ticket_status_history (ticket_id, old_status, new_status, user_id)
     VALUES ($1, $2, $3, $4)`, [req.params.id, ticket.status, newStatus, user.id]);
  await addHistory(ticket.id, user.id, decision === 'approved' ? 'approved' : 'rejected',
    notify.STATUS_LABELS[ticket.status], notify.STATUS_LABELS[newStatus]);
  await query(
    `INSERT INTO ticket_messages (ticket_id, user_id, kind, content, new_status)
     VALUES ($1, $2, 'approval', $3, $4)`,
    [req.params.id, user.id,
     `${user.name} ${decision === 'approved' ? 'APROVOU' : 'REPROVOU'} a solução proposta.` +
     `${note ? `\n\n${note}` : ''}`,
     newStatus]);

  const updated = await loadTicket(req.params.id);
  await notify.approvalResponded(updated, decision, user.name);
  if (decision === 'approved' && updated.resolution_notes) {
    await notify.solutionToWhatsApp(updated, updated.resolution_notes).catch((e) =>
      console.log('[tickets] aviso whatsapp da solucao aprovada falhou:', e.message));
  }
  res.json(decorate(updated, user));
});

// ---------------------------------------------------------------------
// Mensagens / notas no chamado
//   - equipe (admin, admin local, moderador, tecnico): kind 'internal' = nota interna
//   - cliente gestor: kind 'note' (instrucao/solicitacao)
//   - demais: kind 'comment'
// ---------------------------------------------------------------------
router.post('/:id/messages', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  const user = req.user;
  if (!canMessage(user, ticket)) {
    return res.status(403).json({ error: 'Você não pode interagir neste chamado.' });
  }
  const content = String(req.body?.content || '').trim();
  if (!content) return res.status(422).json({ error: 'Escreva a mensagem.' });

  let kind = 'comment';
  if (req.body?.kind === 'internal') {
    if (!canInternal(user)) return res.status(403).json({ error: 'Seu perfil não pode escrever notas internas.' });
    kind = 'internal';
  } else if (has(user, 'ticket.manager_note') && inScope(user, ticket) && req.body?.kind === 'note') {
    kind = 'note';
  }

  const { rows } = await query(
    `INSERT INTO ticket_messages (ticket_id, user_id, kind, content)
     VALUES ($1, $2, $3, $4) RETURNING *`, [req.params.id, user.id, kind, content]);
  const message = { ...rows[0], user: { id: user.id, name: user.name, role: user.role } };

  // Notifica envolvidos + atualiza painel em tempo real
  const updated = await loadTicket(req.params.id);
  const s = await notify.summary(updated);
  let participants = await notify.getParticipants(ticket.id, ticket.entity_id, user.id);
  if (kind === 'internal') {
    // nota interna: so quem tem a permissao de notas internas recebe o aviso
    const { rows: allowedRoles } = await query(
      `SELECT role_key FROM role_permissions WHERE permission = 'ticket.internal' AND allowed`);
    const keys = new Set(allowedRoles.map((r) => r.role_key));
    const keyOf = (p) => (p.role === 'client' ? (Number(p.client_level) === 2 ? 'manager' : 'user') : p.role);
    participants = participants.filter((p) => p.role === 'admin' || keys.has(keyOf(p)));
  }
  await notify.deliver({
    ticket: updated, event: 'comment.added', recipients: participants,
    title: () => `${kind === 'internal' ? 'Nota interna' : 'Nova mensagem'} em ${s.number}`,
    subject: () => `[Mensagem] ${s.number}`,
    message: () => `${user.name} escreveu: ${content}`,
  });
  if (kind === 'internal') {
    realtime.emitBroadcastRoles(['admin', 'moderator', 'technician'], 'ticket:update', s);
  } else {
    emitUpdate(updated, s);
  }

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
      if (!canViewTicket(req.user, ticket)) return res.status(403).json({ error: 'Acesso negado.' });
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
      emitUpdate(ticket, s);
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
    if (!ticket || !canViewTicket(req.user, ticket)) return res.status(403).json({ error: 'Acesso negado.' });
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
    if (!(canEditTicket(req.user, ticket) || isRequester(req.user, ticket))) {
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
