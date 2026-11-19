// ---------------------------------------------------------------
// app.js — bootstrap, roteamento, socket e shell da aplicacao
// ---------------------------------------------------------------

// Menu lateral montado a partir das permissoes do perfil
//  - no topo: Abrir chamado (destaque) e Meus chamados (com sininho de novidade)
//  - Atendimento: painel e listas de chamados
//  - Equipamentos: inventario
//  - Locais: localizacoes (empresa > posto)
//  - Cadastros: usuarios, empresas, materiais, categorias
//  - Sistema: perfis e permissoes, configuracoes (so o Administrador Mestre)
function buildNav(u) {
  const can = (perm) => Roles.can(u, perm);
  const master = Roles.isMaster(u);
  const client = Roles.isClient(u);
  const items = [];
  const grupo = (titulo, g, lista) => {
    if (lista.length) items.push({ group: titulo, g }, ...lista.map((i) => ({ ...i, g })));
  };

  // Abrir chamado: a acao principal do sistema, sempre no topo do menu e em destaque
  if (can('ticket.create')) items.push({ cta: true, href: '#/new', icon: 'bi-plus-lg', label: 'Abrir chamado' });
  // Meus chamados (os que abri e os que estao comigo), logo abaixo, com sininho de novidade.
  // Para o cliente a lista "Chamados" ja e a dele: o atalho aponta para ela e ela sai do grupo.
  const listaJaEMinha = client || (!can('ticket.view_all') && !can('ticket.view_company'));
  items.push({ top: true, href: listaJaEMinha ? '#/tickets' : '#/mine', icon: 'bi-ticket-detailed', label: 'Meus chamados' });

  const atendimento = [];
  if (can('dashboard.view')) atendimento.push({ href: '#/dashboard', icon: 'bi-speedometer2', label: 'Painel' });
  const ticketsLabel = can('ticket.view_all') ? 'Chamados' : 'Chamados da empresa';
  if (!listaJaEMinha) atendimento.push({ href: '#/tickets', icon: 'bi-journal-text', label: ticketsLabel });
  if (client && can('ticket.view_company')) atendimento.push({ href: '#/team-tickets', icon: 'bi-people', label: 'Chamados da equipe' });
  atendimento.push({ href: '#/watching', icon: 'bi-eye', label: 'Acompanhando' });
  // so um item (ex.: cliente, que so tem "Acompanhando"): fica solto, sem titulo de grupo
  if (atendimento.length === 1) items.push({ ...atendimento[0], g: 'g-solto' });
  else grupo('Atendimento', 'g-atend', atendimento);

  grupo('Equipamentos', 'g-equip', can('inventory.view')
    ? [{ href: '#/inventory', icon: 'bi-hdd-stack', label: 'Inventário' }] : []);

  grupo('Locais', 'g-locais', can('locations.manage')
    ? [{ href: '#/admin/locations', icon: 'bi-geo-alt', label: 'Localizações' }] : []);

  const cadastros = [];
  if (can('users.manage')) cadastros.push({ href: '#/admin/users', icon: 'bi-people', label: 'Usuários' });
  if (master) cadastros.push({ href: '#/admin/entities', icon: 'bi-building', label: window.EMPRESA_UNICA ? 'Dados da empresa' : 'Empresas' });
  if (master || Roles.isManager(u) || u.role === 'admin_local') cadastros.push({ href: '#/admin/materials', icon: 'bi-box-seam', label: 'Materiais' });
  if (master) cadastros.push({ href: '#/admin/categories', icon: 'bi-diagram-3', label: 'Categorias e opções' });
  grupo('Cadastros', 'g-cad', cadastros);

  grupo('Sistema', 'g-sis', master ? [
    { href: '#/admin/roles', icon: 'bi-shield-check', label: 'Perfis e permissões' },
    { href: '#/admin/settings', icon: 'bi-gear', label: 'Configurações' },
  ] : []);
  return items;
}

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
    '/watching': 'Acompanhando',
    '/mine': 'Meus chamados',
    '/admin/locations': 'Localizações',
    '/admin/materials': 'Materiais',
    '/inventory': 'Inventário',
    '/inventory/agents': 'Agentes',
    '/new': 'Abrir Chamado',
    '/admin/users': 'Usuários',
    '/admin/entities': window.EMPRESA_UNICA ? 'Dados da empresa' : 'Empresas',
    '/admin/categories': 'Categorias e opções',
    '/admin/settings': 'Configurações',
    '/admin/roles': 'Perfis e permissões',
    '/perfil': 'Meu Perfil',
  };
  if (path.startsWith('/tickets/')) return 'Chamado';
  if (path.startsWith('/inventory/')) return 'Ativo';
  return map[path] || 'Sistema';
}

