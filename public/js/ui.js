// Utilidades de data
const fmt = {
  date(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  },
  dateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  },
  timeAgo(iso) {
    if (!iso) return '—';
    const d = new Date(iso).getTime();
    const s = Math.floor((Date.now() - d) / 1000);
    if (s < 60) return 'agora';
    if (s < 3600) return `há ${Math.floor(s / 60)} min`;
    if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
    if (s < 172800) return 'há 1 dia';
    return `há ${Math.floor(s / 86400)} dias`;
  },
  bytes(n) {
    if (n === null || n === undefined) return '—';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0, v = Number(n) || 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
  },
};

const LABELS = {
  status: { 1: 'Novo', 2: 'Atribuído', 3: 'Em andamento', 4: 'Pendente', 5: 'Resolvido', 6: 'Fechado', 7: 'Cancelado' },
  priority: { 1: 'Baixa', 2: 'Média', 3: 'Alta', 4: 'Urgente' },
  role: {
    admin: 'Administrador Mestre', admin_local: 'Administrador Local', moderator: 'Moderador',
    technician: 'Técnico', client: 'Cliente',
  },
  clientLevel: { 1: 'Usuário', 2: 'Gestor' },
  history: {
    created: 'Chamado criado', status: 'Status alterado', reopened: 'Chamado reaberto',
    technician: 'Técnico', moderator: 'Moderador', category: 'Categoria', impact: 'Urgência',
    priority: 'Prioridade', location: 'Localização', needed_by: 'Data de necessidade',
    estimated_at: 'Previsão de atendimento', due_at: 'Prazo (SLA)', asset: 'Equipamento',
    title: 'Título', description: 'Descrição alterada', watcher_added: 'Observador adicionado',
    watcher_removed: 'Observador removido', solution: 'Solução registrada',
    approved: 'Solução aprovada', rejected: 'Solução reprovada', resolution: 'Encerramento',
  },
  equipmentAction: {
    repaired: 'Reparado / consertado no local',
    adjusted: 'Configurado / ajustado (sem troca de peça)',
    part_replaced: 'Peça trocada',
    replaced: 'Equipamento substituído por outro',
    sent_external: 'Enviado para manutenção externa',
    no_change: 'Nenhuma alteração no equipamento',
    discarded: 'Equipamento descartado / sem conserto',
    no_equipment: 'Não envolveu equipamento',
  },
  approval: { none: '—', pending: 'Aprovação pendente', approved: 'Aprovado', rejected: 'Reprovado' },
};

const STATUS_BADGE = { 1: 'new', 2: 'assigned', 3: 'progress', 4: 'pending', 5: 'solved', 6: 'closed', 7: 'canceled' };
const Views = {};
const PRIO_BADGE = { 1: 'prio-low', 2: 'prio-med', 3: 'prio-high', 4: 'prio-urgent' };

function badgeStatus(s) {
  return `<span class="badge bd-${STATUS_BADGE[s] || 'new'}">${LABELS.status[s] || s}</span>`;
}
function badgePriority(p) {
  return `<span class="badge ${PRIO_BADGE[p] || 'prio-med'}"><i class="bi bi-flag-fill me-1"></i>${LABELS.priority[p] || p}</span>`;
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(message, type = 'info') {
  const colors = { info: 'text-bg-primary', success: 'text-bg-success', danger: 'text-bg-danger', warning: 'text-bg-warning' };
  const box = document.getElementById('toast-wrap');
  const t = document.createElement('div');
  t.className = `toast align-items-center border-0 ${colors[type]}`;
  t.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(message)}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  box.appendChild(t);
  const bs = new bootstrap.Toast(t, { delay: 4500 });
  bs.show();
  t.addEventListener('hidden.bs.toast', () => t.remove());
}

function showError(e) {
  const msg = e && e.message ? e.message : 'Erro inesperado.';
  toast(msg, 'danger');
}

function spinner() {
  return `<div class="text-center py-5"><div class="spinner-border text-primary" role="status"></div>
    <div class="text-muted mt-2">Carregando...</div></div>`;
}

