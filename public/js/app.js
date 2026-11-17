// ---------------------------------------------------------------
// app.js — bootstrap, roteamento, socket e shell da aplicacao
// ---------------------------------------------------------------

// Menu lateral montado a partir das permissoes do perfil
//  - Orcim: o sistema de chamados (painel, chamados, inventario...)
//  - Dia a dia da TI: rotina do tecnico do grupo (aberta dentro desta tela, ver TI abaixo)
//  - Administracao
function buildNav(u) {
  const can = (perm) => Roles.can(u, perm);
  const master = Roles.isMaster(u);
  const client = Roles.isClient(u);
  const items = [];
  const orcim = [];
  if (can('dashboard.view')) orcim.push({ href: '#/dashboard', icon: 'bi-speedometer2', label: 'Painel' });
  const ticketsLabel = can('ticket.view_all') ? 'Chamados'
    : (can('ticket.view_company') && !client) ? 'Chamados da empresa' : 'Meus Chamados';
  orcim.push({ href: '#/tickets', icon: 'bi-journal-text', label: ticketsLabel });
  if (client && can('ticket.view_company')) orcim.push({ href: '#/team-tickets', icon: 'bi-people', label: 'Chamados da Equipe' });
  orcim.push({ href: '#/watching', icon: 'bi-eye', label: 'Chamados a observar' });
  if (can('inventory.view')) orcim.push({ href: '#/inventory', icon: 'bi-hdd-stack', label: 'Inventário' });
  if (can('ticket.create')) orcim.push({ href: '#/new', icon: 'bi-plus-circle', label: 'Novo Chamado' });
  items.push({ group: 'Orcim', g: 'g-orcim' }, ...orcim.map((i) => ({ ...i, g: 'g-orcim' })));

  const tiGestor = can('ti.manage');
  if (tiGestor || can('ti.view')) {
    items.push({ group: 'Dia a dia da TI', g: 'g-ti' });
    if (tiGestor) {
      items.push({ href: '#/ti/painel', icon: 'bi-graph-up-arrow', label: 'Painel do gestor' });
      items.push({ href: '#/ti', icon: 'bi-binoculars', label: 'Acompanhamento' });
      items.push({ href: '#/ti/hoje', icon: 'bi-sun', label: 'Dia do técnico' });
    } else {
      items.push({ href: '#/ti', icon: 'bi-sun', label: 'Meu dia' });
    }
    items.push({ href: '#/ti/agenda', icon: 'bi-calendar3', label: 'Agenda' });
    items.push({ href: '#/ti/postos', icon: 'bi-pin-map', label: 'Postos' });
    items.push({ href: '#/ti/solicitacoes', icon: 'bi-megaphone', label: 'Solicitações' });
    items.push({ href: '#/ti/atividades', icon: 'bi-kanban', label: tiGestor ? 'Atividades' : 'Minhas atividades' });
    items.push({ href: '#/ti/checklists', icon: 'bi-ui-checks', label: 'Checklists' });
  }

  const admin = [];
  if (can('users.manage')) admin.push({ href: '#/admin/users', icon: 'bi-people', label: 'Usuários' });
  if (master) admin.push({ href: '#/admin/entities', icon: 'bi-building', label: window.EMPRESA_UNICA ? 'Dados da empresa' : 'Empresas' });
  if (can('locations.manage')) admin.push({ href: '#/admin/locations', icon: 'bi-geo-alt', label: 'Localizações' });
  if (master || u.role === 'admin_local') admin.push({ href: '#/admin/materials', icon: 'bi-box-seam', label: 'Materiais' });
  if (master) {
    admin.push({ href: '#/admin/categories', icon: 'bi-diagram-3', label: 'Categorias e opções' });
    admin.push({ href: '#/admin/roles', icon: 'bi-shield-check', label: 'Perfis e permissões' });
    admin.push({ href: '#/admin/settings', icon: 'bi-gear', label: 'Configurações' });
  }
  if (admin.length) items.push({ group: 'Administração', g: 'g-admin' }, ...admin.map((i) => ({ ...i, g: 'g-admin' })));
  // itens do Dia a dia da TI: marca o grupo (cor do módulo)
  items.forEach((i) => { if (!i.g && i.href && i.href.startsWith('#/ti')) i.g = 'g-ti'; });
  return items;
}

