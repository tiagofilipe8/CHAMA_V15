const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { query, withTransaction } = require('../db');
const {
  requireAuth, scopeConditions, canViewTicket, canTriage, canAccessEntity, seesAll, has,
  isMaster, isLocalAdmin, isModerator, canAssign, canTake, canManageWatchers, canWork,
  canStatusAny, canResolve, needsApproval, canApprove, canCancel, canEditTicket, canMessage,
  canInternal, inScope, ticketAbilities, isRequester,
} = require('../middleware/auth');
const notify = require('../services/notify');
const settingsStore = require('../services/settingsStore');
const realtime = require('../services/realtime');
const { perfilDaEmpresa } = require('./optionProfiles');
const regrasArquivo = require('../uploadRules');
const avaliacao = require('../services/avaliacao');
const pausas = require('../services/pausas');

// Quem abriu pode encerrar o próprio chamado ("resolvido" fica para o técnico avaliar e fechar)
const MOTIVOS_USUARIO = {
  resolvido: 'Já foi resolvido',
  sozinho: 'Resolvi sozinho',
  engano: 'Aberto por engano',
  repetido: 'Chamado repetido',
  nao_preciso: 'Não preciso mais',
  outro: 'Outro motivo',
};
const DIAS_PARA_REABRIR = 3;

