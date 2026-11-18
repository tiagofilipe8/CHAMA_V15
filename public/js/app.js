// ---------------------------------------------------------------
// app.js — bootstrap, roteamento, socket e shell da aplicacao
// ---------------------------------------------------------------

const NAV = {
  admin: [
    { href: '#/dashboard', icon: 'bi-speedometer2', label: 'Painel' },
    { href: '#/tickets', icon: 'bi-journal-text', label: 'Chamados' },
    { href: '#/inventory', icon: 'bi-hdd-stack', label: 'Inventário' },
    { href: '#/new', icon: 'bi-plus-circle', label: 'Novo Chamado' },
    { sep: true },
    { href: '#/admin/users', icon: 'bi-people', label: 'Usuários' },
    { href: '#/admin/entities', icon: 'bi-buildings', label: 'Entidades' },
    { href: '#/admin/categories', icon: 'bi-diagram-3', label: 'Categorias' },
    { href: '#/admin/settings', icon: 'bi-gear', label: 'Configurações' },
  ],
  technician: [
    { href: '#/dashboard', icon: 'bi-speedometer2', label: 'Painel' },
    { href: '#/tickets', icon: 'bi-journal-text', label: 'Chamados' },
    { href: '#/inventory', icon: 'bi-hdd-stack', label: 'Inventário' },
    { href: '#/new', icon: 'bi-plus-circle', label: 'Novo Chamado' },
  ],
  client: [
    { href: '#/tickets', icon: 'bi-journal-text', label: 'Meus Chamados' },
    { href: '#/team-tickets', icon: 'bi-people', label: 'Chamados da Equipe', manager: true },
    { href: '#/inventory', icon: 'bi-hdd-stack', label: 'Inventário', manager: true },
    { href: '#/admin/users', icon: 'bi-people', label: 'Usuários', manager: true },
    { href: '#/new', icon: 'bi-plus-circle', label: 'Novo Chamado' },
  ],
};

let socket = null;

function currentUser() {
  return API.user || {};
}

