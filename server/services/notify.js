const { query } = require('../db');
const settingsStore = require('./settingsStore');
const mailer = require('./mailer');
const config = require('../config');
const whatsapp = require('./whatsapp');
const realtime = require('./realtime');
const { isPreview } = require('../db');

const STATUS_LABELS = {
  1: 'Novo', 2: 'Atribuído', 3: 'Em andamento', 4: 'Pendente',
  5: 'Resolvido', 6: 'Fechado', 7: 'Cancelado',
};
const PRIORITY_LABELS = { 1: 'Baixa', 2: 'Média', 3: 'Alta', 4: 'Urgente' };
const APPROVAL_LABELS = { none: '—', pending: 'Pendente', approved: 'Aprovado', rejected: 'Reprovado' };

// Templates padrão em pt-BR — o administrador pode sobrescrever em Configurações → Notificações
const DEFAULT_TEMPLATES = {
  'ticket.created': {
    title: 'Novo chamado recebido',
    subject: '[Novo] {{number}} - {{title}}',
    message: 'Um novo chamado foi aberto por {{requester_name}} ({{entity_name}}).\nNúmero: {{number}}\nTítulo: {{title}}\nPrioridade: {{priority_label}}\nStatus: {{status_label}}',
  },
  'ticket.created.confirmation': {
    title: 'Chamado aberto com sucesso',
    subject: 'Chamado {{number}} aberto',
    message: 'Seu chamado foi registrado. Número: {{number}}\nTítulo: {{title}}\nAcompanhe as atualizações pelo sistema ou por e-mail/WhatsApp.',
  },
  'status.changed': {
    title: 'Status do chamado {{number}} alterado para {{status_label}}',
    subject: '[{{status_label}}] {{number}} - {{title}}',
    message: 'O chamado {{number}} - "{{title}}" teve o status alterado para {{status_label}}.',
  },
  // por status (sobrepõe o genérico acima quando existir)
  'status.changed.1': { title: 'Chamado {{number}} — Novo', subject: '[Novo] {{number}} - {{title}}', message: 'O chamado {{number}} foi reaberto como *Novo*. Título: "{{title}}"\nAguardando atribuição.' },
  'status.changed.2': { title: 'Chamado {{number}} — Atribuído', subject: '[Atribuído] {{number}} - {{title}}', message: 'O chamado {{number}} - "{{title}}" foi atribuído ao técnico {{assigned_name}}.\nEm breve o atendimento será iniciado.' },
  'status.changed.3': { title: 'Chamado {{number}} — Em andamento', subject: '[Em andamento] {{number}} - {{title}}', message: 'Boa notícia! O chamado {{number}} - "{{title}}" está *em andamento*.\nTécnico responsável: {{assigned_name}}\nAcompanhe as atualizações por aqui.' },
  'status.changed.4': { title: 'Chamado {{number}} — Pendente', subject: '[Pendente] {{number}} - {{title}}', message: 'O chamado {{number}} - "{{title}}" está *pendente*.\nMotivo: aguardando informações ou ação externa. Retornaremos em breve.' },
  'status.changed.5': { title: 'Chamado {{number}} — Resolvido', subject: '[Resolvido] {{number}} - {{title}}', message: 'O chamado {{number}} - "{{title}}" foi *resolvido*.\n{{approval_comment}}\nAcesse o sistema para avaliar a solução.' },
  'status.changed.6': { title: 'Chamado {{number}} — Fechado', subject: '[Fechado] {{number}} - {{title}}', message: 'O chamado {{number}} - "{{title}}" foi *fechado*. Obrigado pelo contato!' },
  'status.changed.7': { title: 'Chamado {{number}} — Cancelado', subject: '[Cancelado] {{number}} - {{title}}', message: 'O chamado {{number}} - "{{title}}" foi *cancelado*.' },
  'ticket.assigned': {
    title: 'Chamado {{number}} atribuído',
    subject: '[Atribuído] {{number}} - {{title}}',
    message: 'O chamado {{number}} - "{{title}}" foi atribuído ao técnico {{assigned_name}}.',
  },
  'comment.added': {
    title: 'Nova mensagem em {{number}}',
    subject: '[Mensagem] {{number}} - {{title}}',
    message: '"{{body}}" \n\n-- {{author_name}} ({{number}})',
  },
  'approval.requested': {
    title: 'Aprovação solicitada - {{number}}',
    subject: '[Aprovação] {{number}} - {{title}}',
    message: 'O chamado {{number}} - "{{title}}" aguarda sua aprovação da solução proposta.\n{{approval_comment}}\nAcesse o sistema para aprovar ou reprovar.',
  },
  'approval.responded.approved': {
    title: 'Solução APROVADA - {{number}}',
    subject: '[Aprovado] {{number}} - {{title}}',
    message: '{{responder_name}} aprovou a solução do chamado {{number}} - "{{title}}".{{approval_comment}}',
  },
  'approval.responded.rejected': {
    title: 'Solução REPROVADA - {{number}}',
    subject: '[Reprovado] {{number}} - {{title}}',
    message: '{{responder_name}} reprovou a solução do chamado {{number}} - "{{title}}".{{approval_comment}}',
  },
};