function emptyState(title, subtitle, icon = 'bi-inbox') {
  return `<div class="empty-state">
    <i class="bi ${icon}"></i>
    <h5>${esc(title)}</h5>
    <p>${esc(subtitle || '')}</p>
  </div>`;
}

// Modal de confirmacao generico
function confirmDialog({ title, body, confirmText = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal fade';
    m.innerHTML = `<div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">${esc(title)}</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">${body || ''}</div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirmOk">${esc(confirmText)}</button>
        </div>
      </div></div>`;
    document.body.appendChild(m);
    const modal = new bootstrap.Modal(m);
    const done = (val) => { modal.hide(); m.addEventListener('hidden.bs.modal', () => m.remove()); resolve(val); };
    m.querySelector('#confirmOk').onclick = () => done(true);
    m.addEventListener('hidden.bs.modal', () => { m.remove(); resolve(false); });
    modal.show();
  });
}

// ---------------- Perfis ----------------
// admin = Administrador Mestre | admin_local = Administrador Local (1 empresa)
// moderator = Moderador (triagem) | technician = Técnico
// client: client_level 1 = Usuário, 2 = Gestor
const Roles = {
  isMaster: (u) => !!u && u.role === 'admin',
  isLocalAdmin: (u) => !!u && u.role === 'admin_local',
  isModerator: (u) => !!u && u.role === 'moderator',
  isTechnician: (u) => !!u && u.role === 'technician',
  isClient: (u) => !!u && u.role === 'client',
  isManager: (u) => !!u && u.role === 'client' && Number(u.client_level) === 2,
  // Permissoes (vindas do servidor; o Administrador Mestre tem todas)
  can: (u, perm) => !!u && (u.role === 'admin' || (Array.isArray(u.permissions) && u.permissions.includes(perm))),
  // ve chamados de todas as empresas
  isStaff: (u) => Roles.can(u, 'ticket.view_all'),
  // ve notas internas
  isTeam: (u) => Roles.can(u, 'ticket.internal'),
  canSeeDashboard: (u) => Roles.can(u, 'dashboard.view'),
  canSeeInventory: (u) => Roles.can(u, 'inventory.view'),
  canManageUsers: (u) => Roles.can(u, 'users.manage'),
  canManageLocations: (u) => Roles.can(u, 'locations.manage'),
  label(u) {
    if (!u) return '';
    if (u.role === 'client') return LABELS.clientLevel[u.client_level] || 'Usuário';
    return LABELS.role[u.role] || u.role;
  },
};

// Tempo entre duas datas em texto curto (ex.: "2 d 3 h", "45 min")
function fmtDuration(fromIso, toIso) {
  if (!fromIso) return '—';
  const ms = (toIso ? new Date(toIso) : new Date()) - new Date(fromIso);
  if (!(ms >= 0)) return '—';
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

// Urgencia do chamado (nome configuravel) com a cor da prioridade equivalente
function badgeImpact(t) {
  if (!t.impact_name) return badgePriority(t.priority);
  return `<span class="badge ${PRIO_BADGE[t.priority] || 'prio-med'}" title="Prioridade ${esc(LABELS.priority[t.priority] || '')}"><i class="bi bi-flag-fill me-1"></i>${esc(t.impact_name)}</span>`;
}

// Valor legivel no historico do chamado (datas em formato brasileiro)
function fmtHistValue(action, v) {
  if (v === null || v === undefined || v === '') return '';
  if (action === 'estimated_at' || action === 'due_at') return fmt.dateTime(v);
  if (action === 'needed_by') return fmt.date(String(v).slice(0, 10) + 'T12:00:00');
  return String(v);
}

// Estrelas (0 a 5) somente leitura
function starsHtml(n) {
  const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return `<span class="stars" title="${v} de 5">${'<i class="bi bi-star-fill"></i>'.repeat(v)}${'<i class="bi bi-star"></i>'.repeat(5 - v)}</span>`;
}