// A opção (categoria, urgência ou causa) é do perfil de opções da empresa?
// perfil undefined = não confere (compatibilidade); null = Padrão.
const mesmoPerfil = (linha, perfil) => perfil === undefined
  || String(linha.profile_id ?? '') === String(perfil ?? '');

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
    const ext = regrasArquivo.extensaoSegura(file.originalname);
    const base = path.basename(file.originalname, path.extname(file.originalname))
      .replace(/[^\w\-À-ÿ ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'arquivo';
    cb(null, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${base}${ext}`);
  },
});
const attUpload = multer({
  storage: attStorage,
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  // so fotos, PDF, Word e Excel sem macro (ver server/uploadRules.js)
  fileFilter: regrasArquivo.fileFilter,

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
    delete out.requester_rating_criteria;
    delete out.resolution_cause_id;
    delete out.resolution_cause_name;
  }
  return {
    ...out,
    // numeração simples: "#16" (o número antigo, ex. 2026-00016, fica em numero_antigo)
    number: `#${ticket.id}`,
    numero_antigo: ticket.number,
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
  realtime.emitToUsers([ticket.requester_id, ticket.assigned_user_id]
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
async function resolveCategory(categoryId, simpleCategoryId, perfil) {
  const id = simpleCategoryId || categoryId;
  if (!id) return { category_id: null, simple_category_id: null };
  const { rows } = await query('SELECT id, kind, maps_to_id, active, profile_id FROM categories WHERE id = $1', [id]);
  if (!rows.length || !rows[0].active) return { error: 'Categoria inválida.' };
  const c = rows[0];
  if (!mesmoPerfil(c, perfil)) return { error: 'Essa categoria não é do perfil de opções desta empresa.' };
  // Só categorias simples: o chamado grava direto na simples escolhida
  if (c.kind === 'simple') return { category_id: c.id, simple_category_id: c.id };
  return { category_id: c.id, simple_category_id: null };
}

async function resolveImpact(impactId, perfil) {
  if (!impactId) return null;
  const { rows } = await query('SELECT id, name, priority, profile_id FROM impact_levels WHERE id = $1 AND active', [impactId]);
  if (!rows.length || !mesmoPerfil(rows[0], perfil)) return null;
  return rows[0];
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
async function readResolution(body = {}, perfil) {
  // A causa e sempre obrigatoria
  const causeId = body.resolution_cause_id;
  if (!causeId || !/^\d+$/.test(String(causeId))) return { error: 'Escolha a causa do problema.' };
  const c = await query('SELECT id, name, profile_id, neutral FROM resolution_causes WHERE id = $1 AND active', [causeId]);
  if (!c.rows.length || !mesmoPerfil(c.rows[0], perfil)) return { error: 'Causa inválida.' };
  const cause = c.rows[0];
  let notes = String(body.resolution_notes || body.comment || '').trim();
  let action = String(body.equipment_action || '');
  // nota: checklist de 5 itens (cada "sim" = 1 estrela); sem checklist, aceita a nota direta
  let rating = body.requester_rating;
  let criterios = null;
  if (body.requester_rating_criteria !== undefined && body.requester_rating_criteria !== null) {
    const c = avaliacao.lerChecklist(body.requester_rating_criteria);
    if (c.error) return { error: c.error };
    criterios = c.criterios; rating = c.nota;
  }
  const semNota = rating === undefined || rating === null || rating === '';
  const ratingComment = String(body.requester_rating_comment || '').trim() || null;

  // Causa neutra (aberto por engano, duplicado...): o resto e opcional
  if (cause.neutral) {
    if (!notes) notes = `Encerrado sem atendimento: ${cause.name}.`;
    if (!EQUIPMENT_ACTIONS[action]) action = 'no_equipment';
    if (!semNota && !/^[0-5]$/.test(String(rating))) return { error: 'A nota vai de 0 a 5 estrelas.' };
    return { notes, cause, action, rating: semNota ? null : parseInt(rating, 10), ratingComment, criterios: semNota ? null : criterios };
  }

  if (notes.length < 5) return { error: 'Descreva o que aconteceu e o que foi feito.' };
  if (!EQUIPMENT_ACTIONS[action]) return { error: 'Informe o que aconteceu com o equipamento.' };
  if (semNota || !/^[0-5]$/.test(String(rating))) {
    return { error: 'Dê uma nota de 0 a 5 estrelas para o usuário.' };
  }
  return { notes, cause, action, rating: parseInt(rating, 10), ratingComment, criterios };
}

async function saveResolution(ticket, user, r) {
  await query(
    `UPDATE tickets SET resolution_notes = $2, resolution_cause_id = $3, equipment_action = $4,
            requester_rating = $5, requester_rating_comment = $6, resolved_by_id = $7,
            requester_rating_criteria = $8, awaiting_evaluation = FALSE
     WHERE id = $1`,
    [ticket.id, r.notes, r.cause.id, r.action, r.rating, r.ratingComment, user.id, r.criterios ? JSON.stringify(r.criterios) : null]);
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
  if (watching === 'me') frag('FALSE', []); // observadores foram tirados do sistema
  if (q && /^#?\d+$/.test(String(q).trim())) {
    frag(`(t.id = ? OR t.number ILIKE ?)`, [parseInt(String(q).replace('#', ''), 10), `%${String(q).replace('#', '')}%`]);
  } else if (q) {
    frag(`(t.title ILIKE ? OR t.description ILIKE ? OR t.number ILIKE ?)`,
      [`%${q}%`, `%${q}%`, `%${q}%`]);
  }

  const where = ['TRUE', ...conds].join(' AND ');
  const lim = Math.min(parseInt(limit, 10) || 200, 500);
  const { rows } = await query(
    `${TICKET_SELECT} WHERE (${where}) ${scope.sql ? 'AND ' + scope.sql : ''}
     ORDER BY ${req.query.sort === 'number' ? 't.id DESC' : 't.updated_at DESC'} LIMIT ${lim}`, params);
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
// ---------------------------------------------------------------------
// Em atendimento: o chamado que o técnico (ou o Administrador Mestre) está atendendo agora.
//   GET  /tickets/atendimento          -> o meu atual + os meus chamados em aberto (por urgência)
//   POST /tickets/:id/atender          -> passa a atender este (troca o anterior)
//   POST /tickets/atendimento/parar    -> para de atender (pausa)
// Começar a atender um chamado Novo/Atribuído muda o status para "Em andamento".
// Ao resolver, fechar, cancelar ou trocar o técnico, o "em atendimento" é limpo sozinho.
// ---------------------------------------------------------------------
const podeAtender = (u) => isMaster(u) || has(u, 'ticket.work');

router.get('/atendimento', async (req, res) => {
  const u = req.user;
  if (!podeAtender(u)) return res.json({ pode: false, atual: null, meus: [] });
  const me = await query('SELECT working_ticket_id, working_since FROM users WHERE id = $1', [u.id]);
  const atualId = me.rows[0]?.working_ticket_id || null;
  const { rows } = await query(
    `${TICKET_SELECT} WHERE t.assigned_user_id = $1 AND t.status NOT IN (5,6,7)
     ORDER BY t.priority DESC, t.needed_by NULLS LAST, t.created_at`, [u.id]);
  let atual = atualId ? rows.find((r) => String(r.id) === String(atualId)) : null;
  if (atualId && !atual) {
    const t = await loadTicket(atualId);
    atual = t && ![5, 6, 7].includes(t.status) && canViewTicket(u, t) ? t : null;
    if (!atual) await query('UPDATE users SET working_ticket_id = NULL, working_since = NULL WHERE id = $1', [u.id]);
  }
  res.json({
    pode: true,
    desde: atual ? me.rows[0].working_since : null,
    atual: atual ? decorate(atual, u) : null,
    meus: rows.map((r) => decorate(r, u)),
  });
});

router.post('/atendimento/parar', async (req, res) => {
  await query('UPDATE users SET working_ticket_id = NULL, working_since = NULL WHERE id = $1', [req.user.id]);
  realtime.emitBroadcastRoles(['admin', 'moderator', 'technician'], 'equipe:atendimento', { user_id: req.user.id });
  res.json({ ok: true });
});

router.post('/:id/atender', async (req, res) => {
  const u = req.user;
  if (!podeAtender(u)) return res.status(403).json({ error: 'Seu perfil não atende chamados.' });
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  if ([5, 6, 7].includes(ticket.status)) return res.status(422).json({ error: 'Este chamado já foi resolvido, fechado ou cancelado.' });
  // só o técnico do chamado (o Administrador Mestre pode atender qualquer um que esteja com ele)
  if (String(ticket.assigned_user_id || '') !== String(u.id)) {
    return res.status(422).json({ error: 'Só dá para atender um chamado que está com você. Assuma ou peça a atribuição antes.' });
  }
  await query('UPDATE users SET working_ticket_id = $1, working_since = now() WHERE id = $2', [ticket.id, u.id]);
  if ([1, 2].includes(ticket.status)) {
    await query('UPDATE tickets SET status = 3 WHERE id = $1', [ticket.id]);
    await query('INSERT INTO ticket_status_history (ticket_id, old_status, new_status, user_id) VALUES ($1, $2, 3, $3)',
      [ticket.id, ticket.status, u.id]);
    await addHistory(ticket.id, u.id, 'status', notify.STATUS_LABELS[ticket.status], notify.STATUS_LABELS[3]);
    await query(`INSERT INTO ticket_messages (ticket_id, user_id, kind, content, new_status) VALUES ($1, $2, 'system', $3, 3)`,
      [ticket.id, u.id, `${u.name} começou a atender o chamado.`]);
  }
  const updated = await loadTicket(ticket.id);
  emitUpdate(updated, await notify.summary(updated));
  realtime.emitBroadcastRoles(['admin', 'moderator', 'technician'], 'equipe:atendimento', { user_id: u.id, ticket_id: ticket.id });
  res.json({ ok: true, ticket: decorate(updated, u) });
});

// Ultimos comentarios de varios chamados (previa no calendario: passar o mouse num dia).
// So chamados que a pessoa pode ver; notas internas so para quem pode le-las.
router.get('/comments-preview', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter((x) => /^\d+$/.test(x)).slice(0, 500).map(Number);
  if (!ids.length) return res.json({});
  const scope = scopeConditions(req.user, 2);
  const kinds = canInternal(req.user) ? "'comment','note','internal'" : "'comment','note'";
  const { rows } = await query(
    `SELECT ticket_id, quem, texto, quando FROM (
       SELECT m.ticket_id, u.name AS quem, m.content AS texto, m.created_at AS quando,
              row_number() OVER (PARTITION BY m.ticket_id ORDER BY m.created_at DESC) AS n
       FROM ticket_messages m
       JOIN users u ON u.id = m.user_id
       JOIN tickets t ON t.id = m.ticket_id
       WHERE m.ticket_id = ANY($1::bigint[]) AND m.kind IN (${kinds})
       ${scope.sql ? 'AND ' + scope.sql : ''}
     ) x WHERE n <= 3 ORDER BY ticket_id, quando DESC`, [ids, ...scope.params]);
  const out = {};
  rows.forEach((r) => { (out[r.ticket_id] = out[r.ticket_id] || []).push({ quem: r.quem, texto: r.texto, quando: r.quando }); });
  res.json(out);
});

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

  // Categoria (obrigatoria), do perfil de opções da empresa
  const perfilEnt = await perfilDaEmpresa(entId);
  const cat = await resolveCategory(category_id, simple_category_id, perfilEnt);
  if (cat.error) return res.status(422).json({ error: cat.error });
  if (!cat.category_id) return res.status(422).json({ error: 'Escolha a categoria do chamado.' });
  const catMat = await query('SELECT is_material FROM categories WHERE id = $1', [cat.simple_category_id || cat.category_id]);
  if (catMat.rows[0]?.is_material && !materiaisOk.length) {
    return res.status(422).json({ error: 'Escolha pelo menos um material da lista.' });
  }
  // Categoria de manutenção: precisa dizer qual equipamento (ou "não se aplica" / "não encontrei a etiqueta")
  const catEquip = await query('SELECT requires_asset FROM categories WHERE id = $1', [cat.simple_category_id || cat.category_id]);
  const escolhaEquip = String(req.body?.asset_escolha || '');
  let assetPendente = false; let assetNaoAplica = false;
  if (catEquip.rows[0]?.requires_asset && !asset_id) {
    if (escolhaEquip === 'nao_encontrei') assetPendente = true;
    else if (escolhaEquip === 'nao_aplica') assetNaoAplica = true;
    else return res.status(422).json({ error: 'Escolha qual é o equipamento (ou "Não se aplica" / "Não encontrei a etiqueta").', asset_obrigatorio: true });
  }

  // Urgencia (obrigatoria). Compatibilidade: se vier so a prioridade antiga, converte.
  let impact = await resolveImpact(impact_id, perfilEnt);
  if (!impact && priority) {
    const { rows } = await query(
      `SELECT id, name, priority FROM impact_levels
       WHERE active AND priority = $1 AND COALESCE(profile_id, 0) = COALESCE($2::bigint, 0)
       ORDER BY sort_order LIMIT 1`,
      [Math.min(Math.max(parseInt(priority, 10) || 2, 1), 4), perfilEnt]);
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

  // Data de necessidade e opcional ("sem pressa" = sem data)
  if (needed_by) {
    if (!validDate(needed_by)) return res.status(422).json({ error: 'Data de necessidade inválida.' });
    if (String(needed_by) < new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10)) {
      return res.status(422).json({ error: 'A data de necessidade não pode ser no passado.' });
    }
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
    if (assetPendente || assetNaoAplica) {
      await query('UPDATE tickets SET asset_pendente = $2, asset_nao_aplica = $3 WHERE id = $1', [ticketId, assetPendente, assetNaoAplica]);
    }
    // não achou a etiqueta: a equipe é avisada para marcar depois qual é o equipamento
    if (assetPendente) {
      const equipe = await query(`SELECT id FROM users WHERE active AND role IN ('admin','moderator','technician') AND id <> $1`, [user.id]);
      for (const r of equipe.rows) {
        await notify.createInApp(r.id, `#${ticketId}: falta marcar o equipamento`, `${user.name} não encontrou a etiqueta. Veja qual é o equipamento e marque no chamado.`, ticketId).catch(() => {});
      }
    }
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
    query(`SELECT m.id, m.name, m.unit, m.quantity, m.status, m.status_at, m.destino, m.asset_id, m.asset_ids, m.asset_type,
                  m.price, m.location_id, l.name AS location_name, u.name AS status_by_name
           FROM ticket_materials m LEFT JOIN users u ON u.id = m.status_by LEFT JOIN locations l ON l.id = m.location_id
           WHERE m.ticket_id = $1 ORDER BY m.id`, [id]),
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
    watchers: [], // observadores foram tirados do sistema
    materials: has(req.user, 'inventory.secrets') ? mats.rows : mats.rows.map(({ price, ...m }) => m), // preço só para quem pode ver
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
  // categoria e urgência: do perfil de opções da empresa (a nova, se a triagem trocar a empresa agora)
  const perfilAlvo = (category_id !== undefined || simple_category_id !== undefined || impact_id !== undefined)
    ? await perfilDaEmpresa(req.body?.entity_id || ticket.entity_id) : undefined;
  if (category_id !== undefined || simple_category_id !== undefined) {
    const cat = await resolveCategory(category_id, simple_category_id, perfilAlvo);
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
    const impact = await resolveImpact(impact_id, perfilAlvo);
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
      if (ticket.asset_pendente) add('asset_pendente = ?', false); // o técnico marcou o equipamento
      if (ticket.asset_nao_aplica) add('asset_nao_aplica = ?', false);
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

  // "Assumir chamado" (assumir: true) = fica com quem clicou. Antes, quem tinha permissão de
  // atribuir e clicava em Assumir mandava "sem técnico" e acabava TIRANDO o técnico do chamado.
  const assumir = req.body?.assumir === true;
  let techId = assumir ? user.id : (req.body?.user_id || null);
  if (!triage) {
    // so pode assumir para si um chamado sem responsavel
    techId = user.id;
    if (ticket.assigned_user_id && String(ticket.assigned_user_id) !== String(user.id)) {
      return res.status(403).json({ error: 'Chamado já está atribuído a outro técnico.' });
    }
  }
  let techName = null;
  if (techId) {
    // quem pode ficar com chamados: Técnico e Administrador Mestre
    const { rows } = await query(
      `SELECT name FROM users WHERE id = $1 AND role IN ('technician', 'admin') AND active = TRUE`, [techId]);
    if (!rows.length) return res.status(422).json({ error: 'Só um Técnico ou o Administrador Mestre pode ficar com o chamado.' });
    techName = rows[0].name;
  }
  if (String(techId || '') === String(ticket.assigned_user_id || '')) {
    return res.json(decorate(ticket, user)); // nada mudou: não grava nem avisa ninguém
  }

  // Novo + técnico = Atribuído; Atribuído sem técnico volta a Novo
  const newStatus = ticket.status === 1 && techId ? 2 : (ticket.status === 2 && !techId ? 1 : ticket.status);
  const changed = String(techId || '') !== String(ticket.assigned_user_id || '');
  await query(
    `UPDATE tickets SET assigned_user_id = $2::bigint,
       status = $3::smallint,
       assigned_at = CASE WHEN $4::boolean THEN (CASE WHEN $2::bigint IS NULL THEN NULL ELSE now() END)
                          ELSE assigned_at END
     WHERE id = $1`, [req.params.id, techId, newStatus, changed]);

  const changeText = !techId ? `${user.name} tirou o técnico do chamado.`
    : String(techId) === String(user.id) ? `${user.name} assumiu o chamado.`
      : `${user.name} atribuiu o chamado a ${techName}.`;
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
  await notify.ticketAssigned(updated, user);
  res.json(decorate(updated, user));
});

// Quem pode ficar com este chamado (Técnicos e Administrador Mestre), com a carga de cada um:
// chamados em aberto por urgência e o que está atendendo agora. Usado na janela "Atribuir técnico".
// Para quem abriu o chamado escolher "qual técnico resolveu" (só nomes)
router.get('/:id/quem-pode-ter-resolvido', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  if (!canViewTicket(req.user, ticket)) return res.status(403).json({ error: 'Acesso negado.' });
  const { rows } = await query(
    `SELECT id, name FROM users WHERE active AND role IN ('technician','admin','moderator')
     ORDER BY (id = $1) DESC, (role = 'technician') DESC, name`, [ticket.assigned_user_id || 0]);
  res.json(rows);
});

router.get('/:id/tecnicos', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  if (!canAssign(req.user, ticket)) return res.status(403).json({ error: 'Seu perfil não pode atribuir técnicos neste chamado.' });
  const { rows } = await query(
    `SELECT u.id, u.name, u.role,
            count(t.id)::int AS total,
            count(t.id) FILTER (WHERE t.priority = 4)::int AS p4,
            count(t.id) FILTER (WHERE t.priority = 3)::int AS p3,
            count(t.id) FILTER (WHERE t.priority = 2)::int AS p2,
            count(t.id) FILTER (WHERE t.priority = 1)::int AS p1,
            (SELECT json_build_object('id', w.id, 'title', w.title) FROM tickets w
              WHERE w.id = u.working_ticket_id AND w.status NOT IN (5,6,7)) AS atendendo
     FROM users u
     LEFT JOIN tickets t ON t.assigned_user_id = u.id AND t.status NOT IN (5,6,7)
     WHERE u.active AND u.role IN ('technician', 'admin')
     GROUP BY u.id
     ORDER BY (u.role = 'technician') DESC, count(t.id), u.name`);
  res.json(rows);
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
    // reabrir: só até 3 dias depois que o técnico fechou, e contando o que não resolveu
    if (toStatus === 3) {
      if (ticket.reopen_until && new Date(ticket.reopen_until) < new Date()) {
        return res.status(403).json({ error: `O prazo para reabrir (${DIAS_PARA_REABRIR} dias depois do fechamento) acabou. Abra um chamado novo e cite o #${ticket.id}.` });
      }
      if (!String(comment || '').trim()) return res.status(422).json({ error: 'Conte o que não ficou resolvido.', reopen_reason: true });
    }
  }

  // Em pausa: sempre com motivo e data para retomar
  let pausa = null;
  if (toStatus === 4) {
    pausa = pausas.lerPausa(req.body);
    if (pausa.error) return res.status(422).json({ error: pausa.error, pause_form: true });
  }

  // Chamado do WhatsApp sem empresa real: atribuir empresa antes de resolver.
  if ([5, 6].includes(toStatus) && exigeEmpresaNoEncerramento(ticket)) {
    return res.status(422).json({
      error: 'Este chamado veio pelo WhatsApp e ainda está sem empresa. Atribua uma empresa antes de resolver.',
      entity_required: true,
    });
  }

  const settings = await settingsStore.getAll();

  // Encerrar (Resolvido ou Fechado) sempre passa pelo formulario de encerramento.
  // Fechar um chamado que ja foi resolvido (com causa registrada) nao pede de novo.
  const jaTemEncerramento = ticket.status === 5 && !!ticket.resolution_cause_id;
  const precisaFormulario = toStatus === 5 || (toStatus === 6 && !jaTemEncerramento);

  // Quem nao pode resolver direto -> solicita aprovacao do solicitante (modelo GLPI)
  if (precisaFormulario && needsApproval(user) && settings['app.approval_on_solve']) {
    return res.status(409).json({
      error: 'Para encerrar, registre a solução e peça a aprovação do cliente.',
      request_approval: true,
    });
  }
  let resolution = null;
  if (precisaFormulario) {
    resolution = await readResolution(req.body, await perfilDaEmpresa(ticket.entity_id));
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
  if (pausa) {
    await query(
      `UPDATE tickets SET pause_reason = $2, pause_until = $3, pause_prev_status = $4, paused_at = now(), paused_by = $5 WHERE id = $1`,
      [ticket.id, pausa.motivo, pausa.ate, [1, 2, 3].includes(ticket.status) ? ticket.status : null, user.id]);
  } else if (ticket.status === 4) {
    await query('UPDATE tickets SET pause_reason = NULL, pause_until = NULL, pause_prev_status = NULL, paused_at = NULL WHERE id = $1', [ticket.id]);
  }
  // técnico (ou a equipe) fechou: o solicitante ainda pode reabrir por 3 dias
  const fechouPelaEquipe = toStatus === 6 && String(user.id) !== String(ticket.requester_id);
  if (fechouPelaEquipe) {
    await query(`UPDATE tickets SET reopen_until = now() + ($2::int * interval '1 day'), awaiting_evaluation = FALSE WHERE id = $1`, [ticket.id, DIAS_PARA_REABRIR]);
  } else if ([1, 2, 3, 4].includes(toStatus)) {
    await query('UPDATE tickets SET reopen_until = NULL, awaiting_evaluation = FALSE, closed_by_requester = FALSE WHERE id = $1', [ticket.id]);
  }
  const reopened = [5, 6].includes(ticket.status) && toStatus === 3;
  await addHistory(ticket.id, user.id, reopened ? 'reopened' : 'status',
    notify.STATUS_LABELS[ticket.status], notify.STATUS_LABELS[toStatus]);
  await query(
    `INSERT INTO ticket_messages (ticket_id, user_id, kind, content, new_status)
     VALUES ($1, $2, $3, $4, $5)`,
    [req.params.id, user.id, (comment || resolution || pausa) ? 'comment' : 'system',
     resolution ? `Chamado ${toStatus === 6 ? 'fechado' : 'resolvido'}.\n\nO que foi feito: ${resolution.notes}`
       : pausa ? `Chamado em pausa: ${pausas.MOTIVOS_PAUSA[pausa.motivo]}. Volta para a fila em ${pausa.ate.split('-').reverse().join('/')}.${comment ? `\n\n${comment}` : ''}`
         : reopened && comment ? `Chamado reaberto. O que não ficou resolvido: ${comment}`
           : comment || `${user.name} alterou o status de "${notify.STATUS_LABELS[ticket.status]}" para "${notify.STATUS_LABELS[toStatus]}".`,
     toStatus]);
  if (triage) await claimModerator(ticket, user);

  const updated = await loadTicket(req.params.id);
  await notify.statusChanged(updated, user, toStatus);
  if (fechouPelaEquipe && ticket.requester_id) {
    const ate = new Date(Date.now() + DIAS_PARA_REABRIR * 86400000).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    await notify.createInApp(ticket.requester_id, `Chamado #${ticket.id} fechado`,
      `Se o problema não foi resolvido, você pode reabrir até ${ate}.`, ticket.id).catch(() => {});
  }
  if (resolution) {
    await notify.solutionToWhatsApp(updated, resolution.notes).catch((e) =>
      console.log('[tickets] aviso whatsapp da solucao falhou:', e.message));
  }
  res.json(decorate(updated, user));
});

// ---------------------------------------------------------------------
// Quem abriu encerra o próprio chamado, com motivo
//   resolvido -> fica "Resolvido" esperando o técnico avaliar (causa + checklist) e fechar
//   os outros -> fecha na hora, marcado como "fechado pelo usuário" (sem nota)
// ---------------------------------------------------------------------
router.post('/:id/encerrar-usuario', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  const user = req.user;
  if (String(ticket.requester_id) !== String(user.id) || !canCancel(user, ticket)) {
    return res.status(403).json({ error: 'Só quem abriu o chamado pode encerrá-lo por aqui.' });
  }
  if (![1, 2, 3, 4].includes(ticket.status)) return res.status(422).json({ error: 'Esse chamado já está encerrado.' });
  const motivo = String(req.body?.motivo || '');
  if (!MOTIVOS_USUARIO[motivo]) return res.status(422).json({ error: 'Escolha o motivo.' });
  const nota = String(req.body?.nota || '').trim().slice(0, 1000) || null;
  if (motivo === 'outro' && !nota) return res.status(422).json({ error: 'Explique o motivo.' });
  let ref = null;
  if (motivo === 'repetido') {
    const n = parseInt(String(req.body?.ref || '').replace('#', ''), 10);
    const outro = n && n !== Number(ticket.id) ? await loadTicket(n) : null;
    if (!outro || !canViewTicket(user, outro)) return res.status(422).json({ error: 'Informe o número do outro chamado (ex.: #12).' });
    ref = outro.id;
  }
  // técnico atendendo agora (pode estar a caminho): avisa antes
  const atendendo = (await query('SELECT name FROM users WHERE working_ticket_id = $1', [ticket.id])).rows[0];
  if (atendendo && !req.body?.confirmar) {
    return res.status(409).json({ error: `${atendendo.name} está atendendo este chamado agora (pode já estar a caminho).`, em_atendimento: true, tecnico: atendendo.name });
  }
  // "Já foi resolvido": quem abriu diz qual técnico resolveu (ele fica com o chamado para avaliar e fechar)
  let resolveu = null;
  if (motivo === 'resolvido') {
    const rid = String(req.body?.tecnico_id || '');
    resolveu = /^\d+$/.test(rid) ? (await query(
      `SELECT id, name FROM users WHERE id = $1 AND active AND role IN ('technician','admin','moderator')`, [rid])).rows[0] : null;
    if (!resolveu) return res.status(422).json({ error: 'Escolha o técnico que resolveu.', tecnico_obrigatorio: true });
  }
  // "Resolvi sozinho" dito por alguém da equipe (técnico, moderador ou admin mestre): ele mesmo vira o
  // técnico do chamado e fecha na hora, sem avaliação
  if (motivo === 'sozinho' && ['technician', 'moderator', 'admin'].includes(user.role)) {
    resolveu = { id: user.id, name: user.name };
    await query('UPDATE tickets SET resolved_by_id = $2 WHERE id = $1', [ticket.id, user.id]);
  }
  const novo = motivo === 'resolvido' ? 5 : 6;
  if (resolveu && String(resolveu.id) !== String(ticket.assigned_user_id || '')) {
    await query('UPDATE tickets SET assigned_user_id = $2, assigned_at = COALESCE(assigned_at, now()) WHERE id = $1', [ticket.id, resolveu.id]);
    await addHistory(ticket.id, user.id, 'technician', ticket.assigned_name || null, resolveu.name);
  }
  await query(
    `UPDATE tickets SET status = $2::smallint, closed_at = CASE WHEN $2::smallint = 6 THEN now() ELSE NULL END,
            resolved_at = COALESCE(resolved_at, now()),
            closed_by_requester = ($2::smallint = 6), awaiting_evaluation = ($2::smallint = 5),
            requester_close_reason = $3, requester_close_note = $4, requester_close_ref = $5, reopen_until = NULL,
            approval_status = CASE WHEN approval_status = 'pending' THEN 'none' ELSE approval_status END,
            pause_reason = NULL, pause_until = NULL, pause_prev_status = NULL, paused_at = NULL
     WHERE id = $1`, [ticket.id, novo, motivo, nota, ref]);
  await query(`INSERT INTO ticket_status_history (ticket_id, old_status, new_status, user_id) VALUES ($1, $2, $3, $4)`,
    [ticket.id, ticket.status, novo, user.id]);
  await addHistory(ticket.id, user.id, novo === 5 ? 'marked_resolved' : 'closed_by_requester', notify.STATUS_LABELS[ticket.status], MOTIVOS_USUARIO[motivo]);
  const rotuloNota = motivo === 'sozinho' ? 'Como resolveu' : 'Observação';
  const texto = novo === 5
    ? `${user.name} avisou que ${resolveu.name} resolveu o problema. Falta o técnico avaliar para fechar.${nota ? `\n\n${rotuloNota}: ${nota}` : ''}`
    : `${user.name} encerrou o chamado: ${MOTIVOS_USUARIO[motivo]}${ref ? ` (é o mesmo do #${ref})` : ''}.${nota ? `\n\n${rotuloNota}: ${nota}` : ''}`;
  await query(`INSERT INTO ticket_messages (ticket_id, user_id, kind, content, new_status) VALUES ($1, $2, 'comment', $3, $4)`,
    [ticket.id, user.id, texto, novo]);
  const updated = await loadTicket(ticket.id);
  await notify.statusChanged(updated, user, novo);
  // quem cuida do chamado: o técnico; sem técnico, a coordenação (admin e moderadores)
  // (equipe que resolveu sozinha: só avisa o técnico que estava antes, se tinha outro)
  const equipeSozinha = motivo === 'sozinho' && resolveu;
  const responsavel = equipeSozinha ? ticket.assigned_user_id : (resolveu ? resolveu.id : ticket.assigned_user_id);
  const quem = responsavel
    ? [responsavel]
    : equipeSozinha ? [] : (await query(`SELECT id FROM users WHERE active AND role IN ('admin','moderator')`)).rows.map((r) => r.id);
  for (const id of quem) {
    if (String(id) === String(user.id)) continue;
    await notify.createInApp(id, novo === 5 ? `#${ticket.id}: o usuário avisou que resolveu. Avalie para fechar` : `#${ticket.id} encerrado pelo usuário`,
      `${MOTIVOS_USUARIO[motivo]}${nota ? ` — ${nota}` : ''}`, ticket.id).catch(() => {});
  }
  res.json(decorate(updated, user));
});

// Sugestões para o checklist da nota (o que dá para saber pelo próprio chamado)
router.get('/:id/avaliacao-sugestoes', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  if (!canResolve(req.user, ticket)) return res.status(403).json({ error: 'Acesso negado.' });
  res.json({ criterios: avaliacao.CRITERIOS, sugestoes: await avaliacao.sugestoes(ticket) });
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
  const resolution = await readResolution(req.body, await perfilDaEmpresa(ticket.entity_id));
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
  await notify.approvalRequested(updated, user);
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
// Citações na conversa:  @[Nome](u12) = pessoa citada · #16 = outro chamado
//   GET /tickets/:id/mencionaveis -> quem pode ser citado (quem consegue abrir o chamado:
//   equipe da Orcim, solicitante, técnico e gestores da empresa)
// ---------------------------------------------------------------------
const RE_MENCAO = /@\[([^\]\n]{1,80})\]\(u(\d+)\)/g;
async function mencionaveis(ticket) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.role, u.client_level, l.name AS location_name
     FROM users u LEFT JOIN locations l ON l.id = u.location_id
     WHERE u.active AND (
       u.role IN ('admin', 'moderator', 'technician')
       OR u.id = $1 OR u.id = $2
       OR (u.role = 'client' AND u.client_level >= 2 AND (u.entity_id = $3
           OR u.id IN (SELECT user_id FROM user_entities WHERE entity_id = $3))))
     ORDER BY (u.id = $2) DESC, (u.id = $1) DESC, u.name`,
    [ticket.requester_id, ticket.assigned_user_id || 0, ticket.entity_id]);
  return rows;
}
router.get('/:id/mencionaveis', async (req, res) => {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  if (!canViewTicket(req.user, ticket)) return res.status(403).json({ error: 'Acesso negado.' });
  const lista = await mencionaveis(ticket);
  res.json(lista.filter((u) => String(u.id) !== String(req.user.id)).map((u) => ({
    id: u.id, name: u.name, location_name: u.location_name,
    papel: u.role === 'admin' ? 'Admin Mestre' : u.role === 'moderator' ? 'Moderador' : u.role === 'technician' ? 'Técnico'
      : Number(u.client_level) === 2 ? 'Gestor' : 'Solicitante',
  })));
});

// ---------------------------------------------------------------------
// Mensagens / notas no chamado
//   - equipe (admin, admin local, moderador, tecnico): kind 'internal' = nota interna
//   - cliente gestor: kind 'note' (instrucao/solicitacao)
//   - demais: kind 'comment'
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Pedido de material ligado ao inventário e ao Estoque de T.I.
//   cada item pedido tem: preço unitário, posto de destino e situação
//   pedido    -> nada no inventário ainda
//   comprado  -> cada unidade entra no inventário como "Comprado - aguardando chegar", com preço e posto
//   chegou    -> "Pronto para entregar"
//   entregue  -> "Em estoque" (Estoque de T.I. do posto) ou "Operando" (inventário do posto),
//                ou sai do inventário se for "só marcar entregue" (consumível)
//   cancelado -> sai do inventário (o que ainda não tinha sido entregue)
//   O solicitante é avisado a cada mudança (sem o preço).
// ---------------------------------------------------------------------
const SITUACAO_MATERIAL = { solicitado: 'Pedido', comprado: 'Comprado', chegou: 'Chegou', entregue: 'Entregue', cancelado: 'Cancelado' };
const ESTADO_DO_PEDIDO = { comprado: 'ORDERED', chegou: 'READY' };
const TIPOS_EQUIP = ['COMPUTER', 'NOTEBOOK', 'SERVER', 'PRINTER', 'MONITOR', 'UPS', 'NETWORK_DEVICE', 'MOBILE_DEVICE', 'PERIPHERAL', 'OTHER'];
const podeMexerPedido = (user, ticket) => canResolve(user, ticket) || (has(user, 'inventory.manage') && canViewTicket(user, ticket));

// Deixa os equipamentos do item iguais à situação do pedido (dentro de uma transação)
async function sincronizarEquipamentos(q, ticket, m, situacao, user) {
  const ids = (m.asset_ids || []).map(String);
  const vivos = ids.length ? (await q('SELECT id, status FROM assets WHERE id = ANY($1::bigint[])', [ids])).rows : [];
  const apagar = async (lista) => { if (lista.length) await q('DELETE FROM assets WHERE id = ANY($1::bigint[])', [lista.map((a) => a.id)]); };
  if (situacao === 'solicitado' || situacao === 'cancelado' || (situacao === 'entregue' && m.destino === 'nenhum')) {
    // não entra (ou sai) do inventário: só o que ainda não foi entregue
    await apagar(vivos.filter((a) => ['ORDERED', 'READY'].includes(a.status) || situacao === 'entregue'));
    return [];
  }
  const estado = situacao === 'entregue' ? (m.destino === 'estoque' ? 'STOCK' : 'OPERATING') : ESTADO_DO_PEDIDO[situacao];
  const qtd = Math.min(Math.max(Number(m.quantity) || 1, 1), 20);
  const local = m.location_id || ticket.location_id || null;
  const tipo = TIPOS_EQUIP.includes(m.asset_type) ? m.asset_type : 'PERIPHERAL';
  // periférico (mouse, teclado, cabo...): sem etiqueta, um registro só com a quantidade
  if (tipo === 'PERIPHERAL') {
    const n = Math.max(Number(m.quantity) || 1, 1);
    const extras = vivos.slice(1);
    await apagar(extras);
    let a = vivos[0];
    if (a) {
      await q(`UPDATE assets SET status = $2, price = $3, location_id = $4, type = $5, controle = 'quantidade', quantity = $6 WHERE id = $1`, [a.id, estado, m.price, local, tipo, n]);
      if (a.status !== estado) {
        await q(`INSERT INTO asset_history (asset_id, user_id, action, field, old_value, new_value) VALUES ($1,$2,'AssetUpdated','status',$3,$4)`, [a.id, user.id, a.status, estado]);
      }
    } else {
      const { rows } = await q(
        `INSERT INTO assets (entity_id, name, type, status, location_id, price, notes, created_by, controle, quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'quantidade', $9) RETURNING id, status`,
        [ticket.entity_id, String(m.name).toUpperCase(), tipo, estado, local, m.price, `Pedido #${ticket.id}`, user.id, n]);
      a = rows[0];
      await q(`INSERT INTO asset_history (asset_id, user_id, action, field, new_value) VALUES ($1,$2,'AssetCreated','name',$3)`, [a.id, user.id, `pedido #${ticket.id} (${n} un)`]);
    }
    if (estado === 'STOCK') {
      // chegou no estoque: soma com o mesmo item que já está no estoque do posto (contado junto)
      const igual = (await q(
        `SELECT id FROM assets WHERE entity_id = $1 AND location_id IS NOT DISTINCT FROM $2 AND controle = 'quantidade' AND status = 'STOCK'
           AND upper(name) = upper($3) AND id <> $4 ORDER BY id LIMIT 1`, [ticket.entity_id, local, m.name, a.id])).rows[0];
      const alvo = igual ? igual.id : a.id;
      if (igual) {
        // custo médio: (qtd antiga × preço antigo + qtd nova × preço novo) / total
        await q(`UPDATE assets SET price = CASE WHEN $3::numeric IS NULL THEN price WHEN price IS NULL OR quantity = 0 THEN $3::numeric
                   ELSE round((price * quantity + $3::numeric * $2) / (quantity + $2), 2) END,
                   quantity = quantity + $2 WHERE id = $1`, [igual.id, n, m.price]);
        await q(`INSERT INTO asset_history (asset_id, user_id, action, field, new_value) VALUES ($1,$2,'AssetUpdated','quantity',$3)`, [igual.id, user.id, `+${n} (pedido #${ticket.id})`]);
        await q('DELETE FROM assets WHERE id = $1', [a.id]);
      }
      await q(`INSERT INTO stock_movements (asset_id, kind, user_id, to_entity_id, to_location_id, price, note, quantity) VALUES ($1,'entry',$2,$3,$4,$5,$6,$7)`,
        [alvo, user.id, ticket.entity_id, local, m.price === null || m.price === undefined ? null : Number(m.price) * n, `Entregue pelo pedido #${ticket.id}`, n]);
      return igual ? [] : [String(a.id)];
    }
    return [String(a.id)];
  }
  const atuais = vivos.map((a) => String(a.id));
  for (const a of vivos) {
    await q(`UPDATE assets SET status = $2, price = $3, location_id = $4, type = $5 WHERE id = $1`, [a.id, estado, m.price, local, tipo]);
    if (a.status !== estado) {
      await q(`INSERT INTO asset_history (asset_id, user_id, action, field, old_value, new_value) VALUES ($1,$2,'AssetUpdated','status',$3,$4)`,
        [a.id, user.id, a.status, estado]);
      if (estado === 'STOCK') {
        await q(`INSERT INTO stock_movements (asset_id, kind, user_id, to_entity_id, to_location_id, price, note) VALUES ($1,'entry',$2,$3,$4,$5,$6)`,
          [a.id, user.id, ticket.entity_id, local, m.price, `Entregue pelo pedido #${ticket.id}`]);
      }
    }
  }
  for (let i = atuais.length; i < qtd; i += 1) {
    const { rows } = await q(
      `INSERT INTO assets (entity_id, name, type, status, location_id, price, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [ticket.entity_id, String(m.name).toUpperCase(), tipo, estado, local, m.price, `Pedido #${ticket.id}`, user.id]);
    atuais.push(String(rows[0].id));
    await q(`INSERT INTO asset_history (asset_id, user_id, action, field, new_value) VALUES ($1,$2,'AssetCreated','name',$3)`,
      [rows[0].id, user.id, `pedido #${ticket.id}`]);
    if (estado === 'STOCK') {
      await q(`INSERT INTO stock_movements (asset_id, kind, user_id, to_entity_id, to_location_id, price, note) VALUES ($1,'entry',$2,$3,$4,$5,$6)`,
        [rows[0].id, user.id, ticket.entity_id, local, m.price, `Entregue pelo pedido #${ticket.id}`]);
    }
  }
  return atuais;
}

// Muda o item: { status?, price?, location_id?, destino?, asset_type? } — o que vier é gravado e o inventário acompanha
async function atualizarItemPedido(req, res, forcar = {}) {
  const ticket = await loadTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  const user = req.user;
  if (!podeMexerPedido(user, ticket)) return res.status(403).json({ error: 'Seu perfil não pode mudar os pedidos de material.' });
  const b = { ...(req.body || {}), ...forcar };
  const { rows } = await query('SELECT * FROM ticket_materials WHERE id = $1 AND ticket_id = $2', [req.params.mid, ticket.id]);
  if (!rows.length) return res.status(404).json({ error: 'Material não encontrado.' });
  const atual = rows[0];
  const novo = { ...atual };
  if (b.status !== undefined) {
    if (!SITUACAO_MATERIAL[b.status]) return res.status(422).json({ error: 'Situação inválida.' });
    novo.status = b.status;
  }
  if (b.price !== undefined) {
    if (!has(user, 'inventory.secrets')) return res.status(403).json({ error: 'Seu perfil não pode informar preço.' });
    const p = b.price === null || b.price === '' ? null : Number(String(b.price).replace(',', '.'));
    if (p !== null && (!Number.isFinite(p) || p < 0 || p >= 1e10)) return res.status(422).json({ error: 'Preço inválido.' });
    novo.price = p;
  }
  if (b.location_id !== undefined) {
    if (b.location_id) {
      const ok = await query('SELECT id FROM locations WHERE id = $1 AND entity_id = $2', [b.location_id, ticket.entity_id]);
      if (!ok.rows.length) return res.status(422).json({ error: 'Esse posto não é da empresa do chamado.' });
      novo.location_id = ok.rows[0].id;
    } else novo.location_id = null;
  }
  if (b.destino !== undefined) {
    if (!['estoque', 'inventario', 'nenhum'].includes(b.destino)) return res.status(422).json({ error: 'Destino inválido.' });
    novo.destino = b.destino;
  }
  if (b.asset_type !== undefined && TIPOS_EQUIP.includes(b.asset_type)) novo.asset_type = b.asset_type;
  if (novo.status === 'entregue' && !novo.destino) novo.destino = 'inventario';
  const mexeInventario = ['comprado', 'chegou'].includes(novo.status) || (novo.status === 'entregue' && novo.destino !== 'nenhum');
  if (mexeInventario && !has(user, 'inventory.manage')) {
    return res.status(403).json({ error: 'Seu perfil não cadastra itens no inventário. Peça a quem cuida do inventário.' });
  }
  const mudouSituacao = novo.status !== atual.status;
  let ids = atual.asset_ids || [];
  await withTransaction(async (q) => {
    // o inventário acompanha (também quando só o preço, o posto ou o destino mudam)
    // periférico entregue no estoque já foi somado ao que tinha lá (sem registro próprio): não cria de novo
    const jaSomado = !mudouSituacao && atual.status === 'entregue' && !ids.length && atual.destino === novo.destino;
    if (!jaSomado && (mudouSituacao || ids.length || mexeInventario)) ids = await sincronizarEquipamentos(q, ticket, novo, novo.status, user);
    await q(`UPDATE ticket_materials SET status = $2, price = $3, location_id = $4, destino = $5, asset_type = $6, asset_ids = $7::bigint[],
                    asset_id = $8, status_at = CASE WHEN $9 THEN now() ELSE status_at END,
                    status_by = CASE WHEN $9 THEN $10 ELSE status_by END WHERE id = $1`,
      [atual.id, novo.status, novo.price, novo.location_id, novo.destino || null, novo.asset_type || null, ids, ids[0] || null, mudouSituacao, user.id]);
  });
  if (mudouSituacao) {
    const posto = novo.location_id ? (await query('SELECT name FROM locations WHERE id = $1', [novo.location_id])).rows[0]?.name : ticket.location_name;
    const onde = novo.status === 'entregue' && novo.destino === 'estoque' ? ' (Estoque de T.I.)' : '';
    const texto = `${atual.quantity} ${atual.unit || 'un'} · ${atual.name}: ${SITUACAO_MATERIAL[novo.status]}${posto && novo.status !== 'cancelado' ? ` · vai para ${posto}${onde}` : ''}`;
    await query(`INSERT INTO ticket_messages (ticket_id, user_id, kind, content) VALUES ($1, $2, 'system', $3)`, [ticket.id, user.id, `Pedido de material — ${texto}`]);
    if (ticket.requester_id && String(ticket.requester_id) !== String(user.id)) {
      await notify.createInApp(ticket.requester_id, `Seu pedido #${ticket.id}: ${SITUACAO_MATERIAL[novo.status].toLowerCase()}`, texto, ticket.id).catch(() => {});
    }
  }
  res.json({ ok: true, asset_ids: ids, asset_id: ids[0] || null });
}

// Situação (e o que mais vier junto: preço, posto, destino)
router.post('/:id/materials/:mid/status', (req, res) => atualizarItemPedido(req, res));
// Só preço, posto, destino ou categoria do equipamento (sem mudar a situação)
router.patch('/:id/materials/:mid', (req, res) => { const { status, ...resto } = req.body || {}; req.body = resto; return atualizarItemPedido(req, res); });
// Entregar (usado no "O que levar" das rotas): { destino }
router.post('/:id/materials/:mid/entregar', (req, res) => {
  if (!['estoque', 'inventario', 'nenhum'].includes(String(req.body?.destino || ''))) return res.status(422).json({ error: 'Escolha para onde vai o item.' });
  return atualizarItemPedido(req, res, { status: 'entregue' });
});

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

  // Citações (@): só quem pode abrir o chamado; nota interna, só quem lê notas internas
  const citadosIds = [...new Set([...content.matchAll(RE_MENCAO)].map((m) => m[2]))].filter((id) => String(id) !== String(user.id));
  let citados = [];
  if (citadosIds.length) {
    const validos = await mencionaveis(ticket);
    citados = validos.filter((u) => citadosIds.includes(String(u.id))
      && (kind !== 'internal' || ['admin', 'moderator', 'technician'].includes(u.role)));
    const textoLimpo = content.replace(RE_MENCAO, '@$1');
    for (const u of citados) {
      await notify.createInApp(u.id, `${user.name} citou você no chamado ${s.number}`,
        textoLimpo.length > 240 ? `${textoLimpo.slice(0, 239)}…` : textoLimpo, ticket.id).catch(() => {});
    }
    // quem foi citado já recebeu o aviso de citação: não recebe o de "nova mensagem" também
    const jaAvisados = new Set(citados.map((u) => String(u.id)));
    participants = participants.filter((p) => !jaAvisados.has(String(p.id)));
  }
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
    message: () => `${user.name} escreveu: ${content.replace(RE_MENCAO, '@$1')}`,
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
router.post('/:id/attachments', async (req, res, next) => {
  // Confere o chamado e o acesso ANTES de gravar qualquer arquivo no disco
  if (!/^\d+$/.test(String(req.params.id))) return res.status(404).json({ error: 'Chamado não encontrado.' });
  let ticket;
  try {
    ticket = await loadTicket(req.params.id);
  } catch (e) { return next(e); }
  if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
  if (!canViewTicket(req.user, ticket)) return res.status(403).json({ error: 'Acesso negado.' });

  attUpload.array('files', 10)(req, res, async (err) => {
    if (err) {
      regrasArquivo.apagarGravados(req.files);
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo grande demais (máximo 15 MB).' : err.message;
      return res.status(422).json({ error: msg });
    }
    try {
      if (!req.files?.length) return res.status(422).json({ error: 'Envie ao menos um arquivo.' });
      const ruim = regrasArquivo.conferirGravados(req.files);
      if (ruim) return res.status(422).json({ error: ruim });
      const inserted = [];
      for (const f of req.files) {
        const storagePath = path.join('uploads', 'tickets', String(ticket.id), f.filename).replace(/\\/g, '/');
        const { rows } = await query(
          `INSERT INTO ticket_attachments (ticket_id, file_name, storage_path, mime_type, file_size, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [ticket.id, f.originalname, storagePath, regrasArquivo.tipoCanonico(f.originalname), f.size, req.user.id]);
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
      regrasArquivo.apagarGravados(req.files);
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
    const inline = req.query.inline === '1' && /^image\/(png|jpeg|webp|gif)$/.test(rows[0].mime_type || '');
    // arquivo antigo de tipo nao permitido: so baixa, nunca abre no navegador
    const tipoSeguro = /^(image\/(png|jpeg|webp|gif|heic|heif)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet))$/.test(rows[0].mime_type || '');
    res.type(tipoSeguro ? rows[0].mime_type : 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
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