function pageTitleFromPath() {
  const path = location.hash.replace(/^#/, '') || '/dashboard';
  const map = {
    '/dashboard': 'Painel de Chamados',
    '/tickets': 'Chamados',
    '/team-tickets': 'Chamados da Equipe',
    '/inventory': 'Inventário',
    '/inventory/agents': 'Agentes',
    '/new': 'Abrir Chamado',
    '/admin/users': 'Usuários',
    '/admin/entities': 'Entidades',
    '/admin/categories': 'Categorias',
    '/admin/settings': 'Configurações',
    '/perfil': 'Meu Perfil',
  };
  if (path.startsWith('/tickets/')) return 'Chamado';
  if (path.startsWith('/inventory/')) return 'Ativo';
  return map[path] || 'Sistema';
}

function renderNav() {
  const user = currentUser();
  const nav = document.getElementById('side-nav');
  const items = (NAV[user.role] || []).filter((it) =>
    it.sep || !it.manager || (user.client_level || 1) === 2);
  nav.innerHTML = items.map((it) =>
    it.sep ? '<hr class="nav-sep">' :
    `<a class="nav-item" href="${it.href}"><i class="bi ${it.icon}"></i><span>${it.label}</span></a>`
  ).join('');

  // identities
  const name = user.name || user.username;
  document.getElementById('side-user-name').textContent = name;
  document.getElementById('side-user-role').textContent =
    user.role === 'client' ? `${LABELS.role[user.role]} · ${LABELS.clientLevel[user.client_level] || ''}`.trim()
    : LABELS.role[user.role];
  const avatar = document.getElementById('side-avatar');
  avatar.textContent = name ? name.trim().charAt(0).toUpperCase() : '?';
  document.getElementById('page-title').textContent = pageTitleFromPath();

  // identidade da entidade no menu lateral
  if (user.role === 'admin' || user.role === 'technician') {
    document.getElementById('side-title').textContent = 'Central de Serviços';
    if (user.entity_logo) {
      const logoBox = document.getElementById('side-logo');
      logoBox.innerHTML = '';
      const img = document.createElement('img');
      img.src = user.entity_logo;
      img.alt = user.entity_name || 'Logo da entidade';
      img.title = user.entity_name || '';
      logoBox.appendChild(img);
    }
  } else if (user.entity_logo) {
    const logoBox = document.getElementById('side-logo');
    logoBox.innerHTML = '';
    const img = document.createElement('img');
    img.src = user.entity_logo;
    img.alt = user.entity_name || 'Logo da entidade';
    img.title = user.entity_name || '';
    logoBox.appendChild(img);
    document.getElementById('side-title').textContent = user.entity_name || 'Central de Serviços';
  }
}

function activeNav() {
  const path = location.hash.replace(/^#/, '');
  document.querySelectorAll('.nav-item').forEach((a) => {
    const href = a.getAttribute('href');
    const target = href.replace(/^#/, '');
    a.classList.toggle('active',
      target === '/dashboard' ? path === '/dashboard' : path === target || path.startsWith(target + '/'));
  });
}

// ---------------- Roteador ----------------
const routes = [
  { re: /^#\/dashboard$/, view: () => Views.dashboard },
  { re: /^#\/tickets$/, view: () => Views.tickets },
  { re: /^#\/team-tickets$/, view: () => (el) => Views.tickets(el, { team: true }) },
  { re: /^#\/tickets\/(\d+)$/, view: (m) => Views.ticketDetail(m[1]) },
  { re: /^#\/new$/, view: () => Views.newTicket },
  { re: /^#\/inventory$/, view: () => Views.inventory },
  { re: /^#\/inventory\/agents$/, view: () => Views.agents },
  { re: /^#\/inventory\/(\d+)$/, view: (m) => (el) => Views.assetDetail(m[1], el) },
  { re: /^#\/admin\/users$/, view: () => Views.adminUsers },
  { re: /^#\/admin\/entities$/, view: () => Views.adminEntities },
  { re: /^#\/admin\/categories$/, view: () => Views.adminCategories },
  { re: /^#\/admin\/settings$/, view: () => Views.adminSettings },
  { re: /^#\/perfil$/, view: () => Views.profile },
];

async function router() {
  if (!API.token) { location.href = '/'; return; }
  renderNav();
  activeNav();
  const hash = location.hash || '#/dashboard';
  const viewEl = document.getElementById('view');
  for (const r of routes) {
    const m = hash.match(r.re);
    if (m) {
      const render = r.view(m);
      if (typeof render === 'function') {
        viewEl.innerHTML = spinner();
        try { await render(viewEl); } catch (e) { showError(e); }
      } else if (typeof render === 'string') {
        viewEl.innerHTML = render;
      }
      return;
    }
  }
  viewEl.innerHTML = emptyState('Página não encontrada', 'Verifique o endereço acessado.', 'bi-compass');
}

async function guardRole(...roles) {
  const u = currentUser();
  if (!roles.includes(u.role)) {
    location.hash = '#/dashboard';
    toast('Acesso restrito a ' + roles.map((r) => LABELS.role[r]).join('/') + '.', 'warning');
    return false;
  }
  return true;
}

// ---------------- Socket em tempo real ----------------
function connectSocket() {
  if (!API.token) return;
  socket = io({ auth: { token: API.token } });
  socket.on('connect', () => console.log('Socket conectado'));

  socket.on('ticket:new', (tk) => {
    if (location.hash === '#/dashboard') {
      Voice.announceNewTicket(tk);
      Views.dashboard(document.getElementById('view'), { silent: true });
    } else {
      toast(`Novo chamado ${tk.number} — ${tk.title}`, 'success');
    }
  });

  socket.on('ticket:update', (tk) => {
    if (location.hash === '#/dashboard') {
      Views.dashboard(document.getElementById('view'), { silent: true });
    } else if (location.hash === `#/tickets/${tk.id}`) {
      Views.ticketDetail(tk.id)(document.getElementById('view'), { silent: true });
    }
  });

  socket.on('notification:new', (n) => {
    loadBell();
    // notifica em tela quando nao esta no dashboard (evita duplicidade)
    toast(n.title, 'info');
  });
}

async function loadBell() {
  try {
    const data = await API.get('/notifications');
    const countEl = document.getElementById('notif-count');
    const listEl = document.getElementById('notif-list');
    countEl.classList.toggle('d-none', data.unread === 0);
    countEl.textContent = data.unread > 99 ? '99+' : data.unread;
    listEl.innerHTML = data.list.length
      ? data.list.map((n) => `
        <a class="dropdown-item notif-item ${n.is_read ? '' : 'unread'}" href="${n.ticket_id ? `#/tickets/${n.ticket_id}` : (String(n.title).includes('Manutenção') ? '#/dashboard' : '#/inventory')}">
          <div class="notif-title">${esc(n.title)}</div>
          <div class="notif-msg">${esc(n.message)}</div>
          <small class="text-muted">${fmt.timeAgo(n.created_at)}</small>
        </a>`).join('')
      : '<div class="px-3 py-3 text-muted small">Nenhuma notificação.</div>';
    listEl.querySelectorAll('.notif-item').forEach((el) => {
      el.addEventListener('click', () => { API.post('/notifications/read').catch(() => {}); });
    });
  } catch {}
}

// ---------------- Boot ----------------
async function boot() {
  if (!API.token) { location.href = '/'; return; }

  // Valida sessao e atualiza dados do usuario
  try {
    const me = await API.get('/auth/me');
    API.user = me.user;
  } catch {
    API.logout();
    location.href = '/';
    return;
  }

  // Identidade visual e preferencias de voz
  try {
    const s = await (await fetch('/api/settings/public')).json();
    document.title = s.app_name || 'Central de Serviços';
    document.getElementById('side-title').textContent = s.app_name || 'Central de Serviços';
    const logoBox = document.getElementById('side-logo');
    if (s.logo) {
      logoBox.innerHTML = '';
      const img = document.createElement('img');
      img.src = s.logo; img.alt = 'Logo';
      logoBox.appendChild(img);
    }
    Voice.init(s);
    if (!s['app.voice_enabled']) {
      document.getElementById('btn-voice').classList.add('off');
      document.getElementById('voice-icon').className = 'bi bi-volume-mute-fill';
    }
  } catch {}

  renderNav();
  connectSocket();
  loadBell();

  // eventos do shell
  document.getElementById('btn-logout').onclick = logout;
  document.getElementById('btn-side-toggle').onclick = () => document.body.classList.toggle('sidebar-open');
  document.getElementById('btn-voice').onclick = () => {
    Voice.enabled = !Voice.enabled;
    const el = document.getElementById('btn-voice');
    const ic = document.getElementById('voice-icon');
    el.classList.toggle('off', !Voice.enabled);
    ic.className = Voice.enabled ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill';
    localStorage.setItem('os_voice', Voice.enabled ? '1' : '0');
  };
  document.getElementById('btn-notif-read').onclick = async () => {
    await API.post('/notifications/read').catch(() => {});
    loadBell();
  };

  // restaura preferencia de voz salva
  const savedVoice = localStorage.getItem('os_voice');
  if (savedVoice) {
    Voice.enabled = savedVoice === '1';
    const el = document.getElementById('btn-voice');
    el.classList.toggle('off', !Voice.enabled);
    document.getElementById('voice-icon').className =
      Voice.enabled ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill';
  }

  window.addEventListener('hashchange', router);
  router();
}

function logout() {
  API.logout();
  location.href = '/';
}

document.addEventListener('DOMContentLoaded', boot);