// ---------------- Dia a dia da TI (embutido) ----------------
// As telas do Dia a dia da TI ficam em /gbf e abrem num quadro dentro desta tela,
// com o mesmo login (a /gbf troca o token da Central pelo dela) e sem o menu proprio.
const TI_TITULOS = {
  '': 'Dia a dia da TI', painel: 'Painel do gestor', hoje: 'Dia do técnico', agenda: 'Agenda',
  postos: 'Postos', visitas: 'Visita', solicitacoes: 'Solicitações', atividades: 'Atividades',
  checklists: 'Checklists', config: 'Config. do Dia a dia',
};
const TI = {
  // '#/ti/postos/3?x=1' -> '#/postos/3?x=1' (rota dentro do /gbf)
  rotaInterna(hash) { return '#/' + hash.replace(/^#\/ti\/?/, ''); },
  titulo(hash) {
    const parte = hash.replace(/^#\/ti\/?/, '').split(/[/?]/)[0];
    return TI_TITULOS[parte] || 'Dia a dia da TI';
  },
  frame() { return document.getElementById('ti-frame'); },
  // ja existe o quadro: so muda a rota dentro dele (nao recarrega)
  navegar(hash) {
    const f = this.frame();
    if (!f || !f.contentWindow) return false;
    const alvo = this.rotaInterna(hash);
    if (f.contentWindow.location.hash !== alvo) f.contentWindow.location.hash = alvo;
    document.getElementById('page-title').textContent = this.titulo(hash);
    return true;
  },
  abrir(el, hash) {
    const view = document.getElementById('view');
    view.classList.add('ti-embed');
    el.innerHTML = `<iframe id="ti-frame" class="ti-frame" title="Dia a dia da TI"
      src="/gbf/?embed=1${this.rotaInterna(hash)}"></iframe>`;
    document.getElementById('page-title').textContent = this.titulo(hash);
  },
};

// Mensagens vindas do quadro do Dia a dia da TI
window.addEventListener('message', (ev) => {
  if (ev.origin !== location.origin || !ev.data || typeof ev.data !== 'object') return;
  const m = ev.data;
  if (m.gbf === 'rota' && typeof m.hash === 'string') {
    // navegacao dentro do quadro: atualiza o endereco e o menu sem recarregar
    const novo = '#/ti' + (m.hash === '#/' ? '' : m.hash.replace(/^#/, ''));
    if (location.hash !== novo) history.replaceState(null, '', novo);
    activeNav();
    document.getElementById('page-title').textContent = TI.titulo(novo);
  } else if (m.gbf === 'abrir' && typeof m.hash === 'string' && /^#\/[\w/?=&.-]*$/.test(m.hash)) {
    location.hash = m.hash; // ex.: chamado da Orcim citado numa atividade
  } else if (m.gbf === 'sem-acesso') {
    toast(m.mensagem || 'Sem acesso ao Dia a dia da TI.', 'warning');
  }
});

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
    '/watching': 'Chamados a observar',
    '/admin/locations': 'Localizações',
    '/admin/materials': 'Materiais',
    '/inventory': 'Inventário',
    '/inventory/agents': 'Agentes',
    '/new': 'Abrir Chamado',
    '/admin/users': 'Usuários',
    '/admin/entities': 'Dados da empresa',
    '/admin/categories': 'Categorias e opções',
    '/admin/settings': 'Configurações',
    '/admin/roles': 'Perfis e permissões',
    '/perfil': 'Meu Perfil',
  };
  if (path === '/ti' || path.startsWith('/ti/') || path.startsWith('/ti?')) return TI.titulo('#' + path);
  if (path.startsWith('/tickets/')) return 'Chamado';
  if (path.startsWith('/inventory/')) return 'Ativo';
  return map[path] || 'Sistema';
}

function renderNav() {
  const user = currentUser();
  const nav = document.getElementById('side-nav');
  const items = buildNav(user);
  nav.innerHTML = items.map((it) =>
    it.group ? `<div class="nav-group ${it.g || ''}">${esc(it.group)}</div>` :
    it.sep ? '<hr class="nav-sep">' :
    `<a class="nav-item ${it.g || ''}" href="${it.href}"><i class="bi ${it.icon}"></i><span>${it.label}</span></a>`
  ).join('');

  // identities
  const name = user.name || user.username;
  document.getElementById('side-user-name').textContent = name;
  document.getElementById('side-user-role').textContent =
    Roles.label(user) + (user.location_name ? ` · ${user.location_name}` : '');
  const avatar = document.getElementById('side-avatar');
  avatar.textContent = name ? name.trim().charAt(0).toUpperCase() : '?';
  document.getElementById('page-title').textContent = pageTitleFromPath();

  // identidade da entidade no menu lateral
  if (Roles.isStaff(user)) {
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

// Selo do módulo ao lado do título (mesma cor do grupo no menu)
function moduloAtual() {
  const p = location.hash.replace(/^#/, '') || '/dashboard';
  if (p === '/ti' || p.startsWith('/ti/') || p.startsWith('/ti?')) return ['Dia a dia da TI', 'tg-teal', 'bi-feather'];
  if (p.startsWith('/admin') || p === '/perfil') return ['Administração', 'tg-violet', 'bi-gear'];
  return ['Orcim', 'tg-blue', 'bi-headset'];
}
function marcarModulo() {
  const el = document.getElementById('page-modulo');
  if (!el) return;
  const [nome, cor, icone] = moduloAtual();
  el.className = `tg page-modulo ${cor}`;
  el.innerHTML = `<i class="bi ${icone}"></i>${nome}`;
}

// Modo escuro: guardado no navegador; o Dia a dia da TI (mesmo endereço) acompanha sozinho
function aplicarTema(tema) {
  document.documentElement.setAttribute('data-bs-theme', tema);
  const b = document.getElementById('btn-tema');
  if (b) b.innerHTML = tema === 'dark' ? '<i class="bi bi-sun-fill"></i>' : '<i class="bi bi-moon-stars-fill"></i>';
  const f = document.getElementById('ti-frame');
  if (f && f.contentDocument) f.contentDocument.documentElement.setAttribute('data-bs-theme', tema);
}

function activeNav() {
  marcarModulo();
  const fab = document.getElementById('fab-novo');
  if (fab) fab.classList.toggle('show', Roles.can(currentUser(), 'ticket.create') && !/^#\/new/.test(location.hash));
  const path = location.hash.replace(/^#/, '');
  document.querySelectorAll('#side-nav .nav-item').forEach((a) => {
    const href = a.getAttribute('href') || '';
    const target = href.replace(/^#/, '');
    a.classList.toggle('active',
      (target === '/dashboard' || target === '/ti') ? path === target || (target === '/ti' && path.startsWith('/ti?'))
        : path === target || path.startsWith(target + '/') || path.startsWith(target + '?'));
  });
}

// ---------------- Roteador ----------------
const routes = [
  { re: /^#\/dashboard$/, view: () => Views.dashboard },
  { re: /^#\/tickets$/, view: () => Views.tickets },
  { re: /^#\/team-tickets$/, view: () => (el) => Views.tickets(el, { team: true }) },
  { re: /^#\/watching$/, view: () => (el) => Views.tickets(el, { watching: true }) },
  { re: /^#\/admin\/locations(\?.*)?$/, view: () => Views.adminLocations },
  { re: /^#\/tickets\/(\d+)(\?.*)?$/, view: (m) => Views.ticketDetail(m[1]) },
  { re: /^#\/new$/, view: () => Views.newTicket },
  { re: /^#\/inventory$/, view: () => Views.inventory },
  { re: /^#\/inventory\/agents$/, view: () => Views.agents },
  { re: /^#\/inventory\/(\d+)$/, view: (m) => (el) => Views.assetDetail(m[1], el) },
  { re: /^#\/admin\/users$/, view: () => Views.adminUsers },
  { re: /^#\/admin\/materials$/, view: () => Views.adminMaterials },
  { re: /^#\/admin\/entities$/, view: () => Views.adminEntities },
  { re: /^#\/admin\/categories$/, view: () => Views.adminCategories },
  { re: /^#\/admin\/settings$/, view: () => Views.adminSettings },
  { re: /^#\/admin\/roles$/, view: () => Views.adminRoles },
  { re: /^#\/perfil$/, view: () => Views.profile },
  { re: /^#\/ti(\/.*|\?.*)?$/, view: (m) => (el) => TI.abrir(el, m[0]) },
];

async function router() {
  if (!API.token) { location.href = '/'; return; }
  renderNav();
  activeNav();
  const hash = location.hash || '#/dashboard';
  const viewEl = document.getElementById('view');
  if (/^#\/ti(\/|\?|$)/.test(hash)) {
    if (TI.navegar(hash)) return;
  } else {
    viewEl.classList.remove('ti-embed');
  }
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
    } else if (/^#\/(tickets|team-tickets|watching)$/.test(location.hash) && Views.tickets.refresh) {
      Views.tickets.refresh();
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
    if (s.versao) document.getElementById('side-versao').textContent = `Versão ${s.versao}`;
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

  // Empresa única (Grupo Beija-Flor): esconde o que só serve para várias empresas
  try {
    const ents = (await API.get('/entities')).filter((e) => e.active);
    window.EMPRESA_UNICA = ents.length <= 1 ? (ents[0] || null) : null;
    document.body.classList.toggle('empresa-unica', ents.length <= 1);
  } catch {}

  renderPreviewBar();
  renderNav();
  connectSocket();
  loadBell();

  // eventos do shell
  document.getElementById('btn-logout').onclick = logout;
  aplicarTema(document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'light');
  document.getElementById('btn-tema').onclick = () => {
    const novo = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('tema', novo); } catch {}
    aplicarTema(novo);
  };
  document.getElementById('btn-side-toggle').onclick = (ev) => {
    ev.stopPropagation();
    document.body.classList.toggle('sidebar-open');
  };
  // tablet/celular: fecha o menu ao escolher uma opcao ou ao tocar fora dele
  const closeSidebar = () => document.body.classList.remove('sidebar-open');
  document.getElementById('side-nav').addEventListener('click', (ev) => {
    if (ev.target.closest('a')) closeSidebar();
  });
  document.querySelector('.app-main').addEventListener('click', () => {
    if (document.body.classList.contains('sidebar-open')) closeSidebar();
  });
  window.addEventListener('hashchange', closeSidebar);
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

async function exitPreview() {
  await API.endPreview();
  location.href = '/app.html#/admin/roles';
  location.reload();
}

// Faixa fixa no topo enquanto o admin ve o sistema como outro perfil
function renderPreviewBar() {
  const u = currentUser();
  document.body.classList.toggle('in-preview', !!u.preview);
  if (!u.preview) return;
  const bar = document.createElement('div');
  bar.className = 'preview-bar';
  bar.innerHTML = `
    <i class="bi bi-eye-fill"></i>
    <div class="pv-text">Você está vendo o sistema como <b>${esc(u.preview.role_label || Roles.label(u))}</b>${u.entity_name ? ` em ${esc(u.entity_name)}` : ''}.
      <span class="pv-sub">É uma cópia provisória: nada do que fizer aqui muda os dados reais nem envia avisos.</span></div>
    <button class="btn btn-sm btn-light" id="btn-exit-preview"><i class="bi bi-box-arrow-left"></i> Sair da prévia</button>`;
  document.querySelector('.app-main').prepend(bar);
  bar.querySelector('#btn-exit-preview').onclick = exitPreview;
}

function logout() {
  if (API.inPreview) { exitPreview(); return; }
  API.logout();
  location.href = '/';
}

document.addEventListener('DOMContentLoaded', boot);