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
  // Meus pedidos: os pedidos de material que eu fiz, com sininho quando mudam (a caminho, chegou, entregue...)
  if (can('ticket.create')) items.push({ pedidos: true, href: '#/meus-pedidos', icon: 'bi-bag-check', label: 'Meus pedidos' });
  // Em atendimento (quem atende chamados): o chamado que a pessoa está atendendo agora
  if (Atendimento.pode(u)) items.push({ atend: true, href: '#/atendimento', icon: 'bi-play-circle', label: 'Em atendimento' });
  // Chat interno (todo mundo), com a bolinha de mensagens não lidas
  if (window.CHAT_LIGADO) items.push({ chat: true, href: '#/chat', icon: 'bi-chat-dots', label: 'Chat' });

  const atendimento = [];
  if (can('dashboard.view')) atendimento.push({ href: '#/dashboard', icon: 'bi-speedometer2', label: 'Painel' });
  if (can('dashboard.view') && can('ticket.rating')) atendimento.push({ href: '#/causas', icon: 'bi-clipboard-data', label: 'Causas e notas' });
  if (can('dashboard.view')) atendimento.push({ href: '#/relatorios', icon: 'bi-file-earmark-pdf', label: 'Relatórios em PDF' });
  if (can('dashboard.view')) atendimento.push({ href: '#/urgencia', icon: 'bi-fire', label: 'Score de urgência' });
  // Rotas: agenda (hoje e próximos dias), montar rota e a página de cada rota; o contador mostra as rotas de hoje
  if (can('dashboard.view')) atendimento.push({ rotas: true, href: '#/rotas', icon: 'bi-signpost-split', label: 'Rotas' });
  // quem não vê o painel (gestor, usuário): as visitas da TI planejadas para o seu local
  if (!can('dashboard.view')) atendimento.push({ href: '#/visitas', icon: 'bi-truck', label: 'Visitas da TI' });
  const ticketsLabel = can('ticket.view_all') ? 'Chamados' : 'Chamados da empresa';
  if (!listaJaEMinha) atendimento.push({ href: '#/tickets', icon: 'bi-journal-text', label: ticketsLabel });
  if (client && can('ticket.view_company')) atendimento.push({ href: '#/team-tickets', icon: 'bi-people', label: 'Chamados da equipe' });
  // so um item: fica solto, sem titulo de grupo
  if (atendimento.length === 1) items.push({ ...atendimento[0], g: 'g-solto' });
  else grupo('Atendimento', 'g-atend', atendimento);

  // Equipamentos: Inventário e, logo abaixo (ligado por um "L"), o Estoque de T.I. de cada posto
  const equip = [];
  // perfil Usuário: vê o inventário, o estoque e as manutenções só do local do seu cadastro
  const doLocal = Roles.presoAoLocal(u);
  if (can('inventory.view')) equip.push({ href: '#/inventory', icon: 'bi-hdd-stack', label: doLocal ? 'Inventário do local' : 'Inventário da Empresa' });
  if (can('stock.withdraw') || can('inventory.view')) equip.push({ href: '#/estoque', icon: 'bi-box-seam', label: 'Estoque de T.I.', sub: can('inventory.view') });
  if (can('inventory.view') && !doLocal) equip.push({ href: '#/pedidos', icon: 'bi-cart3', label: 'Pedidos', sub: true });
  if (can('inventory.view') || can('stock.withdraw')) equip.push({ href: '#/manutencao', icon: 'bi-tools', label: 'Itens em manutenção', sub: can('inventory.view') });
  // Estoque da ORCIM: só a equipe da ORCIM (cuida do inventário e vê todas as empresas)
  if (can('inventory.manage') && (master || can('ticket.view_all'))) equip.push({ href: '#/orcim', icon: 'bi-boxes', label: 'Estoque da ORCIM' });
  if (can('stock.report')) equip.push({ href: '#/inventario/relatorio', icon: 'bi-graph-up', label: 'Relatório de inventário' }); // item próprio, no mesmo nível do Inventário
  grupo('Equipamentos', 'g-equip', equip);

  // Locais: Empresas e, logo abaixo (ligada por um "L"), as Localizações de cada empresa
  const locais = [];
  if (master) locais.push({ href: '#/admin/entities', icon: 'bi-building', label: window.EMPRESA_UNICA ? 'Dados da empresa' : 'Empresas' });
  if (can('locations.manage')) locais.push({ href: '#/admin/locations', icon: 'bi-geo-alt', label: 'Localizações', sub: master });
  grupo('Locais', 'g-locais', locais);

  const cadastros = [];
  if (can('users.manage')) cadastros.push({ href: '#/admin/users', icon: 'bi-people', label: 'Usuários' });
  if (can('materials.manage')) cadastros.push({ href: '#/admin/materials', icon: 'bi-box-seam', label: 'Materiais' });
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
  const path = (location.hash.replace(/^#/, '') || '/dashboard').split('?')[0];
  const map = {
    '/dashboard': 'Painel de Chamados',
    '/tickets': 'Chamados',
    '/team-tickets': 'Chamados da Equipe',
    '/mine': 'Meus chamados',
    '/meus-pedidos': 'Meus pedidos',
    '/atendimento': 'Meu atendimento',
    '/causas': 'Causas e notas',
    '/relatorios': 'Relatórios em PDF',
    '/urgencia': 'Score de urgência',
    '/rotas': 'Rotas',
    '/rotas/nova': /editar=/.test(location.hash) ? 'Editar rota' : 'Montar rota',
    '/visitas': 'Visitas da TI',
    '/chat': 'Chat',
    '/estoque': 'Estoque de T.I.',
    '/pedidos': 'Pedidos',
    '/manutencao': 'Itens em manutenção',
    '/inventario/relatorio': 'Relatório de inventário',
    '/admin/locations': 'Localizações',
    '/admin/materials': 'Materiais',
    '/inventory': Roles.presoAoLocal(currentUser()) ? 'Inventário do local' : 'Inventário da Empresa',
    '/orcim': 'Estoque da ORCIM',
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
  if (path.startsWith('/chat/')) return 'Chat';
  if (path.startsWith('/inventory/')) return 'Equipamento';
  if (/^\/rotas\/\d+$/.test(path)) return 'Rota';
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
    '/atendimento': 'O chamado que você está atendendo agora e a sua fila, do mais urgente para o menos urgente.',
    '/causas': 'Por que abrem e por que fecham os chamados, e a nota de cada local e usuário com a TI.',
    '/relatorios': 'Escolha o período e os relatórios, veja a prévia e baixe tudo num PDF formatado.',
    '/urgencia': 'Os locais em ordem de urgência: soma do score dos chamados abertos (urgência, atraso e prazo).',
    '/rotas': 'As rotas da TI: as de hoje, as que ficaram sem concluir e as dos próximos dias. Monte uma rota nova pelos locais mais urgentes.',
    '/rotas/nova': 'Escolha os locais, confira a ordem e o que levar, e agende o dia.',
    '/visitas': 'Os dias em que a TI vai passar no seu local (rotas planejadas pelos técnicos).',
    '/tickets': listaTickets,
    '/mine': 'Os chamados que você abriu e os que estão com você. O sininho marca os que tiveram novidade.',
    '/meus-pedidos': 'Acompanhe cada material que você pediu: pedido, comprado (a caminho da ORCIM), na ORCIM, a caminho do local e entregue. Confirme quando receber.',
    '/team-tickets': 'Os chamados de todas as pessoas das empresas que você acompanha.',
    '/new': 'Conte o problema e onde ele está. A equipe de TI recebe o chamado na hora.',
    '/inventory': 'Computadores, impressoras e outros equipamentos de cada empresa: o que são, onde estão, quanto custaram e em que estado estão.',
    '/orcim': 'Itens da ORCIM que ainda não foram para nenhuma empresa. Registre e transfira para a empresa e o posto.',
    '/chat': 'Converse com a equipe. Use @ para citar alguém e # para marcar um chamado.',
    '/estoque': 'Itens guardados no estoque de cada posto. Quem pega um item dá baixa aqui, dizendo o motivo.',
    '/pedidos': 'Chamados com pedido de material e clique no item para dizer de onde ele sai (estoque do local, ORCIM ou compra).',
    '/manutencao': 'Itens que precisam de conserto: peça a manutenção de um item e acompanhe até ele voltar para o local.',
    '/inventario/relatorio': 'Quanto vale o inventário, por que os itens saem do estoque e quanto custam as retiradas. Filtre por estoque de T.I. ou por localidade.',
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
  if (/^\/chat\/\d+/.test(path)) return 'Converse com a equipe. Use @ para citar alguém e # para marcar um chamado.';
  if (/^\/inventory\/\d+/.test(path)) return 'Dados do equipamento e os chamados ligados a ele.';
  if (/^\/rotas\/\d+$/.test(path)) return 'Paradas, chamados e o que levar. No dia, comece a rota e conclua no fim.';
  return map[path] || '';
}

// Ícone do Score de urgência pega fogo quando há chamado de operação parada em aberto
let alertaParada = 0;
function pintarAlertaUrgencia() {
  const a = document.querySelector('#side-nav a[href="#/urgencia"]');
  if (!a) return;
  a.classList.toggle('nav-em-chamas', alertaParada > 0);
  a.title = alertaParada ? `${alertaParada} chamado(s) de operação parada em aberto` : '';
}
// Rotas: quantas rotas de hoje ainda não foram concluídas ("2 hoje" ao lado do item do menu)
let rotasHoje = 0;
function pintarRotasHoje() {
  const b = document.querySelector('#nav-rotas .nav-rotas-n');
  if (!b) return;
  b.classList.toggle('d-none', !rotasHoje);
  b.textContent = `${rotasHoje} hoje`;
}
async function carregarRotasHoje() {
  if (!Roles.can(currentUser(), 'dashboard.view')) return;
  try { rotasHoje = (await API.get('/rotas/hoje')).n || 0; } catch { rotasHoje = 0; }
  pintarRotasHoje();
}
window.recarregarRotasHoje = carregarRotasHoje;
let esperaAlerta = null;
function carregarAlertaUrgencia() {
  if (!Roles.can(currentUser(), 'dashboard.view')) return;
  clearTimeout(esperaAlerta);
  esperaAlerta = setTimeout(async () => {
    try { alertaParada = (await API.get('/dashboard/urgencia/alerta')).parada || 0; } catch { alertaParada = 0; }
    pintarAlertaUrgencia();
  }, 400);
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
    } else if (it.pedidos) {
      html += `<a class="nav-item nav-top" id="nav-pedidos" href="${it.href}"><i class="bi ${it.icon}"></i><span>${it.label}</span>`
        + '<span class="nav-bell d-none" title="Seus pedidos tiveram novidade"><i class="bi bi-bell-fill"></i><b></b></span></a>';
    } else if (it.rotas) {
      html += `<a class="nav-item" id="nav-rotas" href="${it.href}"><i class="bi ${it.icon}"></i><span>${it.label}</span>`
        + '<span class="nav-rotas-n d-none" title="Rotas de hoje ainda não concluídas"></span></a>';
    } else if (it.chat) {
      html += `<a class="nav-item nav-top" id="nav-chat" href="${it.href}"><i class="bi ${it.icon}"></i><span>${it.label}</span>`
        + '<b class="nav-chat-n d-none" title="Mensagens não lidas"></b></a>';
    } else {
      html += it.atend
        ? `<a class="nav-item nav-atend" id="nav-atend" href="${it.href}"><i class="bi ${it.icon}"></i><span>${it.label}</span><span class="nav-atend-num"></span></a>`
        : `<a class="nav-item ${it.g || ''}${it.sub ? ' nav-sub' : ''}" href="${it.href}"><i class="bi ${it.icon}"></i><span>${it.label}</span></a>`;
    }
  });
  fecha();
  nav.innerHTML = html;
  pintarNovidades();
  Atendimento.carregar();
  Chat.pintarBolinha();
  pintarAlertaUrgencia();
  pintarRotasHoje();

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
  if (p.startsWith('/inventory') || p.startsWith('/inventario') || p.startsWith('/estoque') || p.startsWith('/pedidos') || p.startsWith('/orcim') || p.startsWith('/manutencao')) return ['Equipamentos', 'tg-amber', 'bi-hdd-stack'];
  if (p.startsWith('/chat')) return ['Chat', 'tg-teal', 'bi-chat-dots'];
  if (p.startsWith('/admin/locations')) return ['Locais', 'tg-teal', 'bi-geo-alt'];
  if (p.startsWith('/admin/roles') || p.startsWith('/admin/settings')) return ['Sistema', 'tg-gray', 'bi-gear'];
  if (p.startsWith('/admin')) return ['Cadastros', 'tg-violet', 'bi-folder2-open'];
  if (p === '/perfil') return ['Minha conta', 'tg-gray', 'bi-person'];
  return ['Atendimento', 'tg-blue', 'bi-headset'];
}
// ---------------- Migalhas (você está em: Início › Grupo › Página › Detalhe) ----------------
let migalhaExtra = null; // texto do item aberto (ex.: título do chamado), preenchido pela própria tela
function migalhasDoCaminho() {
  const u = currentUser();
  const can = (p) => Roles.can(u, p);
  const path = (location.hash.replace(/^#/, '') || '/dashboard').split('?')[0];
  const inicio = can('dashboard.view') ? '#/dashboard' : '#/tickets';
  const [grupo, cor, icone] = moduloAtual();
  const hrefGrupo = {
    Atendimento: inicio,
    Equipamentos: can('inventory.view') ? '#/inventory' : '#/estoque',
    Locais: Roles.isMaster(u) ? '#/admin/entities' : '#/admin/locations',
    Cadastros: can('users.manage') ? '#/admin/users' : null,
    Sistema: Roles.isMaster(u) ? '#/admin/settings' : null,
    Chat: '#/chat',
    'Minha conta': '#/perfil',
  }[grupo] || null;
  const lista = [{ txt: 'Início', href: inicio, icon: 'bi-house-door-fill', casa: true }];
  lista.push({ txt: grupo, href: hrefGrupo, icon: icone, cor });
  let m;
  if ((m = path.match(/^\/tickets\/(\d+)/))) {
    lista.push({ txt: can('ticket.view_all') ? 'Chamados' : 'Meus chamados', href: '#/tickets' });
    lista.push({ txt: migalhaExtra || `Chamado #${m[1]}` });
  } else if ((m = path.match(/^\/inventory\/(\d+)/))) {
    lista.push({ txt: Roles.presoAoLocal(u) ? 'Inventário do local' : 'Inventário da Empresa', href: '#/inventory' });
    lista.push({ txt: migalhaExtra || `Equipamento #${m[1]}` });
  } else if (path === '/inventory/agents') {
    lista.push({ txt: Roles.presoAoLocal(u) ? 'Inventário do local' : 'Inventário da Empresa', href: '#/inventory' }, { txt: 'Agentes' });
  } else if (path === '/estoque' && can('inventory.view')) {
    lista.push({ txt: Roles.presoAoLocal(u) ? 'Inventário do local' : 'Inventário da Empresa', href: '#/inventory' }, { txt: 'Estoque de T.I.' });
  } else if (/^\/chat\/\d+/.test(path)) {
    lista.push({ txt: migalhaExtra || 'Conversa' });
  } else if (/^\/rotas\//.test(path)) {
    lista.push({ txt: 'Rotas', href: '#/rotas' }, { txt: migalhaExtra || pageTitleFromPath() });
  } else {
    const titulo = pageTitleFromPath();
    if (titulo && titulo !== grupo) lista.push({ txt: titulo });
  }
  // o último é a página aberta (sem link); itens repetidos em seguida saem
  const out = lista.filter((it, i) => i === 0 || it.txt !== lista[i - 1].txt);
  out[out.length - 1].atual = true;
  return out;
}
function pintarMigalhas() {
  const nav = document.getElementById('migalhas');
  if (!nav) return;
  const itens = migalhasDoCaminho();
  nav.innerHTML = `<ol>${itens.map((it) => {
    const conteudo = `${it.icon ? `<i class="bi ${it.icon}"></i>` : ''}<span>${esc(it.txt)}</span>`;
    const cls = ['mg-it', it.casa ? 'mg-casa' : '', it.cor ? `mg-grupo ${it.cor}` : '', it.atual ? 'mg-atual' : ''].filter(Boolean).join(' ');
    return `<li class="${cls}">${it.href && !it.atual ? `<a href="${it.href}">${conteudo}</a>` : `<span${it.atual ? ' aria-current="page"' : ''}>${conteudo}</span>`}</li>`;
  }).join('<li class="mg-sep" aria-hidden="true"><i class="bi bi-chevron-right"></i></li>')}</ol>`;
}
// a tela aberta pode trocar o último item (ex.: "#16 · Impressora não liga")
window.migalhaDetalhe = (texto) => { migalhaExtra = texto || null; pintarMigalhas(); };
window.addEventListener('hashchange', () => { migalhaExtra = null; });

function marcarModulo() {
  pintarMigalhas();
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
  // quando um item do menu bate exatamente com a tela (ex.: Agenda de rotas), só ele fica marcado
  const itens = [...document.querySelectorAll('#side-nav .nav-item')];
  const exato = itens.some((a) => (a.getAttribute('href') || '').replace(/^#/, '') === path && path.includes('?'));
  itens.forEach((a) => {
    const href = a.getAttribute('href') || '';
    const target = href.replace(/^#/, '');
    a.classList.toggle('active',
      target === '/dashboard' ? path === target
        : path === target || path.startsWith(target + '/') || (!exato && path.startsWith(target + '?')));
  });
  const cta = document.querySelector('#side-nav .nav-cta');
  if (cta) cta.classList.toggle('active', /^\/new($|\?)/.test(path));
}

// ---------------- Roteador ----------------
const routes = [
  { re: /^#\/dashboard$/, view: () => Views.dashboard },
  { re: /^#\/tickets$/, view: () => Views.tickets },
  { re: /^#\/team-tickets$/, view: () => (el) => Views.tickets(el, { team: true }) },
  { re: /^#\/watching$/, view: () => () => { location.replace('#/mine'); } }, // observadores saíram do sistema
  { re: /^#\/mine$/, view: () => (el) => Views.tickets(el, { mine: true }) },
  { re: /^#\/atendimento$/, view: () => Views.atendimento },
  { re: /^#\/causas$/, view: () => Views.causas },
  { re: /^#\/relatorios$/, view: () => Views.relatorios },
  { re: /^#\/urgencia$/, view: () => Views.urgencia },
  { re: /^#\/rotas(\?.*)?$/, view: () => Views.rotas },
  { re: /^#\/rotas\/nova(\?.*)?$/, view: () => Views.rotaNova },
  { re: /^#\/rotas\/(\d+)$/, view: (m) => (el) => Views.rota(m[1], el) },
  { re: /^#\/visitas$/, view: () => Views.visitas },
  { re: /^#\/chat$/, view: () => Views.chat },
  { re: /^#\/chat\/(\d+)$/, view: (m) => Views.chatConversa(m[1]) },
  { re: /^#\/estoque(\?.*)?$/, view: () => Views.estoque },
  { re: /^#\/pedidos$/, view: () => Views.pedidos },
  { re: /^#\/manutencao$/, view: () => Views.manutencao },
  { re: /^#\/meus-pedidos$/, view: () => Views.meusPedidos },
  { re: /^#\/orcim$/, view: () => Views.orcim },
  { re: /^#\/inventario\/relatorio$/, view: () => Views.estoqueRelatorio },
  { re: /^#\/estoque\/relatorio$/, view: () => () => { location.replace('#/inventario/relatorio'); } }, // endereço antigo
  { re: /^#\/admin\/locations(\?.*)?$/, view: () => Views.adminLocations },
  { re: /^#\/tickets\/(\d+)(\?.*)?$/, view: (m) => Views.ticketDetail(m[1]) },
  { re: /^#\/new(\?.*)?$/, view: () => Views.newTicket },
  { re: /^#\/inventory(\?.*)?$/, view: () => Views.inventory },
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
  // trocou de tela: fecha janelas (modais) e menus que ficaram abertos
  document.querySelectorAll('.modal.show').forEach((m) => bootstrap.Modal.getInstance(m)?.hide());
  document.querySelector('.menu-mover')?.remove();
  // abriu um chamado: as notificacoes dele contam como lidas (some o sininho dele)
  const aberto = hash.match(/^#\/tickets\/(\d+)/);
  // guarda desde quando ele tinha novidade (a tela do chamado faz piscar o que mudou depois disso)
  if (aberto) {
    const desde = novidadeDesde[aberto[1]];
    if (desde) window.novidadeAberta = { id: aberto[1], desde };
    else if (!window.novidadeAberta || window.novidadeAberta.id !== aberto[1]) window.novidadeAberta = null;
  } else window.novidadeAberta = null;
  if (aberto && (novidades.includes(Number(aberto[1])) || novidadeDesde[aberto[1]])) {
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

  // várias mudanças seguidas = uma atualização só do painel
  let esperaPainel = null;
  const atualizarPainel = () => {
    clearTimeout(esperaPainel);
    esperaPainel = setTimeout(() => {
      if (location.hash === '#/dashboard') Views.dashboard(document.getElementById('view'), { silent: true });
    }, 1500);
  };
  socket.on('ticket:new', () => carregarAlertaUrgencia());
  socket.on('ticket:update', () => carregarAlertaUrgencia());
  socket.on('ticket:new', (tk) => {
    if (location.hash === '#/dashboard') {
      Voice.announceNewTicket(tk);
      atualizarPainel();
    } else {
      toast(`Novo chamado ${tk.number} — ${tk.title}`, 'success');
    }
  });

  socket.on('ticket:update', (tk) => {
    if (location.hash === '#/dashboard') {
      atualizarPainel();
    } else if (location.hash === `#/tickets/${tk.id}`) {
      atualizarChamadoAberto(tk.id);
    } else if (/^#\/(tickets|team-tickets|watching|mine)$/.test(location.hash) && Views.tickets.refresh) {
      Views.tickets.refresh();
    }
  });

  socket.on('chat:message', (m) => Chat.chegou(m));
  socket.on('chat:deleted', (d) => Chat.apagada(d));

  socket.on('notification:new', (n) => {
    loadBell();
    // sem aviso repetido: nao avisa do chamado que ja esta aberto na tela,
    // nem repete o mesmo titulo em poucos segundos
    if (n.ticket_id && location.hash === `#/tickets/${n.ticket_id}`) return;
    if (n.link && location.hash === n.link) return; // a conversa citada já está aberta
    const chave = `${n.ticket_id || ''}|${n.title}`;
    if (ultimosAvisos.has(chave)) return;
    ultimosAvisos.add(chave);
    setTimeout(() => ultimosAvisos.delete(chave), 5000);
    toast(n.title, 'info');
  });
}
const ultimosAvisos = new Set();

// A pessoa esta escrevendo algo na tela do chamado? (mensagem, modal aberto, campo em foco)
function editandoNaTela(viewEl) {
  if (document.querySelector('.modal.show')) return true;
  const a = document.activeElement;
  if (a && viewEl.contains(a) && /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName) && a.type !== 'file') return true;
  for (const c of viewEl.querySelectorAll('textarea, input[type="text"], input:not([type])')) {
    if (c.value && c.value !== c.defaultValue) return true;
  }
  return false;
}

// Chamado aberto mudou (outra pessoa mexeu). Se ninguem esta digitando, atualiza na hora;
// se esta digitando, mostra um aviso para atualizar quando quiser (nada do que foi digitado se perde).
function atualizarChamadoAberto(id) {
  const viewEl = document.getElementById('view');
  const recarregar = async () => {
    const rascunho = viewEl.querySelector('#msg-content')?.value || '';
    await Views.ticketDetail(id)(viewEl, { silent: true });
    const campo = viewEl.querySelector('#msg-content');
    if (campo && rascunho && !campo.value) campo.value = rascunho;
  };
  if (!editandoNaTela(viewEl)) { recarregar(); return; }
  if (viewEl.querySelector('#aviso-atualizado')) return;
  const aviso = document.createElement('div');
  aviso.id = 'aviso-atualizado';
  aviso.className = 'alert alert-info d-flex align-items-center justify-content-between gap-2 py-2 mb-2 aviso-atualizado';
  aviso.setAttribute('role', 'status');
  aviso.innerHTML = `<span><i class="bi bi-arrow-repeat me-1"></i>Este chamado teve novidades. O que você está escrevendo continua aqui.</span>
    <button type="button" class="btn btn-sm btn-primary">Mostrar novidades</button>`;
  aviso.querySelector('button').onclick = () => { aviso.remove(); recarregar(); };
  viewEl.prepend(aviso);
}

// ---------------- Em atendimento ----------------
// O chamado que o técnico (ou o Administrador Mestre) está atendendo agora. Aparece no menu
// ("Em atendimento #12"), no Painel (card Equipe) e no chamado (botão Atender agora / pausar).
const Atendimento = {
  atualId: null,
  dados: null,
  _quando: 0,
  pode: (u) => !!u && (Roles.isMaster(u) || Roles.can(u, 'ticket.work')),
  async carregar(forcar = false) {
    const u = currentUser();
    if (!this.pode(u)) return null;
    if (!forcar && this.dados && Date.now() - this._quando < 20000) { this.pintarMenu(); return this.dados; }
    try {
      this.dados = await API.get('/tickets/atendimento');
      this._quando = Date.now();
      this.atualId = this.dados.atual ? this.dados.atual.id : null;
    } catch { /* sem rede: mantém o que tinha */ }
    this.pintarMenu();
    return this.dados;
  },
  pintarMenu() {
    const a = document.getElementById('nav-atend');
    if (!a) return;
    const atual = this.dados && this.dados.atual;
    a.classList.toggle('ativo', !!atual);
    a.querySelector('.nav-atend-num').innerHTML = atual ? `<i class="dp-pulso"></i>#${atual.id}` : '';
    a.title = atual ? `Atendendo agora: #${atual.id} ${atual.title}` : 'Nenhum chamado em atendimento — clique para escolher';
  },
  async atender(id) { await API.post(`/tickets/${id}/atender`, {}); await this.carregar(true); },
  async parar() { await API.post('/tickets/atendimento/parar', {}); await this.carregar(true); },
};
window.Atendimento = Atendimento;

Views.atendimento = async function atendimento(el) {
  const u = currentUser();
  if (!Atendimento.pode(u)) { location.hash = '#/mine'; return; }
  const d = await Atendimento.carregar(true);
  if (!d) { el.innerHTML = emptyState('Não foi possível carregar', 'Tente de novo em instantes.', 'bi-exclamation-triangle'); return; }
  const TOM = { 4: 'u-stop', 3: 'u-soon', 2: 'u-slow', 1: 'u-req' };
  const URG = { 4: 'Operação parada', 3: 'Parada iminente', 2: 'Operação prejudicada', 1: 'Requisição' };
  const a = d.atual;
  const precisa = (t) => (t.needed_by ? `precisa até ${fmt.date(String(t.needed_by).slice(0, 10) + 'T12:00:00')}` : '');
  const atrasado = (t) => t.needed_by && String(t.needed_by).slice(0, 10) < CalendarUI.todayIso();
  const outros = d.meus.filter((t) => !a || String(t.id) !== String(a.id));
  const porUrg = [4, 3, 2, 1].map((p) => [p, outros.filter((t) => Number(t.priority) === p)]).filter(([, l]) => l.length);

  el.innerHTML = `
    <div class="at-pagina">
      <div class="card panel-card at-atual ${a ? TOM[a.priority] || 'u-req' : 'vazio'}">
        ${a ? `
          <div class="at-atual-cab"><i class="dp-pulso"></i> Atendendo agora <span class="text-muted">· desde ${esc(fmt.timeAgo(d.desde))}</span></div>
          <div class="at-atual-tit"><span class="at-num">#${a.id}</span> ${esc(a.title)}</div>
          <div class="at-atual-meta">
            <span class="tg tg-gray">${esc(a.impact_name || URG[a.priority] || '')}</span> ${badgeStatus(a.status)}
            ${a.location_name ? `<span><i class="bi bi-geo-alt"></i>${esc(a.location_name)}</span>` : ''}
            ${a.requester_name ? `<span><i class="bi bi-person"></i>${esc(a.requester_name)}</span>` : ''}
            ${precisa(a) ? `<span class="${atrasado(a) ? 'text-danger fw-semibold' : ''}"><i class="bi bi-calendar-event"></i>${precisa(a)}</span>` : ''}
          </div>
          <div class="at-atual-acoes">
            <a class="btn btn-primary btn-sm" href="#/tickets/${a.id}"><i class="bi bi-box-arrow-up-right"></i> Abrir o chamado</a>
            <button class="btn btn-outline-secondary btn-sm" id="at-parar"><i class="bi bi-pause-fill"></i> Pausar</button>
          </div>` : `
          <div class="at-vazio"><i class="bi bi-cup-hot"></i>
            <div><b>Você não está atendendo nenhum chamado agora.</b>
              <div class="small text-muted">Escolha abaixo o que vai atender. A equipe vê no Painel o que cada um está fazendo.</div></div></div>`}
      </div>

      <div class="card panel-card">
        <div class="dp-bloco-cab"><span><i class="bi bi-list-task"></i> ${a ? 'Seus outros chamados' : 'Seus chamados em aberto'}</span>
          <span class="small text-muted">do mais urgente para o menos urgente</span></div>
        ${porUrg.length ? porUrg.map(([p, lista]) => `
          <div class="at-grupo ${TOM[p]}"><i></i>${URG[p]} <b>${lista.length}</b></div>
          ${lista.map((t) => `
            <div class="at-item ${TOM[t.priority] || 'u-req'}">
              <div class="at-item-tx">
                <a href="#/tickets/${t.id}" class="at-item-tit"><span class="at-num">#${t.id}</span> ${esc(t.title)}</a>
                <div class="at-item-meta">${badgeStatus(t.status)}
                  ${t.location_name ? `<span><i class="bi bi-geo-alt"></i>${esc(t.location_name)}</span>` : ''}
                  ${precisa(t) ? `<span class="${atrasado(t) ? 'text-danger fw-semibold' : ''}">${precisa(t)}</span>` : ''}</div>
              </div>
              <button class="btn btn-sm btn-outline-success at-atender" data-id="${t.id}"><i class="bi bi-play-fill"></i> Atender agora</button>
            </div>`).join('')}`).join('')
    : `<div class="dp-vazio">${a ? 'Nenhum outro chamado com você.' : 'Nenhum chamado com você agora. Os chamados atribuídos a você aparecem aqui.'}</div>`}
      </div>
      <p class="small text-muted mt-2"><i class="bi bi-info-circle"></i> Começar a atender um chamado <b>Novo</b> ou <b>Atribuído</b> muda a situação para <b>Em andamento</b>.
        Quando você resolve, fecha ou passa o chamado para outro técnico, ele sai daqui sozinho.</p>
    </div>`;

  el.querySelector('#at-parar')?.addEventListener('click', async () => {
    try { await Atendimento.parar(); toast('Atendimento pausado.', 'info'); Views.atendimento(el); } catch (e) { showError(e); }
  });
  el.querySelectorAll('.at-atender').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await Atendimento.atender(b.dataset.id); toast(`Agora você está atendendo o #${b.dataset.id}.`, 'success'); Views.atendimento(el); }
    catch (e) { b.disabled = false; showError(e); }
  }));
};

// Chamados meus (abertos por mim ou comigo) com notificacao nao lida
let novidades = [];
let novidadeDesde = {}; // { id do chamado: aviso mais antigo não lido }
function pintarNovidades() {
  const n = novidades.length;
  const b = document.querySelector('#nav-mine .nav-bell');
  if (b) {
    b.classList.toggle('d-none', n === 0);
    b.querySelector('b').textContent = n > 99 ? '99+' : String(n);
    b.title = n === 1 ? '1 chamado seu teve novidade' : `${n} chamados seus tiveram novidade`;
  }
  document.querySelectorAll('[data-tk-novidade]').forEach((el) => {
    const tem = novidades.includes(Number(el.dataset.tkNovidade));
    el.classList.toggle('d-none', !tem);
    // o card (ou a linha) fica amarelinho enquanto precisa de atenção
    const caixa = el.closest('.kcard, .ticket-row');
    if (caixa) caixa.classList.toggle('atencao', tem || caixa.dataset.semTecnico === '1');
  });
}
window.temNovidade = (id) => novidades.includes(Number(id));
// precisa de atenção: teve novidade, ou está aberto sem técnico e a pessoa pode assumir ou escolher
window.semTecnicoParaMim = (t) => !t.assigned_user_id && !t.assigned_name && [1, 2, 3, 4].includes(Number(t.status))
  && (Roles.can(API.user || {}, 'ticket.take') || Roles.can(API.user || {}, 'ticket.assign'));
// pedidos com novidade (sininho de "Meus pedidos")
let novidadesPedidos = [];
window.pedidoTemNovidade = (id) => novidadesPedidos.includes(Number(id));
function pintarNovidadesPedidos() {
  const n = novidadesPedidos.length;
  const b = document.querySelector('#nav-pedidos .nav-bell');
  if (b) {
    b.classList.toggle('d-none', n === 0);
    b.querySelector('b').textContent = n > 99 ? '99+' : String(n);
    b.title = n === 1 ? '1 pedido seu teve novidade' : `${n} pedidos seus tiveram novidade`;
  }
  document.querySelectorAll('[data-pd-novidade]').forEach((el) => {
    el.classList.toggle('d-none', !novidadesPedidos.includes(Number(el.dataset.pdNovidade)));
  });
}
window.recarregarSino = () => loadBell();
// o calendário escuta para pôr/tirar o sininho das bolinhas
let novidadesAntes = '';
function avisarNovidades() {
  const k = novidades.slice().sort().join(',');
  if (k === novidadesAntes) return;
  novidadesAntes = k;
  document.dispatchEvent(new CustomEvent('novidades'));
}

async function loadBell() {
  try {
    const data = await API.get('/notifications');
    novidades = (Array.isArray(data.mine_tickets) ? data.mine_tickets : []).map(Number);
    novidadeDesde = data.novidade_desde || {};
    pintarNovidades();
    avisarNovidades();
    const antesPd = novidadesPedidos.slice().sort().join(',');
    novidadesPedidos = (Array.isArray(data.mine_orders) ? data.mine_orders : []).map(Number);
    pintarNovidadesPedidos();
    if (novidadesPedidos.slice().sort().join(',') !== antesPd) document.dispatchEvent(new CustomEvent('novidades-pedidos'));
    const countEl = document.getElementById('notif-count');
    const listEl = document.getElementById('notif-list');
    countEl.classList.toggle('d-none', data.unread === 0);
    countEl.textContent = data.unread > 99 ? '99+' : data.unread;
    listEl.innerHTML = data.list.length
      ? data.list.map((n) => `
        <a class="dropdown-item notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-ticket="${n.ticket_id || ''}" href="${n.link && /^#\/[\w/?=&-]*$/.test(n.link) ? n.link : n.ticket_id ? `#/tickets/${n.ticket_id}` : (String(n.title).includes('Manutenção') ? '#/dashboard' : '#/inventory')}">
          <div class="notif-title">${esc(n.title)}</div>
          <div class="notif-msg">${esc(n.message)}</div>
          <small class="text-muted">${fmt.timeAgo(n.created_at)}</small>
        </a>`).join('')
      : '<div class="px-3 py-3 text-muted small">Nenhuma notificação.</div>';
    // clicar numa notificacao marca como lida so as daquele chamado
    listEl.querySelectorAll('.notif-item').forEach((el) => {
      el.addEventListener('click', () => {
        const tid = el.dataset.ticket ? Number(el.dataset.ticket) : null;
        API.post('/notifications/read', tid ? { ticket_id: tid } : { id: Number(el.dataset.id) })
          .then(loadBell).catch(() => {});
      });
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
    window.CHAT_LIGADO = !!s.chat_enabled;
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
  if (window.CHAT_LIGADO) Chat.carregarBolinha();
  carregarAlertaUrgencia();
  carregarRotasHoje();

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
