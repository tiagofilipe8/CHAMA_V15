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
  role: { admin: 'Administrador', technician: 'Técnico', client: 'Cliente' },
  clientLevel: { 1: 'Requisitante', 2: 'Gestor' },
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