function renderTemplate(str, vars) {
  if (!str) return '';
  return String(str).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v != null ? String(v) : '';
  });
}

async function loadTemplates() {
  try {
    const all = await settingsStore.getAll();
    const custom = all['notify.templates'];
    if (custom && typeof custom === 'object') return { ...DEFAULT_TEMPLATES, ...custom };
  } catch {}
  return DEFAULT_TEMPLATES;
}

function buildVars(s, extra = {}) {
  return {
    number: s.number || '',
    title: s.title || '',
    status: s.status || '',
    status_label: s.status_label || STATUS_LABELS[s.status] || '',
    priority: s.priority || '',
    priority_label: s.priority_label || PRIORITY_LABELS[s.priority] || '',
    assigned_name: s.assigned_name || '',
    requester_name: s.requester_name || '',
    entity_name: s.entity_name || '',
    approval_comment: s.approval_comment ? `\n${s.approval_comment}` : '',
    ...extra,
  };
}

async function summary(ticket) {
  return {
    id: ticket.id,
    number: `#${ticket.id}`,
    title: ticket.title,
    status: ticket.status,
    status_label: STATUS_LABELS[ticket.status],
    priority: ticket.priority,
    priority_label: PRIORITY_LABELS[ticket.priority],
    assigned_user_id: ticket.assigned_user_id,
    assigned_name: ticket.assigned_name || null,
    requester_id: ticket.requester_id,
    requester_name: ticket.requester_name || null,
    entity_id: ticket.entity_id,
    entity_name: ticket.entity_name || null,
    updated_at: ticket.updated_at,
    created_at: ticket.created_at,
  };
}

async function createInApp(userId, title, message, ticketId = null) {
  const { rows } = await query(
    `INSERT INTO inapp_notifications (user_id, ticket_id, title, message)
     VALUES ($1, $2, $3, $4) RETURNING *`, [userId, ticketId, title, message]);
  realtime.emitToUsers([userId], 'notification:new', rows[0]);
  return rows[0];
}

