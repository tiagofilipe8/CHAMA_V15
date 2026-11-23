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
  // um nome só para a mesma coisa: a urgência do chamado
  priority: { 1: 'Requisição', 2: 'Operação prejudicada', 3: 'Parada iminente', 4: 'Operação parada' },
  role: {
    admin: 'Administrador Mestre', admin_local: 'Administrador Local', moderator: 'Moderador',
    technician: 'Técnico', client: 'Cliente',
  },
  clientLevel: { 1: 'Usuário', 2: 'Gestor' },
  history: {
    created: 'Chamado criado', status: 'Status alterado', reopened: 'Chamado reaberto',
    technician: 'Técnico', moderator: 'Moderador', category: 'Categoria', impact: 'Urgência',
    entity: 'Empresa',
    priority: 'Urgência', location: 'Localização', needed_by: 'Data de necessidade',
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

// Anexos: so PDF e fotos (o servidor confere de novo)
const ANEXO_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,.pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.heif';
const ANEXO_MSG = 'Só é possível anexar PDF ou fotos (PNG, JPG, JPEG, WEBP, GIF ou HEIC).';
function anexoPermitido(f) {
  return /\.(pdf|png|jpe?g|webp|gif|heic|heif)$/i.test(f?.name || '');
}
// Separa os arquivos aceitos; avisa sobre os recusados
function filtrarAnexos(files) {
  const ok = [], ruins = [];
  for (const f of Array.from(files || [])) (anexoPermitido(f) ? ok : ruins).push(f);
  if (ruins.length) toast(`${ruins.map((f) => f.name).join(', ')}: ${ANEXO_MSG}`, 'warning');
  return ok;
}

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

// toast(msg, tipo, { acao: { texto, aoClicar }, tempo })
function toast(message, type = 'info', extra = {}) {
  const colors = { info: 'text-bg-primary', success: 'text-bg-success', danger: 'text-bg-danger', warning: 'text-bg-warning' };
  const box = document.getElementById('toast-wrap');
  const t = document.createElement('div');
  t.className = `toast align-items-center border-0 ${colors[type] || colors.info}`;
  t.setAttribute('role', type === 'danger' ? 'alert' : 'status');
  t.setAttribute('aria-live', type === 'danger' ? 'assertive' : 'polite');
  // fundo amarelo: texto e X escuros (contraste)
  const xClaro = type !== 'warning';
  t.innerHTML = `<div class="d-flex align-items-center"><div class="toast-body">${esc(message)}</div>
    ${extra.acao ? `<button type="button" class="btn btn-sm ${xClaro ? 'btn-light' : 'btn-dark'} me-1 toast-acao">${esc(extra.acao.texto)}</button>` : ''}
    <button type="button" class="btn-close ${xClaro ? 'btn-close-white' : ''} me-2 m-auto" data-bs-dismiss="toast" aria-label="Fechar"></button></div>`;
  box.appendChild(t);
  // erro nao some sozinho: fica ate a pessoa fechar
  const bs = new bootstrap.Toast(t, type === 'danger'
    ? { autohide: false }
    : { delay: extra.tempo || (extra.acao ? 8000 : 4500) });
  if (extra.acao) {
    t.querySelector('.toast-acao').addEventListener('click', () => { bs.hide(); extra.acao.aoClicar(); });
  }
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
// admin = Administrador Mestre (admin_local antigo = Gestor)
// moderator = Moderador (triagem) | technician = Técnico
// client: client_level 1 = Usuário, 2 = Gestor
const Roles = {
  isMaster: (u) => !!u && u.role === 'admin',
  // o antigo Administrador Local virou Gestor
  isLocalAdmin: (u) => !!u && (u.role === 'admin_local' || (u.role === 'client' && Number(u.client_level) === 2)),
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
  return `<span class="badge ${PRIO_BADGE[t.priority] || 'prio-med'}" title="Nível: ${esc(LABELS.priority[t.priority] || '')}"><i class="bi bi-flag-fill me-1"></i>${esc(t.impact_name)}</span>`;
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

// ---------------------------------------------------------------
// Siglas explicadas: qualquer sigla conhecida que aparece na tela ganha
// um sublinhado pontilhado. No computador, passe o mouse; no celular, toque.
// ---------------------------------------------------------------
const SIGLAS = {
  NOC: 'Painel da equipe que mostra os chamados ao vivo.',
  SLA: 'Prazo combinado para resolver o chamado.',
  TMR: 'Tempo médio até a equipe dar a primeira resposta.',
  TMA: 'Tempo médio até o chamado ser resolvido.',
  OS: 'O mesmo que chamado.',
  TI: 'A equipe que cuida de computadores, internet e sistemas.',
  TAG: 'Etiqueta com o número do equipamento.',
  PDV: 'O caixa da loja.',
  IP: 'Endereço do equipamento na rede.',
  MAC: 'Código da placa de rede do equipamento.',
  CPU: 'Processador do computador.',
  RAM: 'Memória do computador.',
  HD: 'Disco onde ficam os arquivos do computador.',
  SSD: 'Disco rápido onde ficam os arquivos do computador.',
  DNS: 'Serviço que encontra o endereço dos sites na internet.',
  VPN: 'Conexão segura com a rede da empresa pela internet.',
  UF: 'Estado (ex.: SP).',
  QR: 'Código para ler com a câmera do celular.',
  ID: 'Número do registro.',
};
const SIGLA_RE = new RegExp(`(^|[^\\wÀ-ÿ])(${Object.keys(SIGLAS).join('|')})(?=$|[^\\wÀ-ÿ])`, 'g');
const SIGLA_PULAR = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'PRE', 'ABBR', 'SVG', 'TEXT', 'TSPAN', 'TITLE', 'BUTTON']);
function marcarSiglas(raiz) {
  if (!raiz || raiz.nodeType !== 1) return;
  const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      for (let p = n.parentNode; p && p !== raiz.parentNode; p = p.parentNode) {
        if (p.nodeType === 1 && (SIGLA_PULAR.has(p.nodeName.toUpperCase()) || p.isContentEditable || (p.classList && p.classList.contains('sem-sigla')))) return NodeFilter.FILTER_REJECT;
      }
      SIGLA_RE.lastIndex = 0;
      return SIGLA_RE.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const nos = [];
  while (walker.nextNode()) nos.push(walker.currentNode);
  for (const n of nos) {
    const frag = document.createDocumentFragment();
    let ult = 0;
    const txt = n.nodeValue;
    SIGLA_RE.lastIndex = 0;
    let m;
    while ((m = SIGLA_RE.exec(txt))) {
      const ini = m.index + m[1].length;
      frag.appendChild(document.createTextNode(txt.slice(ult, ini)));
      const ab = document.createElement('abbr');
      ab.className = 'sigla';
      ab.title = SIGLAS[m[2]];
      ab.textContent = m[2];
      frag.appendChild(ab);
      ult = ini + m[2].length;
    }
    frag.appendChild(document.createTextNode(txt.slice(ult)));
    n.parentNode.replaceChild(frag, n);
  }
}
function ligarSiglas(aviso) {
  let fila = [];
  let agendado = false;
  const obs = new MutationObserver((muts) => {
    muts.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) fila.push(n); }));
    if (!agendado && fila.length) {
      agendado = true;
      requestAnimationFrame(() => {
        obs.disconnect();
        const lote = fila; fila = []; agendado = false;
        lote.forEach((n) => { if (n.isConnected && !n.closest('#board, .sem-sigla')) marcarSiglas(n); });
        obs.observe(document.body, { childList: true, subtree: true });
      });
    }
  });
  marcarSiglas(document.body);
  obs.observe(document.body, { childList: true, subtree: true });
  // toque no celular: mostra a explicação
  // (o toque na sigla não abre o cartão/linha que está por baixo)
  document.addEventListener('click', (ev) => {
    const ab = ev.target.closest && ev.target.closest('abbr.sigla');
    if (!ab) return;
    ev.stopPropagation();
    ev.preventDefault();
    aviso(`${ab.textContent}: ${ab.title}`);
  }, true);
}

document.addEventListener('DOMContentLoaded', () => ligarSiglas((msg) => toast(msg, 'info')));