// Frase curta embaixo do titulo: para que serve a pagina aberta
function pageDescFromPath() {
  const u = currentUser();
  const path = (location.hash.replace(/^#/, '') || '/dashboard').split('?')[0];
  const listaTickets = Roles.can(u, 'ticket.view_all')
    ? 'Todos os chamados, para acompanhar, distribuir e atender.'
    : (Roles.can(u, 'ticket.view_company') && !Roles.isClient(u))
      ? 'Todos os chamados da sua empresa.'
      : 'Os chamados que você abriu e o andamento de cada um.';
  const map = {
    '/dashboard': 'Resumo do atendimento: chamados abertos, urgências e o que precisa ficar pronto em cada dia.',
    '/tickets': listaTickets,
    '/mine': 'Os chamados que você abriu e os que estão com você. O sininho marca os que tiveram novidade.',
    '/team-tickets': 'Os chamados de todas as pessoas das empresas que você acompanha.',
    '/watching': 'Chamados em que você foi incluído como observador: você acompanha, mas não é o responsável.',
    '/new': 'Conte o problema e onde ele está. A equipe de TI recebe o chamado na hora.',
    '/inventory': 'Computadores, impressoras e outros equipamentos: o que são, onde estão e quem usa.',
    '/inventory/agents': 'Programas instalados nos computadores que enviam o inventário sozinhos.',
    '/admin/locations': 'Lugares atendidos (lojas, postos, setores). Cada chamado e equipamento fica ligado a um local.',
    '/admin/users': 'Quem acessa o sistema, de qual empresa e local, e com qual perfil.',
    '/admin/entities': window.EMPRESA_UNICA ? 'Nome, logo e contatos da empresa.' : 'Empresas atendidas: nome, logo e contatos de cada uma.',
    '/admin/materials': 'Itens que podem ser pedidos no chamado "Pedido de material" (toner, mouse, cabo...).',
    '/admin/categories': 'Tipos de problema, níveis de urgência e causas de encerramento usados nos chamados.',
    '/admin/roles': 'O que cada perfil (Técnico, Gestor, Usuário...) pode ver e fazer no sistema.',
    '/admin/settings': 'Opções gerais: nome do sistema, avisos por e-mail e WhatsApp, backup.',
    '/perfil': 'Seus dados de contato e sua senha.',
  };
  if (/^\/tickets\/\d+/.test(path)) return 'Situação, conversa e histórico do chamado.';
  if (/^\/inventory\/\d+/.test(path)) return 'Dados do equipamento e os chamados ligados a ele.';
  return map[path] || '';
}

function renderNav() {
  const user = currentUser();
  const nav = document.getElementById('side-nav');
  const items = buildNav(user);
  // Grupos (Atendimento, Equipamentos, Locais, Cadastros, Sistema): sempre abertos, o titulo so organiza
  let html = '';
  let aberto = false;
  const fecha = () => { if (aberto) html += '</div></div>'; aberto = false; };
  items.forEach((it) => {
    if (it.cta) {
      html += `<a class="nav-cta" href="${it.href}"><i class="bi ${it.icon}"></i><span>${it.label}</span></a>`;
    } else if (it.top) {
      html += `<a class="nav-item nav-top" id="nav-mine" href="${it.href}"><i class="bi ${it.icon}"></i><span>${it.label}</span>`
        + '<span class="nav-bell d-none" title="Seus chamados tiveram novidade"><i class="bi bi-bell-fill"></i><b></b></span></a>';
    } else if (it.group) {
      fecha();
      html += `<div class="nav-sec" data-sec="${it.g || ''}">`
        + `<div class="nav-group ${it.g || ''}"><span>${esc(it.group)}</span></div>`
        + '<div class="nav-sec-body">';
      aberto = true;
    } else if (it.sep) {
      html += '<hr class="nav-sep">';
    } else {
      html += `<a class="nav-item ${it.g || ''}" href="${it.href}"><i class="bi ${it.icon}"></i><span>${it.label}</span></a>`;
    }
  });
  fecha();
  nav.innerHTML = html;
  pintarNovidades();

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

// Selo do grupo ao lado do título (mesma cor do grupo no menu)
function moduloAtual() {
  const p = location.hash.replace(/^#/, '') || '/dashboard';
  if (p.startsWith('/inventory')) return ['Equipamentos', 'tg-amber', 'bi-hdd-stack'];
  if (p.startsWith('/admin/locations')) return ['Locais', 'tg-teal', 'bi-geo-alt'];
  if (p.startsWith('/admin/roles') || p.startsWith('/admin/settings')) return ['Sistema', 'tg-gray', 'bi-gear'];
  if (p.startsWith('/admin')) return ['Cadastros', 'tg-violet', 'bi-folder2-open'];
  if (p === '/perfil') return ['Minha conta', 'tg-gray', 'bi-person'];
  return ['Atendimento', 'tg-blue', 'bi-headset'];
}
function marcarModulo() {
  const el = document.getElementById('page-modulo');
  if (!el) return;
  const [nome, cor, icone] = moduloAtual();
  el.className = `tg page-modulo ${cor}`;
  el.innerHTML = `<i class="bi ${icone}"></i>${nome}`;
  const desc = document.getElementById('page-desc');
  if (desc) desc.textContent = pageDescFromPath();
}

// Modo escuro: guardado no navegador
function aplicarTema(tema) {
  document.documentElement.setAttribute('data-bs-theme', tema);
  const b = document.getElementById('btn-tema');
  if (b) b.innerHTML = tema === 'dark' ? '<i class="bi bi-sun-fill"></i>' : '<i class="bi bi-moon-stars-fill"></i>';
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
      target === '/dashboard' ? path === target
        : path === target || path.startsWith(target + '/') || path.startsWith(target + '?'));
  });
  const cta = document.querySelector('#side-nav .nav-cta');
  if (cta) cta.classList.toggle('active', /^\/new($|\?)/.test(path));
}

// ---------------- Roteador ----------------
const routes = [
  { re: /^#\/dashboard$/, view: () => Views.dashboard },
  { re: /^#\/tickets$/, view: () => Views.tickets },
  { re: /^#\/team-tickets$/, view: () => (el) => Views.tickets(el, { team: true }) },
  { re: /^#\/watching$/, view: () => (el) => Views.tickets(el, { watching: true }) },
  { re: /^#\/mine$/, view: () => (el) => Views.tickets(el, { mine: true }) },
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
];

async function router() {
  if (!API.token) { location.href = '/'; return; }
  renderNav();
  activeNav();
  const hash = location.hash || '#/dashboard';
  const viewEl = document.getElementById('view');
  // abriu um chamado: as notificacoes dele contam como lidas (some o sininho dele)
  const aberto = hash.match(/^#\/tickets\/(\d+)/);
  if (aberto && novidades.includes(Number(aberto[1]))) {
    API.post('/notifications/read', { ticket_id: Number(aberto[1]) }).then(loadBell).catch(() => {});
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
    } else if (/^#\/(tickets|team-tickets|watching|mine)$/.test(location.hash) && Views.tickets.refresh) {
      Views.tickets.refresh();
    }
  });

  socket.on('notification:new', (n) => {
    loadBell();
    // notifica em tela quando nao esta no dashboard (evita duplicidade)
    toast(n.title, 'info');
  });
}

// Chamados meus (abertos por mim ou comigo) com notificacao nao lida
let novidades = [];
function pintarNovidades() {
  const n = novidades.length;
  const b = document.querySelector('#nav-mine .nav-bell');
  if (b) {
    b.classList.toggle('d-none', n === 0);
    b.querySelector('b').textContent = n > 99 ? '99+' : String(n);
    b.title = n === 1 ? '1 chamado seu teve novidade' : `${n} chamados seus tiveram novidade`;
  }
  document.querySelectorAll('[data-tk-novidade]').forEach((el) => {
    el.classList.toggle('d-none', !novidades.includes(Number(el.dataset.tkNovidade)));
  });
}
window.temNovidade = (id) => novidades.includes(Number(id));

async function loadBell() {
  try {
    const data = await API.get('/notifications');
    novidades = Array.isArray(data.mine_tickets) ? data.mine_tickets : [];
    pintarNovidades();
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