async function logNotification({ ticketId, channel, event, recipient, subject, status, error }) {
  await query(
    `INSERT INTO notification_log (ticket_id, channel, event, recipient, subject, status, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [ticketId || null, channel, event, recipient, subject || null, status || 'sent', error || null]);
}

// Busca os envolvidos no chamado (requisitante, gestores da entidade,
// tecnico atribuido e administradores)
async function getParticipants(ticketId, entityId, excludeUserId = null) {
  const { rows } = await query(
    `SELECT DISTINCT u.id, u.name, u.email, u.phone, u.role, u.client_level
     FROM users u
     WHERE u.active = TRUE AND (
       u.id IN (SELECT requester_id FROM tickets WHERE id = $1)
       OR u.id IN (SELECT assigned_user_id FROM tickets WHERE id = $1)
       OR u.id IN (SELECT assigned_moderator_id FROM tickets WHERE id = $1)
       OR (u.entity_id = $2 AND u.role = 'client' AND u.client_level >= 2)
       OR (u.role = 'client' AND u.client_level >= 2
           AND u.id IN (SELECT user_id FROM user_entities WHERE entity_id = $2))
       OR (u.entity_id = $2 AND u.role = 'admin_local')
       OR u.role = 'admin'
     )`,
    [ticketId, entityId]);
  const fora = String(excludeUserId ?? '');
  return rows.filter((r) => !fora || String(r.id) !== fora);
}

async function getAdminsAndTechs() {
  const { rows } = await query(
    `SELECT id, name, email, phone FROM users
     WHERE active = TRUE AND role IN ('admin','moderator','technician')`);
  return rows;
}

// Central de envio: email + whatsapp + in-app + socket
async function deliver({ ticket, event, recipients, title, subject, message, ticketMsg }) {
  const settings = await settingsStore.getAll();
  const emailOn = settings['app.notify_email'];
  const waOn = settings['app.notify_whatsapp'];
  const techNewOn = settings['app.notify_techs_new'] !== false;
  const clientNotify = settings['app.notify_clients'] !== false;

  const s = ticketMsg || await summary(ticket);
  const openUrl = `${require('../config').publicUrl}/#/tickets/${ticket.id}`;

  for (const r of recipients) {
    const shouldNotify =
      (r.role === 'admin') ||
      ((r.role === 'technician' || r.role === 'moderator') && techNewOn) ||
      ((r.role === 'client' || r.role === 'admin_local') && clientNotify);

    if (!shouldNotify) continue;

    const msgText = typeof message === 'function' ? message(ticket, r, s) : String(message || '');
    const ttl = typeof title === 'function' ? title(ticket, r) : String(title || '');
    const subj = typeof subject === 'function' ? subject(ticket, r) : String(subject || ttl);

    await createInApp(r.id, ttl, msgText, ticket.id).catch(() => {});

    if (emailOn && !isPreview() && r.email) {
      const html = `<div style="font-family:Arial,sans-serif;line-height:1.6">
        <h3>${ttl}</h3>
        <p>${msgText.replace(/\n/g, '<br>')}</p>
        <p>Chamado <b>${s.number}</b> — ${escHtml(s.title)}</p>
        <p><a href="${openUrl}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Abrir chamado</a></p>
        <hr><small>Central de Atendimento</small></div>`;
      try {
        await mailer.sendMail({ to: r.email, subject: subj, html });
        await logNotification({ ticketId: ticket.id, channel: 'email', event, recipient: r.email, subject: subj, status: 'sent' });
      } catch (err) {
        await logNotification({ ticketId: ticket.id, channel: 'email', event, recipient: r.email, subject: subj, status: 'error', error: err.message });
      }
    }

    if (waOn && !isPreview() && r.phone) {
      try {
        await whatsapp.sendTextMessage(r.phone, `${ttl}\n${msgText}`);
        await logNotification({ ticketId: ticket.id, channel: 'whatsapp', event, recipient: r.phone, status: 'sent' });
      } catch (err) {
        await logNotification({ ticketId: ticket.id, channel: 'whatsapp', event, recipient: r.phone, status: 'error', error: err.message });
      }
    }
  }
}

// Chamados abertos pelo WhatsApp recebem a solucao de volta no mesmo numero.
// Best effort: se o WhatsApp estiver offline, registra o erro e nao derruba a
// mudanca de status. Nao depende do aviso generico de "status alterado".
async function solutionToWhatsApp(ticket, solution) {
  if (!ticket || !ticket.via_whatsapp || !solution || isPreview()) return;
  let phone = null;
  try {
    const found = await query(
      `SELECT wc.phone
         FROM whatsapp_contacts wc
        WHERE wc.user_id = $1
          AND wc.phone ~ '^[0-9]+$'
        ORDER BY wc.last_seen_at DESC NULLS LAST
        LIMIT 1`, [ticket.requester_id]);
    phone = found.rows.length ? found.rows[0].phone : null;
  } catch (e) {
    console.log('[notify] solucao whatsapp: falha ao buscar contato:', e.message);
  }
  if (!phone) return;

  const texto = `Seu chamado ${ticket.number} foi resolvido!\n\n` +
    `Assunto: ${ticket.title}\n\n` +
    `Solução:\n${String(solution).slice(0, 3000)}\n\n` +
    (config.publicUrl ? `Acesse o sistema para avaliar: ${config.publicUrl}` : 'Obrigado pelo contato!');

  try {
    await whatsapp.sendTextMessage(phone, texto);
    await logNotification({
      ticketId: ticket.id, channel: 'whatsapp', event: 'resolution.whatsapp',
      recipient: phone, status: 'sent',
    });
  } catch (err) {
    await logNotification({
      ticketId: ticket.id, channel: 'whatsapp', event: 'resolution.whatsapp',
      recipient: phone, status: 'error', error: err.message,
    }).catch(() => {});
    console.log('[notify] solucao whatsapp nao enviada:', err.message);
  }
}

function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Helper para resolver template com fallback para DEFAULT
async function resolveTemplate(eventKey, vars, statusOverride) {
  const all = await loadTemplates();
  // tenta chave específica de status primeiro
  if (statusOverride && all[`${eventKey}.${statusOverride}`]) {
    const t = all[`${eventKey}.${statusOverride}`];
    return { title: renderTemplate(t.title, vars), subject: renderTemplate(t.subject, vars), message: renderTemplate(t.message, vars) };
  }
  const t = all[eventKey] || DEFAULT_TEMPLATES[eventKey] || { title: eventKey, subject: eventKey, message: '' };
  return { title: renderTemplate(t.title, vars), subject: renderTemplate(t.subject, vars), message: renderTemplate(t.message, vars) };
}

// ------------- Eventos (usando templates personalizáveis) -------------

async function ticketCreated(ticket, socketTicket) {
  const s = socketTicket || await summary(ticket);
  const templates = await loadTemplates();
  const support = (await getAdminsAndTechs()).filter((u) => String(u.id) !== String(ticket.requester_id));
  const vars = buildVars(s);
  const t = templates['ticket.created'] || DEFAULT_TEMPLATES['ticket.created'];
  await deliver({
    ticket, event: 'ticket.created', recipients: support,
    title: () => renderTemplate(t.title, vars),
    subject: () => renderTemplate(t.subject, vars),
    message: () => renderTemplate(t.message, vars),
    ticketMsg: s,
  });
  const owner = await query('SELECT * FROM users WHERE id = $1', [ticket.requester_id]);
  if (owner.rows.length) {
    const vars2 = buildVars(s);
    const tc = templates['ticket.created.confirmation'] || DEFAULT_TEMPLATES['ticket.created.confirmation'];
    await deliver({
      ticket, event: 'ticket.created.confirmation', recipients: owner.rows,
      title: () => renderTemplate(tc.title, vars2),
      subject: () => renderTemplate(tc.subject, vars2),
      message: () => renderTemplate(tc.message, vars2),
      ticketMsg: s,
    });
  }
  realtime.emitBroadcastRoles(['admin', 'moderator', 'technician'], 'ticket:new', s);
  realtime.emitToUsers([ticket.requester_id], 'ticket:new', s);
  if (ticket.entity_id) realtime.emitToEntities([ticket.entity_id], 'ticket:new', s);
}

async function statusChanged(ticket, actor, newStatus) {
  const s = await summary(ticket);
  const recipients = await getParticipants(ticket.id, ticket.entity_id, actor.id);
  const vars = buildVars({ ...s, status: newStatus, status_label: STATUS_LABELS[newStatus] });
  const { title, subject, message } = await resolveTemplate('status.changed', vars, newStatus);
  await deliver({ ticket, event: 'status.changed', recipients, title: () => title, subject: () => subject, message: () => message, ticketMsg: s });
  realtime.emitBroadcastRoles(['admin', 'moderator', 'technician'], 'ticket:update', s);
  realtime.emitToUsers([ticket.requester_id], 'ticket:update', s);
  if (ticket.assigned_user_id) realtime.emitToUsers([ticket.assigned_user_id], 'ticket:update', s);
  if (ticket.entity_id) realtime.emitToEntities([ticket.entity_id], 'ticket:update', s);
}

async function ticketAssigned(ticket, actor = null) {
  const s = await summary(ticket);
  const recipients = await getParticipants(ticket.id, ticket.entity_id, actor && actor.id);
  const vars = buildVars(s);
  const t = (await loadTemplates())['ticket.assigned'] || DEFAULT_TEMPLATES['ticket.assigned'];
  await deliver({ ticket, event: 'ticket.assigned', recipients, title: () => renderTemplate(t.title, vars), subject: () => renderTemplate(t.subject, vars), message: () => renderTemplate(t.message, vars), ticketMsg: s });
  realtime.emitBroadcastRoles(['admin', 'moderator', 'technician'], 'ticket:update', s);
  realtime.emitToUsers([ticket.requester_id], 'ticket:update', s);
  if (ticket.assigned_user_id) realtime.emitToUsers([ticket.assigned_user_id], 'ticket:update', s);
  if (ticket.entity_id) realtime.emitToEntities([ticket.entity_id], 'ticket:update', s);
}

async function commentAdded(ticket, message) {
  const s = await summary(ticket);
  const author = message.user;
  const body = message.content;
  const recipients = await getParticipants(ticket.id, ticket.entity_id, author.id);
  const vars = buildVars(s, { body, body_short: body.slice(0,200) + (body.length>200?'...':''), author_name: author.name });
  const t = (await loadTemplates())['comment.added'] || DEFAULT_TEMPLATES['comment.added'];
  await deliver({ ticket, event: 'comment.added', recipients, title: () => renderTemplate(t.title, vars), subject: () => renderTemplate(t.subject, vars), message: () => renderTemplate(t.message, vars), ticketMsg: s });
  realtime.emitBroadcastRoles(['admin', 'moderator', 'technician'], 'ticket:update', s);
  realtime.emitToUsers([ticket.requester_id], 'ticket:update', s);
  if (ticket.assigned_user_id) realtime.emitToUsers([ticket.assigned_user_id], 'ticket:update', s);
  if (ticket.entity_id) realtime.emitToEntities([ticket.entity_id], 'ticket:update', s);
}

async function approvalRequested(ticket, actor = null) {
  const s = await summary(ticket);
  const recipients = await getParticipants(ticket.id, ticket.entity_id, actor && actor.id);
  const vars = buildVars(s);
  const t = (await loadTemplates())['approval.requested'] || DEFAULT_TEMPLATES['approval.requested'];
  await deliver({ ticket, event: 'approval.requested', recipients: recipients.filter((r) => r.role === 'client' || r.role === 'admin'), title: () => renderTemplate(t.title, vars), subject: () => renderTemplate(t.subject, vars), message: () => renderTemplate(t.message, vars), ticketMsg: s });
  realtime.emitBroadcastRoles(['admin', 'moderator', 'technician'], 'ticket:update', s);
  realtime.emitToUsers([ticket.requester_id], 'ticket:update', s);
  if (ticket.entity_id) realtime.emitToEntities([ticket.entity_id], 'ticket:update', s);
}

async function approvalResponded(ticket, decision, responderName) {
  const s = await summary(ticket);
  const recipients = await getParticipants(ticket.id, ticket.entity_id, ticket.approval_responded_by_id);
  const key = decision === 'approved' ? 'approval.responded.approved' : 'approval.responded.rejected';
  const vars = buildVars(s, { responder_name: responderName, decision });
  const t = (await loadTemplates())[key] || DEFAULT_TEMPLATES[key];
  await deliver({ ticket, event: 'approval.responded', recipients, title: () => renderTemplate(t.title, vars), subject: () => renderTemplate(t.subject, vars), message: () => renderTemplate(t.message, vars), ticketMsg: s });
  realtime.emitBroadcastRoles(['admin', 'moderator', 'technician'], 'ticket:update', s);
  realtime.emitToUsers([ticket.requester_id], 'ticket:update', s);
  if (ticket.assigned_user_id) realtime.emitToUsers([ticket.assigned_user_id], 'ticket:update', s);
  if (ticket.entity_id) realtime.emitToEntities([ticket.entity_id], 'ticket:update', s);
}


// Previsao de atendimento definida/alterada
async function estimateChanged(ticket, actor) {
  const s = await summary(ticket);
  const recipients = await getParticipants(ticket.id, ticket.entity_id, actor.id);
  const when = ticket.estimated_at
    ? new Date(ticket.estimated_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : 'sem previsão';
  await deliver({
    ticket, event: 'estimate.changed', recipients,
    title: () => `Previsão de atendimento em ${s.number}`,
    subject: () => `[Previsão] ${s.number}`,
    message: () => `${actor.name} definiu a previsão de atendimento: ${when}.`,
    ticketMsg: s,
  });
}

// Observador adicionado ao chamado
async function watcherAdded(ticket, watcher, actor) {
  const s = await summary(ticket);
  const { rows } = await query('SELECT id, name, email, phone, role FROM users WHERE id = $1', [watcher.id]);
  if (!rows.length) return;
  await deliver({
    ticket, event: 'watcher.added', recipients: rows,
    title: () => `Você está acompanhando ${s.number}`,
    subject: () => `[Observador] ${s.number}`,
    message: () => `${actor.name} adicionou você como observador(a) do chamado "${s.title}".`,
    ticketMsg: s,
  });
}

module.exports = {
  estimateChanged,
  watcherAdded,
  STATUS_LABELS,
  PRIORITY_LABELS,
  APPROVAL_LABELS,
  DEFAULT_TEMPLATES,
  renderTemplate,
  loadTemplates,
  buildVars,
  summary,
  getParticipants,
  getAdminsAndTechs,
  createInApp,
  solutionToWhatsApp,
  ticketCreated,
  statusChanged,
  ticketAssigned,
  commentAdded,
  approvalRequested,
  approvalResponded,
  deliver,
};