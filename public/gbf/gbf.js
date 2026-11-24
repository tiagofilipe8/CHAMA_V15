/* Painel Beija-Flor — front-end (sem dependência do app da Central) */
(() => {
  'use strict';

  // ------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const TZ = 'America/Sao_Paulo';
  const fmtData = (d) => (d ? new Date(d).toLocaleString('pt-BR', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  }) : '—');
  const fmtDia = (d) => (d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d)
    .toLocaleDateString('pt-BR', { timeZone: TZ }) : '—');
  function dur(s) {
    if (s === null || s === undefined) return '—';
    if (s < 60) return '< 1 min';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
    const d = Math.floor(h / 24);
    return `${d} d${h % 24 ? ` ${h % 24} h` : ''}`;
  }
  function relativo(d) {
    const s = Math.round((Date.now() - new Date(d)) / 1000);
    if (s < 60) return 'agora';
    return `há ${dur(s)}`;
  }
  const paraInputLocal = (d) => {
    if (!d) return '';
    const x = new Date(d);
    return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  const deInputLocal = (v) => (v ? new Date(v).toISOString() : null);
  // Prazo de atividade: sem horário = o dia todo
  const prazoTxt = (t) => (!t || !t.due_at ? '—' : `${t.inicio ? `${t.inicio.slice(8, 10)}/${t.inicio.slice(5, 7)} → ` : ''}${t.all_day ? `${fmtDia(t.due_at)} · dia todo` : fmtData(t.due_at)}`);
  const diaDoPrazo = (t) => (t && t.due_at ? new Date(t.due_at).toLocaleDateString('en-CA', { timeZone: TZ }) : '');
  const horaDoPrazo = (t) => (!t || !t.due_at || t.all_day ? ''
    : new Date(t.due_at).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }));
  const iniciais = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sem storage */ } },
  };

  // ---------------------------------------------------------------
  // Siglas explicadas: qualquer sigla conhecida que aparece na tela ganha
  // um sublinhado pontilhado. No computador, passe o mouse; no celular, toque.
  // ---------------------------------------------------------------
  const SIGLAS = {
    NOC: 'Central de Operações: painel que acompanha os chamados em tempo real (do inglês Network Operations Center).',
    SLA: 'Prazo combinado para atender e resolver o chamado (acordo de nível de serviço).',
    TMR: 'Tempo médio de resposta: quanto a equipe demora, em média, para dar a 1ª resposta.',
    TMA: 'Tempo médio de atendimento: quanto demora, em média, para resolver o chamado.',
    OS: 'Ordem de Serviço: o mesmo que chamado.',
    TI: 'Tecnologia da Informação: a equipe que cuida de computadores, rede, internet e sistemas.',
    TAG: 'Etiqueta de patrimônio que identifica cada equipamento.',
    PDV: 'Ponto de Venda: o caixa.',
    IP: 'Endereço do equipamento na rede.',
    MAC: 'Código único da placa de rede do equipamento.',
    CPU: 'Processador do computador.',
    RAM: 'Memória do computador.',
    HD: 'Disco onde ficam os arquivos do computador.',
    SSD: 'Disco rápido onde ficam os arquivos do computador.',
    DNS: 'Serviço que transforma o nome de um site no endereço dele na internet.',
    VPN: 'Conexão segura com a rede da empresa pela internet.',
    UF: 'Estado (sigla, ex.: SP).',
    QR: 'Código QR: aponte a câmera do celular para ler.',
    ID: 'Número que identifica o registro.',
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
          lote.forEach((n) => { if (n.isConnected) marcarSiglas(n); });
          obs.observe(document.body, { childList: true, subtree: true });
        });
      }
    });
    marcarSiglas(document.body);
    obs.observe(document.body, { childList: true, subtree: true });
    // toque no celular: mostra a explicação
    document.addEventListener('click', (ev) => {
      const ab = ev.target.closest && ev.target.closest('abbr.sigla');
      if (ab) aviso(`${ab.textContent}: ${ab.title}`);
    });
  }
  ligarSiglas((msg) => toast(msg));

  // Tema claro/escuro: o mesmo escolhido na Central (guardado no navegador)
  const aplicarTema = () => document.documentElement.setAttribute('data-bs-theme', store.get('tema') === 'dark' ? 'dark' : 'light');
  aplicarTema();
  window.addEventListener('storage', (e) => { if (e.key === 'tema') aplicarTema(); });

  // Modo embutido: aberto dentro da Central (/app.html), com o login e o menu dela
  const EMBED = new URLSearchParams(location.search).get('embed') === '1' && window.parent !== window;
  if (EMBED) document.body.classList.add('embed');
  const avisarCentral = (msg) => { if (EMBED) window.parent.postMessage(msg, location.origin); };

  // Troca o token da Central (mesmo navegador) por um token do painel
  let tentativasPonte = 0;
  async function entrarPelaCentral() {
    tentativasPonte += 1;
    const tokenCentral = store.get('os_token');
    const erro = (msg) => {
      $('#tela-login').classList.add('d-none');
      $('#app').classList.remove('d-none');
      $('#view').innerHTML = `<div class="alert alert-warning m-3">${esc(msg)}</div>`;
      avisarCentral({ gbf: 'sem-acesso', mensagem: msg });
    };
    if (!tokenCentral) { erro('Entre na Central para usar o Dia a dia da TI.'); return; }
    try {
      const res = await fetch('/api/gbf/auth/central', { method: 'POST', headers: { Authorization: `Bearer ${tokenCentral}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { erro(data.error || 'Não foi possível abrir o Dia a dia da TI.'); return; }
      API.token = data.token;
      await entrar(data.user);
    } catch (e) {
      erro(e.message);
    }
  }

  function toast(msg, erro = false) {
    const el = document.createElement('div');
    el.className = `toast-x${erro ? ' err' : ''}`;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // ------------------------------------------------------------------
  // API
  // ------------------------------------------------------------------
  const API = {
    get token() { return store.get('gbf_token'); },
    set token(v) { store.set('gbf_token', v); },
    async req(method, url, body) {
      const opts = { method, headers: {} };
      if (this.token) opts.headers.Authorization = `Bearer ${this.token}`;
      if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      const res = await fetch(`/api/gbf${url}`, opts);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401 && !url.startsWith('/auth/login')) sair(false);
        const e = new Error(data.error || 'Não foi possível concluir.');
        e.status = res.status;
        throw e;
      }
      return data;
    },
    get(u) { return this.req('GET', u); },
    post(u, b) { return this.req('POST', u, b ?? {}); },
    patch(u, b) { return this.req('PATCH', u, b); },
    put(u, b) { return this.req('PUT', u, b); },
  };

  // ------------------------------------------------------------------
  // Rótulos
  // ------------------------------------------------------------------
  const TAG_STATUS_CENTRAL = { 1: 'tag-blue', 2: 'tag-violet', 3: 'tag-teal', 4: 'tag-amber', 5: 'tag-green', 6: 'tag-gray', 7: 'tag-gray' };
  // urgência (mesmas cores da Central): 4 vermelho, 3 laranja, 2 amarelo, 1 azul
  const TAG_PRIO = { 1: 'tag-urg1', 2: 'tag-urg2', 3: 'tag-urg3', 4: 'tag-urg4' };
  const SLA = {
    atrasado: ['tag-red', 'Atrasada'], em_risco: ['tag-amber', 'Vence logo'], no_prazo: ['tag-green', 'No prazo'],
    sem_prazo: ['tag-gray', 'Sem prazo'], cumprido: ['tag-green', 'Prazo cumprido'], estourado: ['tag-red', 'Fora do prazo'],
  };
  const STATUS_TAREFA = {
    a_fazer: ['tag-blue', 'A fazer'], em_andamento: ['tag-teal', 'Em andamento'], aguardando: ['tag-amber', 'Aguardando'],
    concluida: ['tag-green', 'Concluída'], cancelada: ['tag-gray', 'Cancelada'],
  };
  const PRAZO_TAREFA = {
    atrasada: ['tag-red', 'Atrasada'], vence_logo: ['tag-amber', 'Vence em 24 h'], no_prazo: ['tag-green', 'No prazo'],
    sem_prazo: null, cumprido: ['tag-green', 'Feita no prazo'], fora_do_prazo: ['tag-red', 'Feita com atraso'],
  };
  const PRIO_TAREFA = { 1: 'Requisição', 2: 'Operação prejudicada', 3: 'Parada iminente', 4: 'Operação parada' }; // mesma urgência dos chamados (nomes da Orcim)
  const tag = (cls, txt, icon) => `<span class="tag ${cls}">${icon ? `<i class="bi bi-${icon}"></i>` : ''}${esc(txt)}</span>`;
  const tagSla = (s) => tag(...(SLA[s] || SLA.sem_prazo));
  const tagStatus = (d) => tag(TAG_STATUS_CENTRAL[d.status] || 'tag-gray', d.status_label);
  const tagPrio = (d) => tag(TAG_PRIO[d.priority] || 'tag-gray', d.priority_label);
  const tagTarefa = (s) => tag(...(STATUS_TAREFA[s] || ['tag-gray', s]));
  const tagPrazoTarefa = (p) => (PRAZO_TAREFA[p] ? tag(...PRAZO_TAREFA[p]) : '');

  // ------------------------------------------------------------------
  // Sessão
  // ------------------------------------------------------------------
  let EU = null;
  const ehGestor = () => EU?.role === 'gestor';
  // faz visitas: técnico, ou gestor marcado também como técnico (ex.: o Lucas)
  const fazVisitas = () => !!EU && (EU.role !== 'gestor' || !!EU.faz_visitas);

  function mostrarLogin() {
    $('#app').classList.add('d-none');
    $('#tela-login').classList.remove('d-none');
    setTimeout(() => $('#login-user').focus(), 50);
  }

  function sair(avisar = true) {
    if (EMBED) { API.token = null; EU = null; if (tentativasPonte < 3) entrarPelaCentral(); return; }
    API.token = null;
    EU = null;
    pararNotificacoes();
    if (avisar) toast('Você saiu do painel.');
    mostrarLogin();
  }

  $('#form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erro = $('#login-erro');
    erro.classList.add('d-none');
    try {
      const r = await API.post('/auth/login', {
        username: $('#login-user').value, password: $('#login-pass').value,
      });
      API.token = r.token;
      $('#login-pass').value = '';
      await entrar(r.user);
    } catch (e) {
      erro.textContent = e.message;
      erro.classList.remove('d-none');
    }
  });

  async function entrar(user) {
    EU = user;
    $('#tela-login').classList.add('d-none');
    $('#app').classList.remove('d-none');
    $('#side-nome').textContent = EU.name;
    $('#side-papel').textContent = ehGestor() ? (EU.faz_visitas ? 'Gestor e técnico' : 'Gestor') : 'Técnico';
    $('#side-avatar').textContent = iniciais(EU.name);
    montarMenu();
    iniciarNotificacoes();
    render();
  }

  $('#btn-sair').addEventListener('click', () => sair());
  $('#btn-menu').addEventListener('click', () => $('#side').classList.toggle('open'));
  $('#side-backdrop').addEventListener('click', () => $('#side').classList.remove('open'));

  // ------------------------------------------------------------------
  // Menu e rotas
  // ------------------------------------------------------------------
  // Menu lateral. Gestor: Início, (Meu dia se também faz visitas), Visitas, Resultados, Orcim,
  // Configurar. Técnico: Meu dia, Visitas e Orcim. Tutoriais e Minha conta no rodapé.
  // [rota, ícone, nome, contador]
  const SECAO_MENU = { Visitas: 'vis', 'Painel do Gestor - Resultados': 'pg', Orcim: 'orc', Configurar: 'cfg' };
  function montarMenu() {
    const g = ehGestor();
    const itens = [
      ...(g ? [['#/', 'house', 'Início', 'inicio']] : [['#/', 'sun', 'Meu dia', 'meu_dia']]),
      ...(g && fazVisitas() ? [['#/meu-dia', 'sun', 'Meu dia', 'meu_dia']] : []),
      ['grp', 'Visitas'],
      ['#/agenda', 'calendar3', 'Agenda'],
      ['#/solicitacoes', 'megaphone', 'Visitas pedidas', 'visitas_pedidas'],
      ['#/postos', 'geo-alt', 'Postos'],
      ['#/atividades', 'kanban', g ? 'Atividades' : 'Minhas atividades', 'atividades'],
      ...(g ? [['grp', 'Painel do Gestor - Resultados'], ['#/painel', 'graph-up-arrow', 'Painel do gestor']] : []),
      ['grp', 'Orcim'],
      ['#/demandas', 'inboxes', 'Chamados'],
      ['#/orcim', 'speedometer2', 'Visão Orcim'],
      ['#/manutencoes', 'tools', 'Manutenções'],
      ...(g ? [['grp', 'Configurar'], ['#/checklists', 'ui-checks', 'Checklists'], ['#/usuarios', 'people', 'Usuários'],
        ['#/config', 'sliders', 'Configurações'], ['#/tudo', 'database', 'Tudo da Orcim']] : []),
      ['sep'],
      ['#/tutoriais', 'question-circle', 'Tutoriais'],
      ['#/conta', 'person-lock', 'Minha conta'],
    ];
    let sec = 'dia';
    $('#side-nav').innerHTML = '<a class="side-cta" href="#/novo" data-rota="#/novo"><i class="bi bi-plus-lg"></i><span>Novo pedido</span></a>'
      + `<a href="#/notificacoes" data-rota="#/notificacoes" class="sec-dia side-notif" id="side-notif"><i class="bi bi-bell"></i><span>Notificações</span><b class="side-cont urg${naoLidasNotif ? '' : ' d-none'}" id="side-notif-n">${naoLidasNotif > 99 ? '99+' : naoLidasNotif}</b></a>`
      + itens.map((i) => {
        // cada seção do menu tem a sua cor (ícones, título e item ativo)
        if (i[0] === 'grp') { sec = SECAO_MENU[i[1]] || 'dia'; return `<div class="grp sec-${sec}">${esc(i[1])}</div>`; }
        if (i[0] === 'sep') { sec = 'fim'; return '<div class="side-sep"></div>'; }
        return `<a href="${i[0]}" data-rota="${i[0]}" class="sec-${sec}"><i class="bi bi-${i[1]}"></i><span>${esc(i[2])}</span>${i[3] ? `<b class="side-cont d-none" data-cont="${i[3]}"></b>` : ''}</a>`;
      }).join('');
    atualizarContadores();
  }

  // Contadores do menu: o que está esperando a pessoa (atualiza ao trocar de tela e a cada 30 s)
  let contadoresEm = 0;
  async function atualizarContadores(forcar = false) {
    if (!EU || (!forcar && Date.now() - contadoresEm < 5000)) return;
    contadoresEm = Date.now();
    let c;
    try { c = await API.get('/menu/contadores'); } catch { return; }
    const urgente = { inicio: true, atividades: true };
    $$('#side-nav [data-cont]').forEach((el) => {
      const n = Number(c[el.dataset.cont]) || 0;
      el.textContent = n > 99 ? '99+' : String(n);
      el.classList.toggle('d-none', !n);
      el.classList.toggle('urg', !!urgente[el.dataset.cont]);
    });
  }

  function marcarMenu(base) {
    $$('#side-nav a').forEach((a) => a.classList.toggle('active', a.dataset.rota === base));
    $('#side').classList.remove('open');
  }

  function rotaAtual() {
    const h = location.hash.replace(/^#/, '') || '/';
    const [caminho, qs] = h.split('?');
    return { partes: caminho.split('/').filter(Boolean), qs: new URLSearchParams(qs || '') };
  }

  function titulo(t) {
    $('#top-titulo').textContent = t;
    document.title = `${t} · Painel Beija-Flor`;
  }

  const view = () => $('#view');
  const carregando = () => { view().innerHTML = '<div class="loading"><div class="spinner-border spinner-border-sm"></div> Carregando…</div>'; };
  const falha = (e) => { view().innerHTML = `<div class="alert alert-danger">${esc(e.message)}</div>`; };

  let renderSeq = 0;
  // Uma frase pequena no topo de cada tela (e de cada aba do Painel do gestor) dizendo para que ela serve
  const DESC_TELA = {
    inicio: 'O que precisa da sua atenção agora e como está o dia da TI.',
    'meu-dia': 'Suas visitas e atividades de hoje, na ordem do dia.',
    agenda: 'Tudo o que está marcado para a TI: visitas de rotina, visitas pedidas e atividades. Arraste um item para outro dia para reagendar.',
    solicitacoes: 'Visitas pedidas à TI pelos gestores, com data desejada, urgência e tarefas.',
    postos: 'Os postos do grupo, com a próxima visita de rotina e o checklist de cada um.',
    atividades: 'Tarefas da TI. No quadro, arraste o cartão para outra coluna para mudar o status.',
    demandas: 'Chamados abertos na Orcim (cópia da Central).',
    orcim: 'Resumo dos chamados da Orcim.',
    manutencoes: 'Manutenções e equipamentos registrados na Orcim.',
    checklists: 'Modelos de checklist usados nas visitas. Cada posto usa um na visita de rotina.',
    usuarios: 'Quem usa o painel e o papel de cada um: gestor, técnico ou os dois.',
    config: 'Ajustes gerais do painel.',
    tutoriais: 'Passo a passo guiado, separado por assunto: a tela escurece, o lugar certo fica em destaque e um balão explica.',
    conta: 'Seus dados e sua senha.',
    tudo: 'Todas as tabelas copiadas da Orcim, só para consulta.',
    novo: 'Peça uma visita ao posto ou crie uma atividade. Só o essencial: o resto já vem preenchido.',
    notificacoes: 'Tudo o que aconteceu no painel e envolve você ou a equipe: pedidos, mudanças, comentários e reagendamentos.',
  };
  const DESC_PAINEL = {
    calendario: 'Todas as atividades, visitas de rotina, visitas pedidas e chamados da Orcim do mês, nas cores da urgência. Clique num dia para ver a lista.',
    ti: 'O que a TI do Beija-Flor entregou no período: visitas, tarefas verificadas, problemas encontrados e atividades.',
    orcim: 'Chamados da Orcim no período: abertos, resolvidos, tempo de atendimento e prazo.',
    postos: 'Cada posto no período: visitas, problemas encontrados, chamados e atividades em aberto.',
    funcionarios: 'Cada pessoa do time: o que fez no período e o que tem em aberto agora.',
  };
  function descreverTela(a, b, qs) {
    let txt;
    if (a === 'painel') txt = DESC_PAINEL[qs.get('aba') || 'calendario'];
    else if (!b) txt = DESC_TELA[!a ? (ehGestor() ? 'inicio' : 'meu-dia') : a === 'hoje' ? 'meu-dia' : a];
    if (!txt || view().querySelector(':scope > .tela-desc')) return;
    const el = document.createElement('div');
    el.className = 'tela-desc';
    el.textContent = txt;
    const abas = view().querySelector(':scope > .pg-abas');
    if (abas) abas.after(el); else view().prepend(el);
  }

  // Animações: o destaque do filtro/aba desliza do item anterior para o novo, os números contam
  // até o valor e o conteúdo entra suave. Quem pede menos movimento no sistema não vê animação.
  const posFiltro = {}; // última posição do destaque de cada grupo (para deslizar de onde estava)
  let direcaoPeriodo = 0;
  const semMovimento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function animarTela() {
    $$('.pg-seg, .pg-abas', view()).forEach((g) => {
      const chave = `${location.hash.split('?')[0]}|${g.getAttribute('aria-label') || g.className}`;
      g.classList.add('anim');
      let ind = g.querySelector(':scope > .ind');
      if (!ind) { ind = document.createElement('span'); ind.className = 'ind'; g.prepend(ind); }
      const on = g.querySelector('a.on');
      if (!on) { ind.style.opacity = '0'; return; }
      const alvo = { left: on.offsetLeft, width: on.offsetWidth };
      const antes = posFiltro[chave];
      ind.style.transition = 'none';
      Object.assign(ind.style, { opacity: '1', left: `${(antes || alvo).left}px`, width: `${(antes || alvo).width}px` });
      void ind.offsetWidth;
      ind.style.transition = '';
      Object.assign(ind.style, { left: `${alvo.left}px`, width: `${alvo.width}px` });
      posFiltro[chave] = alvo;
      // ao clicar, o destaque já vai para o novo item (a tela troca em seguida)
      g.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => {
        posFiltro[chave] = { left: a.offsetLeft, width: a.offsetWidth };
        Object.assign(ind.style, { left: `${a.offsetLeft}px`, width: `${a.offsetWidth}px` });
        g.querySelectorAll('a.on').forEach((x) => x.classList.remove('on'));
        a.classList.add('on');
      }));
    });
    // setas do período: o nome entra do lado certo
    $$('.pg-seta', view()).forEach((a, i) => a.addEventListener('click', () => { direcaoPeriodo = i === 0 ? -1 : 1; }));
    const nome = $('.pg-nome', view());
    if (nome && direcaoPeriodo) { nome.classList.add(direcaoPeriodo < 0 ? 'entra-esq' : 'entra-dir'); }
    direcaoPeriodo = 0;
    if (semMovimento()) return;
    // números contam até o valor
    $$('[data-conta]', view()).forEach((el) => {
      const fim = Number(el.dataset.conta);
      if (!Number.isFinite(fim) || fim <= 0) return;
      const t0 = performance.now(); const dur = Math.min(900, 380 + fim * 25);
      const passo = (t) => {
        const p = Math.min(1, (t - t0) / dur);
        el.textContent = Math.round(fim * (1 - (1 - p) ** 3));
        if (p < 1) requestAnimationFrame(passo);
      };
      el.textContent = '0';
      requestAnimationFrame(passo);
      setTimeout(() => { el.textContent = fim; }, dur + 150); // garante o valor final (aba em segundo plano)
    });
  }

  async function render() {
    if (!EU) return;
    const seq = ++renderSeq;
    const { partes, qs } = rotaAtual();
    if (EU.must_change_password && partes[0] !== 'conta') {
      toast('Antes de usar o painel, crie sua senha nova aqui em "Minha conta".', true);
      location.hash = '#/conta';
      return;
    }
    const [a, b] = partes;
    if (EMBED) {
      // o que já existe na parte Orcim da Central abre lá (sem telas repetidas)
      const naCentral = {
        demandas: b ? `#/tickets/${encodeURIComponent(b)}` : '#/tickets', orcim: '#/dashboard', tudo: '#/dashboard',
        manutencoes: '#/inventory', usuarios: '#/admin/users', conta: '#/perfil', config: '#/admin/entities',
      }[a];
      // cadastro de posto é único: Administração > Localizações (cria local + usuário do posto)
      if (a === 'postos' && b === 'novo') { avisarCentral({ gbf: 'abrir', hash: '#/admin/locations' }); return; }
      if (naCentral) { avisarCentral({ gbf: 'abrir', hash: naCentral }); return; }
      avisarCentral({ gbf: 'rota', hash: location.hash || '#/' });
    }
    atualizarContadores();
    try {
      carregando();
      if (!a) { marcarMenu('#/'); if (ehGestor()) await vAcompanhamento(qs, seq); else await vHoje(seq); }
      else if (a === 'hoje') { marcarMenu(ehGestor() ? '#/' : '#/'); await vHoje(seq); }
      else if (a === 'meu-dia') { marcarMenu(ehGestor() ? '#/meu-dia' : '#/'); await vHoje(seq, true); }
      else if (a === 'painel' && ehGestor()) { marcarMenu('#/painel'); await vPainelGestor(qs, seq); }
      else if (a === 'calendario' && ehGestor()) { location.replace(`#/painel?aba=calendario${qs.get('mes') ? `&mes=${encodeURIComponent(qs.get('mes'))}` : ''}`); }
      else if (a === 'orcim') { marcarMenu('#/orcim'); await vVisao(seq); }
      else if (a === 'agenda') { marcarMenu('#/agenda'); await vAgenda(qs, seq); }
      else if (a === 'postos' && b === 'novo') { marcarMenu('#/postos'); await vFormPosto(null, seq); }
      else if (a === 'postos' && b && partes[2] === 'editar') { marcarMenu('#/postos'); await vFormPosto(b, seq); }
      else if (a === 'postos' && b) { marcarMenu('#/postos'); await vPosto(b, seq); }
      else if (a === 'postos') { marcarMenu('#/postos'); await vPostos(qs, seq); }
      else if (a === 'visitas' && b) { marcarMenu('#/postos'); await vVisita(b, seq); }
      else if (a === 'checklists' && b) { marcarMenu('#/checklists'); await vFormChecklist(b === 'novo' ? null : b, seq); }
      else if (a === 'checklists') { marcarMenu('#/checklists'); await vChecklists(seq); }
      else if (a === 'novo') { marcarMenu('#/novo'); await vNovoPedido(qs, seq); }
      else if (a === 'notificacoes') { marcarMenu('#/notificacoes'); await vNotificacoes(qs, seq); }
      else if (a === 'solicitacoes' && b === 'nova' && ehGestor()) { marcarMenu('#/solicitacoes'); await vFormSolicitacao(null, qs, seq); }
      else if (a === 'solicitacoes' && b && partes[2] === 'editar' && ehGestor()) { marcarMenu('#/solicitacoes'); await vFormSolicitacao(b, qs, seq); }
      else if (a === 'solicitacoes' && b) { marcarMenu('#/solicitacoes'); await vSolicitacao(b, seq); }
      else if (a === 'solicitacoes') { marcarMenu('#/solicitacoes'); await vSolicitacoes(qs, seq); }
      else if (a === 'demandas' && b) { marcarMenu('#/demandas'); await vDemanda(b, seq); }
      else if (a === 'demandas') { marcarMenu('#/demandas'); await vDemandas(qs, seq); }
      else if (a === 'tudo' && ehGestor() && b && partes[2] !== undefined) { marcarMenu('#/tudo'); await vEspelhoRegistro(decodeURIComponent(b), decodeURIComponent(partes.slice(2).join('/')), seq); }
      else if (a === 'tudo' && ehGestor() && b) { marcarMenu('#/tudo'); await vEspelhoTabela(decodeURIComponent(b), qs, seq); }
      else if (a === 'tudo' && ehGestor()) { marcarMenu('#/tudo'); await vEspelho(seq); }
      else if (a === 'manutencoes') { marcarMenu('#/manutencoes'); await vManutencoes(seq); }
      else if (a === 'atividades' && b === 'nova') { marcarMenu('#/atividades'); await vFormAtividade(null, qs, seq); }
      else if (a === 'atividades' && b && partes[2] === 'editar') { marcarMenu('#/atividades'); await vFormAtividade(b, qs, seq); }
      else if (a === 'atividades' && b) { marcarMenu('#/atividades'); await vAtividade(b, seq); }
      else if (a === 'atividades') { marcarMenu('#/atividades'); await vAtividades(qs, seq); }
      else if (a === 'usuarios' && ehGestor()) { marcarMenu('#/usuarios'); await vUsuarios(seq); }
      else if (a === 'config' && ehGestor()) { marcarMenu('#/config'); await vConfig(seq); }
      else if (a === 'tutoriais') { marcarMenu('#/tutoriais'); await vTutoriais(seq); }
      else if (a === 'conta') { marcarMenu('#/conta'); vConta(); }
      else { location.hash = '#/'; }
      if (seq === renderSeq) { descreverTela(a, b, qs); animarTela(); }
    } catch (e) {
      if (!e.status) console.error(e);
      if (seq === renderSeq && e.status !== 401) falha(e);
    }
  }
  window.addEventListener('hashchange', render);

  // ------------------------------------------------------------------
  // Componentes
  // ------------------------------------------------------------------
  function barras(lista, { max = 8, vazio = 'Nada por aqui.' } = {}) {
    if (!lista?.length) return `<div class="small-muted">${esc(vazio)}</div>`;
    const top = lista.slice(0, max);
    const maior = Math.max(...top.map((x) => x.total), 1);
    return `<div class="lista-num">${top.map((x, i) => `
      <div class="ln-row"><span class="ln-pos">${i + 1}</span><span class="ln-nome" title="${esc(x.nome)}">${esc(x.nome)}</span>
        <span class="ln-v">${x.total}</span></div>`).join('')}</div>`;
  }

  function tendencia(serie) {
    if (!serie?.length) return '';
    return graficoLinhas(serie.map((p) => ({ periodo: p.dia, abertas: p.abertas, resolvidas: p.resolvidas })),
      [{ campo: 'abertas', nome: 'Abertas', cor: '#94a3b8' }, { campo: 'resolvidas', nome: 'Resolvidas', cor: '#0f766e' }],
      { escala: 'dia', altura: 200, largura: 640 });
  }

  function kpi(lbl, val, { cls = '', hint = '', href = '', icon = '' } = {}) {
    const inner = `<div class="lbl">${icon ? `<i class="bi bi-${icon}"></i>` : ''}${esc(lbl)}</div>
      <div class="val">${esc(val)}</div>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}`;
    return href ? `<a class="kpi ${cls}" href="${href}">${inner}</a>` : `<div class="kpi ${cls}">${inner}</div>`;
  }

  const vazio = (txt, icon = 'inbox') => `<div class="empty"><i class="bi bi-${icon}"></i>${esc(txt)}</div>`;

  // ------------------------------------------------------------------
  // Painel do gestor (Orcim + TI do grupo, com filtro de datas e PDF)
  // ------------------------------------------------------------------
  const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const isoSoma = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
  const fmtIso = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
  const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  function presetsPeriodo() {
    const h = hojeSP();
    const ini = `${h.slice(0, 7)}-01`;
    const fimMesPassado = isoSoma(ini, -1);
    return [
      ['7d', 'Últimos 7 dias', isoSoma(h, -6), h],
      ['30d', 'Últimos 30 dias', isoSoma(h, -29), h],
      ['mes', 'Este mês', ini, h],
      ['mes-ant', 'Mês passado', `${fimMesPassado.slice(0, 7)}-01`, fimMesPassado],
      ['ano', 'Este ano', `${h.slice(0, 4)}-01-01`, h],
    ];
  }

  function rotuloBalde(iso, escala) {
    if (escala === 'hora') return `${iso.slice(11, 13)}h`;
    if (escala === 'mes') return `${MESES_CURTOS[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;
    if (escala === 'semana') return `sem. ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
    return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  }

  const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const nomeEscala = (e) => ({ hora: 'por hora', dia: 'por dia', semana: 'por semana', mes: 'por mês' }[e] || 'por período');

  // Colunas por período (agrupadas ou empilhadas). Devolve SVG puro (serve na tela e no PDF).
  // Escala "redonda" (1, 2, 5, 10...), colunas com cantos arredondados, valor em cima quando cabe
  // e grade tracejada. As classes g-* deixam as cores certas no tema escuro (no PDF valem as cores fixas).
  function escalaRedonda(v) {
    if (v <= 4) return Math.max(1, v);
    const p = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }
  // Gráfico de linha (o único tipo de gráfico do site). SVG puro: serve na tela e no PDF.
  // Uma linha por série, pontos com o valor ao passar o mouse, grade tracejada e escala redonda.
  function graficoLinhas(serie, series, { escala = 'dia', altura = 220, largura = 520 } = {}) {
    if (!serie?.length) return '<div class="g-vazio">Sem dados no período.</div>';
    const valores = serie.flatMap((p) => series.map((c) => p[c.campo] || 0));
    if (!valores.some(Boolean)) return '<div class="g-vazio"><i class="bi bi-graph-up"></i> Nada no período.</div>';
    const W = largura; const H = altura; const esq = 30; const dir = 14; const topo = 16; const base = H - 26;
    const n = serie.length;
    const max = escalaRedonda(Math.max(...valores));
    const x = (i) => (n === 1 ? (esq + W - dir) / 2 : esq + (i * (W - esq - dir)) / (n - 1));
    const y = (v) => base - (v / max) * (base - topo);
    const marcas = max <= 4 ? Array.from({ length: max + 1 }, (_, k) => k) : [0, max / 2, max];
    const grade = marcas.map((v) => `<line class="g-l" x1="${esq}" x2="${W - dir}" y1="${y(v)}" y2="${y(v)}" stroke="#e2e8f0" ${v ? 'stroke-dasharray="3 4"' : ''}/>
        <text class="g-t" x="${esq - 7}" y="${y(v) + 4}" text-anchor="end" font-size="10.5" fill="#64748b">${v}</text>`).join('');
    const pontos = n <= 14; // com muitos pontos, só a bolinha do último (o resto fica no traço)
    const linhas = series.map((c, j) => {
      const pts = serie.map((p, i) => [x(i), y(p[c.campo] || 0)]);
      const d = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
      const area = series.length === 1 ? `<path d="${d} L${pts[pts.length - 1][0].toFixed(1)} ${base} L${pts[0][0].toFixed(1)} ${base} Z" fill="${c.cor}" fill-opacity=".10"/>` : '';
      const bolinhas = serie.map((p, i) => {
        const v = p[c.campo] || 0;
        const dica = `${rotuloBalde(p.periodo, escala)}: ${v} ${c.nome.toLowerCase()}`;
        const ultimo = i === n - 1;
        return (pontos || ultimo) ? `<circle class="g-p" cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="${ultimo ? 4 : 3}" fill="${ultimo ? c.cor : '#fff'}" stroke="${c.cor}" stroke-width="2"><title>${esc(dica)}</title></circle>` : '';
      }).join('');
      return `${area}<path class="g-linha" pathLength="1" d="${d}" fill="none" stroke="${c.cor}" stroke-width="${j === 0 ? 2.6 : 2.2}" stroke-linejoin="round" stroke-linecap="round"/>${bolinhas}`;
    }).join('');
    const passo = Math.max(1, Math.ceil(n / (largura >= 800 ? 12 : 7)));
    const rotulos = serie.map((p, i) => (((i % passo === 0 && n - 1 - i >= passo / 2) || i === n - 1)
      ? `<text class="g-t" x="${x(i)}" y="${H - 7}" text-anchor="${n > 1 && i === n - 1 ? 'end' : n > 1 && i === 0 ? 'start' : 'middle'}" font-size="11" fill="#64748b">${esc(rotuloBalde(p.periodo, escala))}</text>` : '')).join('');
    const legenda = series.map((c) => `<span><i style="background:${c.cor}"></i>${esc(c.nome)}</span>`).join('');
    return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((c) => c.nome).join(' e '))} ${esc(nomeEscala(escala))}" style="width:100%;height:auto">
      ${grade}${linhas}${rotulos}</svg><div class="legend">${legenda}</div>`;
  }

  // Ranking em tabela (para o PDF)
  function graficoBarrasSvg(lista, { max = 8 } = {}) {
    if (!lista?.length) return '<p class="muted">Nada no período.</p>';
    return `<table><tbody>${lista.slice(0, max).map((x) => `<tr><td>${esc(x.nome)}</td><td class="num">${x.total}</td></tr>`).join('')}</tbody></table>`;
  }

  function medidor(valor, rotulo) {
    const r = 44; const c = 2 * Math.PI * r;
    const v = valor === null || valor === undefined ? null : Math.max(0, Math.min(100, valor));
    const cor = v === null ? '#cbd5e1' : v >= 85 ? '#0f766e' : v >= 60 ? '#d97706' : '#dc2626';
    return `<svg viewBox="0 0 120 120" style="width:120px;height:120px" role="img" aria-label="${esc(rotulo)}: ${pct(v)}">
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="12"/>
      ${v === null ? '' : `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${cor}" stroke-width="12" stroke-linecap="round"
        stroke-dasharray="${(v / 100) * c} ${c}" transform="rotate(-90 60 60)"/>`}
      <text x="60" y="66" text-anchor="middle" font-size="22" font-weight="700" fill="#0f172a">${pct(v)}</text></svg>`;
  }

  const CORES_ORCIM = [
    { campo: 'criadas', nome: 'Abertas', cor: '#94a3b8' },
    { campo: 'resolvidas', nome: 'Resolvidas', cor: '#0f766e' },
  ];
  const CORES_TI = [
    { campo: 'visitas', nome: 'Visitas', cor: '#0f766e' },
    { campo: 'atividades', nome: 'Atividades', cor: '#6366f1' },
    { campo: 'solicitacoes', nome: 'Pedidos de visita', cor: '#f59e0b' },
  ];
  // (as cores acima valem para a tela e para o PDF)

  // Texto do relatório, escrito a partir dos números do período
  function textoRelatorio(d) {
    const o = d.orcim.kpis; const t = d.ti.kpis; const per = d.periodo;
    const par = [];
    par.push(`Período analisado: de ${fmtIso(per.de)} a ${fmtIso(per.ate)} (${plural(per.dias, 'dia', 'dias')}).`);

    // Orcim
    let s = `No período, a Orcim recebeu ${plural(o.criadas, 'chamado', 'chamados')} e resolveu ${o.resolvidas}.`;
    if (o.prazo_base) {
      s += ` Dos resolvidos com prazo definido (${o.prazo_base}), ${o.prazo_cumprido_pct}% foram resolvidos dentro do prazo`;
      s += o.fora_do_prazo ? ` e ${plural(o.fora_do_prazo, 'ficou', 'ficaram')} fora do prazo.` : '.';
    } else if (o.resolvidas) {
      s += ' Nenhum dos resolvidos tinha prazo definido, então não há como medir o cumprimento de prazo.';
    }
    par.push(s);
    if (o.tempo_medio_resolucao !== null) {
      par.push(`O tempo médio até resolver foi de ${dur(o.tempo_medio_resolucao)} (mediana de ${dur(o.tempo_mediano_resolucao)})`
        + `${o.tempo_medio_primeira_resposta !== null ? `, e a primeira resposta levou em média ${dur(o.tempo_medio_primeira_resposta)}` : ''}.`);
    }
    const cat = d.orcim.por_categoria[0]; const tec = d.orcim.por_tecnico[0];
    if (cat && cat.nome !== '—') par.push(`A categoria com mais chamados abertos no período foi ${cat.nome} (${cat.total}).`);
    if (tec && tec.nome !== 'Sem técnico') par.push(`Quem mais resolveu chamados pela Orcim foi ${tec.nome} (${tec.total}, média de ${dur(tec.tempo_medio)} por chamado).`);
    par.push(`Na data deste relatório, há ${plural(o.abertas_agora, 'chamado', 'chamados')} em aberto`
      + `${o.atrasadas_agora ? `, ${plural(o.atrasadas_agora, 'atrasado', 'atrasados')}` : ', nenhum atrasado'}`
      + `${o.sem_tecnico_agora ? ` e ${plural(o.sem_tecnico_agora, 'sem técnico', 'sem técnico')} da Orcim` : ''}.`);

    // TI do grupo
    s = `A TI do grupo concluiu ${plural(t.visitas, 'visita', 'visitas')}, ${plural(t.atividades, 'atividade', 'atividades')}`
      + `${t.atividades_com_atraso ? ` (${t.atividades_com_atraso} com atraso)` : ''}`
      + ` e atendeu ${plural(t.solicitacoes, 'solicitação', 'solicitações')}`
      + `${t.tempo_medio_solicitacao !== null ? `, com tempo médio de atendimento de ${dur(t.tempo_medio_solicitacao)}` : ''}.`;
    par.push(s);
    if (t.solicitacoes_recebidas) par.push(`Foram recebidas ${plural(t.solicitacoes_recebidas, 'solicitação', 'solicitações')} do gestor no período.`);
    par.push(t.nao_ok
      ? `Nas visitas do período, ${plural(t.nao_ok, 'item de checklist ficou', 'itens de checklist ficaram')} como NÃO OK.`
      : (t.visitas ? 'Em todas as visitas do período, o checklist ficou sem itens NÃO OK.' : ''));
    const pessoas = d.ti.por_pessoa;
    if (pessoas.length) {
      par.push(`Por pessoa: ${pessoas.map((p) => `${p.nome} — ${plural(p.visitas, 'visita', 'visitas')}, ${plural(p.atividades, 'atividade', 'atividades')}, ${plural(p.solicitacoes, 'solicitação', 'solicitações')}`).join('; ')}.`);
    }
    par.push(`Na data deste relatório, há ${plural(t.postos_atrasados_agora, 'posto com visita atrasada', 'postos com visita atrasada')}, `
      + `${plural(t.atividades_atrasadas_agora, 'atividade atrasada', 'atividades atrasadas')} e `
      + `${plural(t.solicitacoes_abertas_agora, 'solicitação em aberto', 'solicitações em aberto')}.`);
    return par.filter(Boolean);
  }

  function listaAtencao(d, { paraPdf = false } = {}) {
    const itens = [];
    d.orcim.atrasadas.forEach((x) => itens.push({
      tipo: 'Chamado atrasado', texto: `${x.number || '#' + x.id} — ${x.title}`,
      detalhe: `${x.assigned_name ? x.assigned_name : 'sem técnico'} · prazo ${fmtData(x.due_at)}`,
      link: `#/demandas/${x.id}`,
    }));
    d.ti.postos_atrasados.forEach((x) => itens.push({
      tipo: 'Visita atrasada', texto: x.name, detalhe: `prevista para ${fmtDia(x.data)} · ${plural(x.dias_atraso, 'dia', 'dias')} de atraso`,
      link: `#/postos/${x.id}`,
    }));
    d.ti.solicitacoes_paradas.forEach((x) => itens.push({
      tipo: 'Solicitação parada', texto: x.title, detalhe: `${x.local ? `${x.local} · ` : ''}aberta em ${fmtData(x.created_at)}`,
      link: `#/solicitacoes/${x.id}`,
    }));
    d.ti.nao_ok.slice(0, 15).forEach((x) => itens.push({
      tipo: 'Item NÃO OK', texto: `${x.local}: ${x.item_label}`, detalhe: `${fmtData(x.finished_at)}${x.note ? ` · ${x.note}` : ''}`,
      link: `#/visitas/${x.visit_id}`,
    }));
    if (!itens.length) return paraPdf ? '<p>Nada pendente.</p>' : vazio('Nada precisando de atenção. 👏', 'emoji-smile');
    if (paraPdf) {
      return `<table><thead><tr><th>Tipo</th><th>O quê</th><th>Detalhe</th></tr></thead><tbody>${itens.map((i) => `
        <tr><td>${esc(i.tipo)}</td><td>${esc(i.texto)}</td><td>${esc(i.detalhe)}</td></tr>`).join('')}</tbody></table>`;
    }
    return `<div class="table-wrap"><table class="table-x"><tbody>${itens.map((i) => `
      <tr class="click" data-href="${i.link}"><td class="text-nowrap">${tag(i.tipo === 'Item NÃO OK' || i.tipo === 'Solicitação parada' ? 'tag-amber' : 'tag-red', i.tipo)}</td>
        <td><div class="fw-semibold">${esc(i.texto)}</div><div class="small-muted">${esc(i.detalhe)}</div></td></tr>`).join('')}
      </tbody></table></div>`;
  }

  let ultimoPainel = null;

  // Painel do gestor: abas compactas. TI do Beija-Flor usa os dados do Painel; Orcim, Por posto e
  // Calendário usam os dados da Orcim (hoje pela cópia da Central; depois pela API da Orcim).
  // Números pequenos numa faixa no topo, listas com barrinha e tabelas; nada de cartão grande.
  const ABAS_PAINEL = [['calendario', 'Calendário'], ['ti', 'TI do Beija-Flor'], ['orcim', 'Orcim'], ['postos', 'Por posto'], ['funcionarios', 'Por funcionário']];

  // variação contra o período anterior: "+6", "−4h"; verde quando melhorou
  function variacao(atual, antes, { menorMelhor = false, tempo = false, pp = false } = {}) {
    if (atual === null || atual === undefined || antes === null || antes === undefined) return '';
    const dif = atual - antes;
    if (!dif) return '';
    const bom = menorMelhor ? dif < 0 : dif > 0;
    const txt = tempo ? dur(Math.abs(dif)) : pp ? `${Math.abs(dif)} pp` : Math.abs(dif);
    return `<span class="pg-var ${bom ? 'bom' : 'ruim'}" title="período anterior: ${tempo ? dur(antes) : antes}${pp ? '%' : ''}">${dif > 0 ? '+' : '−'}${txt}</span>`;
  }
  const faixa = (itens) => `<div class="pg-faixa">${itens.map((i) => `<div${i.href ? ` data-href="${i.href}" class="clicavel"` : ''}>
    <span class="l">${esc(i.l)}</span><b${typeof i.v === 'number' ? ` data-conta="${i.v}"` : ''}>${esc(i.v ?? '—')}</b> ${i.var || ''}${i.sub ? ` <span class="s">${esc(i.sub)}</span>` : ''}</div>`).join('')}</div>`;
  function listaBarras(lista, { valor = (x) => x.total, texto = (x) => x.total, cor = '', vazio = 'Nada no período.', max = 6, link = null } = {}) {
    const itens = (lista || []).filter((x) => valor(x)).slice(0, max);
    if (!itens.length) return `<div class="small-muted py-1">${esc(vazio)}</div>`;
    const topo = Math.max(...itens.map(valor));
    return `<div class="lista-num">${itens.map((x, i) => `<div class="ln-row"${link ? ` data-href="${link(x)}"` : ''}>
      <span class="ln-pos"${cor ? ` style="background:${typeof cor === 'function' ? (cor(x) || 'var(--brand)') : cor};color:#fff"` : ''}>${i + 1}</span>
      <span class="ln-nome" title="${esc(x.nome)}">${esc(x.nome)}</span><span class="ln-v">${esc(texto(x))}</span></div>`).join('')}</div>`;
  }
  const blocoPg = (titulo, corpo, nota = '') => `<section class="pg-bloco"><h3>${esc(titulo)}${nota ? `<span>${nota}</span>` : ''}</h3>${corpo}</section>`;
  const cartaoGrafico = (titulo, corpo, nota = '') => `<section class="pg-bloco pg-card"><h3>${esc(titulo)}${nota ? `<span>${nota}</span>` : ''}</h3>${corpo}</section>`;
  const emBreveApi = '<span class="pg-api">API Orcim</span>';
  const pctTxt = (v) => (v === null || v === undefined ? '—' : `${v}%`);

  // Período do painel: Dia, Semana, Mês, Ano (com setas para voltar/avançar) ou Personalizado.
  // Os gráficos agrupam por hora (Dia), por dia (Semana e Mês) ou por mês (Ano).
  const TIPOS_PERIODO = [['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês'], ['ano', 'Ano'], ['livre', 'Personalizado']];
  const isoMes = (iso, n) => { // soma n meses mantendo o dia 1
    const [a, m] = iso.split('-').map(Number);
    const x = new Date(Date.UTC(a, m - 1 + n, 1));
    return x.toISOString().slice(0, 10);
  };
  const fimDoMes = (iso) => isoSoma(isoMes(`${iso.slice(0, 7)}-01`, 1), -1);
  function periodoPainel(tipo, ref) {
    if (tipo === 'dia') return { de: ref, ate: ref, escala: 'hora' };
    if (tipo === 'semana') {
      const dow = new Date(`${ref}T12:00:00Z`).getUTCDay();
      const seg = isoSoma(ref, -dow); // semana de domingo a sábado
      return { de: seg, ate: isoSoma(seg, 6), escala: 'dia' };
    }
    if (tipo === 'ano') return { de: `${ref.slice(0, 4)}-01-01`, ate: `${ref.slice(0, 4)}-12-31`, escala: 'mes' };
    return { de: `${ref.slice(0, 7)}-01`, ate: fimDoMes(ref), escala: 'dia' }; // mês
  }
  function moverPeriodo(tipo, ref, n) {
    if (tipo === 'dia') return isoSoma(ref, n);
    if (tipo === 'semana') return isoSoma(ref, 7 * n);
    if (tipo === 'ano') return `${Number(ref.slice(0, 4)) + n}${ref.slice(4, 10)}`;
    return isoMes(`${ref.slice(0, 7)}-01`, n);
  }
  function nomePeriodo(tipo, de, ate) {
    if (tipo === 'dia') {
      const t = new Date(`${de}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
    if (tipo === 'semana') return `${de.slice(8, 10)}/${de.slice(5, 7)} a ${fmtIso(ate)}`;
    if (tipo === 'mes') { const m = MESES_CAL[Number(de.slice(5, 7)) - 1]; return `${m.charAt(0).toUpperCase() + m.slice(1)} de ${de.slice(0, 4)}`; }
    if (tipo === 'ano') return de.slice(0, 4);
    return `${fmtIso(de)} a ${fmtIso(ate)}`;
  }

  async function vPainelGestor(qs, seq) {
    titulo('Painel do gestor');
    let aba = qs.get('aba') || 'calendario'; // abre sempre no Calendário
    if (!ABAS_PAINEL.some(([k]) => k === aba)) aba = 'ti';
    let salvo = {};
    try { salvo = JSON.parse(store.get('gbf_painel_filtro') || '{}'); } catch { /* padrão */ }
    let tipo = qs.get('per') || salvo.per || 'mes';
    if (!TIPOS_PERIODO.some(([k]) => k === tipo)) tipo = 'mes';
    const ref = /^\d{4}-\d{2}-\d{2}$/.test(qs.get('ref') || '') ? qs.get('ref') : (salvo.per === tipo && salvo.ref ? salvo.ref : hojeSP());
    let per;
    if (tipo === 'livre') {
      const de0 = qs.get('de') || salvo.de || isoSoma(hojeSP(), -29);
      const ate0 = qs.get('ate') || salvo.ate || hojeSP();
      per = { de: de0 <= ate0 ? de0 : ate0, ate: de0 <= ate0 ? ate0 : de0, escala: '' };
    } else per = periodoPainel(tipo, ref);
    const url = (x) => `#/painel?${new URLSearchParams({ aba, per: tipo, ...(tipo === 'livre' ? { de: per.de, ate: per.ate } : { ref }), ...x })}`;
    const abasHtml = () => `<nav class="pg-abas" aria-label="Abas do painel">${ABAS_PAINEL.map(([k, nome]) => `<a href="${url({ aba: k })}" class="${k === aba ? 'on' : ''}">${nome}</a>`).join('')}</nav>`;
    // Calendário geral: todas as atividades, visitas e pedidos do mês (sem o filtro de período)
    if (aba === 'calendario') { await vCalendarioPainel(qs, seq, abasHtml(), url({ aba: 'calendario' })); return; }

    const d = await API.get(`/painel-gestor?${new URLSearchParams({ de: per.de, ate: per.ate, escala: per.escala })}`);
    if (seq !== renderSeq) return;
    ultimoPainel = d;
    store.set('gbf_painel_filtro', JSON.stringify({ per: tipo, ref, de: per.de, ate: per.ate }));
    const contemHoje = per.de <= hojeSP() && hojeSP() <= per.ate;

    const conteudo = { ti: abaTi, orcim: abaOrcim, postos: abaPostos, funcionarios: abaFuncionarios }[aba](d);
    view().innerHTML = `
      ${abasHtml()}
      <div class="pg-filtro">
        <div class="pg-seg" role="group" aria-label="Ver por">
          ${TIPOS_PERIODO.map(([k, nome]) => `<a class="${k === tipo ? 'on' : ''}" aria-current="${k === tipo}" href="${url({ per: k, ...(k === 'livre' ? { de: per.de, ate: per.ate } : { ref: tipo === 'livre' ? hojeSP() : ref }) })}">${nome}</a>`).join('')}
        </div>
        ${tipo === 'livre' ? `
          <div class="pg-livre">
            <label class="small-muted d-flex align-items-center gap-1">De <input type="date" class="form-control form-control-sm" id="pg-de" value="${esc(per.de)}"></label>
            <label class="small-muted d-flex align-items-center gap-1">Até <input type="date" class="form-control form-control-sm" id="pg-ate" value="${esc(per.ate)}"></label>
            <button class="btn btn-sm btn-brand" id="pg-aplicar">Aplicar</button>
          </div>` : `
          <div class="pg-nav">
            <a class="pg-seta" href="${url({ ref: moverPeriodo(tipo, ref, -1) })}" aria-label="Período anterior"><i class="bi bi-chevron-left"></i></a>
            <strong class="pg-nome">${esc(nomePeriodo(tipo, per.de, per.ate))}</strong>
            <a class="pg-seta" href="${url({ ref: moverPeriodo(tipo, ref, 1) })}" aria-label="Próximo período"><i class="bi bi-chevron-right"></i></a>
            ${contemHoje ? '' : `<a class="pg-hoje" href="${url({ ref: hojeSP() })}">Hoje</a>`}
          </div>`}
        <button class="btn btn-sm btn-outline-secondary pg-pdf" id="pg-pdf"><i class="bi bi-file-earmark-pdf"></i> PDF</button>
      </div>
      <div class="pg-compara">Gráficos ${nomeEscala(d.periodo.escala)} · números comparados com ${fmtIso(d.periodo.anterior.de)} a ${fmtIso(d.periodo.anterior.ate)} · "agora" é a situação neste momento</div>
      <div id="pg-conteudo">${conteudo}</div>`;

    $('#pg-aplicar')?.addEventListener('click', () => {
      const a = $('#pg-de').value; const b = $('#pg-ate').value;
      if (!a || !b) { toast('Escolha as duas datas.', true); return; }
      location.hash = url({ per: 'livre', de: a, ate: b });
    });
    $('#pg-pdf').addEventListener('click', () => exportarPdf(ultimoPainel));
    ligarCliques();
  }

  // Cartão da aba TI: cor da série no gráfico, o número principal e os detalhes
  function cartaoTi({ cor, ic, titulo, explica, href, principal, outros }) {
    const num = (v) => (typeof v === 'number' ? `<b data-conta="${v}">${v}</b>` : `<b>${esc(v ?? '—')}</b>`);
    return `<a class="ti-card" href="${href}" style="--cor:${cor}">
      <div class="ti-cab"><span class="ti-ic"><i class="bi bi-${ic}"></i></span><b>${esc(titulo)}</b><i class="bi bi-arrow-right ti-ir"></i></div>
      <div class="ti-expl">${esc(explica)}</div>
      <div class="ti-prin">${num(principal.n)}<span>${esc(principal.rot)}</span>${principal.var || ''}</div>
      <div class="ti-outros">${outros.map(([v, r, cls]) => `<div class="${cls || ''}">${num(v)}<span>${esc(r)}</span></div>`).join('')}</div>
    </a>`;
  }
  function abaTi(d) {
    const k = d.ti.kpis; const a = d.ti.anterior || {}; const pr = d.ti.planejado_reativo;
    return `
      <div class="ti-tres">
        ${cartaoTi({ cor: '#0f766e', ic: 'geo-alt', titulo: 'Visitas', explica: 'Idas aos postos concluídas no período (rotina e pedidas).', href: '#/agenda',
    principal: { n: k.visitas, rot: 'visitas feitas', var: variacao(k.visitas, a.visitas) },
    outros: [[k.postos_visitados, 'postos visitados'], [k.tarefas_verificadas, 'tarefas verificadas'], [k.tarefas_problema, 'com problema', k.tarefas_problema ? 'ruim' : '']] })}
        ${cartaoTi({ cor: '#6366f1', ic: 'check2-square', titulo: 'Atividades', explica: 'Tarefas do quadro de Atividades (não precisam de ida ao posto).', href: '#/atividades',
    principal: { n: k.atividades, rot: 'concluídas', var: variacao(k.atividades, a.atividades) },
    outros: [[pctTxt(k.no_prazo_pct), 'no prazo'], [k.atividades_abertas_agora, 'em aberto agora'], [k.atividades_atrasadas_agora, 'atrasadas agora', k.atividades_atrasadas_agora ? 'ruim' : '']] })}
        ${cartaoTi({ cor: '#f59e0b', ic: 'megaphone', titulo: 'Pedidos de visita', explica: 'Visitas pedidas pelos gestores pelo Novo pedido (antes "solicitações").', href: '#/solicitacoes?situacao=todas',
    principal: { n: k.visitas_pedidas_feitas, rot: `de ${k.visitas_pedidas} atendidos` },
    outros: [[pctTxt(k.visitas_pedidas_no_prazo_pct), 'na data pedida'], [k.visitas_pedidas_atrasadas_agora, 'atrasados agora', k.visitas_pedidas_atrasadas_agora ? 'ruim' : '']] })}
      </div>
      <div class="pg-duas">
        ${cartaoGrafico('Entregas da TI: visitas, atividades e pedidos', graficoLinhas(d.ti.serie, CORES_TI, { escala: d.periodo.escala }), nomeEscala(d.periodo.escala))}
        ${cartaoGrafico('Itens com problema nas visitas', graficoLinhas(d.ti.serie, [{ campo: 'nao_ok', nome: 'Itens NÃO OK', cor: '#ef4444' }], { escala: d.periodo.escala }), nomeEscala(d.periodo.escala))}
      </div>
      ${blocoPg('Problemas encontrados nas visitas', d.ti.nao_ok.length ? d.ti.nao_ok.slice(0, 12).map((n) => `<div class="pg-prob" data-href="#/visitas/${n.visit_id}">
          <span class="pg-prob-t"><b>${esc(n.item_label)}</b> — ${esc(n.local)}</span>
          <span class="small-muted text-nowrap">${fmtDia(n.finished_at)}</span>
          ${n.note ? `<span class="pg-prob-n">${esc(n.note)}</span>` : ''}</div>`).join('')
    : '<div class="small-muted py-1">Nenhum problema encontrado nas visitas do período.</div>', 'com o comentário deixado na visita')}
      <div class="pg-duas">
        ${blocoPg('Tarefas que mais dão problema', listaBarras(d.ti.nao_ok_por_item, { vazio: 'Nenhum item NÃO OK no período.' }), 'vezes NÃO OK')}
        ${blocoPg('Planejado × reativo', listaBarras([
    { nome: 'Planejado (rotina e atividades)', total: pr.planejado },
    { nome: 'Reativo (visitas pedidas)', total: pr.reativo },
  ], { vazio: 'Nada entregue no período.' }), pr.planejado + pr.reativo ? `${pr.planejado_pct}% planejado` : '')}
      </div>
      <a class="pg-link-cal" href="#/painel?aba=calendario"><i class="bi bi-calendar3"></i> Ver todas as atividades no calendário</a>`;
  }

  // Por funcionário: todo mundo do time (gestor e técnico), um cartão por pessoa
  function abaFuncionarios(d) {
    const fs = d.ti.funcionarios || [];
    if (!fs.length) return vazio('Nenhum usuário ativo.', 'people');
    const n = (v, t, cls = '') => `<div class="fn-n ${cls}"><b>${v}</b><span>${t}</span></div>`;
    return `<div class="fn-grade">${fs.map((p) => `<div class="fn-card">
      <div class="fn-topo"><span class="avatar">${esc(iniciais(p.nome))}</span>
        <div class="min-w-0"><div class="fw-semibold text-truncate">${esc(p.nome)}</div>
        <div>${p.papeis.map((x) => tag(x === 'Gestor' ? 'tag-blue' : 'tag-teal', x)).join(' ')}</div></div></div>
      <div class="fn-nums">
        ${n(p.visitas, 'visitas feitas')}${n(p.atividades, 'atividades concluídas')}${n(pctTxt(p.no_prazo_pct), 'no prazo')}
        ${n(p.em_aberto, 'em aberto agora')}${n(p.atrasadas, 'atrasadas agora', p.atrasadas ? 'ruim' : '')}${n(p.nao_ok, 'problemas achados')}
      </div>
      <div class="small-muted">${[p.pediu ? `pediu ${plural(p.pediu, 'visita', 'visitas')}` : '', p.reagendou ? `reagendou ${p.reagendou}x` : '',
    p.tempo_medio ? `tempo médio ${dur(p.tempo_medio)}` : ''].filter(Boolean).join(' · ') || '—'}</div>
      <a class="small" href="#/atividades?responsavel=${p.id}">Ver atividades de ${esc(p.nome.split(' ')[0])} →</a>
    </div>`).join('')}</div>
    <div class="small-muted mt-2">Números do período escolhido; "agora" é a situação neste momento. Inclui gestores, para quem também faz visitas.</div>`;
  }

  // Causas de encerramento (vêm da Orcim). Laranja = causado por pessoas (mau uso, acidente, erro do usuário).
  const CAUSA_HUMANA = /mau uso|neglig|acidente|erro do usu|cliente|gerente|funcion/i;
  function blocoCausas(d) {
    const o = d.orcim;
    if (!o.causas_ok || (!o.causas.length && !o.sem_causa)) {
      return blocoPg('Por que os chamados aconteceram', `<div class="small-muted py-1">${o.causas_ok
        ? 'Nenhum chamado resolvido com causa no período.'
        : 'A causa ainda não chega: aparece quando o sistema da Orcim tiver o encerramento com causa e o envio de dados estiver ligado.'}</div>`, emBreveApi);
    }
    const nota = `resolvidos no período${o.sem_causa ? ` · ${o.sem_causa} sem causa informada` : ''}`;
    const tabela = o.causas_por_posto.length ? `<div class="table-responsive"><table class="table table-sm pg-tabela mb-0">
      <thead><tr><th>Posto</th><th>Causa</th><th class="text-end">Chamados</th></tr></thead>
      <tbody>${o.causas_por_posto.map((x) => `<tr><td>${esc(x.posto)}</td>
        <td>${CAUSA_HUMANA.test(x.causa) ? '<span class="causa-hum" title="causado por pessoas"></span>' : ''}${esc(x.causa)}</td>
        <td class="text-end"><b>${x.total}</b></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="small-muted py-1">Os chamados com causa ainda não têm posto informado.</div>';
    return `<div class="pg-duas">
        ${blocoPg('Por que os chamados aconteceram', listaBarras(o.causas, {
    max: 10, texto: (x) => `${x.total} · ${x.pct}%${x.anterior ? ` (antes ${x.anterior})` : ''}`,
    cor: (x) => (x.neutra ? '#94a3b8' : CAUSA_HUMANA.test(x.nome) ? '#ec7a1c' : ''),
  }), nota)}
        ${blocoPg('O que aconteceu com os equipamentos', listaBarras(o.acoes_equip, { max: 7, vazio: 'Nenhum equipamento envolvido.' }), 'nos mesmos chamados')}
      </div>
      <div class="small-muted mb-2 causa-leg"><span class="causa-hum"></span> laranja = causado por pessoas (mau uso, acidente, erro do usuário) · cinza = aberto por engano · "antes" = período anterior</div>
      ${blocoPg('Causas por posto', tabela, 'as combinações que mais aparecem')}`;
  }

  function abaOrcim(d) {
    const k = d.orcim.kpis; const a = d.orcim.anterior || {};
    const corUrg = { 4: '#d7263d', 3: '#ec7a1c', 2: '#d9a400', 1: '#4c7dd9' };
    return `
      ${faixa([
    { l: 'Abertos', v: k.criadas, var: variacao(k.criadas, a.criadas, { menorMelhor: true }) },
    { l: 'Resolvidos', v: k.resolvidas, var: variacao(k.resolvidas, a.resolvidas) },
    { l: 'Tempo médio', v: dur(k.tempo_medio_resolucao), var: variacao(k.tempo_medio_resolucao, a.tempo_medio_resolucao, { menorMelhor: true, tempo: true }), sub: k.tempo_mediano_resolucao !== null ? `mediana ${dur(k.tempo_mediano_resolucao)}` : '' },
    { l: 'No prazo', v: pctTxt(k.prazo_cumprido_pct), var: variacao(k.prazo_cumprido_pct, a.prazo_cumprido_pct, { pp: true }) },
    { l: '1ª resposta', v: dur(k.tempo_medio_primeira_resposta), var: variacao(k.tempo_medio_primeira_resposta, a.tempo_medio_primeira_resposta, { menorMelhor: true, tempo: true }) },
    { l: 'Em aberto agora', v: k.abertas_agora, sub: k.atrasadas_agora ? `${k.atrasadas_agora} atrasado(s)` : '', href: '#/demandas?situacao=abertas' },
  ])}
      ${cartaoGrafico('Chamados abertos × resolvidos', graficoLinhas(d.orcim.serie, CORES_ORCIM, { escala: d.periodo.escala, altura: 190, largura: 900 }), nomeEscala(d.periodo.escala))}
      ${blocoCausas(d)}
      <div class="pg-duas">
        ${blocoPg('Problemas mais recorrentes', listaBarras(d.orcim.por_categoria, { vazio: 'Nenhum chamado no período.' }), `${emBreveApi} hoje: categorias da Central`)}
        ${blocoPg('Equipamentos mais solicitados', d.orcim.equipamentos ? listaBarras(d.orcim.equipamentos)
    : '<div class="small-muted py-1">Aparece aqui quando a API da Orcim estiver ligada.</div>', emBreveApi)}
      </div>
      <div class="pg-duas">
        ${blocoPg('Tempo médio por categoria', listaBarras(d.orcim.tempo_por_categoria, {
    valor: (x) => x.tempo_medio, texto: (x) => dur(x.tempo_medio), vazio: 'Nenhum resolvido no período.',
  }), 'resolvidos no período')}
        ${blocoPg('Por urgência', listaBarras(d.orcim.por_urgencia, { max: 4, vazio: 'Nenhum chamado no período.', cor: (x) => corUrg[x.prioridade] }))}
      </div>
      <div class="pg-duas">
        ${blocoPg('Em aberto por idade', listaBarras(d.orcim.abertas_por_idade, {
    max: 4, vazio: 'Nada em aberto.', cor: (x) => (x.nome.startsWith('mais') ? '#dc2626' : x.nome.startsWith('1 a') ? '#f59e0b' : ''),
  }), 'agora')}
        ${blocoPg('Atrasados agora', d.orcim.atrasadas.length ? d.orcim.atrasadas.slice(0, 5).map((x) => `<div class="pg-linha" data-href="#/demandas/${x.id}">
          <span class="text-truncate">${esc(x.number || `#${x.id}`)} — ${esc(x.title)}</span><span class="small-muted text-nowrap">${esc(x.assigned_name || 'sem técnico')}</span></div>`).join('')
    : '<div class="small-muted py-1">Nenhum chamado atrasado.</div>')}
      </div>
      ${blocoPg('Por técnico da Orcim', d.orcim.tecnicos.length ? `<div class="table-responsive"><table class="table table-sm pg-tabela mb-0">
        <thead><tr><th>Técnico</th><th>Resolvidos</th><th>Tempo médio</th><th>1ª resposta</th><th>No prazo</th><th>Em aberto</th></tr></thead>
        <tbody>${d.orcim.tecnicos.map((t) => `<tr><td>${esc(t.nome)}</td><td>${t.resolvidos}</td><td>${dur(t.tempo_medio)}</td><td>${dur(t.primeira_resposta)}</td>
          <td>${pctTxt(t.no_prazo_pct)}</td><td>${t.em_aberto}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="small-muted">Nenhum chamado no período.</div>')}`;
  }

  function abaPostos(d) {
    const cor = { atrasado: 'red', atencao: 'amber', ok: 'green', sem_data: 'gray' };
    const semChamados = d.postos.every((p) => p.chamados === null);
    const porNome = (campo) => d.postos.map((p) => ({ nome: p.nome, total: p[campo] || 0 })).sort((a, b) => b.total - a.total);
    return `<div class="pg-duas">
      ${cartaoGrafico('Visitas por posto', listaBarras(porNome('visitas'), { max: 10, vazio: 'Nenhuma visita no período.' }))}
      ${cartaoGrafico('Itens com problema por posto', listaBarras(porNome('nao_ok'), { max: 10, cor: '#ef4444', vazio: 'Nenhum item NÃO OK no período.' }))}
      </div>
      ${semChamados ? '' : cartaoGrafico('Chamados da Orcim por posto', listaBarras(porNome('chamados'), { max: 10, cor: '#534AB7', vazio: 'Nenhum chamado no período.' }))}` + blocoPg('Postos', d.postos.length ? `<div class="table-responsive"><table class="table table-sm pg-tabela mb-0">
      <thead><tr><th>Posto</th><th>Chamados</th><th>Mais repete ${emBreveApi}</th><th>Causa mais comum</th><th>Tempo médio</th><th>NÃO OK</th><th>Visitas</th><th>Última visita</th><th>Atividades abertas</th></tr></thead>
      <tbody>${d.postos.map((p) => `<tr data-href="#/postos/${p.id}" class="clicavel">
        <td class="text-nowrap"><span class="ac-dot ${cor[p.situacao]} d-inline-block me-2"></span>${esc(p.nome)}${p.dias_atraso ? ` <span class="small text-danger">${p.dias_atraso} d</span>` : ''}</td>
        <td>${p.chamados ?? '—'}</td><td>${p.mais_repete ? `${esc(p.mais_repete.nome)} (${p.mais_repete.total})` : '—'}</td><td>${p.causa_top ? `${CAUSA_HUMANA.test(p.causa_top.nome) ? '<span class="causa-hum"></span>' : ''}${esc(p.causa_top.nome)} (${p.causa_top.total})` : '—'}</td><td>${dur(p.tempo_medio)}</td>
        <td>${p.nao_ok || '—'}</td><td>${p.visitas}</td><td>${p.ultima_visita ? fmtDia(p.ultima_visita) : '—'}</td>
        <td>${p.atividades_abertas || '—'}</td></tr>`).join('')}</tbody></table></div>
      <div class="small-muted mt-2">Bolinha: vermelho = visita atrasada · amarelo = item NÃO OK sem atividade · verde = em dia · cinza = sem próxima visita.
        ${semChamados ? 'A Central ainda não informa o posto de cada chamado; a coluna de chamados aparece quando essa ligação existir.' : 'Chamados ligados ao posto pela localização da Central.'}</div>`
      : vazio('Nenhum posto cadastrado.', 'geo-alt'), 'clique num posto para ver o detalhe');
  }

  // --------------------------- Calendário ---------------------------
  // Tudo o que foi pedido em cada dia (Orcim + TI do Beija-Flor). Em cada dia, um número por
  // urgência, na cor da urgência. Clicar no dia mostra a lista daquele dia ao lado.
  const COR_URG = { 4: 'urg-4', 3: 'urg-3', 2: 'urg-2', 1: 'urg-1' };
  const MESES_CAL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const calFiltro = () => {
    const f = { orcim: true, ti: true, abertos: false };
    try { Object.assign(f, JSON.parse(store.get('gbf_cal_filtros') || '{}')); } catch { /* padrão */ }
    return f;
  };
  const mesSoma = (mes, n) => {
    const [a, m] = mes.split('-').map(Number);
    const d = new Date(Date.UTC(a, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };

  // Etiqueta do status real (A fazer, Em andamento, Aguardando: o quê, Concluída) + "atrasada" quando for o caso
  function etiquetaEstado(i) {
    if (i.feito) return tag('tag-green', 'Concluída');
    const e = i.estado;
    const base = e === 'aguardando' ? tag('tag-amber', i.aguardando ? `Aguardando: ${corta(i.aguardando, 22)}` : 'Aguardando')
      : e === 'em_andamento' ? tag('tag-teal', 'Em andamento')
        : e === 'a_fazer' ? tag('tag-gray', 'A fazer')
          : tag('tag-gray', i.situacao || '—');
    return `<span class="etq">${base}${i.atrasado ? tag('tag-red', 'Atrasada') : ''}</span>`;
  }
  const corta = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));

  async function vCalendarioPainel(qs, seq, abasHtml = '', base = '#/painel?aba=calendario', opts = {}) {
    titulo(opts.titulo || 'Painel do gestor');
    base = base.replace(/&(mes|dia)=[^&]*/g, '');
    const mes = /^\d{4}-\d{2}$/.test(qs.get('mes') || '') ? qs.get('mes') : hojeSP().slice(0, 7);
    const semanaDe = opts.semana ? (/^\d{4}-\d{2}-\d{2}$/.test(qs.get('data') || '') ? qs.get('data') : hojeSP()) : null;
    const c = await API.get(opts.semana ? `/painel-gestor/calendario?de=${semanaDe}` : `/painel-gestor/calendario?mes=${mes}`);
    if (seq !== renderSeq) return;
    const filtro = calFiltro();
    let diaSel = /^\d{4}-\d{2}-\d{2}$/.test(qs.get('dia') || '') ? qs.get('dia') : (opts.semana ? (c.inicio <= c.hoje && c.hoje <= c.fim ? c.hoje : c.inicio) : (c.hoje.slice(0, 7) === c.mes ? c.hoje : c.primeiro));
    const irSemana = (d) => `${base}&data=${d}`;
    const [ano, mesNum] = c.mes.split('-').map(Number);
    const irMes = (m) => `${base}&mes=${m}`;

    const visiveis = () => c.itens.filter((i) => filtro[i.fonte] && (!filtro.abertos || i.aberto));
    const porDia = () => {
      const m = new Map();
      for (const i of visiveis()) {
        if (!m.has(i.dia)) m.set(i.dia, []);
        m.get(i.dia).push(i);
      }
      return m;
    };

    view().innerHTML = `
      ${abasHtml}
      <div class="calpg${opts.semana ? ' semana' : ''}">
      <div class="cal-leg" aria-label="Legenda">
        <div class="cal-leg-g"><span class="cal-leg-t">Urgência</span>${[4, 3, 2, 1].map((p) => `<span class="cal-leg-i"><i class="cal-num ${COR_URG[p]}"></i>${esc(c.urgencias[p])}</span>`).join('')}</div>
        <div class="cal-leg-g"><span class="cal-leg-t">Andamento</span>
          <span class="cal-leg-i"><i class="bi bi-circle"></i>A fazer</span>
          <span class="cal-leg-i"><i class="bi bi-circle-half"></i>Em andamento / aguardando</span>
          <span class="cal-leg-i"><i class="bi bi-check-circle-fill"></i>Concluída</span></div>
        <div class="cal-leg-g"><span class="cal-leg-t">Outros</span>
          <span class="cal-leg-i"><i class="bi bi-alarm"></i>atrasado</span>
          <span class="cal-leg-i"><span class="cal-leg-linha"></span>vários dias</span></div>
      </div>
      <div class="cal-topo">
        ${opts.semana ? `
        <a class="btn btn-sm btn-outline-secondary" href="${irSemana(isoSoma(c.inicio, -7))}" aria-label="Semana anterior"><i class="bi bi-chevron-left"></i></a>
        <strong class="cal-mes">${c.inicio.slice(8, 10)}/${c.inicio.slice(5, 7)} a ${c.fim.slice(8, 10)}/${c.fim.slice(5, 7)}</strong>
        <a class="btn btn-sm btn-outline-secondary" href="${irSemana(isoSoma(c.inicio, 7))}" aria-label="Próxima semana"><i class="bi bi-chevron-right"></i></a>
        ${c.inicio <= c.hoje && c.hoje <= c.fim ? '' : `<a class="btn btn-sm btn-link" href="${irSemana(c.hoje)}">Hoje</a>`}` : `
        <a class="btn btn-sm btn-outline-secondary" href="${irMes(mesSoma(c.mes, -1))}" aria-label="Mês anterior"><i class="bi bi-chevron-left"></i></a>
        <strong class="cal-mes">${MESES_CAL[mesNum - 1].replace(/^./, (x) => x.toUpperCase())} de ${ano}</strong>
        <a class="btn btn-sm btn-outline-secondary" href="${irMes(mesSoma(c.mes, 1))}" aria-label="Próximo mês"><i class="bi bi-chevron-right"></i></a>
        ${c.hoje.slice(0, 7) !== c.mes ? `<a class="btn btn-sm btn-link" href="${irMes(c.hoje.slice(0, 7))}">Hoje</a>` : ''}`}
        <div class="cal-filtros ms-auto" role="group" aria-label="Mostrar">
          <button type="button" data-f="orcim">Orcim</button>
          <button type="button" data-f="ti">TI do Beija-Flor</button>
          <button type="button" data-f="abertos">Só em aberto</button>
        </div>
      </div>
      <div class="cal-nota small-muted">TI: atividades no prazo, visitas de rotina e visitas pedidas no dia desejado. Orcim: dia em que o chamado foi aberto${c.orcim_ok ? '' : ' — não consegui ler os chamados agora'}.</div>
      <div class="cal-corpo">
        <div class="cal-grade" role="grid" aria-label="Calendário geral">
          ${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((d, i) => `<div class="cal-sem${i === 0 || i === 6 ? ' fds' : ''}" role="columnheader">${d}</div>`).join('')}
          <div id="cal-dias" style="display:contents"></div>
        </div>
        <aside class="cal-dia" id="cal-dia" aria-live="polite"></aside>
      </div>
      <div class="cal-resumo small-muted" id="cal-resumo"></div>
      </div>`;

    // Atividades de vários dias: cada uma ganha uma "pista" (até 3) para as linhas não se cruzarem
    const faixasVis = () => (c.faixas || []).filter((x) => filtro.ti && (!filtro.abertos || x.aberto));
    const pistas = () => {
      const fim = [];
      return faixasVis().slice().sort((a, b) => a.ini.localeCompare(b.ini) || b.fim.localeCompare(a.fim)).map((x) => {
        let p = fim.findIndex((f) => f < x.ini);
        if (p < 0) { p = fim.length; fim.push(x.fim); } else fim[p] = x.fim;
        return { ...x, pista: p };
      }).filter((x) => x.pista < 3);
    };
    const faixasDoDia = (d, lista) => lista.filter((x) => x.ini <= d && d <= x.fim);
    const htmlFaixas = (d, lista) => faixasDoDia(d, lista).map((x) => {
      const parte = d === x.ini ? 'ini' : d === x.fim ? 'fim' : 'meio';
      return `<span class="cal-faixa ${parte} ${COR_URG[x.prioridade]}${x.feito ? ' feita' : ''}" style="--p:${x.pista}" aria-hidden="true">${parte === 'ini' ? '<em>início</em>' : parte === 'fim' ? '<em>entrega</em>' : ''}</span>`;
    }).join('');

    const fmtCurta = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
    // itens do dia + atividades de vários dias que estão correndo naquele dia (a entrega já vem na lista)
    const doDia = (dia, m = porDia()) => {
      const lst = (m.get(dia) || []).slice();
      faixasVis().filter((x) => x.ini <= dia && dia < x.fim).forEach((x) => lst.push({ ...x, faixaTxt: dia === x.ini ? `começa hoje · entrega ${fmtCurta(x.fim)}` : `em curso · entrega ${fmtCurta(x.fim)}` }));
      return lst.sort((a, b) => Number(a.feito) - Number(b.feito) || b.prioridade - a.prioridade || (a.hora || '').localeCompare(b.hora || ''));
    };
    // andamento (só o que é da TI): a fazer, em andamento/aguardando, concluída
    const andamento = (lst) => {
      const ti = lst.filter((i) => i.fonte === 'ti');
      return {
        fazer: ti.filter((i) => !i.feito && !['em_andamento', 'aguardando'].includes(i.estado)).length,
        andando: ti.filter((i) => !i.feito && ['em_andamento', 'aguardando'].includes(i.estado)).length,
        feito: ti.filter((i) => i.feito).length,
      };
    };
    const htmlAndamento = (a) => [
      a.fazer ? `<span title="a fazer"><i class="bi bi-circle"></i>${a.fazer}</span>` : '',
      a.andando ? `<span title="em andamento"><i class="bi bi-circle-half"></i>${a.andando}</span>` : '',
      a.feito ? `<span title="concluída"><i class="bi bi-check-circle-fill"></i>${a.feito}</span>` : '',
    ].join('');
    const podeArrastar = (i) => opts.arrastar && i.reagendar && !i.feito;
    const dadosDrag = (i) => esc(JSON.stringify({ tipo: i.reagendar, id: i.id, data: i.fim || i.dia, hora: i.hora || null }));
    const icAnd = (i) => (i.feito ? 'check-circle-fill' : ['em_andamento', 'aguardando'].includes(i.estado) ? 'circle-half' : 'circle');
    // item dentro do dia (semana): bolinha da urgência, hora, título e o andamento
    const miniItem = (i) => `<span class="cal-mini${i.feito ? ' feito' : ''}${i.atrasado ? ' atr' : ''}" data-link="${esc(i.link)}"${podeArrastar(i) ? ` data-drag="${dadosDrag(i)}"` : ''}>
        <i class="cal-num ${COR_URG[i.prioridade]}"></i><span class="h">${esc(i.hora || '')}</span><span class="t">${esc(i.titulo)}</span><i class="bi bi-${icAnd(i)} a"></i></span>`;
    const itemLista = (i) => `<li data-link="${esc(i.link)}" tabindex="0"${podeArrastar(i) ? ` class="arrastavel" data-drag="${esc(JSON.stringify({ tipo: i.reagendar, id: i.id, data: i.fim || i.dia, hora: i.hora || null }))}" title="Arraste para outro dia para reagendar"` : ''}>
        <div class="cal-pop-lin"><i class="cal-num ${COR_URG[i.prioridade]}"></i><span class="t">${esc(i.titulo)}</span>${etiquetaEstado(i)}</div>
        ${i.faixaTxt ? `<div class="cal-pop-faixa">${esc(i.faixaTxt)}</div>` : ''}
        <div class="cal-pop-det"><div><dl>
          <dt>Urgência</dt><dd>${esc(c.urgencias[i.prioridade] || '—')}</dd>
          <dt>Quando</dt><dd>${i.ini ? `${fmtCurta(i.ini)} → ${fmtCurta(i.fim)}` : i.comeca ? `${fmtCurta(i.comeca)} → ${fmtCurta(i.dia)}` : esc(i.hora || 'dia todo')}</dd>
          <dt>Situação</dt><dd>${esc(i.situacao || '—')}${i.aguardando ? ` · aguardando ${esc(i.aguardando)}` : ''}</dd>
          ${i.responsavel ? `<dt>Responsável</dt><dd>${esc(i.responsavel)}</dd>` : ''}
          ${i.detalhe ? `<dt>Detalhes</dt><dd>${esc(i.detalhe)}</dd>` : ''}
          <dt>Origem</dt><dd>${i.fonte === 'orcim' ? 'Orcim' : 'TI do Beija-Flor'} · ${esc(i.numero)}</dd>
        </dl>
        ${(i.comentarios || []).length ? `<div class="cal-pop-coms">${i.comentarios.map((k) => `<div class="cal-pop-com"><b>${esc(k.quem || '—')}</b> <span>${esc(relativo(k.quando))}</span><div>${realcarMencoes(esc(corta(k.texto, 160)))}</div></div>`).join('')}</div>` : ''}
        ${opts.acoes && !i.feito ? `<div class="cal-acoes">${i.tipo === 'rotina' ? btnIniciar({ id: i.id, name: i.titulo.replace(/^Visita de rotina — /, '') }, null, false) : ''}${i.reagendar ? btnReag({ tipo: i.reagendar, id: i.id, data: i.fim || i.dia, hora: i.hora || null }) : ''}</div>` : ''}
        <span class="cal-pop-abrir">Abrir <i class="bi bi-arrow-right"></i></span></div></div>
      </li>`;

    const pintar = () => {
      const m = porDia();
      const fx = pistas();
      const dias = [];
      for (let d = c.inicio; d <= c.fim; d = isoSoma(d, 1)) dias.push(d);
      $('#cal-dias').innerHTML = dias.map((d) => {
        const lst = m.get(d) || [];
        const cont = [4, 3, 2, 1].map((p) => [p, lst.filter((i) => i.prioridade === p).length]).filter(([, n]) => n);
        const fora = d.slice(0, 7) !== c.mes;
        const atrasados = lst.filter((i) => i.atrasado).length;
        const nfx = faixasDoDia(d, fx).length ? Math.max(...faixasDoDia(d, fx).map((x) => x.pista)) + 1 : 0;
        return `<button type="button" class="cal-cel${[0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()) ? ' fds' : ''}${fora ? ' fora' : ''}${d === c.hoje ? ' hoje' : ''}${d === diaSel ? ' sel' : ''}${nfx ? ' com-faixa' : ''}" data-dia="${d}" data-drop-dia="${d}" style="--nf:${nfx}"
          aria-label="${fmtIso(d)}: ${lst.length} item(ns)" aria-pressed="${d === diaSel}">
          <span class="cal-cab-d"><span class="cal-d">${Number(d.slice(8, 10))}</span><span class="cal-and">${htmlAndamento(andamento(doDia(d, m)))}</span></span>
          ${opts.mais ? `<span class="cal-mais" role="button" tabindex="0" data-novo="${d}" title="Novo pedido neste dia" aria-label="Novo pedido em ${fmtIso(d)}"><i class="bi bi-plus-lg"></i></span>` : ''}
          ${atrasados ? `<span class="cal-atr" title="${atrasados} atrasada(s)"><i class="bi bi-alarm"></i>${atrasados}</span>` : ''}
          ${opts.semana ? `<span class="cal-sem-itens">${doDia(d, m).filter((i) => !i.faixaTxt || d === i.ini || d === c.inicio).map(miniItem).join('') || '<span class="cal-sem-vazio">—</span>'}</span>` : `<span class="cal-nums">${cont.map(([p, n]) => `<i class="cal-num ${COR_URG[p]}">${n}</i>`).join('')}</span>`}
          ${htmlFaixas(d, fx)}
        </button>`;
      }).join('');
      $$('#cal-dias [data-dia]').forEach((b) => b.addEventListener('click', () => {
        diaSel = b.dataset.dia;
        history.replaceState(null, '', `${base}&mes=${c.mes}&dia=${diaSel}`);
        pintar();
        if (window.matchMedia('(max-width: 900px)').matches) $('#cal-dia').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));

      const lista = doDia(diaSel, m);
      const and = andamento(lista);
      const dataLonga = new Date(`${diaSel}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: '2-digit' }).replace(/^./, (x) => x.toUpperCase());
      $('#cal-dia').innerHTML = `<h3>${esc(dataLonga)}${diaSel === c.hoje ? ' <span class="tag tag-teal">hoje</span>' : ''}</h3>
        <div class="small-muted mb-2">${lista.length ? `${plural(lista.length, 'item', 'itens')} · ${and.fazer} a fazer · ${and.andando} em andamento · ${and.feito} concluída(s)` : 'Nada neste dia.'}</div>
        ${lista.length ? `<ul class="cal-lista">${lista.map(itemLista).join('')}</ul><div class="cal-lista-dica small-muted">Passe o mouse num item para ver os detalhes; clique para abrir.${opts.arrastar ? ' Arraste um item para outro dia para reagendar.' : ''}</div>` : ''}
        ${opts.mais ? `<a class="btn btn-sm btn-outline-brand w-100 mt-2" href="#/novo?data=${diaSel}"><i class="bi bi-plus-lg"></i> Novo pedido neste dia</a>` : ''}`;
      $$('#cal-dia li[data-link]').forEach((x) => {
        x.addEventListener('click', (ev) => { if (ev.target.closest('button, .btn')) return; location.hash = x.dataset.link; });
        x.addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = x.dataset.link; });
      });

      if (opts.acoes) { ligarReagendar(); ligarIniciar(); }
      const doMes = visiveis().filter((i) => (opts.semana ? (c.inicio <= i.dia && i.dia <= c.fim) : i.dia.slice(0, 7) === c.mes));
      $('#cal-resumo').innerHTML = `${opts.semana ? 'Na semana' : 'No mês'}: ${plural(doMes.length, 'item', 'itens')} · ${[4, 3, 2, 1].map((p) => `${doMes.filter((i) => i.prioridade === p).length} ${esc(c.urgencias[p]).toLowerCase()}`).join(' · ')} · ${doMes.filter((i) => i.aberto).length} ainda em aberto`;
      $$('.cal-filtros [data-f]').forEach((b) => {
        b.classList.toggle('on', !!filtro[b.dataset.f]);
        b.setAttribute('aria-pressed', String(!!filtro[b.dataset.f]));
      });
    };
    if (opts.mais) {
      $('#cal-dias').addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-novo]');
        if (!b) return;
        ev.stopPropagation(); ev.preventDefault();
        location.hash = `#/novo?data=${b.dataset.novo}`;
      }, true);
      $('#cal-dias').addEventListener('keydown', (ev) => {
        const b = ev.target.closest('[data-novo]');
        if (b && ev.key === 'Enter') { ev.stopPropagation(); ev.preventDefault(); location.hash = `#/novo?data=${b.dataset.novo}`; }
      }, true);
    }
    if (opts.semana) {
      $('#cal-dias').addEventListener('click', (ev) => {
        const it = ev.target.closest('.cal-mini[data-link]');
        if (!it) return;
        ev.stopPropagation(); ev.preventDefault();
        location.hash = it.dataset.link;
      }, true);
    }
    if (opts.arrastar) ativarArrasto(view());
    // Hover num dia: cartão pequeno perto do mouse com andamento e prévia dos comentários.
    // Clique: a lista da direita mostra o dia (com sanfona) e uma linha liga o dia à lista.
    {
      const criar = (id, html) => {
        let el = document.getElementById(id);
        if (!el) { el = document.createElement('div'); el.id = id; el.innerHTML = html; document.body.appendChild(el); }
        return el;
      };
      document.getElementById('cal-pop')?.classList.remove('on', 'fixo'); // popup antigo (não é mais usado)
      const dica = criar('cal-dica', '');
      const linha = criar('cal-linha', '<svg width="100%" height="100%"><path d="" /></svg>');
      const comentariosDe = (lst) => lst.flatMap((i) => (i.comentarios || []).map((k) => ({ ...k, item: i.titulo })))
        .sort((a, b) => new Date(b.quando) - new Date(a.quando));
      const grade = $('#cal-dias');

      if (window.matchMedia('(hover: hover)').matches) {
        let diaDica = null;
        grade.addEventListener('mousemove', (ev) => {
          const cel = ev.target.closest('[data-dia]');
          if (!cel) { dica.classList.remove('on'); diaDica = null; return; }
          if (cel.dataset.dia !== diaDica) {
            diaDica = cel.dataset.dia;
            const lst = doDia(diaDica);
            const a = andamento(lst);
            const coms = comentariosDe(lst).slice(0, 2);
            dica.innerHTML = `<div class="cal-dica-l1"><i class="bi bi-eye"></i> ${lst.length ? plural(lst.length, 'item', 'itens') : 'Nada neste dia'}</div>
              ${lst.length ? `<div class="cal-dica-and">${a.fazer} a fazer · ${a.andando} em andamento · ${a.feito} concluída(s)</div>` : ''}
              ${coms.map((k) => `<div class="cal-dica-com"><i class="bi bi-chat-left-text"></i><span><b>${esc((k.quem || '').split(' ')[0])}:</b> ${esc(corta(k.texto, 70))}</span></div>`).join('')}
              ${lst.length ? '<div class="cal-dica-l2">clique para ver a lista ao lado</div>' : ''}`;
            dica.classList.add('on');
          }
          const w = dica.offsetWidth; const h = dica.offsetHeight;
          let x = ev.clientX + 16; if (x + w > innerWidth - 6) x = ev.clientX - w - 12;
          let y = ev.clientY + 18; if (y + h > innerHeight - 6) y = ev.clientY - h - 12;
          dica.style.transform = `translate(${x}px, ${y}px)`;
        });
        grade.addEventListener('mouseleave', () => { dica.classList.remove('on'); diaDica = null; });
      }

      // Clique no dia: popup com a lista ao lado do dia, ligado por uma linha curta.
      // Fica dentro da área do calendário (não cobre a lista da direita). Em tela estreita, só a lista de baixo.
      const pop = criar('cal-pop', '<div class="cal-pop-in"></div>');
      pop.classList.remove('on', 'fixo');
      const fecharPop = () => { pop.classList.remove('on', 'fixo'); linha.classList.remove('on'); };
      const abrirPop = (cel) => {
        if (window.innerWidth < 900) return;
        const dia = cel.dataset.dia;
        const lst = doDia(dia);
        const a = andamento(lst);
        const titDia = new Date(`${dia}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: '2-digit' }).replace(/^./, (x) => x.toUpperCase());
        pop.firstElementChild.innerHTML = `<div class="cal-pop-cab"><b>${esc(titDia)}</b>
            <span>${lst.length ? `${a.fazer} a fazer · ${a.andando} em andamento · ${a.feito} concl.` : ''}</span>
            <button type="button" class="cal-pop-x" aria-label="Fechar"><i class="bi bi-x-lg"></i></button></div>
          ${lst.length ? `<ul class="cal-lista">${lst.slice(0, 30).map(itemLista).join('')}</ul>` : '<div class="cal-pop-vazio">Nada neste dia.</div>'}
          ${opts.mais ? `<a class="btn btn-sm btn-outline-brand w-100 mt-2" href="#/novo?data=${dia}"><i class="bi bi-plus-lg"></i> Novo pedido neste dia</a>` : ''}`;
        pop.classList.add('fixo');
        pop.querySelectorAll('[data-reag]').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); fecharPop(); reagendar(JSON.parse(b.dataset.reag)); }));
        pop.querySelectorAll('[data-iniciar]').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); fecharPop(); iniciarVisita(b.dataset.iniciar, b.dataset.nome, b.dataset.visita || null); }));
        const g = $('.cal-grade').getBoundingClientRect();
        const r = cel.getBoundingClientRect();
        const pw = Math.min(330, Math.max(260, g.width / 2.6));
        pop.style.width = `${pw}px`;
        const ph = Math.min(pop.offsetHeight || 200, innerHeight - 24);
        const gap = 26;
        // do lado que tem espaço dentro do calendário
        let x = r.right + gap;
        let lado = 'dir';
        if (x + pw > g.right) { x = r.left - gap - pw; lado = 'esq'; }
        x = Math.max(g.left, Math.min(x, g.right - pw));
        let y = r.top - 8;
        y = Math.max(12, Math.min(y, innerHeight - ph - 12));
        pop.firstElementChild.style.maxHeight = `${innerHeight - y - 12}px`;
        const primeira = !pop.classList.contains('on');
        if (primeira) pop.classList.add('sem-mov');
        pop.style.transform = `translate(${x}px, ${y}px)`;
        pop.firstElementChild.classList.remove('troca'); void pop.offsetWidth; pop.firstElementChild.classList.add('troca');
        pop.classList.add('on');
        setTimeout(() => {
          pop.classList.remove('sem-mov');
          // linha curta: da borda do dia até a borda do popup
          // usa a posição de destino (não a medida no meio da animação)
          const p = { left: x, right: x + pw, top: y };
          const x1 = lado === 'dir' ? r.right : r.left; const y1 = r.top + r.height / 2;
          const x2 = lado === 'dir' ? p.left : p.right; const y2 = Math.min(Math.max(y1, p.top + 18), p.top + 40);
          const meio = (x1 + x2) / 2;
          linha.querySelector('path').setAttribute('d', `M${x1},${y1} C${meio},${y1} ${meio},${y2} ${x2},${y2}`);
          linha.classList.remove('on'); void linha.offsetWidth; linha.classList.add('on');
        }, primeira ? 40 : 240);
      };
      grade.addEventListener('click', (ev) => {
        if (!ev.target.closest('[data-dia]') || ev.target.closest('[data-novo], .cal-mini')) return;
        dica.classList.remove('on');
        const dia = ev.target.closest('[data-dia]').dataset.dia;
        setTimeout(() => { const cel = grade.querySelector(`[data-dia="${dia}"]`); if (cel) abrirPop(cel); }, 0);
      });
      const apagar = fecharPop;
      if (!linha.dataset.ligado) {
        linha.dataset.ligado = '1';
        pop.addEventListener('click', (ev) => {
          if (ev.target.closest('.cal-pop-x')) { fecharPop(); return; }
          if (ev.target.closest('button, .btn')) return;
          const li = ev.target.closest('li[data-link]');
          if (li) { fecharPop(); location.hash = li.dataset.link; }
        });
        document.addEventListener('mousedown', (ev) => {
          if (pop.classList.contains('fixo') && !pop.contains(ev.target) && !ev.target.closest('#cal-dias') && !ev.target.closest('.modal')) fecharPop();
        });
        document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') fecharPop(); });
        window.addEventListener('scroll', (ev) => { if (!pop.contains(ev.target)) apagar(); }, true);
        window.addEventListener('resize', apagar);
        window.addEventListener('hashchange', () => { apagar(); document.getElementById('cal-dica')?.classList.remove('on'); });
      }
    }

    $$('.cal-filtros [data-f]').forEach((b) => b.addEventListener('click', () => {
      filtro[b.dataset.f] = !filtro[b.dataset.f];
      if (!filtro.orcim && !filtro.ti) filtro[b.dataset.f === 'orcim' ? 'ti' : 'orcim'] = true; // sempre mostra pelo menos um
      store.set('gbf_cal_filtros', JSON.stringify(filtro));
      pintar();
    }));
    pintar();
  }


  // Relatório para imprimir / salvar em PDF (sem bibliotecas: o navegador gera o PDF)
  function exportarPdf(d) {
    if (!d) return;
    const o = d.orcim.kpis; const t = d.ti.kpis; const per = d.periodo;
    const esc_ = per.escala;
    const tituloEscala = nomeEscala(esc_);
    const nomeArquivo = `Relatorio_Painel_Gestor_${per.de}_a_${per.ate}`;
    const linha = (rot, val) => `<tr><td>${esc(rot)}</td><td class="num">${esc(val)}</td></tr>`;
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${esc(nomeArquivo)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; font-size: 11.5pt; line-height: 1.45; margin: 0; }
  h1 { font-size: 18pt; margin: 0 0 2px; color: #0f766e; }
  h2 { font-size: 13pt; margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #0f766e; break-after: avoid; }
  h3 { font-size: 11pt; margin: 12px 0 6px; break-after: avoid; }
  .sub { color: #64748b; font-size: 10pt; margin-bottom: 12px; }
  p { margin: 0 0 7px; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; margin-bottom: 8px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th { background: #f1f5f9; }
  td.num { text-align: right; font-weight: 600; white-space: nowrap; }
  .duas { display: flex; gap: 16px; } .duas > div { flex: 1; min-width: 0; }
  .grafico-box { break-inside: avoid; margin-bottom: 10px; }
  .legend { display: flex; gap: 14px; font-size: 9pt; color: #64748b; margin-top: 4px; }
  .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; }
  .muted { color: #64748b; }
  .rodape { margin-top: 18px; font-size: 8.5pt; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 6px; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style></head><body>
  <h1>Relatório do Painel do Gestor</h1>
  <div class="sub">Grupo Beija-Flor · Orcim e TI do grupo · de ${fmtIso(per.de)} a ${fmtIso(per.ate)} (${plural(per.dias, 'dia', 'dias')}) · gerado em ${fmtData(per.gerado_em)}</div>

  <h2>Resumo do período</h2>
  ${textoRelatorio(d).map((p) => `<p>${esc(p)}</p>`).join('')}

  <h2>Orcim — chamados</h2>
  <div class="duas">
    <div><table><tbody>
      ${linha('Abertos no período', o.criadas)}
      ${linha('Resolvidos no período', o.resolvidas)}
      ${linha('Dentro do prazo', o.prazo_base ? `${pct(o.prazo_cumprido_pct)} (${o.prazo_base - o.fora_do_prazo} de ${o.prazo_base})` : '—')}
      ${linha('Tempo médio até resolver', dur(o.tempo_medio_resolucao))}
      ${linha('Tempo médio até 1ª resposta', dur(o.tempo_medio_primeira_resposta))}
      ${linha('Em aberto agora', o.abertas_agora)}
      ${linha('Atrasados agora', o.atrasadas_agora)}
    </tbody></table></div>
    <div style="flex:0 0 130px;text-align:center">${medidor(o.prazo_cumprido_pct, 'Dentro do prazo')}<div class="muted">dentro do prazo</div></div>
  </div>
  <div class="grafico-box"><h3>Chamados abertos × resolvidos ${tituloEscala}</h3>${graficoLinhas(d.orcim.serie, CORES_ORCIM, { escala: esc_, altura: 190, largura: 900 })}</div>
  <div class="grafico-box"><h3>Chamados abertos por categoria</h3>${graficoBarrasSvg(d.orcim.por_categoria)}</div>
  <div class="grafico-box"><h3>Resolvidos por técnico da Orcim</h3>${d.orcim.por_tecnico.length
    ? `<table><thead><tr><th>Técnico</th><th class="num">Resolvidos</th><th class="num">Tempo médio</th></tr></thead><tbody>${d.orcim.por_tecnico.map((x) => `<tr><td>${esc(x.nome)}</td><td class="num">${x.total}</td><td class="num">${dur(x.tempo_medio)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nenhum chamado resolvido no período.</p>'}</div>

  <h2>TI do grupo — dia a dia</h2>
  <table><tbody>
    ${linha('Visitas feitas', t.visitas)}
    ${linha('Atividades concluídas', `${t.atividades}${t.atividades_com_atraso ? ` (${t.atividades_com_atraso} com atraso)` : ''}`)}
    ${linha('Solicitações atendidas', t.solicitacoes)}
    ${linha('Tempo médio de atendimento das solicitações', dur(t.tempo_medio_solicitacao))}
    ${linha('Itens de checklist NÃO OK', t.nao_ok)}
    ${linha('Postos com visita atrasada (agora)', t.postos_atrasados_agora)}
    ${linha('Atividades atrasadas (agora)', t.atividades_atrasadas_agora)}
    ${linha('Solicitações em aberto (agora)', t.solicitacoes_abertas_agora)}
  </tbody></table>
  <div class="grafico-box"><h3>Entregas da TI ${tituloEscala}</h3>${graficoLinhas(d.ti.serie, CORES_TI, { escala: esc_, altura: 190, largura: 900 })}</div>
  <div class="grafico-box"><h3>Visitas por posto</h3>${graficoBarrasSvg(d.ti.por_posto)}</div>
  ${d.ti.por_pessoa.length ? `<div class="grafico-box"><h3>Por pessoa</h3><table><thead><tr><th>Pessoa</th><th class="num">Visitas</th><th class="num">Atividades</th><th class="num">Solicitações</th></tr></thead><tbody>
    ${d.ti.por_pessoa.map((p) => `<tr><td>${esc(p.nome)}</td><td class="num">${p.visitas}</td><td class="num">${p.atividades}</td><td class="num">${p.solicitacoes}</td></tr>`).join('')}</tbody></table></div>` : ''}

  <h2>Precisa de atenção</h2>
  ${listaAtencao(d, { paraPdf: true })}

  <div class="rodape">Números "no período" consideram de ${fmtIso(per.de)} a ${fmtIso(per.ate)} (horário de Brasília). Números "agora" mostram a situação no momento em que o relatório foi gerado. Solicitação parada = em aberto há mais de ${d.ti.parada_dias} dias.</div>
</body></html>`;

    const antigo = $('#frame-pdf');
    if (antigo) antigo.remove();
    const frame = document.createElement('iframe');
    frame.id = 'frame-pdf';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    const tituloAntes = document.title;
    document.title = nomeArquivo; // alguns navegadores usam o título da página como nome do arquivo
    setTimeout(() => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => { document.title = tituloAntes; }, 1000);
    }, 300);
    toast('Na janela que abriu, escolha "Salvar como PDF".');
  }

  // ------------------------------------------------------------------
  // Visão geral
  // ------------------------------------------------------------------
  let periodo = Number(store.get('gbf_periodo')) || 30;

  async function vVisao(seq) {
    titulo('Visão Orcim');
    const [r, at, minhas] = await Promise.all([
      API.get(`/demandas/resumo?dias=${periodo}`),
      API.get(`/atividades/resumo?dias=${periodo}`),
      API.get('/atividades?situacao=abertas'),
    ]);
    if (seq !== renderSeq) return;
    const k = r.kpis;
    const prox = minhas.filter((t) => ehGestor() || t.assignee_id == EU.id).slice(0, 6);
    view().innerHTML = `
      <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
        <div class="small-muted me-auto">Demandas da Orcim no período e o que está em aberto agora.</div>
        <div class="btn-group btn-group-sm" role="group" aria-label="Período">
          ${[7, 30, 90].map((d) => `<button class="btn ${d === periodo ? 'btn-dark' : 'btn-outline-secondary'}" data-dias="${d}">${d} dias</button>`).join('')}
        </div>
      </div>
      <div class="kpis">
        ${kpi('Em aberto', k.abertas, { href: '#/demandas?situacao=abertas', icon: 'inbox' })}
        ${kpi('Atrasadas', k.atrasadas, { cls: k.atrasadas ? 'bad' : 'ok', href: '#/demandas?situacao=atrasadas', icon: 'alarm' })}
        ${kpi('Vencem em até 4 h', k.em_risco, { cls: k.em_risco ? 'warn' : '', href: '#/demandas?situacao=em_risco', icon: 'hourglass-split' })}
        ${kpi('Sem técnico da Orcim', k.sem_tecnico, { cls: k.sem_tecnico ? 'warn' : '', href: '#/demandas?situacao=sem_tecnico', icon: 'person-x' })}
        ${kpi('Aguardando nossa aprovação', k.aguardando_aprovacao, { href: '#/demandas?situacao=aprovacao', icon: 'patch-question' })}
        ${kpi(`Resolvidas em ${r.periodo_dias} dias`, k.resolvidas_periodo, { cls: 'ok', hint: `${k.criadas_periodo} abertas no período`, href: '#/demandas?situacao=concluidas', icon: 'check2-circle' })}
        ${kpi('Tempo médio até resolver', dur(k.tempo_medio_resolucao), { hint: k.tempo_mediano_resolucao !== null ? `mediana ${dur(k.tempo_mediano_resolucao)}` : 'sem resolvidas no período', icon: 'stopwatch' })}
        ${kpi('Tempo até 1ª resposta', dur(k.tempo_medio_primeira_resposta), { hint: 'média das abertas no período', icon: 'chat-left-dots' })}
        ${kpi('Tempo até começar', dur(k.tempo_medio_ate_atendimento), { hint: 'da abertura à atribuição', icon: 'person-check' })}
        ${kpi('Prazo cumprido', k.sla_cumprido_pct === null ? '—' : `${k.sla_cumprido_pct}%`, {
    cls: k.sla_cumprido_pct === null ? '' : (k.sla_cumprido_pct >= 85 ? 'ok' : k.sla_cumprido_pct >= 60 ? 'warn' : 'bad'),
    hint: k.sla_base ? `${k.sla_base} resolvidas com prazo` : 'nenhuma resolvida com prazo', icon: 'calendar-check',
  })}
      </div>
      <div class="grid-2">
        <div class="card-x"><h3><i class="bi bi-bar-chart"></i>Abertas × resolvidas por dia</h3>${tendencia(r.serie)}</div>
        <div class="card-x"><h3><i class="bi bi-diagram-3"></i>Em aberto por status</h3>${barras(r.por_status, { vazio: 'Nenhuma demanda em aberto.' })}</div>
      </div>
      <div class="grid-3">
        <div class="card-x"><h3><i class="bi bi-buildings"></i>Em aberto por empresa</h3>${barras(r.por_empresa, { vazio: 'Nenhuma demanda em aberto.' })}</div>
        <div class="card-x"><h3><i class="bi bi-tags"></i>Abertas no período por categoria</h3>${barras(r.por_categoria, { vazio: 'Nenhuma demanda no período.' })}</div>
        <div class="card-x"><h3><i class="bi bi-person-gear"></i>Técnicos da Orcim</h3>
          ${r.por_tecnico.length ? r.por_tecnico.map((t) => `<div class="d-flex justify-content-between align-items-start gap-2 py-2 border-bottom">
            <div class="min-w-0"><div class="fw-semibold">${esc(t.nome)}</div>
              <div class="small-muted">${t.resolvidas} resolvida(s) no período · média ${dur(t.tempo_medio)}</div></div>
            <div class="text-end text-nowrap"><div><strong>${t.abertas}</strong> <span class="small-muted">em aberto</span></div>
              ${t.atrasadas ? `<div class="text-danger small fw-semibold">${t.atrasadas} atrasada(s)</div>` : ''}</div></div>`).join('')
    : '<div class="small-muted">Sem dados.</div>'}
        </div>
      </div>
      <div class="grid-2">
        <div class="card-x"><h3><i class="bi bi-hourglass-bottom"></i>Mais antigas em aberto <a class="sub" href="#/demandas?situacao=abertas">ver todas</a></h3>
          ${r.mais_antigas.length ? `<div class="table-wrap"><table class="table-x"><tbody>
          ${r.mais_antigas.map((d) => `<tr class="click" data-href="#/demandas/${d.id}">
            <td><div class="num">${esc(d.number || '#' + d.id)}</div>${esc(d.title)}<div class="small-muted">${esc(d.entity_name)}</div></td>
            <td class="text-nowrap">${dur(d.tempo_aberto)}</td><td>${tagSla(d.sla)}</td></tr>`).join('')}
          </tbody></table></div>` : vazio('Nenhuma demanda em aberto.', 'emoji-smile')}
        </div>
        <div class="card-x"><h3><i class="bi bi-kanban"></i>${ehGestor() ? 'Atividades do nosso time' : 'Minhas próximas atividades'} <a class="sub" href="#/atividades">abrir quadro</a></h3>
          ${ehGestor() && at.responsaveis.length ? `<div class="mb-3">${at.responsaveis.map((p) => `<div class="d-flex justify-content-between align-items-start gap-2 py-2 border-bottom">
            <div class="min-w-0"><div class="fw-semibold">${esc(p.nome)}</div>
              <div class="small-muted">${p.concluidas} concluída(s) em ${at.periodo_dias} dias${p.com_prazo ? ` · ${Math.round((p.no_prazo / p.com_prazo) * 100)}% no prazo` : ''} · execução média ${dur(p.tempo_medio)}</div></div>
            <div class="text-end text-nowrap"><div><strong>${p.abertas}</strong> <span class="small-muted">em aberto</span></div>
              ${p.atrasadas ? `<div class="text-danger small fw-semibold">${p.atrasadas} atrasada(s)</div>` : ''}</div></div>`).join('')}</div>` : ''}
          ${prox.length ? prox.map((t) => cartaoTarefa(t)).join('') : vazio('Nenhuma atividade em aberto.', 'check2-all')}
          <a class="btn btn-sm btn-brand mt-2" href="#/atividades/nova"><i class="bi bi-plus-lg"></i> Nova atividade</a>
        </div>
      </div>`;
    $$('[data-dias]').forEach((b) => b.addEventListener('click', () => {
      periodo = Number(b.dataset.dias);
      store.set('gbf_periodo', String(periodo));
      render();
    }));
    ligarCliques();
  }

  function ligarCliques() {
    $$('[data-href]').forEach((el) => el.addEventListener('click', () => { location.hash = el.dataset.href; }));
  }

  // ------------------------------------------------------------------
  // Demandas
  // ------------------------------------------------------------------
  let filtrosDemandas = null;

  async function vDemandas(qs, seq) {
    titulo('Demandas da Orcim');
    if (!filtrosDemandas) filtrosDemandas = await API.get('/demandas/filtros');
    const f = Object.fromEntries(qs.entries());
    if (!f.situacao) f.situacao = 'abertas';
    const lista = await API.get(`/demandas?${new URLSearchParams(f)}`);
    if (seq !== renderSeq) return;
    const chips = [['abertas', 'Em aberto'], ['atrasadas', 'Atrasadas'], ['em_risco', 'Vencem em 4 h'], ['sem_tecnico', 'Sem técnico'],
      ['aprovacao', 'Aguardando aprovação'], ['concluidas', 'Concluídas'], ['todas', 'Todas']];
    const sel = (nome, opcoes, atual, rotulo) => `<select class="form-select form-select-sm" data-f="${nome}" aria-label="${rotulo}">
      <option value="">${rotulo}</option>${opcoes.map(([v, t]) => `<option value="${esc(v)}" ${String(atual ?? '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    view().innerHTML = `
      <div class="chips">${chips.map(([v, t]) => `<button class="chip ${f.situacao === v ? 'active' : ''}" data-sit="${v}">${t}</button>`).join('')}</div>
      <div class="filters">
        <input class="form-control form-control-sm grow" data-f="q" placeholder="Buscar por número, título ou empresa" value="${esc(f.q || '')}">
        ${sel('empresa', filtrosDemandas.empresas.map((e) => [e.id, e.name]), f.empresa, 'Empresa')}
        ${sel('tecnico', [['nenhum', 'Sem técnico'], ...filtrosDemandas.tecnicos.map((t) => [t.id, t.name])], f.tecnico, 'Técnico Orcim')}
        ${sel('prioridade', [[4, 'Operação parada'], [3, 'Parada iminente'], [2, 'Operação prejudicada'], [1, 'Requisição']], f.prioridade, 'Urgência')}
        <input type="date" class="form-control form-control-sm" data-f="de" value="${esc(f.de || '')}" title="Aberta a partir de">
        <input type="date" class="form-control form-control-sm" data-f="ate" value="${esc(f.ate || '')}" title="Aberta até">
      </div>
      <div class="small-muted mb-2">${lista.length} demanda(s)${lista.length >= 300 ? ' — mostrando as primeiras 300, refine os filtros' : ''}</div>
      ${lista.length ? `
      <div class="card-x p-0 hide-mobile"><div class="table-wrap"><table class="table-x">
        <thead><tr><th>Nº</th><th>Demanda</th><th>Status</th><th>Urgência</th><th>Técnico Orcim</th><th>Aberta em</th><th>Tempo</th><th>Prazo</th><th>Nossas atividades</th></tr></thead>
        <tbody>${lista.map((d) => `<tr class="click" data-href="#/demandas/${d.id}">
          <td class="num">${esc(d.number || '#' + d.id)}</td>
          <td><div class="fw-semibold">${esc(d.title)}</div><div class="small-muted">${esc(d.entity_name)}${d.category_name ? ' · ' + esc(d.category_name) : ''}</div></td>
          <td>${tagStatus(d)}</td><td>${tagPrio(d)}</td>
          <td>${d.assigned_name ? esc(d.assigned_name) : '<span class="muted">—</span>'}</td>
          <td class="text-nowrap">${fmtData(d.created_at)}</td>
          <td class="text-nowrap">${d.aberto ? `<span title="Aberta há">${dur(d.tempo_aberto)}</span>` : `<span title="Tempo até resolver">${dur(d.tempo_resolucao)}</span>`}</td>
          <td>${tagSla(d.sla)}${d.due_at ? `<div class="small-muted">${fmtData(d.due_at)}</div>` : ''}</td>
          <td>${d.atividades ? tag(d.atividades.abertas ? 'tag-teal' : 'tag-gray', `${d.atividades.abertas} aberta(s) / ${d.atividades.total}`, 'kanban') : '<span class="muted">—</span>'}</td>
        </tr>`).join('')}</tbody></table></div></div>
      <div class="cards-list">${lista.map((d) => `<div class="item-card" data-href="#/demandas/${d.id}">
        <div class="meta"><span class="num">${esc(d.number || '#' + d.id)}</span>${tagStatus(d)}${tagSla(d.sla)}</div>
        <div class="ttl">${esc(d.title)}</div>
        <div class="meta"><span>${esc(d.entity_name)}</span><span>· ${d.aberto ? `aberta há ${dur(d.tempo_aberto)}` : `resolvida em ${dur(d.tempo_resolucao)}`}</span>
        ${d.assigned_name ? `<span>· ${esc(d.assigned_name)}</span>` : ''}</div></div>`).join('')}</div>`
    : `<div class="card-x">${vazio('Nenhuma demanda com esses filtros.')}</div>`}`;

    const aplicar = (extra = {}) => {
      const novo = { ...f, ...extra };
      $$('[data-f]').forEach((el) => { novo[el.dataset.f] = el.value; });
      Object.assign(novo, extra);
      Object.keys(novo).forEach((k) => { if (!novo[k]) delete novo[k]; });
      location.hash = `#/demandas?${new URLSearchParams(novo)}`;
    };
    $$('[data-sit]').forEach((b) => b.addEventListener('click', () => aplicar({ situacao: b.dataset.sit })));
    $$('select[data-f], input[type=date][data-f]').forEach((el) => el.addEventListener('change', () => aplicar()));
    const busca = $('input[data-f=q]');
    let t;
    busca.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => aplicar(), 500); });
    if (f.q) { busca.focus(); busca.setSelectionRange(busca.value.length, busca.value.length); }
    ligarCliques();
  }

  async function vDemanda(id, seq) {
    const d = await API.get(`/demandas/${encodeURIComponent(id)}`);
    if (seq !== renderSeq) return;
    titulo(d.number || `Demanda #${d.id}`);
    const maiorEtapa = Math.max(1, ...d.tempo_por_etapa.map((e) => e.segundos));
    const aprov = { pending: tag('tag-amber', 'Aprovação pendente', 'patch-question'), approved: tag('tag-green', 'Solução aprovada'), rejected: tag('tag-red', 'Solução reprovada') }[d.approval_status] || '';
    view().innerHTML = `
      <a href="#/demandas" class="small-muted text-decoration-none"><i class="bi bi-arrow-left"></i> Demandas</a>
      <div class="detail-head">
        <div class="min-w-0">
          <div class="d-flex flex-wrap gap-2 align-items-center mt-2"><span class="num">${esc(d.number || '#' + d.id)}</span>${tagStatus(d)}${tagPrio(d)}${tagSla(d.sla)}${aprov}</div>
          <h3>${esc(d.title)}</h3>
          <div class="small-muted">${esc(d.entity_name)}${d.category_name ? ' · ' + esc(d.category_name) : ''}</div>
        </div>
        <a class="btn btn-brand btn-sm" href="#/atividades/nova?demanda=${d.id}"><i class="bi bi-plus-lg"></i> Criar atividade nossa</a>
      </div>
      <div class="stepper mb-3">
        <div class="step"><div class="l">Até a 1ª resposta</div><div class="v">${dur(d.tempo_primeira_resposta)}</div></div>
        <div class="step"><div class="l">Até começar</div><div class="v">${dur(d.tempo_ate_atendimento)}</div></div>
        <div class="step"><div class="l">${d.aberto ? 'Aberta há' : 'Até resolver'}</div><div class="v">${dur(d.aberto ? d.tempo_aberto : d.tempo_resolucao)}</div></div>
        <div class="step"><div class="l">Prazo</div><div class="v">${d.due_at ? fmtData(d.due_at) : '—'}</div></div>
      </div>
      <div class="grid-2">
        <div class="card-x">
          <h3><i class="bi bi-info-circle"></i>Dados</h3>
          <dl class="kv">
            <dt>Solicitante</dt><dd>${esc(d.requester_name || '—')}</dd>
            <dt>Técnico Orcim</dt><dd>${esc(d.assigned_name || 'Ainda sem técnico')}</dd>
            <dt>Aberta em</dt><dd>${fmtData(d.created_at)}</dd>
            <dt>Atribuída em</dt><dd>${fmtData(d.atribuido_em)}</dd>
            <dt>Resolvida em</dt><dd>${fmtData(d.resolvido_em)}</dd>
            <dt>Fechada em</dt><dd>${fmtData(d.closed_at)}</dd>
            <dt>Última atualização</dt><dd>${fmtData(d.updated_at)}</dd>
          </dl>
          <hr><div class="small-muted mb-1">Descrição</div><div style="white-space:pre-wrap">${esc(d.description)}</div>
          ${d.anexos.length ? `<hr><div class="small-muted mb-1">Anexos</div>${d.anexos.map((a) => `<div><a href="/api/gbf/demandas/${d.id}/anexos/${a.id}?token=${encodeURIComponent(API.token)}" target="_blank" rel="noopener"><i class="bi bi-paperclip"></i> ${esc(a.file_name)}</a></div>`).join('')}` : ''}
        </div>
        <div class="card-x">
          <h3><i class="bi bi-clock-history"></i>Tempo em cada etapa</h3>
          ${d.tempo_por_etapa.length ? `<div class="bars mb-3">${d.tempo_por_etapa.map((e) => `<div class="bar-row"><span class="nm">${esc(e.etapa)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, (e.segundos / maiorEtapa) * 100)}%"></div></div><span class="v text-nowrap">${dur(e.segundos)}</span></div>`).join('')}</div>` : '<div class="small-muted mb-3">Sem histórico de status.</div>'}
          <h3><i class="bi bi-signpost-split"></i>Linha do tempo</h3>
          <ul class="timeline">${d.historico.map((h) => `<li><div>${h.old_label ? `${esc(h.old_label)} → ` : ''}<strong>${esc(h.new_label)}</strong></div>
            <div class="when">${fmtData(h.created_at)}${h.user_name ? ' · ' + esc(h.user_name) : ''}</div></li>`).join('') || '<li class="small-muted">Sem registros.</li>'}</ul>
        </div>
      </div>
      <div class="grid-2">
        <div class="card-x"><h3><i class="bi bi-chat-left-text"></i>Conversa na Central <span class="sub">somente leitura</span></h3>
          ${d.mensagens.map((m) => `<div class="msg ${m.kind === 'system' ? 'sys' : ''}">
            <div class="d-flex justify-content-between gap-2"><span class="who">${esc(m.author_name)}${m.kind === 'note' ? ' · nota' : m.kind === 'approval' ? ' · aprovação' : ''}</span><span class="small-muted">${fmtData(m.created_at)}</span></div>
            <div class="body">${esc(m.content)}</div></div>`).join('') || '<div class="small-muted">Sem mensagens.</div>'}
        </div>
        <div class="card-x"><h3><i class="bi bi-kanban"></i>Nossas atividades nesta demanda</h3>
          ${d.atividades.length ? d.atividades.map((t) => `<div class="task" data-href="#/atividades/${t.id}"><div class="ttl">${esc(t.title)}</div>
            <div class="meta">${tagTarefa(t.status)}${t.assignee_name ? `<span>${esc(t.assignee_name)}</span>` : ''}${t.due_at ? `<span>· prazo ${prazoTxt(t)}</span>` : ''}</div></div>`).join('')
    : vazio('Nenhuma atividade nossa ligada a esta demanda.', 'kanban')}
        </div>
      </div>`;
    ligarCliques();
  }

  // ------------------------------------------------------------------
  // Manutenções
  // ------------------------------------------------------------------
  async function vManutencoes(seq) {
    titulo('Manutenções programadas');
    const r = await API.get('/demandas/manutencoes');
    if (seq !== renderSeq) return;
    if (!r.disponivel) { view().innerHTML = `<div class="card-x">${vazio('O inventário da Central ainda não está ativo neste servidor.', 'tools')}</div>`; return; }
    const tagDias = (n) => (n < 0 ? tag('tag-red', `Vencida há ${-n} dia(s)`) : n === 0 ? tag('tag-amber', 'Vence hoje') : n <= 7 ? tag('tag-amber', `Em ${n} dia(s)`) : tag('tag-green', `Em ${n} dias`));
    view().innerHTML = `
      <div class="card-x mb-3"><h3><i class="bi bi-calendar-event"></i>Vencidas e próximas (60 dias) <span class="sub">${r.programadas.length} equipamento(s)</span></h3>
        ${r.programadas.length ? `<div class="table-wrap"><table class="table-x"><thead><tr><th>Equipamento</th><th>Empresa / local</th><th>Serviço previsto</th><th>Data</th><th>Situação</th></tr></thead><tbody>
        ${r.programadas.map((a) => `<tr><td><div class="fw-semibold">${esc(a.name)}</div><div class="num">${esc(a.asset_tag || '')}</div></td>
          <td>${esc(a.entity_name)}<div class="small-muted">${esc([a.location, a.department].filter(Boolean).join(' · '))}</div></td>
          <td>${esc(a.next_maintenance_notes || '—')}</td><td class="text-nowrap">${fmtDia(a.next_maintenance_date)}</td><td>${tagDias(a.dias)}</td></tr>`).join('')}
        </tbody></table></div>` : vazio('Nenhuma manutenção programada para os próximos 60 dias.', 'calendar-check')}
      </div>
      <div class="card-x"><h3><i class="bi bi-wrench-adjustable"></i>Realizadas nos últimos 90 dias <span class="sub">${r.realizadas.length}</span></h3>
        ${r.realizadas.length ? `<div class="table-wrap"><table class="table-x"><thead><tr><th>Data</th><th>Equipamento</th><th>Empresa</th><th>O que foi feito</th><th>Registrado por</th></tr></thead><tbody>
        ${r.realizadas.map((m) => `<tr><td class="text-nowrap">${fmtDia(m.performed_at)}</td><td>${esc(m.asset_name)}<div class="num">${esc(m.asset_tag || '')}</div></td>
          <td>${esc(m.entity_name)}</td><td style="white-space:pre-wrap">${esc(m.description)}</td><td>${esc(m.created_by_name || '—')}</td></tr>`).join('')}
        </tbody></table></div>` : vazio('Nenhuma manutenção registrada nos últimos 90 dias.', 'wrench')}
      </div>`;
  }

  // ------------------------------------------------------------------
  // Atividades
  // ------------------------------------------------------------------
  let usuariosAtivos = null;
  async function carregarUsuarios() {
    if (!usuariosAtivos) usuariosAtivos = await API.get('/usuarios/ativos');
    return usuariosAtivos;
  }

  function cartaoTarefa(t, arrastar = false) {
    const cls = t.prazo === 'atrasada' ? 'late' : t.prazo === 'vence_logo' ? 'soon' : '';
    return `<div class="task ${cls}" data-href="#/atividades/${t.id}"${arrastar ? ` data-drag="${esc(JSON.stringify({ kanban: 1, id: t.id, status: t.status }))}" title="Arraste para outra coluna"` : ''}>
      <div class="ttl">${esc(t.title)}</div>
      <div class="meta">
        ${t.priority >= 3 ? tag(TAG_PRIO[t.priority], PRIO_TAREFA[t.priority]) : ''}
        ${tagPrazoTarefa(t.prazo)}
        ${t.status === 'aguardando' && t.waiting_for ? tag('tag-amber', t.waiting_for, 'pause-circle') : ''}
        ${t.due_at ? `<span><i class="bi bi-calendar"></i> ${prazoTxt(t)}</span>` : ''}
        ${t.ticket_number ? `<span><i class="bi bi-link-45deg"></i>${esc(t.ticket_number)}</span>` : ''}
        ${t.location_name ? `<span><i class="bi bi-geo-alt"></i>${esc(t.location_name)}</span>` : ''}
        ${ehGestor() && t.assignee_name ? `<span><i class="bi bi-person"></i> ${esc(t.assignee_name)}</span>` : ''}
      </div></div>`;
  }

  // Histórico da atividade: ações do sistema em uma linha pequena; comentários em destaque
  function iconeAcao(txt) {
    const t = String(txt || '').toLowerCase();
    if (t.includes('status')) return 'arrow-repeat';
    if (t.includes('prazo')) return 'calendar-event';
    if (t.includes('respons') || t.includes('atribu')) return 'person';
    if (t.includes('criou') || t.includes('criada')) return 'plus-circle';
    if (t.includes('urg') || t.includes('prioridade')) return 'exclamation-triangle';
    return 'dot';
  }
function itemHistorico(e) {
    const hora = new Date(e.created_at).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
    if (e.kind === 'system') {
      return `<div class="hist-acao"><i class="bi bi-${iconeAcao(e.content)}"></i>
        <span class="hist-txt"><b>${esc(e.user_name || 'Sistema')}</b> ${esc(e.user_name && String(e.content).startsWith(e.user_name) ? String(e.content).slice(e.user_name.length).trim() : e.content)}</span>
        <span class="hist-quando">${hora}</span></div>`;
    }
    return `<div class="hist-coment"><span class="avatar">${esc(iniciais(e.user_name || '?'))}</span>
      <div class="hist-balao"><div class="hist-cab"><b>${esc(e.user_name || 'Sistema')}</b><span>${hora}</span></div>
      <div class="hist-corpo">${realcarMencoes(esc(e.content))}</div></div></div>`;
  }
  // separa o histórico por dia: "Hoje", "Ontem", "qua, 18/11"
  function historicoHtml(eventos) {
    if (!eventos.length) return '<div class="small-muted">Nada ainda.</div>';
    let dia = null;
    return eventos.map((e) => {
      const d = new Date(e.created_at).toLocaleDateString('en-CA', { timeZone: TZ });
      const cab = d !== dia ? `<div class="hist-dia">${d === hojeSP() ? 'Hoje' : d === isoSoma(hojeSP(), -1) ? 'Ontem' : dataCurta(d)}</div>` : '';
      dia = d;
      return cab + itemHistorico(e);
    }).join('');
  }
  // @Nome vira destaque (só nomes de usuários que existem)
  function realcarMencoes(html) {
    const nomes = (usuariosAtivos || []).map((u) => esc(u.name)).sort((a, b) => b.length - a.length);
    let out = html;
    for (const n of nomes) out = out.split(`@${n}`).join(`<span class="mencao">@${n}</span>`);
    return out;
  }

  // Marcação com @ num campo de texto: lista de pessoas enquanto digita
  async function ligarMencoes(campo) {
    const users = (await carregarUsuarios()).filter((u) => u.role !== 'unidade');
    const lista = document.createElement('div');
    lista.className = 'mencao-lista d-none';
    campo.parentElement.style.position = 'relative';
    campo.after(lista);
    let achados = []; let sel = 0;
    const termo = () => {
      const antes = campo.value.slice(0, campo.selectionStart);
      const m = antes.match(/(^|\s)@([^@\n]{0,30})$/);
      return m ? m[2] : null;
    };
    const fechar = () => { lista.classList.add('d-none'); achados = []; };
    const pintar = () => {
      lista.innerHTML = achados.map((u, i) => `<button type="button" class="${i === sel ? 'on' : ''}" data-i="${i}"><span class="avatar">${esc(iniciais(u.name))}</span>${esc(u.name)}</button>`).join('');
      lista.classList.toggle('d-none', !achados.length);
    };
    const escolher = (u) => {
      const pos = campo.selectionStart;
      const antes = campo.value.slice(0, pos).replace(/@([^@\n]{0,30})$/, `@${u.name} `);
      campo.value = antes + campo.value.slice(pos);
      campo.setSelectionRange(antes.length, antes.length);
      fechar(); campo.focus();
    };
    campo.addEventListener('input', () => {
      const t = termo();
      if (t === null) { fechar(); return; }
      const b = t.toLowerCase();
      achados = users.filter((u) => u.name.toLowerCase().split(/\s+/).some((p) => p.startsWith(b)) || u.name.toLowerCase().startsWith(b)).slice(0, 6);
      sel = 0; pintar();
    });
    campo.addEventListener('keydown', (e) => {
      if (!achados.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % achados.length; pintar(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + achados.length) % achados.length; pintar(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); escolher(achados[sel]); }
      else if (e.key === 'Escape') { e.stopPropagation(); fechar(); }
    });
    lista.addEventListener('mousedown', (e) => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); escolher(achados[Number(b.dataset.i)]); } });
    campo.addEventListener('blur', () => setTimeout(fechar, 150));
  }

  // "Aguardando o quê?": pop-up ao mudar para Aguardando (no botão ou arrastando no quadro)
  const MOTIVOS_AGUARDANDO = ['Peça / fornecedor', 'Resposta do posto', 'Aprovação do gestor', 'Orcim', 'Terceiro / operadora'];
  function pedirAguardando(id, depois) {
    const el = janela('Aguardando o quê?', `
      <label class="form-label" for="ag-oque">O que falta para continuar?</label>
      <input class="form-control mb-2" id="ag-oque" maxlength="200" placeholder="Ex.: peça chegar do fornecedor">
      <div class="ag-motivos mb-3">${MOTIVOS_AGUARDANDO.map((m) => `<button type="button" class="chip" data-mot="${esc(m)}">${esc(m)}</button>`).join('')}</div>
      <label class="form-label" for="ag-com">Comentário <span class="small-muted">(opcional · use @ para marcar alguém)</span></label>
      <textarea class="form-control" id="ag-com" rows="3" placeholder="Ex.: pedi para @Pedro aprovar a compra"></textarea>`, {
      ok: 'Marcar como aguardando',
      onOk: async (m) => {
        const oque = m.querySelector('#ag-oque').value.trim();
        if (!oque) throw new Error('Diga o que a atividade está aguardando.');
        await API.patch(`/atividades/${id}`, { status: 'aguardando', aguardando: oque });
        const com = m.querySelector('#ag-com').value.trim();
        if (com) await API.post(`/atividades/${id}/comentarios`, { content: com });
        toast('Atividade aguardando. A equipe foi avisada.');
        if (depois) depois();
      },
    });
    el.querySelectorAll('[data-mot]').forEach((b) => b.addEventListener('click', () => {
      el.querySelector('#ag-oque').value = b.dataset.mot; el.querySelector('#ag-oque').focus();
    }));
    ligarMencoes(el.querySelector('#ag-com'));
    setTimeout(() => el.querySelector('#ag-oque')?.focus(), 300);
  }

    async function vAtividades(qs, seq) {
    titulo(ehGestor() ? 'Atividades do time' : 'Minhas atividades');
    const f = Object.fromEntries(qs.entries());
    const modo = f.situacao || 'quadro';
    const params = new URLSearchParams();
    if (modo !== 'quadro' && modo !== 'todas') params.set('situacao', modo);
    if (f.responsavel) params.set('responsavel', f.responsavel);
    if (f.q) params.set('q', f.q);
    const [lista, users] = await Promise.all([API.get(`/atividades?${params}`), ehGestor() ? carregarUsuarios() : []]);
    if (seq !== renderSeq) return;
    const chips = [['quadro', 'Quadro'], ['hoje', 'Para hoje'], ['atrasadas', 'Atrasadas'], ['abertas', 'Em aberto'], ['concluidas', 'Concluídas'], ['todas', 'Todas']];
    let corpo;
    if (modo === 'quadro') {
      const cols = [['a_fazer', 'A fazer'], ['em_andamento', 'Em andamento'], ['aguardando', 'Aguardando'], ['concluida', 'Concluídas (recentes)']];
      corpo = `<div class="board">${cols.map(([s, nome]) => {
        let itens = lista.filter((t) => t.status === s);
        if (s === 'concluida') itens = itens.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at)).slice(0, 10);
        return `<div class="col" data-drop-status="${s}"><h4><span>${nome}</span><span class="muted">${itens.length}</span></h4>${itens.map((t) => cartaoTarefa(t, true)).join('') || '<div class="small-muted px-1 vazio-col">Solte aqui</div>'}</div>`;
      }).join('')}</div>`;
    } else {
      corpo = lista.length ? `<div class="card-x p-0"><div class="table-wrap"><table class="table-x">
        <thead><tr><th>Atividade</th><th>Status</th><th class="hide-mobile">Responsável</th><th>Prazo</th><th class="hide-mobile">Demanda</th></tr></thead><tbody>
        ${lista.map((t) => `<tr class="click" data-href="#/atividades/${t.id}"><td><div class="fw-semibold">${esc(t.title)}</div>${t.location ? `<div class="small-muted">${esc(t.location)}</div>` : ''}</td>
          <td>${tagTarefa(t.status)}</td><td class="hide-mobile">${esc(t.assignee_name || '—')}</td>
          <td class="text-nowrap">${prazoTxt(t)} ${tagPrazoTarefa(t.prazo)}</td>
          <td class="hide-mobile">${t.ticket_number ? `<span class="num">${esc(t.ticket_number)}</span>` : '—'}</td></tr>`).join('')}
        </tbody></table></div></div>` : `<div class="card-x">${vazio('Nenhuma atividade aqui.', 'check2-all')}</div>`;
    }
    view().innerHTML = `
      <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
        <div class="chips mb-0 me-auto">${chips.map(([v, t]) => `<button class="chip ${modo === v ? 'active' : ''}" data-modo="${v}">${t}</button>`).join('')}</div>
        <a class="btn btn-brand btn-sm" href="#/atividades/nova"><i class="bi bi-plus-lg"></i> Nova atividade</a>
      </div>
      <div class="filters">
        <input class="form-control form-control-sm grow" id="busca-at" placeholder="Buscar atividade" value="${esc(f.q || '')}">
        ${ehGestor() ? `<select class="form-select form-select-sm" id="resp-at" aria-label="Responsável"><option value="">Todos os responsáveis</option><option value="nenhum" ${f.responsavel === 'nenhum' ? 'selected' : ''}>Sem responsável</option>
          ${users.map((u) => `<option value="${u.id}" ${String(f.responsavel) === String(u.id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
      </div>
      ${corpo}`;
    const ir = (extra) => {
      const novo = { ...f, ...extra };
      Object.keys(novo).forEach((k) => { if (!novo[k]) delete novo[k]; });
      location.hash = `#/atividades?${new URLSearchParams(novo)}`;
    };
    $$('[data-modo]').forEach((b) => b.addEventListener('click', () => ir({ situacao: b.dataset.modo === 'quadro' ? '' : b.dataset.modo })));
    $('#resp-at')?.addEventListener('change', (e) => ir({ responsavel: e.target.value }));
    if (modo === 'quadro') ativarArrasto(view());
    let t;
    const busca = $('#busca-at');
    busca.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => ir({ q: busca.value.trim() }), 500); });
    if (f.q) { busca.focus(); busca.setSelectionRange(busca.value.length, busca.value.length); }
    ligarCliques();
  }

  async function vFormAtividade(id, qs, seq) {
    const [t, users, demandas, postos] = await Promise.all([
      id ? API.get(`/atividades/${encodeURIComponent(id)}`) : null,
      ehGestor() ? carregarUsuarios() : [],
      API.get('/demandas?situacao=todas&limite=400'),
      API.get('/postos'),
    ]);
    if (seq !== renderSeq) return;
    titulo(id ? 'Editar atividade' : 'Nova atividade');
    const demandaSel = t ? t.ticket_id : qs.get('demanda');
    const postoSel = t ? t.location_id : qs.get('posto');
    const opcoesDemanda = demandas
      .filter((d) => d.aberto || String(d.id) === String(demandaSel))
      .map((d) => `<option value="${d.id}" ${String(d.id) === String(demandaSel) ? 'selected' : ''}>${esc(d.number || '#' + d.id)} — ${esc(d.title)} (${esc(d.entity_name)})</option>`).join('');
    view().innerHTML = `
      <a href="${id ? `#/atividades/${id}` : '#/atividades'}" class="small-muted text-decoration-none"><i class="bi bi-arrow-left"></i> Voltar</a>
      <form class="card-x mt-2" id="form-at" style="max-width:760px">
        <div class="mb-3"><label class="form-label">O que precisa ser feito *</label>
          <input class="form-control" name="title" maxlength="200" required value="${esc(t?.title || (id ? '' : qs.get('titulo') || ''))}"></div>
        ${!id && /^\d+$/.test(qs.get('visita') || '') ? `<input type="hidden" name="visit_id" value="${esc(qs.get('visita'))}">
          <div class="alert alert-light py-2 small">Esta atividade fica ligada à <a href="#/visitas/${esc(qs.get('visita'))}">visita</a> onde o problema apareceu.</div>` : ''}
        <div class="mb-3"><label class="form-label">Detalhes</label>
          <textarea class="form-control" name="description" rows="4">${esc(t?.description || '')}</textarea></div>
        <div class="row g-3 mb-3">
          <div class="col-sm-6"><label class="form-label">Prazo</label><div class="d-flex gap-2">
            <input type="date" class="form-control" name="due_date" value="${diaDoPrazo(t)}" aria-label="Dia do prazo">
            <input type="time" class="form-control" name="due_time" value="${horaDoPrazo(t)}" aria-label="Horário (opcional)" style="max-width:9rem"></div>
            <div class="form-text">Sem horário = o dia todo.</div></div>
          <div class="col-sm-6"><label class="form-label">Começa em <span class="small-muted">(opcional)</span></label>
            <input type="date" class="form-control" name="start_date" value="${esc(t?.inicio || '')}">
            <div class="form-text">Para atividade de vários dias: aparece no calendário como uma linha até a entrega.</div></div>
          <div class="col-sm-6"><label class="form-label">Urgência</label><select class="form-select" name="priority">
            ${[1, 2, 3, 4].map((p) => `<option value="${p}" ${(t?.priority || 1) === p ? 'selected' : ''}>${PRIO_TAREFA[p]}</option>`).join('')}</select></div>
          ${ehGestor() ? `<div class="col-sm-6"><label class="form-label">Responsável</label><select class="form-select" name="assignee_id">
            <option value="">Sem responsável</option>${users.map((u) => `<option value="${u.id}" ${String(t ? t.assignee_id : EU.id) === String(u.id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>` : ''}
          <div class="col-sm-6"><label class="form-label">Posto</label><select class="form-select" name="location_id">
            <option value="">Nenhum</option>${postos.map((p) => `<option value="${p.id}" ${String(p.id) === String(postoSel) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div class="col-sm-6"><label class="form-label">Local / detalhe</label><input class="form-control" name="location" value="${esc(t?.location || '')}" placeholder="Ex.: sala do servidor, caixa 2"></div>
        </div>
        <div class="mb-3"><label class="form-label">Demanda da Orcim relacionada</label>
          <select class="form-select" name="ticket_id"><option value="">Nenhuma</option>${opcoesDemanda}</select>
          <div class="form-text">Ligue a atividade a um chamado da Orcim para acompanhar os dois juntos.</div></div>
        <div class="alert alert-danger py-2 d-none" id="at-erro"></div>
        <button class="btn btn-brand" type="submit">${id ? 'Salvar' : 'Criar atividade'}</button>
      </form>`;
    $('#form-at').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const body = {
        title: fd.get('title'), description: fd.get('description'), priority: Number(fd.get('priority')),
        due_date: fd.get('due_date') || '', due_time: fd.get('due_time') || '', start_date: fd.get('start_date') || '', location: fd.get('location'), ticket_id: fd.get('ticket_id') || null,
        location_id: fd.get('location_id') || null,
      };
      if (!id && fd.get('visit_id')) body.visit_id = fd.get('visit_id');
      if (ehGestor()) body.assignee_id = fd.get('assignee_id') || null;
      try {
        const r = id ? await API.patch(`/atividades/${id}`, body) : await API.post('/atividades', body);
        toast(id ? 'Atividade atualizada.' : 'Atividade criada.');
        location.hash = `#/atividades/${r.id}`;
      } catch (e) {
        $('#at-erro').textContent = e.message;
        $('#at-erro').classList.remove('d-none');
      }
    });
  }

  async function vAtividade(id, seq) {
    const [t] = await Promise.all([API.get(`/atividades/${encodeURIComponent(id)}`), carregarUsuarios()]);
    if (seq !== renderSeq) return;
    titulo('Atividade');
    const acoes = {
      a_fazer: [['em_andamento', 'Começar', 'play-fill', 'btn-brand'], ['aguardando', 'Aguardando', 'pause', 'btn-outline-secondary'], ['concluida', 'Concluir', 'check2', 'btn-outline-success']],
      em_andamento: [['concluida', 'Concluir', 'check2', 'btn-brand'], ['aguardando', 'Aguardando', 'pause', 'btn-outline-secondary']],
      aguardando: [['em_andamento', 'Retomar', 'play-fill', 'btn-brand'], ['concluida', 'Concluir', 'check2', 'btn-outline-success']],
      concluida: [['em_andamento', 'Reabrir', 'arrow-counterclockwise', 'btn-outline-secondary']],
      cancelada: [['a_fazer', 'Reabrir', 'arrow-counterclockwise', 'btn-outline-secondary']],
    }[t.status] || [];
    if (t.aberta) acoes.push(['cancelada', 'Cancelar', 'x-lg', 'btn-outline-danger']);
    view().innerHTML = `
      <a href="#/atividades" class="small-muted text-decoration-none"><i class="bi bi-arrow-left"></i> Atividades</a>
      <div class="detail-head">
        <div class="min-w-0">
          <div class="d-flex flex-wrap gap-2 mt-2">${tagTarefa(t.status)}${t.status === 'aguardando' && t.waiting_for ? tag('tag-amber', `aguardando: ${t.waiting_for}`, 'pause-circle') : ''}${tagPrazoTarefa(t.prazo)}${t.priority >= 3 ? tag(TAG_PRIO[t.priority], PRIO_TAREFA[t.priority]) : ''}</div>
          <h3>${esc(t.title)}</h3>
        </div>
        <div class="d-flex flex-wrap gap-2">
          ${acoes.map(([s, txt, ic, cls]) => `<button class="btn btn-sm ${cls}" data-status="${s}"><i class="bi bi-${ic}"></i> ${txt}</button>`).join('')}
          <a class="btn btn-sm btn-outline-secondary" href="#/atividades/${t.id}/editar"><i class="bi bi-pencil"></i> Editar</a>
        </div>
      </div>
      <div class="grid-2">
        <div class="card-x">
          <dl class="kv">
            <dt>Responsável</dt><dd>${esc(t.assignee_name || 'Sem responsável')}</dd>
            <dt>Prazo</dt><dd>${prazoTxt(t)}</dd>
            <dt>Posto</dt><dd>${t.location_id ? `<a href="#/postos/${t.location_id}">${esc(t.location_name)}</a>` : '—'}${t.visit_id ? ` · <a href="#/visitas/${t.visit_id}">pendência de visita</a>` : ''}</dd>
            <dt>Local</dt><dd>${esc(t.location || '—')}</dd>
            <dt>Criada por</dt><dd>${esc(t.created_by_name || '—')} em ${fmtData(t.created_at)}</dd>
            <dt>Começou em</dt><dd>${fmtData(t.started_at)}</dd>
            <dt>Concluída em</dt><dd>${fmtData(t.completed_at)}${t.tempo_execucao !== null ? ` <span class="small-muted">(${dur(t.tempo_execucao)} de execução)</span>` : ''}</dd>
            <dt>Demanda Orcim</dt><dd>${t.ticket_id ? `<a href="#/demandas/${t.ticket_id}">${esc(t.ticket_number || '#' + t.ticket_id)}</a> ${t.ticket_status_label ? tag('tag-gray', t.ticket_status_label) : ''}<div class="small-muted">${esc(t.ticket_title || '')}</div>` : '—'}</dd>
          </dl>
          ${t.description ? `<hr><div style="white-space:pre-wrap">${esc(t.description)}</div>` : ''}
        </div>
        <div class="card-x">
          <h3><i class="bi bi-chat-dots"></i>Histórico e comentários</h3>
          <div class="hist">${historicoHtml(t.eventos)}</div>
          <form id="form-coment" class="mt-2">
            <div class="mb-2"><textarea class="form-control" name="content" rows="2" placeholder="Escreva um comentário ou atualização · @ para marcar alguém" required></textarea></div>
            <button class="btn btn-sm btn-brand" type="submit">Comentar</button>
          </form>
        </div>
      </div>`;
    $$('[data-status]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.status === 'cancelada' && !confirm('Cancelar esta atividade?')) return;
      if (b.dataset.status === 'aguardando') { pedirAguardando(t.id, render); return; }
      try {
        await API.patch(`/atividades/${t.id}`, { status: b.dataset.status });
        toast('Status atualizado.');
        render();
      } catch (e) { toast(e.message, true); }
    }));
    $('#form-coment').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await API.post(`/atividades/${t.id}/comentarios`, { content: ev.target.content.value });
        render();
      } catch (e) { toast(e.message, true); }
    });
    ligarMencoes($('#form-coment textarea'));
  }

  // ------------------------------------------------------------------
  // Usuários (gestor)
  // ------------------------------------------------------------------
  async function vUsuarios(seq) {
    titulo('Usuários do painel');
    const lista = await API.get('/usuarios');
    if (seq !== renderSeq) return;
    view().innerHTML = `
      <div class="grid-2" style="align-items:start">
        <div class="card-x p-0"><div class="table-wrap"><table class="table-x">
          <thead><tr><th>Nome</th><th>Usuário</th><th>Papel</th><th>Situação</th><th class="hide-mobile">Último acesso</th></tr></thead><tbody>
          ${lista.map((u) => `<tr class="click" data-uid="${u.id}"><td>${esc(u.name)}</td><td class="num">${esc(u.username)}</td>
            <td>${u.role === 'gestor' ? tag('tag-violet', 'Gestor') : ''}${u.role !== 'gestor' || u.faz_visitas ? ` ${tag('tag-teal', 'Técnico')}` : ''}</td>
            <td>${u.active ? tag('tag-green', 'Ativo') : tag('tag-gray', 'Inativo')}${u.must_change_password ? ' ' + tag('tag-amber', 'troca senha') : ''}</td>
            <td class="hide-mobile">${u.last_login ? fmtData(u.last_login) : '—'}</td></tr>`).join('')}
          </tbody></table></div></div>
        <form class="card-x" id="form-user">
          <h3 id="fu-titulo"><i class="bi bi-person-plus"></i>Novo usuário</h3>
          <input type="hidden" name="id">
          <div class="mb-2"><label class="form-label">Nome *</label><input class="form-control" name="name" required></div>
          <div class="mb-2"><label class="form-label">Usuário (login) *</label><input class="form-control" name="username" required pattern="[a-zA-Z0-9._\\-]{3,40}"></div>
          <div class="row g-2 mb-2">
            <div class="col-sm-6"><label class="form-label">E-mail</label><input class="form-control" name="email" type="email"></div>
            <div class="col-sm-6"><label class="form-label">Telefone</label><input class="form-control" name="phone"></div>
          </div>
          <div class="row g-2 mb-2">
            <div class="col-sm-6"><span class="form-label d-block">Papel (pode marcar os dois)</span>
              <div class="papeis" role="group" aria-label="Papéis">
                <label class="papel"><input type="checkbox" name="papel" value="gestor"><span>Gestor</span></label>
                <label class="papel"><input type="checkbox" name="papel" value="tecnico" checked><span>Técnico</span></label>
              </div></div>
            <div class="col-sm-6"><label class="form-label">Situação</label><select class="form-select" name="active">
              <option value="1">Ativo</option><option value="0">Inativo</option></select></div>
          </div>
          <div class="mb-2"><label class="form-label" id="fu-senha-lbl">Senha inicial * (mín. 8)</label>
            <input class="form-control" name="password" type="text" autocomplete="new-password" minlength="8">
            <div class="form-text">A pessoa troca a senha no primeiro acesso.</div></div>
          <div class="alert alert-danger py-2 d-none" id="fu-erro"></div>
          <div class="d-flex gap-2"><button class="btn btn-brand" type="submit">Salvar</button>
            <button class="btn btn-outline-secondary" type="button" id="fu-limpar">Novo</button></div>
        </form>
      </div>`;
    const form = $('#form-user');
    const limpar = () => {
      form.reset(); form.id.value = '';
      $('#fu-titulo').innerHTML = '<i class="bi bi-person-plus"></i>Novo usuário';
      $('#fu-senha-lbl').textContent = 'Senha inicial * (mín. 8)';
      $('#fu-erro').classList.add('d-none');
    };
    $('#fu-limpar').addEventListener('click', limpar);
    $$('[data-uid]').forEach((tr) => tr.addEventListener('click', () => {
      const u = lista.find((x) => String(x.id) === tr.dataset.uid);
      form.id.value = u.id; form.name.value = u.name; form.username.value = u.username;
      form.email.value = u.email || ''; form.phone.value = u.phone || '';
      $$('input[name=papel]', form).forEach((c) => { c.checked = (u.papeis || [u.role]).includes(c.value); });
      form.active.value = u.active ? '1' : '0'; form.password.value = '';
      $('#fu-titulo').innerHTML = `<i class="bi bi-pencil"></i>Editar ${esc(u.name)}`;
      $('#fu-senha-lbl').textContent = 'Nova senha (deixe em branco para manter)';
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = {
        name: form.name.value, username: form.username.value, email: form.email.value, phone: form.phone.value,
        papeis: $$('input[name=papel]:checked', form).map((c) => c.value), active: form.active.value === '1',
      };
      if (form.password.value) body.password = form.password.value;
      try {
        if (form.id.value) await API.patch(`/usuarios/${form.id.value}`, body);
        else {
          if (!body.password) throw new Error('Defina a senha inicial.');
          await API.post('/usuarios', body);
        }
        usuariosAtivos = null;
        toast('Usuário salvo.');
        render();
      } catch (e) {
        $('#fu-erro').textContent = e.message;
        $('#fu-erro').classList.remove('d-none');
      }
    });
  }

  // ------------------------------------------------------------------
  // Tudo da Orcim (gestor): cópia de todas as tabelas da Central
  // ------------------------------------------------------------------
  const NOMES_TABELA = {
    tickets: 'Chamados', ticket_messages: 'Mensagens dos chamados', ticket_status_history: 'Histórico de status',
    ticket_attachments: 'Anexos dos chamados', entities: 'Empresas', categories: 'Categorias', users: 'Usuários da Central',
    assets: 'Equipamentos', asset_maintenances: 'Manutenções de equipamentos', asset_photos: 'Fotos de equipamentos',
    asset_history: 'Histórico de equipamentos', agents: 'Agentes de inventário', settings: 'Configurações da Central',
    notification_log: 'Notificações enviadas', inapp_notifications: 'Avisos no sistema',
    asset_customer_history: 'Troca de empresa dos equipamentos', computer_details: 'Computadores (detalhes)',
    computer_gpu: 'Placas de vídeo', computer_memory: 'Memórias', computer_network_interfaces: 'Placas de rede',
    computer_software: 'Programas instalados', computer_storage: 'Discos', inventory_snapshots: 'Coletas de inventário',
    inventory_changes: 'Mudanças de inventário',
  };
  const nomeTabela = (t) => NOMES_TABELA[t] || t.replace(/_/g, ' ');
  const ehDataHora = (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(v));
  const valorCelula = (v, inteiro = false) => {
    if (v === null || v === undefined || v === '') return '<span class="muted">—</span>';
    if (typeof v === 'boolean') return v ? 'sim' : 'não';
    if (typeof v === 'object') return inteiro ? `<code>${esc(JSON.stringify(v, null, 2))}</code>` : `<code class="small">${esc(JSON.stringify(v).slice(0, 80))}</code>`;
    const txt = String(v);
    if (ehDataHora(txt)) return `<span class="text-nowrap">${fmtData(txt)}</span>`;
    return esc(!inteiro && txt.length > 90 ? `${txt.slice(0, 90)}…` : txt);
  };

  async function vEspelho(seq) {
    titulo('Tudo da Orcim');
    const r = await API.get('/espelho');
    if (seq !== renderSeq) return;
    const total = r.tabelas.reduce((n, t) => n + t.registros, 0);
    view().innerHTML = `
      <div class="small-muted mb-2">Cópia de todas as tabelas da Central da Orcim, atualizada a cada minuto pela integração instalada lá.
        Senhas, chaves, e-mails e telefones de usuários não são enviados.${r.recebido_em ? ` Estrutura recebida em ${fmtData(r.recebido_em)}.` : ''}</div>
      ${r.tabelas.length ? `
      <input class="form-control form-control-sm mb-2" id="filtro-tab" placeholder="Filtrar tabelas" style="max-width:320px">
      <div class="card-x p-0"><div class="table-wrap"><table class="table-x">
        <thead><tr><th>Tabela</th><th class="text-end">Registros</th><th>Último recebido</th></tr></thead>
        <tbody>${r.tabelas.map((t) => `<tr class="click" data-href="#/tudo/${encodeURIComponent(t.nome)}" data-nome="${esc(`${t.nome} ${nomeTabela(t.nome)}`.toLowerCase())}">
          <td><div class="fw-semibold">${esc(nomeTabela(t.nome))}</div><div class="small-muted">${esc(t.nome)}${t.colunas ? ` · ${t.colunas} colunas` : ''}</div></td>
          <td class="text-end num">${t.registros.toLocaleString('pt-BR')}</td>
          <td class="text-nowrap">${t.ultimo ? fmtData(t.ultimo) : '<span class="muted">—</span>'}</td>
        </tr>`).join('')}</tbody></table></div></div>
      <div class="small-muted mt-2">${r.tabelas.length} tabela(s) · ${total.toLocaleString('pt-BR')} registro(s)</div>`
    : `<div class="card-x">${vazio('Nada recebido ainda. Os dados aparecem aqui assim que a Orcim ligar a integração na Central deles.', 'hourglass-split')}</div>`}`;
    const filtro = $('#filtro-tab');
    if (filtro) {
      filtro.addEventListener('input', () => {
        const q = filtro.value.trim().toLowerCase();
        $$('tr[data-nome]').forEach((tr) => { tr.style.display = !q || tr.dataset.nome.includes(q) ? '' : 'none'; });
      });
    }
    ligarCliques();
  }

  async function vEspelhoTabela(tabela, qs, seq) {
    titulo(nomeTabela(tabela));
    const f = Object.fromEntries(qs.entries());
    const r = await API.get(`/espelho/${encodeURIComponent(tabela)}?${new URLSearchParams(f)}`);
    if (seq !== renderSeq) return;
    const paginas = Math.max(1, Math.ceil(r.total / r.por_pagina));
    const link = (p) => `#/tudo/${encodeURIComponent(tabela)}?${new URLSearchParams({ ...f, pagina: p })}`;
    view().innerHTML = `
      <a href="#/tudo" class="small-muted text-decoration-none"><i class="bi bi-arrow-left"></i> Todas as tabelas</a>
      <div class="filters mt-2">
        <input class="form-control form-control-sm grow" id="busca-reg" placeholder="Buscar em qualquer campo" value="${esc(f.busca || '')}">
      </div>
      <div class="small-muted mb-2">${r.total.toLocaleString('pt-BR')} registro(s) · tabela <code>${esc(tabela)}</code></div>
      ${r.registros.length ? `
      <div class="card-x p-0"><div class="table-wrap"><table class="table-x">
        <thead><tr>${r.colunas.map((c) => `<th class="text-nowrap">${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${r.registros.map((l) => `<tr class="click" data-href="#/tudo/${encodeURIComponent(tabela)}/${encodeURIComponent(l.chave)}">
          ${r.colunas.map((c) => `<td class="cel-espelho">${valorCelula(l.dados[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
      ${paginas > 1 ? `<div class="d-flex gap-2 align-items-center mt-2">
        ${r.pagina > 1 ? `<a class="btn btn-sm btn-outline-secondary" href="${link(r.pagina - 1)}"><i class="bi bi-chevron-left"></i> Anterior</a>` : ''}
        <span class="small-muted">Página ${r.pagina} de ${paginas}</span>
        ${r.pagina < paginas ? `<a class="btn btn-sm btn-outline-secondary" href="${link(r.pagina + 1)}">Próxima <i class="bi bi-chevron-right"></i></a>` : ''}
      </div>` : ''}`
    : `<div class="card-x">${vazio(f.busca ? 'Nada encontrado com essa busca.' : 'Tabela vazia.')}</div>`}`;
    const busca = $('#busca-reg');
    let t;
    busca.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const novo = { ...f, busca: busca.value.trim() };
        delete novo.pagina;
        if (!novo.busca) delete novo.busca;
        location.hash = `#/tudo/${encodeURIComponent(tabela)}?${new URLSearchParams(novo)}`;
      }, 500);
    });
    if (f.busca) { busca.focus(); busca.setSelectionRange(busca.value.length, busca.value.length); }
    ligarCliques();
  }

  async function vEspelhoRegistro(tabela, chave, seq) {
    titulo(nomeTabela(tabela));
    const r = await API.get(`/espelho/${encodeURIComponent(tabela)}/${encodeURIComponent(chave)}`);
    if (seq !== renderSeq) return;
    view().innerHTML = `
      <a href="#/tudo/${encodeURIComponent(tabela)}" class="small-muted text-decoration-none"><i class="bi bi-arrow-left"></i> ${esc(nomeTabela(tabela))}</a>
      <div class="card-x mt-2" style="max-width:860px">
        <h3><i class="bi bi-card-text"></i>Registro ${esc(chave)}</h3>
        <div class="table-wrap"><table class="table-x">
          <tbody>${Object.entries(r.dados).map(([k, v]) => `<tr><th class="text-nowrap" style="width:1%">${esc(k)}</th>
            <td style="white-space:pre-wrap;word-break:break-word">${valorCelula(v, true)}${ehDataHora(v) ? ` <span class="small-muted">(${esc(v)})</span>` : ''}</td></tr>`).join('')}</tbody>
        </table></div>
        <div class="small-muted mt-2">Recebido da Orcim em ${fmtData(r.recebido_em)}.</div>
      </div>`;
  }

  // ------------------------------------------------------------------
  // Configurações (gestor)
  // ------------------------------------------------------------------
  async function vConfig(seq) {
    titulo('Configurações');
    const c = await API.get('/config');
    if (seq !== renderSeq) return;
    const marcadas = new Set(c.entidades.map(String));
    view().innerHTML = `
      ${c.sync ? `<div class="card-x mb-3" style="max-width:760px">
        <h3><i class="bi bi-arrow-repeat"></i>Dados da Orcim (envio automático)</h3>
        ${c.sync.ultimo_em
    ? `<div class="${Date.now() - new Date(c.sync.ultimo_em) < 10 * 60e3 ? 'text-success' : 'text-warning'} fw-semibold"><i class="bi bi-check-circle"></i> Último envio recebido: ${fmtData(c.sync.ultimo_em)}</div>
       <div class="small-muted mt-1">A Central da Orcim manda o que mudou a cada minuto. Conferência completa: ${c.sync.completo_em ? fmtData(c.sync.completo_em) : 'ainda não'}.${c.sync.tabelas ? ` ${c.sync.tabelas} tabela(s) recebidas — <a href="#/tudo">ver tudo da Orcim</a>.` : ''}</div>`
    : '<div class="text-warning fw-semibold"><i class="bi bi-hourglass-split"></i> Aguardando o primeiro envio da Central da Orcim.</div><div class="small-muted mt-1">Depois que a Orcim ligar o envio no servidor deles, os dados aparecem aqui em até 1 minuto.</div>'}
      </div>` : ''}
      ${c.fonte?.externa ? `<div class="card-x mb-3" style="max-width:760px">
        <h3><i class="bi bi-database"></i>Dados da Orcim</h3>
        ${c.fonte.ok
    ? `<div class="text-success fw-semibold"><i class="bi bi-check-circle"></i> Conectado ao banco da Orcim (somente leitura) · ${c.fonte.chamados} chamado(s) na Central.</div>`
    : `<div class="text-danger fw-semibold"><i class="bi bi-x-circle"></i> Não foi possível ler o banco da Orcim.</div><div class="small-muted mt-1">${esc(c.fonte.erro)}</div>`}
      </div>` : ''}
      <form class="card-x" id="form-cfg" style="max-width:760px">
        <div class="mb-3"><label class="form-label">Nome do painel</label><input class="form-control" name="nome_painel" value="${esc(c.nome_painel)}"></div>
        <label class="form-label">Empresas acompanhadas</label>
        <div class="form-text mb-2">Marque as empresas da Central que são do grupo. Sem nenhuma marcada, o painel mostra todas.</div>
        <div class="row g-1 mb-3">${c.empresas_central.map((e) => `<div class="col-sm-6"><label class="form-check">
          <input class="form-check-input" type="checkbox" name="ent" value="${e.id}" ${marcadas.has(String(e.id)) ? 'checked' : ''}>
          <span class="form-check-label">${esc(e.name)}${e.active ? '' : ' <span class="small-muted">(inativa)</span>'}</span></label></div>`).join('')}</div>
        <button class="btn btn-brand" type="submit">Salvar</button>
      </form>`;
    $('#form-cfg').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await API.put('/config', {
          nome_painel: ev.target.nome_painel.value,
          entidades: $$('input[name=ent]:checked').map((i) => Number(i.value)),
        });
        filtrosDemandas = null;
        $('#side-titulo').textContent = ev.target.nome_painel.value || 'Painel Beija-Flor';
        toast('Configurações salvas.');
      } catch (e) { toast(e.message, true); }
    });
  }

  // ------------------------------------------------------------------
  // Minha conta
  // ------------------------------------------------------------------
  function vConta() {
    titulo('Minha conta');
    view().innerHTML = `
      ${EU.must_change_password ? '<div class="alert alert-warning" style="max-width:520px"><i class="bi bi-shield-lock"></i> <strong>Crie sua senha para liberar o painel.</strong> Digite a senha que você recebeu em "Senha atual" e escolha uma nova (mínimo 8 caracteres). Depois de salvar, todas as páginas do menu abrem.</div>' : ''}
      <form class="card-x" id="form-senha" style="max-width:520px">
        <h3><i class="bi bi-key"></i>Trocar senha</h3>
        <div class="small-muted mb-3">${esc(EU.name)} · usuário <span class="num">${esc(EU.username)}</span></div>
        <div class="mb-2"><label class="form-label">Senha atual</label><input class="form-control" type="password" name="atual" autocomplete="current-password" required></div>
        <div class="mb-2"><label class="form-label">Nova senha (mín. 8)</label><input class="form-control" type="password" name="nova" autocomplete="new-password" minlength="8" required></div>
        <div class="mb-3"><label class="form-label">Repita a nova senha</label><input class="form-control" type="password" name="nova2" autocomplete="new-password" minlength="8" required></div>
        <div class="alert alert-danger py-2 d-none" id="senha-erro"></div>
        <button class="btn btn-brand" type="submit">Salvar nova senha</button>
      </form>`;
    $('#form-senha').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const erro = $('#senha-erro');
      erro.classList.add('d-none');
      if (f.nova.value !== f.nova2.value) { erro.textContent = 'As senhas novas não são iguais.'; erro.classList.remove('d-none'); return; }
      try {
        await API.post('/auth/senha', { atual: f.atual.value, nova: f.nova.value });
        EU.must_change_password = false;
        toast('Senha alterada.');
        location.hash = '#/';
      } catch (e) { erro.textContent = e.message; erro.classList.remove('d-none'); }
    });
  }

  // ==================================================================
  // ROTINA DO TÉCNICO (Prompt do TI)
  // POSTO -> AGENDA -> VISITA -> CHECKLIST -> CONCLUSÃO -> HISTÓRICO
  // ==================================================================
  const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
  const isoMais = (iso, n) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const diaSemana = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const segunda = (iso) => isoMais(iso, -diaSemana(iso)); // início da semana: domingo
  const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const dataCurta = (iso) => (iso ? `${SEMANA[diaSemana(iso)]}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
  const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

  // Janela simples (Bootstrap) para reagendar, iniciar visita, concluir etc.
  function janela(tituloTxt, corpo, { ok = 'Salvar', onOk, perigo = false } = {}) {
    let el = $('#gbf-modal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gbf-modal';
      el.className = 'modal fade';
      el.tabIndex = -1;
      document.body.appendChild(el);
    }
    el.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title">${esc(tituloTxt)}</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button></div>
      <div class="modal-body">${corpo}<div class="alert alert-danger py-2 mt-3 mb-0 d-none" data-erro></div></div>
      <div class="modal-footer"><button type="button" class="btn btn-lg btn-outline-secondary" data-bs-dismiss="modal">Voltar</button>
        <button type="button" class="btn btn-lg ${perigo ? 'btn-danger' : 'btn-brand'}" data-ok>${esc(ok)}</button></div></div></div>`;
    const m = bootstrap.Modal.getOrCreateInstance(el);
    const btn = el.querySelector('[data-ok]');
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await onOk(el);
        m.hide();
      } catch (e) {
        const er = el.querySelector('[data-erro]');
        er.textContent = e.message;
        er.classList.remove('d-none');
      } finally { btn.disabled = false; }
    };
    m.show();
    return el;
  }

  function iniciarVisita(postoId, nome, emAndamentoId, solicitacaoId = null) {
    if (emAndamentoId) { location.hash = `#/visitas/${emAndamentoId}`; return; }
    janela(`Iniciar visita — ${nome}`, `
      <label class="form-label">Data e hora de início</label>
      <input type="datetime-local" class="form-control form-control-lg" name="inicio" value="${paraInputLocal(new Date())}">
      <div class="form-text">Já vem com agora. Mude só se a visita começou em outro horário.</div>`, {
      ok: 'Iniciar visita',
      onOk: async (el) => {
        const r = await API.post('/visitas', { location_id: postoId, request_id: solicitacaoId, started_at: deInputLocal(el.querySelector('[name=inicio]').value) });
        location.hash = `#/visitas/${r.id}`;
      },
    });
  }

  // Reagendar: visita prevista do posto, atividade ou solicitação. Sempre com o motivo, que fica
  // no histórico e avisa gestores e técnicos pelo sino (POST /reagendar).
  function reagendar(alvo, novaData = null) {
    const comHora = alvo.tipo !== 'solicitacao';
    janela('Reagendar', `
      <label class="form-label" for="rg-data">Nova data</label>
      <input type="date" class="form-control form-control-lg mb-3" id="rg-data" name="data" value="${esc(novaData || alvo.data || hojeISO())}">
      ${comHora ? `<label class="form-label" for="rg-hora">Novo horário <span class="small-muted">(opcional)</span></label>
      <input type="time" class="form-control form-control-lg mb-3" id="rg-hora" name="hora" value="${esc(alvo.hora || '')}">` : ''}
      <label class="form-label" for="rg-motivo">Motivo *</label>
      <textarea class="form-control" id="rg-motivo" name="motivo" rows="3" maxlength="1000" placeholder="Ex.: posto fechado para inventário; gerente pediu outro dia"></textarea>
      <div class="form-text">Gestores e técnicos recebem o aviso com o motivo.</div>`, {
      ok: 'Reagendar',
      onOk: async (el) => {
        const data = el.querySelector('[name=data]').value;
        const hora = comHora ? el.querySelector('[name=hora]').value : '';
        const motivo = el.querySelector('[name=motivo]').value.trim();
        if (!data) throw new Error('Escolha a nova data.');
        if (motivo.length < 3) { el.querySelector('[name=motivo]').focus(); throw new Error('Escreva o motivo do reagendamento.'); }
        await API.post('/reagendar', { tipo: alvo.tipo, id: alvo.id, data, hora: hora || null, motivo });
        toast('Reagendado. Os outros foram avisados.');
        render();
      },
    });
    setTimeout(() => $('#rg-motivo')?.focus(), 350);
  }

  function ligarReagendar() {
    $$('[data-reag]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      reagendar(JSON.parse(b.dataset.reag));
    }));
  }
  function ligarIniciar() {
    $$('[data-iniciar]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      iniciarVisita(b.dataset.iniciar, b.dataset.nome, b.dataset.visita || null);
    }));
  }
  const btnReag = (alvo, extra = '') => `<button type="button" class="btn btn-sm btn-outline-secondary ${extra}" data-reag="${esc(JSON.stringify(alvo))}"><i class="bi bi-calendar2-week"></i> Reagendar</button>`;
  const btnIniciar = (p, visitaId, grande = true) => `<button type="button" class="btn ${grande ? 'btn-lg' : 'btn-sm'} ${visitaId ? 'btn-warning' : 'btn-brand'} btn-acao"
      data-iniciar="${p.id}" data-nome="${esc(p.name)}" ${visitaId ? `data-visita="${visitaId}"` : ''}>
      <i class="bi bi-${visitaId ? 'arrow-right-circle' : 'play-circle'}"></i> ${visitaId ? 'CONTINUAR VISITA' : 'INICIAR VISITA'}</button>`;

  const STATUS_SOLIC = { a_fazer: ['tag-blue', 'A fazer'], em_andamento: ['tag-teal', 'Em andamento'], concluida: ['tag-green', 'Concluída'], cancelada: ['tag-gray', 'Cancelada'] };
  const tagSolic = (s) => tag(...(STATUS_SOLIC[s] || ['tag-gray', s]));

  // ------------------------------- Meu dia ------------------------------
  async function vHoje(seq, meu = false) {
    titulo(ehGestor() && !meu ? 'Dia do técnico' : 'Meu dia');
    const h = await API.get(meu ? '/hoje?meu=1' : '/hoje');
    if (seq !== renderSeq) return;
    const atrasadasV = h.visitas_hoje.filter((v) => v.atrasada).length;
    const novas = h.solicitacoes.filter((s) => s.status === 'a_fazer').length;
    view().innerHTML = `
      <div class="small-muted mb-2 data-hoje">${new Date().toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: 'long' })}</div>
      <div class="kpis kpis-hoje">
        ${kpi('Visitas para hoje', h.visitas_hoje.length, { cls: atrasadasV ? 'warn' : '', hint: atrasadasV ? `${atrasadasV} atrasada(s)` : '', icon: 'geo-alt', href: '#/agenda' })}
        ${kpi('Atividades de hoje', h.atividades_hoje.length, { icon: 'check2-square', href: '#/atividades?situacao=hoje' })}
        ${kpi('Atividades atrasadas', h.atividades_atrasadas.length, { cls: h.atividades_atrasadas.length ? 'bad' : 'ok', icon: 'alarm', href: '#/atividades?situacao=atrasadas' })}
        ${kpi('Solicitações novas', novas, { cls: novas ? 'warn' : '', icon: 'megaphone', href: '#/solicitacoes' })}
        ${kpi('Feito hoje', h.concluidas_hoje.visitas + h.concluidas_hoje.atividades + h.concluidas_hoje.solicitacoes, {
    cls: 'ok', hint: `${h.concluidas_hoje.visitas} visita(s) · ${h.concluidas_hoje.atividades} atividade(s) · ${h.concluidas_hoje.solicitacoes} solicitação(ões)`, icon: 'check2-all',
  })}
      </div>
      ${h.em_andamento.map((v) => `<div class="banner-andamento" data-href="#/visitas/${v.id}">
        <div><strong>Visita em andamento — ${esc(v.location_name)}</strong>
          <div class="small">${v.faltam ? `Faltam ${v.faltam} item(ns) do checklist` : 'Checklist completo, falta concluir'} · desde ${fmtData(v.started_at)}${ehGestor() && v.user_name ? ` · ${esc(v.user_name)}` : ''}</div></div>
        <span class="btn btn-lg btn-warning btn-acao"><i class="bi bi-arrow-right-circle"></i> CONTINUAR</span></div>`).join('')}
      <div class="grid-2">
        <div class="card-x"><h3><i class="bi bi-geo-alt"></i>Visitas de hoje <a class="sub" href="#/agenda">agenda</a></h3>
          ${h.visitas_hoje.length ? h.visitas_hoje.map((p) => `<div class="visita-row">
            <div class="min-w-0" data-href="#/postos/${p.id}">
              <div class="fw-semibold">${esc(p.name)} ${p.atrasada ? tag('tag-red', `atrasada · ${dataBR(p.data)}`) : ''}</div>
              <div class="small-muted">${p.hora ? `<i class="bi bi-clock"></i> ${p.hora} · ` : ''}${esc(p.address || '')}${p.checklist_name ? ` · ${esc(p.checklist_name)}` : ''}</div>
            </div>
            <div class="d-flex gap-2 flex-wrap">${btnIniciar(p, p.visita_id)}${p.visita_id ? '' : btnReag({ tipo: 'posto', id: p.id, data: p.data, hora: p.hora })}</div>
          </div>`).join('') : vazio('Nenhuma visita prevista para hoje.', 'cup-hot')}
        </div>
        <div class="card-x"><h3><i class="bi bi-megaphone"></i>Visitas pedidas pelo gestor <a class="sub" href="#/solicitacoes">ver todas</a></h3>
          ${h.solicitacoes.length ? h.solicitacoes.map((s) => `<div class="task" data-href="#/solicitacoes/${s.id}">
            <div class="d-flex justify-content-between gap-2 align-items-start"><div class="ttl">${esc(s.title)}</div>${btnVisitaSolic(s)}</div>
            ${s.kind === 'visita' ? `<div class="small-muted">${s.tarefas} tarefa(s)${s.atrasada ? ' · <span class="text-danger">passou da data</span>' : ''}</div>` : ''}
            <div class="meta">${tagSolic(s.status)}${s.priority >= 3 ? tag(TAG_PRIO[s.priority], PRIO_TAREFA[s.priority]) : ''}
              ${s.location_name ? `<span><i class="bi bi-geo-alt"></i>${esc(s.location_name)}</span>` : ''}
              ${s.desired_date ? `<span><i class="bi bi-calendar"></i> ${dataBR(s.desired_date)}</span>` : ''}
              <span>· ${relativo(s.created_at)}</span></div></div>`).join('') : vazio('Nenhuma solicitação aberta.', 'emoji-smile')}
        </div>
      </div>
      <div class="grid-2">
        <div class="card-x"><h3><i class="bi bi-check2-square"></i>Atividades <a class="sub" href="#/atividades/nova">+ nova</a></h3>
          ${h.atividades_atrasadas.length ? `<div class="small-muted mb-1">Atrasadas</div>${h.atividades_atrasadas.map((t) => cartaoTarefa({ ...t, prazo: 'atrasada', location_name: t.location_name })).join('')}` : ''}
          ${h.atividades_hoje.length ? `<div class="small-muted mb-1">Para hoje</div>${h.atividades_hoje.map((t) => cartaoTarefa({ ...t, prazo: 'vence_logo' })).join('')}` : ''}
          ${!h.atividades_atrasadas.length && !h.atividades_hoje.length ? vazio('Nada para hoje.', 'check2-all') : ''}
        </div>
        <div class="card-x"><h3><i class="bi bi-calendar-week"></i>Próximas visitas</h3>
          ${h.proximas_visitas.length ? h.proximas_visitas.map((p) => `<div class="d-flex justify-content-between align-items-center py-2 border-bottom gap-2" data-href="#/postos/${p.id}">
            <span class="fw-semibold">${esc(p.name)}</span><span class="text-nowrap small-muted">${dataCurta(p.data)}${p.hora ? ` · ${p.hora}` : ''}</span></div>`).join('')
    : vazio('Nenhuma visita programada.', 'calendar')}
        </div>
      </div>`;
    ligarCliques();
    ligarIniciar();
    ligarReagendar();
    ligarVisitaSolic();
  }

  // -------------------------------- Agenda ------------------------------
  const TIPO_AG = {
    visita: ['geo-alt', 'Visita'], visita_realizada: ['clipboard-check', 'Visita'],
    atividade: ['check2-square', 'Atividade'], solicitacao: ['megaphone', 'Solicitação'],
  };
  const STATUS_AG = {
    agendada: ['tag-blue', 'Agendada'], atrasada: ['tag-red', 'Atrasada'], em_andamento: ['tag-teal', 'Em andamento'],
    concluida: ['tag-green', 'Concluída'], a_fazer: ['tag-blue', 'A fazer'], aguardando: ['tag-amber', 'Aguardando'],
  };

  // Itens que podem ser arrastados: visita prevista do posto, atividade e solicitação ainda abertas
  const arrastavel = (i) => !!i.reagendar && !['concluida', 'em_andamento'].includes(i.status);
  const dadosArrasto = (i) => esc(JSON.stringify({ tipo: i.reagendar, id: i.posto_id || i.id, data: i.data, hora: i.hora || null }));

  // Popup do hover na Agenda: resumo do item (responsável, quem pediu, urgência...)
  const dadosPop = (i) => esc(JSON.stringify({
    t: i.titulo, tipo: TIPO_AG[i.tipo] ? TIPO_AG[i.tipo][1] : '', st: (STATUS_AG[i.status] || ['tag-gray', i.status]),
    q: `${dataCurta(i.data)}${i.hora ? ` · ${i.hora}` : ' · dia todo'}`, p: i.prioridade || null,
    info: (i.info || []).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  }));
  function ativarPopAgenda() {
    if (document.body.dataset.popAg || !window.matchMedia('(hover: hover)').matches) return;
    document.body.dataset.popAg = '1';
    const pop = document.createElement('div');
    pop.id = 'ag-pop';
    pop.setAttribute('role', 'tooltip');
    document.body.appendChild(pop);
    let atual = null;
    const esconder = () => { pop.classList.remove('on'); atual = null; };
    document.addEventListener('mouseover', (ev) => {
      const el = ev.target.closest('[data-pop]');
      if (el === atual) return;
      if (!el || document.body.classList.contains('arrastando')) { esconder(); return; }
      atual = el;
      let d;
      try { d = JSON.parse(el.dataset.pop); } catch { return; }
      pop.innerHTML = `<div class="ag-pop-tit">${esc(d.t)}</div>
        <div class="ag-pop-sub">${tag(...d.st)} <span>${esc(d.tipo)}</span> <span>· ${esc(d.q)}</span>${d.p ? ` <i class="cal-num urg-${d.p}"></i>` : ''}</div>
        ${d.info.length ? `<dl>${d.info.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}`;
      pop.classList.add('on');
      const r = el.getBoundingClientRect();
      const pw = pop.offsetWidth; const ph = pop.offsetHeight;
      let x = r.right + 8; if (x + pw > innerWidth - 8) x = Math.max(8, r.left - pw - 8);
      let y = r.top; if (y + ph > innerHeight - 8) y = Math.max(8, innerHeight - ph - 8);
      pop.style.transform = `translate(${x}px, ${y}px)`;
    });
    document.addEventListener('scroll', esconder, true);
    window.addEventListener('hashchange', esconder);
    document.addEventListener('pointerdown', esconder);
  }

  function itemAgenda(i) {
    const reag = arrastavel(i) ? btnReag({ tipo: i.reagendar, id: i.posto_id || i.id, data: i.data, hora: i.hora }) : '';
    const iniciar = i.tipo === 'visita' && i.status !== 'em_andamento'
      ? btnIniciar({ id: i.posto_id, name: i.local }, null, false) : '';
    return `<div class="ag-item ag-${i.tipo} st-${i.status} ${arrastavel(i) ? 'arrastavel' : ''}" data-href="${i.link}" data-pop="${dadosPop(i)}"
        ${arrastavel(i) ? `data-drag="${dadosArrasto(i)}"` : ''}>
      <div class="ag-hora">${i.hora || '<span class="muted">dia todo</span>'}</div>
      <div class="ag-body min-w-0">
        <div class="ag-tit"><i class="bi bi-${TIPO_AG[i.tipo][0]}"></i> ${esc(i.titulo)}</div>
        <div class="small-muted">${tag(...(STATUS_AG[i.status] || ['tag-gray', i.status]))} ${esc(TIPO_AG[i.tipo][1])}${i.local && i.tipo !== 'visita' && i.tipo !== 'visita_realizada' ? ` · ${esc(i.local)}` : ''}${i.obs ? ` · ${esc(i.obs)}` : ''}</div>
      </div>
      <div class="ag-acoes">${iniciar}${reag}</div></div>`;
  }

  /**
   * Regra do soltar (função pura): troca o DIA e preserva o HORÁRIO.
   * Devolve a chamada à API, ou null quando nada muda.
   */
  function moverPara(alvo, novoDia) {
    if (!alvo || !/^\d{4}-\d{2}-\d{2}$/.test(novoDia || '') || alvo.data === novoDia) return null;
    if (alvo.tipo === 'posto') return { url: `/postos/${alvo.id}`, corpo: { next_visit_date: novoDia, next_visit_time: alvo.hora || null } };
    if (alvo.tipo === 'atividade') return { url: `/atividades/${alvo.id}`, corpo: { due_date: novoDia, due_time: alvo.hora || '' } };
    if (alvo.tipo === 'solicitacao') return { url: `/solicitacoes/${alvo.id}`, corpo: { desired_date: novoDia } };
    return null;
  }

  /**
   * Arrastar e soltar entre dias (semana e mês), sem biblioteca.
   * Mouse: começa depois de mover ~6px (clique continua abrindo o item).
   * Toque (iPhone): segurar ~0,4 s para pegar; antes disso o dedo só rola a tela.
   */
  let suprimirClique = false;
  const STATUS_TAREFA_NOME = { a_fazer: 'A fazer', em_andamento: 'Em andamento', aguardando: 'Aguardando', concluida: 'Concluída' };
  function ativarArrasto(raiz) {
    // #view é o mesmo elemento em todas as telas: registra os eventos uma vez só (delegação)
    if (raiz.dataset.arrastoAtivo) return;
    raiz.dataset.arrastoAtivo = '1';
    let a = null;
    const alvoEm = (x, y) => document.elementFromPoint(x, y)?.closest(a?.dados?.kanban ? '[data-drop-status]' : '[data-drop-dia]') || null;
    const marcar = (el) => {
      $$('.drop-alvo', raiz).forEach((d) => d !== el && d.classList.remove('drop-alvo'));
      if (el) el.classList.add('drop-alvo');
    };
    const comecar = (x, y) => {
      a.iniciou = true;
      const r = a.el.getBoundingClientRect();
      a.dx = x - r.left; a.dy = y - r.top;
      a.fantasma = a.el.cloneNode(true);
      a.fantasma.classList.add('ag-fantasma');
      a.fantasma.style.width = `${r.width}px`;
      document.body.appendChild(a.fantasma);
      a.el.classList.add('ag-origem');
      document.body.classList.add('arrastando');
      if (navigator.vibrate) navigator.vibrate(15);
      mover(x, y);
    };
    const mover = (x, y) => {
      a.fantasma.style.transform = `translate(${x - a.dx}px, ${y - a.dy}px)`;
      marcar(alvoEm(x, y));
    };
    const limpar = () => {
      if (!a) return;
      clearTimeout(a.timer);
      a.fantasma?.remove();
      a.el.classList.remove('ag-origem');
      document.body.classList.remove('arrastando');
      marcar(null);
      a = null;
    };
    const soltar = async (x, y) => {
      const destino = alvoEm(x, y);
      const dados = a.dados;
      const el = a.el;
      suprimirClique = true;
      setTimeout(() => { suprimirClique = false; }, 50);
      limpar();
      if (dados.kanban) { // quadro de atividades: muda o status
        const novo = destino?.dataset.dropStatus;
        if (!novo || novo === dados.status) return;
        if (novo === 'aguardando') { pedirAguardando(dados.id, render); return; }
        try {
          await API.patch(`/atividades/${dados.id}`, { status: novo });
          toast(`Atividade movida para "${STATUS_TAREFA_NOME[novo] || novo}".`);
        } catch (e) { toast(e.message, true); }
        render();
        return;
      }
      const chamada = destino && moverPara(dados, destino.dataset.dropDia);
      if (!chamada || !el) return;
      // pede o motivo antes de mudar a data (e avisa os outros)
      reagendar(dados, destino.dataset.dropDia);
    };
    const pegar = (ev, x, y, toque) => {
      const el = ev.target.closest('[data-drag]');
      if (!el || ev.target.closest('button, .btn, input, select')) return;
      a = { el, dados: JSON.parse(el.dataset.drag), x, y, iniciou: false, toque };
      if (toque) a.timer = setTimeout(() => a && comecar(a.x, a.y), 400);
    };

    // Mouse / caneta
    raiz.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'touch' || ev.button !== 0) return;
      pegar(ev, ev.clientX, ev.clientY, false);
    });
    window.addEventListener('pointermove', (ev) => {
      if (!a || a.toque) return;
      if (!a.iniciou && Math.hypot(ev.clientX - a.x, ev.clientY - a.y) > 6) comecar(ev.clientX, ev.clientY);
      if (a?.iniciou) { ev.preventDefault(); mover(ev.clientX, ev.clientY); }
    });
    window.addEventListener('pointerup', (ev) => {
      if (!a || a.toque) return;
      if (a.iniciou) soltar(ev.clientX, ev.clientY); else limpar();
    });

    // Toque: segurar para pegar
    raiz.addEventListener('touchstart', (ev) => {
      const t = ev.touches[0];
      if (ev.touches.length === 1) pegar(ev, t.clientX, t.clientY, true);
    }, { passive: true });
    raiz.addEventListener('touchmove', (ev) => {
      if (!a) return;
      const t = ev.touches[0];
      if (!a.iniciou) {
        if (Math.hypot(t.clientX - a.x, t.clientY - a.y) > 8) limpar(); // virou rolagem
        return;
      }
      ev.preventDefault(); // pegou o bloco: a tela não rola
      mover(t.clientX, t.clientY);
    }, { passive: false });
    raiz.addEventListener('touchend', (ev) => {
      if (!a) return;
      const t = ev.changedTouches[0];
      if (a.iniciou) { ev.preventDefault(); soltar(t.clientX, t.clientY); } else limpar();
    });
    raiz.addEventListener('touchcancel', limpar);
    raiz.addEventListener('contextmenu', (ev) => { if (ev.target.closest('[data-drag]')) ev.preventDefault(); });
    // Clique logo depois de soltar não abre o item
    raiz.addEventListener('click', (ev) => {
      if (suprimirClique) { ev.stopPropagation(); ev.preventDefault(); }
    }, true);
  }

  // "+" do dia: cria atividade rápida já naquela data
  async function novaAtividadeNoDia(dia) {
    const [postos, users] = await Promise.all([API.get('/postos'), ehGestor() ? carregarUsuarios() : []]);
    janela(`Nova atividade · ${dataCurta(dia)}`, `
      <label class="form-label" for="na-tit">O que precisa ser feito *</label>
      <input class="form-control form-control-lg mb-3" id="na-tit" maxlength="200">
      <div class="row g-2 mb-3">
        <div class="col-6"><label class="form-label" for="na-dia">Dia</label><input type="date" class="form-control" id="na-dia" value="${dia}"></div>
        <div class="col-6"><label class="form-label" for="na-hora">Horário <span class="small-muted">(vazio = dia todo)</span></label><input type="time" class="form-control" id="na-hora" value=""></div>
      </div>
      <label class="form-label" for="na-posto">Posto</label>
      <select class="form-select mb-3" id="na-posto"><option value="">Nenhum</option>${postos.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      ${ehGestor() ? `<label class="form-label" for="na-resp">Responsável</label>
      <select class="form-select mb-3" id="na-resp">${users.filter((u) => u.role !== 'unidade').map((u) => `<option value="${u.id}" ${String(u.id) === String(EU.id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
      <label class="form-label" for="na-desc">Detalhes</label>
      <textarea class="form-control" id="na-desc" rows="2"></textarea>`, {
      ok: 'Criar atividade',
      onOk: async (el) => {
        const titulo = el.querySelector('#na-tit').value.trim();
        if (!titulo) throw new Error('Escreva o que precisa ser feito.');
        const d = el.querySelector('#na-dia').value || dia;
        const body = {
          title: titulo, description: el.querySelector('#na-desc').value,
          due_date: d, due_time: el.querySelector('#na-hora').value || '',
          location_id: el.querySelector('#na-posto').value || null,
        };
        if (ehGestor()) body.assignee_id = el.querySelector('#na-resp').value || null;
        await API.post('/atividades', body);
        toast('Atividade criada.');
        render();
      },
    });
    setTimeout(() => $('#na-tit')?.focus(), 300);
  }

  // Agenda e Calendário são a mesma "Agenda" no menu, com duas abas (o calendário é só do gestor)
  const abasAgenda = () => '';

  async function vAgenda(qs, seq) {
    titulo('Agenda');
    const modo = ['dia', 'semana', 'mes', 'lista'].includes(qs.get('modo')) ? qs.get('modo') : (store.get('gbf_ag_modo') || 'mes');
    store.set('gbf_ag_modo', modo);
    if (modo === 'mes') {
      // o mesmo calendário do Painel do gestor, com o "+" do dia e o arrastar para reagendar
      const hojeA = hojeISO();
      const modos = `<div class="ag-modos-cal"><div class="btn-group btn-group-sm" role="group" aria-label="Ver por">${[['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês'], ['lista', 'Lista']].map(([m, t]) => `<a class="btn ${m === 'mes' ? 'btn-dark' : 'btn-outline-secondary'}" href="#/agenda?modo=${m}&data=${hojeA}">${t}</a>`).join('')}</div>
        <a class="btn btn-brand btn-sm" href="#/novo"><i class="bi bi-plus-lg"></i> Novo pedido</a></div>`;
      const q = new URLSearchParams(qs);
      if (!q.get('mes') && /^\d{4}-\d{2}-\d{2}$/.test(q.get('data') || '')) q.set('mes', q.get('data').slice(0, 7));
      await vCalendarioPainel(q, seq, modos, '#/agenda?modo=mes', { titulo: 'Agenda', mais: true, arrastar: true, acoes: true });
      return;
    }
    if (modo === 'semana') {
      const hojeA = hojeISO();
      const modos = `<div class="ag-modos-cal"><div class="btn-group btn-group-sm" role="group" aria-label="Ver por">${[['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês'], ['lista', 'Lista']].map(([m, t]) => `<a class="btn ${m === 'semana' ? 'btn-dark' : 'btn-outline-secondary'}" href="#/agenda?modo=${m}&data=${hojeA}">${t}</a>`).join('')}</div>
        <a class="btn btn-brand btn-sm" href="#/novo"><i class="bi bi-plus-lg"></i> Novo pedido</a></div>`;
      await vCalendarioPainel(qs, seq, modos, '#/agenda?modo=semana', { titulo: 'Agenda', mais: true, arrastar: true, acoes: true, semana: true });
      return;
    }
    const base = /^\d{4}-\d{2}-\d{2}$/.test(qs.get('data') || '') ? qs.get('data') : hojeISO();
    let de; let ate; let anterior; let proximo; let rotulo;
    if (modo === 'dia') {
      de = base; ate = base; anterior = isoMais(base, -1); proximo = isoMais(base, 1);
      rotulo = new Date(`${base}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'long' });
    } else if (modo === 'semana') {
      de = segunda(base); ate = isoMais(de, 6); anterior = isoMais(de, -7); proximo = isoMais(de, 7);
      rotulo = `${dataBR(de).slice(0, 5)} a ${dataBR(ate).slice(0, 5)}`;
    } else if (modo === 'mes') {
      const primeiro = `${base.slice(0, 7)}-01`;
      const ultimo = isoMais(`${isoMais(primeiro, 32).slice(0, 7)}-01`, -1);
      de = segunda(primeiro); ate = isoMais(segunda(ultimo), 6);
      anterior = `${isoMais(primeiro, -1).slice(0, 7)}-01`; proximo = isoMais(ultimo, 1);
      rotulo = `${MESES[Number(base.slice(5, 7)) - 1]} ${base.slice(0, 4)}`;
    } else {
      de = base; ate = isoMais(base, 30); anterior = isoMais(base, -30); proximo = isoMais(base, 30);
      rotulo = `Próximos 30 dias a partir de ${dataBR(base)}`;
    }
    const r = await API.get(`/agenda?de=${de}&ate=${ate}`);
    if (seq !== renderSeq) return;
    const hoje = r.hoje;
    const porDia = {};
    r.itens.forEach((i) => { (porDia[i.data] = porDia[i.data] || []).push(i); });
    const ir = (o) => `#/agenda?${new URLSearchParams({ modo, data: base, ...o })}`;
    const btnMais = (d) => `<button type="button" class="cal-add" data-add-dia="${d}" aria-label="Adicionar atividade em ${dataCurta(d)}" title="Adicionar atividade"><i class="bi bi-plus-lg"></i></button>`;

    let corpo = '';
    const atrasadasHtml = r.visitas_atrasadas.length && (modo === 'lista' || de <= hoje)
      ? `<div class="card-x mb-3 border-danger-subtle"><h3 class="text-danger"><i class="bi bi-exclamation-triangle"></i>Visitas atrasadas
          ${modo === 'semana' || modo === 'mes' ? '<span class="sub">arraste para um dia da agenda</span>' : ''}</h3>
          ${r.visitas_atrasadas.map((i) => itemAgenda({ ...i, hora: i.hora })).join('')}</div>` : '';
    if (modo === 'dia') {
      corpo = `<div class="card-x"><div class="d-flex justify-content-end mb-2">${btnMais(base)}</div>
        ${(porDia[base] || []).map(itemAgenda).join('') || vazio('Nada agendado neste dia.', 'calendar')}</div>`;
    } else if (modo === 'semana') {
      corpo = `<div class="small-muted mb-2"><i class="bi bi-arrows-move"></i> Arraste um bloco para outro dia (no celular, segure o bloco um instante antes de arrastar). O <strong>+</strong> cria uma atividade no dia.</div>
        <div class="cal-semana">${[0, 1, 2, 3, 4, 5, 6].map((n) => {
        const d = isoMais(de, n);
        return `<div class="cal-dia ${d === hoje ? 'hoje' : ''} ${[0, 6].includes(diaSemana(d)) ? 'fds' : ''}" data-drop-dia="${d}">
          <div class="cal-dia-cab"><a class="cal-dia-tit" href="${ir({ modo: 'dia', data: d })}">${dataCurta(d)}</a>${btnMais(d)}</div>
          <div data-drop-lista>${(porDia[d] || []).map(itemAgenda).join('')}</div></div>`;
      }).join('')}</div>`;
    } else if (modo === 'mes') {
      const dias = [];
      for (let d = de; d <= ate; d = isoMais(d, 1)) dias.push(d);
      corpo = `<div class="small-muted mb-2"><i class="bi bi-arrows-move"></i> Arraste para outro dia · clique no item para abrir · <strong>+</strong> cria atividade.</div>
        <div class="cal-mes"><div class="cal-mes-cab">${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((s, i) => `<div class="${i === 0 || i === 6 ? 'fds' : ''}">${s}</div>`).join('')}</div>
        <div class="cal-mes-grade">${dias.map((d) => {
    const its = porDia[d] || [];
    return `<div class="cal-cel ${d.slice(0, 7) !== base.slice(0, 7) ? 'fora' : ''} ${d === hoje ? 'hoje' : ''} ${[0, 6].includes(diaSemana(d)) ? 'fds' : ''}" data-drop-dia="${d}">
            <div class="cal-cel-cab"><a class="n" href="${ir({ modo: 'dia', data: d })}" title="Ver o dia">${Number(d.slice(8, 10))}</a>${btnMais(d)}</div>
            <div data-drop-lista class="cal-cel-itens">
            ${its.slice(0, 4).map((i) => `<span class="mini st-${i.status} ${arrastavel(i) ? 'arrastavel' : ''}" data-href="${i.link}" data-pop="${dadosPop(i)}"
                ${arrastavel(i) ? `data-drag="${dadosArrasto(i)}"` : ''}><i class="bi bi-${TIPO_AG[i.tipo][0]}"></i> ${esc(i.hora ? `${i.hora} ` : '')}${esc(i.tipo === 'atividade' || i.tipo === 'solicitacao' ? i.titulo : (i.local || i.titulo))}</span>`).join('')}
            ${its.length > 4 ? `<a class="mini mais" href="${ir({ modo: 'dia', data: d })}">+${its.length - 4} mais</a>` : ''}</div></div>`;
  }).join('')}</div></div>`;
    } else {
      const datas = Object.keys(porDia).sort();
      corpo = datas.length ? datas.map((d) => `<div class="card-x mb-2"><h3 class="${d === hoje ? 'text-success' : ''}">${dataCurta(d)}${d === hoje ? ' · hoje' : ''}</h3>${porDia[d].map(itemAgenda).join('')}</div>`).join('')
        : `<div class="card-x">${vazio('Nada agendado nos próximos 30 dias.', 'calendar')}</div>`;
    }
    view().innerHTML = `
      ${abasAgenda('agenda')}
      <div class="ag-topo">
        <div class="btn-group" role="group" aria-label="Visualização">
          ${[['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês'], ['lista', 'Lista']].map(([m, t]) => `<a class="btn ${m === modo ? 'btn-dark' : 'btn-outline-secondary'}" href="#/agenda?modo=${m}&data=${base}">${t}</a>`).join('')}
        </div>
        <div class="d-flex align-items-center gap-1">
          <a class="btn btn-outline-secondary" href="${ir({ data: anterior })}" aria-label="Anterior"><i class="bi bi-chevron-left"></i></a>
          <a class="btn btn-outline-secondary" href="${ir({ data: hoje })}">Hoje</a>
          <a class="btn btn-outline-secondary" href="${ir({ data: proximo })}" aria-label="Próximo"><i class="bi bi-chevron-right"></i></a>
        </div>
        <div class="fw-semibold data-hoje ag-rotulo">${esc(rotulo)}</div>
        <a class="btn btn-brand ms-auto" href="#/atividades/nova"><i class="bi bi-plus-lg"></i> Atividade</a>
      </div>
      ${atrasadasHtml}${corpo}`;
    ligarCliques();
    ligarReagendar();
    ligarIniciar();
    $$('[data-add-dia]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      location.hash = `#/novo?data=${b.dataset.addDia}`;
    }));
    if (modo === 'semana' || modo === 'mes') ativarArrasto(view());
    ativarPopAgenda();
  }

  // -------------------------------- Postos ------------------------------
  function situacaoPosto(p) {
    if (p.visita_em_andamento_id) return tag('tag-teal', 'Visita em andamento');
    if (!p.next_visit_date) return tag('tag-gray', 'Sem data');
    if (p.visita_atrasada) return tag('tag-red', `Atrasada · ${dataBR(p.next_visit_date)}`);
    if (p.visita_hoje) return tag('tag-amber', `Hoje${p.next_visit_time ? ` · ${p.next_visit_time}` : ''}`);
    return tag('tag-green', `${dataCurta(p.next_visit_date)}${p.next_visit_time ? ` · ${p.next_visit_time}` : ''}`);
  }

  async function vPostos(qs, seq) {
    titulo('Postos');
    const todos = qs.get('todos') === '1';
    const lista = await API.get(`/postos${todos ? '?todos=1' : ''}`);
    if (seq !== renderSeq) return;
    view().innerHTML = `
      <div class="filters">
        <input class="form-control grow" id="busca-posto" placeholder="Buscar posto">
        <label class="form-check mb-0"><input type="checkbox" class="form-check-input" id="ver-inativos" ${todos ? 'checked' : ''}> <span class="form-check-label">Mostrar inativos</span></label>
        <a class="btn btn-brand ms-auto" href="#/postos/novo"><i class="bi bi-plus-lg"></i> Novo posto</a>
      </div>
      ${lista.length ? `<div class="postos-grid">${lista.map((p) => `<div class="posto-card ${p.active ? '' : 'inativo'}" data-href="#/postos/${p.id}" data-nome="${esc(p.name.toLowerCase())}">
        <div class="d-flex justify-content-between gap-2 align-items-start">
          <div class="min-w-0"><div class="fw-bold">${esc(p.name)}</div><div class="small-muted">${esc(p.address || 'Sem endereço')}</div></div>
          ${p.active ? '' : tag('tag-gray', 'Inativo')}
        </div>
        <div class="my-2">${situacaoPosto(p)}</div>
        <div class="small-muted">${esc(p.frequency_label)} · última visita ${p.last_visit_at ? fmtData(p.last_visit_at).slice(0, 8) : '—'}</div>
        <div class="meta mt-2">
          ${p.atividades_abertas ? tag('tag-teal', `${p.atividades_abertas} atividade(s)`, 'check2-square') : ''}
          ${p.solicitacoes_abertas ? tag('tag-amber', `${p.solicitacoes_abertas} solicitação(ões)`, 'megaphone') : ''}
          ${p.demandas_orcim_abertas ? tag('tag-violet', `${p.demandas_orcim_abertas} demanda(s) Orcim`, 'inboxes') : ''}
        </div>
        ${p.active ? `<div class="mt-2">${btnIniciar(p, p.visita_em_andamento_id, false)}</div>` : ''}
      </div>`).join('')}</div>` : `<div class="card-x">${vazio('Nenhum posto cadastrado ainda. Comece cadastrando o primeiro.', 'geo-alt')}</div>`}`;
    $('#busca-posto').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      $$('.posto-card').forEach((c) => { c.style.display = c.dataset.nome.includes(q) ? '' : 'none'; });
    });
    $('#ver-inativos').addEventListener('change', (e) => { location.hash = e.target.checked ? '#/postos?todos=1' : '#/postos'; });
    ligarCliques();
    ligarIniciar();
  }

  async function vPosto(id, seq) {
    const p = await API.get(`/postos/${encodeURIComponent(id)}`);
    if (seq !== renderSeq) return;
    titulo(p.name);
    view().innerHTML = `
      <a href="#/postos" class="small-muted text-decoration-none"><i class="bi bi-arrow-left"></i> Postos</a>
      <div class="detail-head">
        <div class="min-w-0"><h3>${esc(p.name)}</h3><div class="mt-1">${situacaoPosto(p)} ${p.active ? '' : tag('tag-gray', 'Inativo')}</div></div>
      </div>
      <div class="acoes-grandes">
        ${p.active ? btnIniciar(p, p.visita_em_andamento_id) : ''}
        <a class="btn btn-lg btn-outline-secondary btn-acao" href="#/postos/${p.id}/editar"><i class="bi bi-pencil"></i> EDITAR POSTO</a>
      </div>
      <div class="grid-2">
        <div class="card-x">
          <h3><i class="bi bi-card-text"></i>Ficha</h3>
          <dl class="kv">
            <dt>Endereço</dt><dd>${esc(p.address || '—')}</dd>
            <dt>Responsável</dt><dd>${esc(p.contact_name || '—')}</dd>
            <dt>Telefone</dt><dd>${p.phone ? `<a href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">${esc(p.phone)}</a>` : '—'}</dd>
            <dt>Última visita</dt><dd>${fmtData(p.last_visit_at)}</dd>
            <dt>Próxima visita</dt><dd>${p.next_visit_date ? `${dataCurta(p.next_visit_date)} ${dataBR(p.next_visit_date).slice(6)}${p.next_visit_time ? ` · ${p.next_visit_time}` : ''}` : '—'}
              ${btnReag({ tipo: 'posto', id: p.id, data: p.next_visit_date, hora: p.next_visit_time }, 'ms-1')}</dd>
            <dt>Frequência</dt><dd>${esc(p.frequency_label)}</dd>
            <dt>Checklist</dt><dd>${p.checklist_id ? `<a href="#/checklists/${p.checklist_id}">${esc(p.checklist_name)}</a>` : 'Nenhum'}</dd>
            <dt class="so-multi">Empresa na Orcim</dt><dd class="so-multi">${esc(p.entity_name || 'Não vinculada')}</dd>
          </dl>
          ${p.notes ? `<hr><div class="small-muted mb-1">Observações</div><div style="white-space:pre-wrap">${esc(p.notes)}</div>` : ''}
        </div>
        <div class="card-x">
          <h3><i class="bi bi-clock-history"></i>Histórico do posto</h3>
          ${p.historico.length ? p.historico.map((v) => `<div class="hist-row" data-href="#/visitas/${v.id}">
            <div><div class="fw-semibold">${fmtData(v.started_at).slice(0, 8)} — ${v.status === 'concluida' ? 'Visita concluída' : 'Visita em andamento'}</div>
              <div class="small-muted">${esc(v.user_name || '')}${v.checklist_name ? ` · ${esc(v.checklist_name)}` : ''}</div></div>
            ${v.status === 'concluida' ? (v.nao_ok ? tag('tag-red', `${v.nao_ok} NÃO OK`) : tag('tag-green', 'Tudo OK')) : tag('tag-teal', 'Em andamento')}
          </div>`).join('') : vazio('Nenhuma visita registrada ainda.', 'clock-history')}
        </div>
      </div>
      <div class="grid-3">
        <div class="card-x"><h3><i class="bi bi-inboxes"></i>Chamados abertos deste posto</h3>
          ${!p.entity_id && !p.central_location_id ? '<div class="small-muted">Este posto ainda não está ligado a uma localização. Cadastre-o em Administração › Localizações.</div>'
    : p.demandas_orcim.length ? p.demandas_orcim.map((d) => `<div class="task" data-href="#/demandas/${d.id}"><div class="ttl">${esc(d.title)}</div>
              <div class="meta"><span class="num">${esc(d.number || '#' + d.id)}</span>${tag('tag-gray', d.status_label)}${d.due_at && new Date(d.due_at) < new Date() ? tag('tag-red', 'Atrasada') : ''}</div></div>`).join('')
      : vazio('Nenhuma demanda aberta na Orcim.', 'emoji-smile')}
        </div>
        <div class="card-x"><h3><i class="bi bi-check2-square"></i>Atividades abertas <a class="sub" href="#/atividades/nova?posto=${p.id}">+ nova</a></h3>
          ${p.atividades.length ? p.atividades.map((t) => `<div class="task" data-href="#/atividades/${t.id}"><div class="ttl">${esc(t.title)}</div>
            <div class="meta">${tagTarefa(t.status)}${t.due_at ? `<span>${prazoTxt(t)}</span>` : ''}</div></div>`).join('') : vazio('Nenhuma atividade aberta.', 'check2-all')}
        </div>
        <div class="card-x"><h3><i class="bi bi-megaphone"></i>Solicitações abertas ${ehGestor() ? `<a class="sub" href="#/solicitacoes/nova?posto=${p.id}">+ nova</a>` : ''}</h3>
          ${p.solicitacoes.length ? p.solicitacoes.map((s) => `<div class="task" data-href="#/solicitacoes/${s.id}"><div class="ttl">${esc(s.title)}</div>
            <div class="meta">${tagSolic(s.status)}${s.desired_date ? `<span>${dataBR(s.desired_date)}</span>` : ''}</div></div>`).join('') : vazio('Nenhuma solicitação aberta.', 'emoji-smile')}
        </div>
      </div>`;
    ligarCliques();
    ligarIniciar();
    ligarReagendar();
  }

  async function vFormPosto(id, seq) {
    const [p, checklists, empresas] = await Promise.all([
      id ? API.get(`/postos/${encodeURIComponent(id)}`) : null,
      API.get('/checklists'),
      API.get('/postos-empresas'),
    ]);
    if (seq !== renderSeq) return;
    titulo(id ? `Editar ${p.name}` : 'Novo posto');
    const v = (k) => esc(p?.[k] ?? '');
    const freq = p?.frequency || 'mensal';
    view().innerHTML = `
      <a href="${id ? `#/postos/${id}` : '#/postos'}" class="small-muted text-decoration-none"><i class="bi bi-arrow-left"></i> Voltar</a>
      <form class="card-x mt-2 form-grande" id="form-posto" style="max-width:760px">
        <div class="mb-3"><label class="form-label" for="fp-nome">Nome do posto *</label><input class="form-control" id="fp-nome" name="name" required value="${v('name')}"></div>
        <div class="mb-3"><label class="form-label" for="fp-end">Endereço</label><input class="form-control" id="fp-end" name="address" value="${v('address')}"></div>
        <div class="row g-3 mb-3">
          <div class="col-sm-6"><label class="form-label" for="fp-resp">Responsável no posto</label><input class="form-control" id="fp-resp" name="contact_name" value="${v('contact_name')}"></div>
          <div class="col-sm-6"><label class="form-label" for="fp-tel">Telefone</label><input class="form-control" id="fp-tel" name="phone" type="tel" value="${v('phone')}"></div>
        </div>
        <div class="row g-3 mb-3">
          <div class="col-sm-6"><label class="form-label" for="fp-freq">Frequência da visita</label>
            <select class="form-select" id="fp-freq" name="frequency">
              ${[['semanal', 'Semanal'], ['quinzenal', 'Quinzenal'], ['mensal', 'Mensal'], ['dias', 'A cada X dias'], ['nenhuma', 'Sem recorrência']].map(([k, t]) => `<option value="${k}" ${k === freq ? 'selected' : ''}>${t}</option>`).join('')}
            </select></div>
          <div class="col-sm-6" id="fp-dias-box"><label class="form-label" for="fp-dias">A cada quantos dias</label>
            <input class="form-control" id="fp-dias" name="frequency_days" type="number" min="1" max="365" inputmode="numeric" value="${v('frequency_days') || 30}"></div>
        </div>
        <div class="row g-3 mb-1">
          <div class="col-6"><label class="form-label" for="fp-data">Próxima visita</label><input class="form-control" id="fp-data" name="next_visit_date" type="date" value="${v('next_visit_date')}"></div>
          <div class="col-6"><label class="form-label" for="fp-hora">Horário</label><input class="form-control" id="fp-hora" name="next_visit_time" type="time" value="${v('next_visit_time')}"></div>
        </div>
        <div class="form-text mb-3">Ao concluir uma visita, o sistema calcula sozinho a próxima data pela frequência. Você pode mudar a data aqui quando quiser.</div>
        <div class="row g-3 mb-3">
          <div class="col-sm-6"><label class="form-label" for="fp-ck">Checklist da visita</label>
            <select class="form-select" id="fp-ck" name="checklist_id"><option value="">Nenhum</option>
              ${checklists.filter((c) => c.active || String(c.id) === String(p?.checklist_id)).map((c) => `<option value="${c.id}" ${String(c.id) === String(p?.checklist_id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
            ${checklists.length ? '' : '<div class="form-text">Crie um modelo em <a href="#/checklists/novo">Checklists</a>.</div>'}</div>
          <div class="col-sm-6 so-multi"><label class="form-label" for="fp-ent">Empresa correspondente na Orcim</label>
            <select class="form-select" id="fp-ent" name="entity_id"><option value="">Não vincular</option>
              ${empresas.map((e) => `<option value="${e.id}" ${String(e.id) === String(p?.entity_id) ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
            <div class="form-text">Mostra as demandas da Orcim deste posto na ficha e na visita.</div></div>
        </div>
        <div class="mb-3"><label class="form-label" for="fp-obs">Observações</label><textarea class="form-control" id="fp-obs" name="notes" rows="3">${v('notes')}</textarea></div>
        ${id ? `<div class="mb-3"><label class="form-check"><input type="checkbox" class="form-check-input" name="active" ${p.active ? 'checked' : ''}> <span class="form-check-label">Posto ativo</span></label></div>` : ''}
        <div class="alert alert-danger py-2 d-none" id="fp-erro"></div>
        <button class="btn btn-brand btn-lg" type="submit">${id ? 'Salvar' : 'Cadastrar posto'}</button>
      </form>`;
    const caixaDias = () => { $('#fp-dias-box').style.display = $('#fp-freq').value === 'dias' ? '' : 'none'; };
    $('#fp-freq').addEventListener('change', caixaDias);
    caixaDias();
    $('#form-posto').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const body = {
        name: f.name.value, address: f.address.value, contact_name: f.contact_name.value, phone: f.phone.value,
        frequency: f.frequency.value, frequency_days: f.frequency_days.value, next_visit_date: f.next_visit_date.value || null,
        next_visit_time: f.next_visit_time.value || null, checklist_id: f.checklist_id.value || null,
        entity_id: f.entity_id.value || null, notes: f.notes.value,
      };
      if (id) body.active = f.active.checked;
      try {
        const r = id ? await API.patch(`/postos/${id}`, body) : await API.post('/postos', body);
        toast(id ? 'Posto salvo.' : 'Posto cadastrado.');
        location.hash = `#/postos/${id || r.id}`;
      } catch (e) { $('#fp-erro').textContent = e.message; $('#fp-erro').classList.remove('d-none'); }
    });
  }

  // -------------------------------- Visita ------------------------------
  const RESP = { ok: ['OK', 'ok'], nao_ok: ['NÃO OK', 'nao'], na: ['N/A', 'na'] };

  async function vVisita(id, seq) {
    const v = await API.get(`/visitas/${encodeURIComponent(id)}`);
    if (seq !== renderSeq) return;
    titulo(`Visita — ${v.location_name}`);
    const total = v.respostas.length;
    const feitas = () => $$('.ck-item').filter((el) => el.dataset.resp).length;
    const tokenQ = `?token=${encodeURIComponent(API.token)}`;

    if (!v.pode_editar) {
      // Relatório da visita (somente leitura)
      const naoOk = v.respostas.filter((r) => r.answer === 'nao_ok').length;
      view().innerHTML = `
        <a href="#/postos/${v.location_id}" class="small-muted text-decoration-none"><i class="bi bi-arrow-left"></i> ${esc(v.location_name)}</a>
        <div class="detail-head"><div><h3>Visita — ${esc(v.location_name)}</h3>
          <div class="mt-1">${v.status === 'concluida' ? tag('tag-green', 'Concluída') : v.status === 'cancelada' ? tag('tag-gray', 'Cancelada') : tag('tag-teal', 'Em andamento')}
          ${total ? (naoOk ? tag('tag-red', `${naoOk} NÃO OK`) : tag('tag-green', 'Checklist todo OK')) : ''}</div></div></div>
        <div class="grid-2">
          <div class="card-x"><dl class="kv">
            <dt>Técnico</dt><dd>${esc(v.user_name || '—')}</dd>
            <dt>Início</dt><dd>${fmtData(v.started_at)}</dd>
            <dt>Conclusão</dt><dd>${fmtData(v.finished_at)}</dd>
            <dt>Duração</dt><dd>${v.finished_at ? dur((new Date(v.finished_at) - new Date(v.started_at)) / 1000) : '—'}</dd>
            <dt>Estava prevista</dt><dd>${dataBR(v.scheduled_for)}</dd>
          </dl>
          ${v.notes ? `<hr><div class="small-muted">Observações</div><div style="white-space:pre-wrap">${esc(v.notes)}</div>` : ''}
          ${v.pending_notes ? `<hr><div class="small-muted">Pendências</div><div style="white-space:pre-wrap">${esc(v.pending_notes)}</div>` : ''}
          ${v.atividades.length ? `<hr><div class="small-muted mb-1">Atividades criadas</div>${v.atividades.map((t) => `<div><a href="#/atividades/${t.id}">${esc(t.title)}</a> ${tagTarefa(t.status)}</div>`).join('')}` : ''}
          </div>
          <div class="card-x"><h3><i class="bi bi-ui-checks"></i>${esc(v.checklist_name || 'Checklist')}</h3>
            ${total ? v.respostas.map((r) => `<div class="d-flex justify-content-between gap-2 py-2 border-bottom">
              <div><div>${esc(r.item_label)}</div>${r.note ? `<div class="small-muted">${esc(r.note)}</div>` : ''}</div>
              ${r.answer === 'ok' ? tag('tag-green', 'OK') : r.answer === 'nao_ok' ? tag('tag-red', 'NÃO OK') : r.answer === 'na' ? tag('tag-gray', 'N/A') : tag('tag-gray', '—')}</div>`).join('') : '<div class="small-muted">Visita sem checklist.</div>'}
          </div>
        </div>
        ${v.fotos.length ? `<div class="card-x"><h3><i class="bi bi-camera"></i>Fotos</h3><div class="fotos">${v.fotos.map((f) => `<a href="/api/gbf/visitas/${v.id}/fotos/${f.id}${tokenQ}" target="_blank" rel="noopener"><img src="/api/gbf/visitas/${v.id}/fotos/${f.id}${tokenQ}" alt="${esc(f.file_name)}" loading="lazy"></a>`).join('')}</div></div>` : ''}`;
      return;
    }

    // Execução da visita
    view().innerHTML = `
      <a href="#/postos/${v.location_id}" class="small-muted text-decoration-none"><i class="bi bi-arrow-left"></i> ${esc(v.location_name)}</a>
      <div class="detail-head"><div><h3>${esc(v.location_name)}</h3>
        <div class="small-muted">Iniciada em ${fmtData(v.started_at)}${v.user_name ? ` por ${esc(v.user_name)}` : ''}</div></div></div>
      ${v.demandas_orcim.length ? `<details class="card-x mb-3"><summary class="fw-semibold"><i class="bi bi-inboxes"></i> ${v.demandas_orcim.length} demanda(s) da Orcim abertas neste posto</summary>
        <div class="mt-2">${v.demandas_orcim.map((d) => `<div class="py-1"><a href="#/demandas/${d.id}">${esc(d.number || '#' + d.id)}</a> — ${esc(d.title)} ${tag('tag-gray', d.status_label)}</div>`).join('')}</div></details>` : ''}
      <div class="card-x mb-3">
        <h3><i class="bi bi-ui-checks"></i>${esc(v.checklist_name || 'Checklist')} <span class="sub" id="ck-prog"></span></h3>
        ${total ? v.respostas.map((r) => `<div class="ck-item" data-rid="${r.id}" data-resp="${r.answer || ''}">
          <div class="ck-label">${esc(r.item_label)}</div>
          <div class="ck-botoes" role="group" aria-label="${esc(r.item_label)}">
            ${Object.entries(RESP).map(([k, [txt, cls]]) => `<button type="button" class="ck-btn ck-${cls} ${r.answer === k ? 'on' : ''}" data-ans="${k}" aria-pressed="${r.answer === k}">${txt}</button>`).join('')}
          </div>
          <button type="button" class="btn btn-link btn-sm p-0 ck-obs-btn">${r.note ? 'Observação' : '+ observação'}</button>
          <textarea class="form-control mt-1 ck-obs ${r.note ? '' : 'd-none'}" rows="2" placeholder="Observação do item">${esc(r.note || '')}</textarea>
        </div>`).join('') : '<div class="small-muted">Este posto não tem checklist. Registre as observações abaixo.</div>'}
      </div>
      <div class="card-x mb-3 form-grande">
        <label class="form-label fw-semibold" for="vs-obs">Observações da visita</label>
        <textarea class="form-control mb-3" id="vs-obs" rows="3">${esc(v.notes || '')}</textarea>
        <label class="form-label fw-semibold" for="vs-pend">Pendências</label>
        <textarea class="form-control" id="vs-pend" rows="2" placeholder="O que ficou para depois">${esc(v.pending_notes || '')}</textarea>
        <label class="form-check mt-2"><input type="checkbox" class="form-check-input" id="vs-criar"> <span class="form-check-label">Criar uma atividade para acompanhar a pendência</span></label>
        <div id="vs-ativ" class="d-none mt-2">
          <input class="form-control mb-2" id="vs-ativ-tit" placeholder="Título da atividade">
          <label class="form-label small" for="vs-ativ-prazo">Prazo</label>
          <div class="d-flex gap-2"><input type="date" class="form-control" id="vs-ativ-prazo">
          <input type="time" class="form-control" id="vs-ativ-hora" aria-label="Horário (opcional)" style="max-width:9rem"></div>
          <div class="form-text">Sem horário = o dia todo.</div>
        </div>
      </div>
      <div class="card-x mb-3">
        <h3><i class="bi bi-camera"></i>Fotos <span class="sub">opcional</span></h3>
        <div class="fotos mb-2">${v.fotos.map((f) => `<div class="foto"><img src="/api/gbf/visitas/${v.id}/fotos/${f.id}${tokenQ}" alt="${esc(f.file_name)}" loading="lazy">
          <button type="button" class="foto-del" data-foto="${f.id}" aria-label="Remover foto"><i class="bi bi-x-lg"></i></button></div>`).join('')}</div>
        <label class="btn btn-outline-secondary btn-lg w-100"><i class="bi bi-camera"></i> Tirar ou escolher foto
          <input type="file" accept="image/*" multiple class="d-none" id="vs-fotos"></label>
      </div>
      <div class="barra-concluir">
        <button type="button" class="btn btn-link text-danger" id="vs-cancelar">Cancelar visita</button>
        <button type="button" class="btn btn-lg btn-brand btn-acao flex-grow-1" id="vs-concluir"><i class="bi bi-check2-circle"></i> CONCLUIR VISITA</button>
      </div>`;

    const progresso = () => { if (total) $('#ck-prog').textContent = `${feitas()} de ${total}`; };
    progresso();
    $$('.ck-item').forEach((item) => {
      const rid = item.dataset.rid;
      $$('.ck-btn', item).forEach((b) => b.addEventListener('click', async () => {
        const novo = item.dataset.resp === b.dataset.ans ? null : b.dataset.ans; // tocar de novo desmarca
        try {
          await API.req('PUT', `/visitas/${v.id}/respostas/${rid}`, { answer: novo });
          item.dataset.resp = novo || '';
          $$('.ck-btn', item).forEach((x) => { const on = x.dataset.ans === novo; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
          if (novo === 'nao_ok') { $('.ck-obs', item).classList.remove('d-none'); }
          progresso();
        } catch (e) { toast(e.message, true); }
      }));
      $('.ck-obs-btn', item).addEventListener('click', () => { const t = $('.ck-obs', item); t.classList.toggle('d-none'); t.focus(); });
      $('.ck-obs', item).addEventListener('change', (e) => {
        API.req('PUT', `/visitas/${v.id}/respostas/${rid}`, { note: e.target.value }).catch((er) => toast(er.message, true));
      });
    });
    const salvarTexto = (campo, el) => el.addEventListener('change', () => API.patch(`/visitas/${v.id}`, { [campo]: el.value }).catch((e) => toast(e.message, true)));
    salvarTexto('notes', $('#vs-obs'));
    salvarTexto('pending_notes', $('#vs-pend'));
    $('#vs-criar').addEventListener('change', (e) => {
      $('#vs-ativ').classList.toggle('d-none', !e.target.checked);
      if (e.target.checked && !$('#vs-ativ-tit').value) $('#vs-ativ-tit').value = $('#vs-pend').value.split('\n')[0].slice(0, 120);
    });
    $('#vs-fotos').addEventListener('change', async (e) => {
      const files = [...e.target.files];
      if (!files.length) return;
      const fd = new FormData();
      files.forEach((f) => fd.append('fotos', f));
      toast('Enviando foto(s)…');
      try {
        const res = await fetch(`/api/gbf/visitas/${v.id}/fotos`, { method: 'POST', headers: { Authorization: `Bearer ${API.token}` }, body: fd });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || 'Não foi possível enviar.');
        await salvarAntesDeRecarregar();
        render();
      } catch (er) { toast(er.message, true); }
    });
    $$('[data-foto]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remover esta foto?')) return;
      await API.req('DELETE', `/visitas/${v.id}/fotos/${b.dataset.foto}`).catch((e) => toast(e.message, true));
      await salvarAntesDeRecarregar();
      render();
    }));
    async function salvarAntesDeRecarregar() {
      await API.patch(`/visitas/${v.id}`, { notes: $('#vs-obs').value, pending_notes: $('#vs-pend').value }).catch(() => {});
    }
    $('#vs-cancelar').addEventListener('click', () => janela('Cancelar visita', '<p class="mb-0">A visita será descartada e não entra no histórico do posto. Continuar?</p>', {
      ok: 'Cancelar visita', perigo: true,
      onOk: async () => { await API.post(`/visitas/${v.id}/cancelar`); toast('Visita cancelada.'); location.hash = `#/postos/${v.location_id}`; },
    }));
    $('#vs-concluir').addEventListener('click', async () => {
      const faltam = total - feitas();
      if (faltam) {
        toast(`Faltam ${faltam} item(ns) do checklist.`, true);
        const pend = $$('.ck-item').find((el) => !el.dataset.resp);
        pend?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        pend?.classList.add('ck-falta');
        return;
      }
      const body = { notes: $('#vs-obs').value, pending_notes: $('#vs-pend').value };
      if ($('#vs-criar').checked) {
        if (!$('#vs-ativ-tit').value.trim()) { toast('Dê um título para a atividade da pendência.', true); return; }
        body.pendencia = { title: $('#vs-ativ-tit').value, due_date: $('#vs-ativ-prazo').value || '', due_time: $('#vs-ativ-hora').value || '', description: $('#vs-pend').value };
      }
      try {
        const r = await API.post(`/visitas/${v.id}/concluir`, body);
        toast(r.proxima_visita ? `Visita concluída. Próxima: ${dataBR(r.proxima_visita)}` : 'Visita concluída.');
        location.hash = `#/visitas/${v.id}`;
        render();
      } catch (e) { toast(e.message, true); }
    });
  }

  // ------------------------------ Checklists ----------------------------
  async function vChecklists(seq) {
    titulo('Checklists');
    const lista = await API.get('/checklists');
    if (seq !== renderSeq) return;
    view().innerHTML = `
      <div class="d-flex mb-3"><a class="btn btn-brand ms-auto" href="#/checklists/novo"><i class="bi bi-plus-lg"></i> Novo checklist</a></div>
      ${lista.length ? `<div class="postos-grid">${lista.map((c) => `<div class="posto-card ${c.active ? '' : 'inativo'}" data-href="#/checklists/${c.id}">
        <div class="d-flex justify-content-between gap-2"><div class="fw-bold">${esc(c.name)}</div>${c.active ? tag('tag-green', 'Ativo') : tag('tag-gray', 'Inativo')}</div>
        ${c.description ? `<div class="small-muted">${esc(c.description)}</div>` : ''}
        <div class="small-muted mt-2">${c.itens} item(ns) · usado em ${c.postos} posto(s)</div>
        <button type="button" class="btn btn-sm btn-outline-secondary mt-2" data-dup="${c.id}"><i class="bi bi-copy"></i> Duplicar</button>
      </div>`).join('')}</div>` : `<div class="card-x">${vazio('Nenhum checklist ainda. Crie o primeiro modelo.', 'ui-checks')}</div>`}`;
    $$('[data-dup]').forEach((b) => b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const r = await API.post(`/checklists/${b.dataset.dup}/duplicar`).catch((e) => toast(e.message, true));
      if (r) { toast('Checklist duplicado.'); location.hash = `#/checklists/${r.id}`; }
    }));
    ligarCliques();
  }

  async function vFormChecklist(id, seq) {
    const [c, postos] = await Promise.all([
      id ? API.get(`/checklists/${encodeURIComponent(id)}`) : { name: '', description: '', active: true, itens: ['Computador', 'Internet', 'Wi-Fi', 'Impressora', 'Telefonia', 'Sistema', 'Pendências'].map((label) => ({ label })), postos: [] },
      API.get('/postos?todos=1'),
    ]);
    if (seq !== renderSeq) return;
    titulo(id ? `Checklist — ${c.name}` : 'Novo checklist');
    const marcados = new Set(c.postos.map(String));
    view().innerHTML = `
      <a href="#/checklists" class="small-muted text-decoration-none"><i class="bi bi-arrow-left"></i> Checklists</a>
      <form class="card-x mt-2 form-grande" id="form-ck" style="max-width:760px">
        <div class="mb-3"><label class="form-label" for="ck-nome">Nome *</label><input class="form-control" id="ck-nome" name="name" required value="${esc(c.name)}" placeholder="Ex.: Visita ao posto"></div>
        <div class="mb-3"><label class="form-label" for="ck-desc">Descrição</label><input class="form-control" id="ck-desc" name="description" value="${esc(c.description || '')}"></div>
        <label class="form-label">Itens (cada um será respondido com OK / NÃO OK / N/A)</label>
        <div id="ck-itens"></div>
        <button type="button" class="btn btn-outline-secondary w-100 mb-3" id="ck-add"><i class="bi bi-plus-lg"></i> Adicionar item</button>
        <label class="form-label">Usar nos postos</label>
        <div class="row g-1 mb-3">${postos.length ? postos.map((p) => `<div class="col-sm-6"><label class="form-check">
          <input type="checkbox" class="form-check-input" name="posto" value="${p.id}" ${marcados.has(String(p.id)) ? 'checked' : ''}>
          <span class="form-check-label">${esc(p.name)}${p.checklist_id && !marcados.has(String(p.id)) ? ` <span class="small-muted">(usa ${esc(p.checklist_name)})</span>` : ''}</span></label></div>`).join('') : '<div class="small-muted">Nenhum posto cadastrado.</div>'}</div>
        <label class="form-check mb-3"><input type="checkbox" class="form-check-input" name="active" ${c.active ? 'checked' : ''}> <span class="form-check-label">Ativo</span></label>
        <div class="form-text mb-3">Mudar o modelo não altera visitas já feitas: cada visita guarda o checklist do jeito que estava.</div>
        <div class="alert alert-danger py-2 d-none" id="ck-erro"></div>
        <div class="d-flex gap-2 flex-wrap"><button class="btn btn-brand btn-lg" type="submit">Salvar</button>
          ${id ? `<button type="button" class="btn btn-outline-secondary btn-lg" id="ck-dup"><i class="bi bi-copy"></i> Duplicar</button>` : ''}</div>
      </form>`;
    const itens = c.itens.map((i) => i.label);
    const desenhar = () => {
      $('#ck-itens').innerHTML = itens.map((l, i) => `<div class="ck-edit">
        <input class="form-control" value="${esc(l)}" data-i="${i}" aria-label="Item ${i + 1}">
        <button type="button" class="btn btn-outline-secondary" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Subir"><i class="bi bi-arrow-up"></i></button>
        <button type="button" class="btn btn-outline-secondary" data-down="${i}" ${i === itens.length - 1 ? 'disabled' : ''} aria-label="Descer"><i class="bi bi-arrow-down"></i></button>
        <button type="button" class="btn btn-outline-danger" data-del="${i}" aria-label="Remover"><i class="bi bi-trash"></i></button></div>`).join('');
      $$('#ck-itens input').forEach((inp) => inp.addEventListener('input', () => { itens[inp.dataset.i] = inp.value; }));
      $$('[data-up]').forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.up; [itens[i - 1], itens[i]] = [itens[i], itens[i - 1]]; desenhar(); }));
      $$('[data-down]').forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.down; [itens[i + 1], itens[i]] = [itens[i], itens[i + 1]]; desenhar(); }));
      $$('[data-del]').forEach((b) => b.addEventListener('click', () => { itens.splice(+b.dataset.del, 1); desenhar(); }));
    };
    desenhar();
    $('#ck-add').addEventListener('click', () => { itens.push(''); desenhar(); $$('#ck-itens input').pop().focus(); });
    $('#ck-dup')?.addEventListener('click', async () => {
      const r = await API.post(`/checklists/${id}/duplicar`).catch((e) => toast(e.message, true));
      if (r) { toast('Checklist duplicado.'); location.hash = `#/checklists/${r.id}`; }
    });
    $('#form-ck').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const body = {
        name: f.name.value, description: f.description.value, active: f.active.checked,
        itens: itens.map((s) => s.trim()).filter(Boolean), postos: $$('input[name=posto]:checked').map((i) => Number(i.value)),
      };
      try {
        const r = id ? await API.put(`/checklists/${id}`, body) : await API.post('/checklists', body);
        toast('Checklist salvo.');
        location.hash = `#/checklists/${id || r.id}`;
        if (id) render();
      } catch (e) { $('#ck-erro').textContent = e.message; $('#ck-erro').classList.remove('d-none'); }
    });
  }

  // ----------------------------- Solicitações ---------------------------
  // Solicitação de visita: o gestor escolhe posto, data desejada, urgência e tarefas (dos checklists).
  // A TI inicia a visita pela solicitação; ao concluir a visita, a solicitação se fecha sozinha.
  const RESP_VISITA = { ok: ['tag-green', 'OK'], nao_ok: ['tag-red', 'NÃO OK'], na: ['tag-gray', 'N/A'] };
  const metaSolic = (s) => [
    s.kind === 'visita' ? `<span><i class="bi bi-clipboard-check"></i>${esc(s.tipo_visita_label || 'Visita')} · ${s.tarefas.length} tarefa(s)</span>` : '',
    tag(TAG_PRIO[s.priority] || 'tag-urg1', s.priority_label),
    s.location_name ? `<span><i class="bi bi-geo-alt"></i>${esc(s.location_name)}</span>` : '',
    s.desired_date ? `<span${['a_fazer', 'em_andamento'].includes(s.status) && s.desired_date < hojeSP() ? ' class="text-danger"' : ''}><i class="bi bi-calendar"></i> para ${dataBR(s.desired_date)}</span>` : '',
  ].join('');
  const btnVisitaSolic = (s, grande = false) => (s.kind === 'visita' && ['a_fazer', 'em_andamento'].includes(s.status)
    ? `<button type="button" class="btn ${grande ? 'btn-lg' : 'btn-sm'} ${s.visit_id ? 'btn-warning' : 'btn-brand'} btn-acao" data-visita-sol="${s.id}"
        data-posto="${s.location_id}" data-nome="${esc(s.location_name || '')}" ${s.visit_id ? `data-visita="${s.visit_id}"` : ''}>
        <i class="bi bi-${s.visit_id ? 'arrow-right-circle' : 'play-circle'}"></i> ${s.visit_id ? 'CONTINUAR VISITA' : 'INICIAR VISITA'}</button>` : '');
  function ligarVisitaSolic() {
    $$('[data-visita-sol]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      iniciarVisita(b.dataset.posto, b.dataset.nome, b.dataset.visita || null, b.dataset.visitaSol);
    }));
  }

  async function vSolicitacoes(qs, seq) {
    titulo('Solicitações');
    const sit = qs.get('situacao') || 'abertas';
    const lista = await API.get(`/solicitacoes?situacao=${sit}`);
    if (seq !== renderSeq) return;
    view().innerHTML = `
      <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
        <div class="chips mb-0 me-auto">${[['abertas', 'Abertas'], ['concluidas', 'Concluídas'], ['todas', 'Todas']].map(([k, t]) => `<a class="chip ${sit === k ? 'active' : ''}" href="#/solicitacoes?situacao=${k}">${t}</a>`).join('')}</div>
        ${ehGestor() ? '<a class="btn btn-brand" href="#/solicitacoes/nova"><i class="bi bi-plus-lg"></i> Solicitar visita</a>' : ''}
      </div>
      ${lista.length ? lista.map((s) => `<div class="task solic" data-href="#/solicitacoes/${s.id}">
        <div class="d-flex justify-content-between gap-2 align-items-start"><div class="ttl">${esc(s.title)}</div>
          <div class="d-flex gap-2 align-items-center">${btnVisitaSolic(s)}${tagSolic(s.status)}</div></div>
        <div class="meta">${metaSolic(s)}
          <span>· ${esc(s.numero)} · pedida por ${esc(s.requested_by_name || '—')} ${relativo(s.created_at)}</span>
          ${s.status === 'concluida' && s.kind === 'visita' ? `<span>· ${s.visita_nao_ok ? `<span class="text-danger">${s.visita_nao_ok} com problema</span>` : 'tudo OK'}</span>` : ''}
          ${s.tempo_ate_concluir !== null ? `<span>· feita em ${dur(s.tempo_ate_concluir)}</span>` : ''}</div></div>`).join('')
    : `<div class="card-x">${vazio(sit === 'abertas' ? 'Nenhuma solicitação aberta.' : 'Nada por aqui.', 'megaphone')}</div>`}`;
    ligarCliques();
    ligarVisitaSolic();
  }

  async function vSolicitacao(id, seq) {
    const s = await API.get(`/solicitacoes/${encodeURIComponent(id)}`);
    if (seq !== renderSeq) return;
    titulo(s.kind === 'visita' ? 'Solicitação de visita' : 'Solicitação');
    const aberta = ['a_fazer', 'em_andamento'].includes(s.status);
    const visita = s.kind === 'visita';
    const v = s.visita;
    const resultado = v && v.respostas.length ? `
      <div class="card-x mt-3" style="max-width:760px"><h3><i class="bi bi-clipboard-check"></i>${v.status === 'concluida' ? 'Resultado da visita' : 'Visita em andamento'}
        <a class="sub" href="#/visitas/${v.id}">abrir a visita</a></h3>
        <div class="small-muted mb-2">${esc(v.user_name || '')}${v.finished_at ? ` · concluída ${fmtData(v.finished_at)}` : ` · começou ${fmtData(v.started_at)}`}</div>
        ${v.respostas.map((r) => `<div class="d-flex gap-2 py-2 border-top align-items-start">
          <div class="flex-grow-1"><div class="${r.answer === 'nao_ok' ? 'fw-semibold text-danger' : ''}">${esc(r.item_label)}</div>
            ${r.note ? `<div class="small" style="white-space:pre-wrap">${esc(r.note)}</div>` : ''}</div>
          <div>${r.answer ? tag(...RESP_VISITA[r.answer]) : tag('tag-gray', 'sem resposta')}</div></div>`).join('')}
        ${v.notes ? `<hr><div class="small-muted mb-1">Comentários</div><div style="white-space:pre-wrap">${esc(v.notes)}</div>` : ''}
        ${v.pending_notes ? `<div class="small-muted mt-2 mb-1">Pendências</div><div style="white-space:pre-wrap">${esc(v.pending_notes)}</div>` : ''}
      </div>` : '';
    view().innerHTML = `
      <a href="#/solicitacoes" class="small-muted text-decoration-none"><i class="bi bi-arrow-left"></i> Solicitações</a>
      <div class="detail-head"><div class="min-w-0"><div class="mt-2">${tagSolic(s.status)} ${tag(TAG_PRIO[s.priority] || 'tag-urg1', s.priority_label)}</div>
        <h3>${esc(s.title)}</h3><div class="small-muted">${esc(s.numero)}</div></div></div>
      <div class="acoes-grandes">
        ${btnVisitaSolic(s, true)}
        ${!visita && s.status === 'a_fazer' ? '<button type="button" class="btn btn-lg btn-brand btn-acao" data-st="em_andamento"><i class="bi bi-play-circle"></i> COMEÇAR</button>' : ''}
        ${!visita && aberta ? '<button type="button" class="btn btn-lg btn-success btn-acao" data-st="concluida"><i class="bi bi-check2-circle"></i> CONCLUIR</button>' : ''}
        ${!visita && !aberta && s.status !== 'cancelada' ? '<button type="button" class="btn btn-lg btn-outline-secondary btn-acao" data-st="em_andamento"><i class="bi bi-arrow-counterclockwise"></i> Reabrir</button>' : ''}
        ${aberta ? btnReag({ tipo: 'solicitacao', id: s.id, data: s.desired_date }, 'btn-lg') : ''}
        ${ehGestor() && (s.status === 'a_fazer' || !visita) && s.status !== 'cancelada' ? `<a class="btn btn-lg btn-outline-secondary" href="#/solicitacoes/${s.id}/editar"><i class="bi bi-pencil"></i> Editar</a>` : ''}
        ${ehGestor() && aberta ? '<button type="button" class="btn btn-lg btn-outline-danger" data-st="cancelada">Cancelar</button>' : ''}
      </div>
      <div class="card-x" style="max-width:760px"><dl class="kv">
        <dt>Pedida por</dt><dd>${esc(s.requested_by_name || '—')} em ${fmtData(s.created_at)}</dd>
        <dt>Posto</dt><dd>${s.location_id ? `<a href="#/postos/${s.location_id}">${esc(s.location_name)}</a>` : '—'}</dd>
        <dt>Data desejada</dt><dd>${dataBR(s.desired_date)}</dd>
        ${visita ? `<dt>Tipo</dt><dd>${esc(s.tipo_visita_label || 'Visita')}</dd>` : ''}
        <dt>Urgência</dt><dd>${esc(s.priority_label)}</dd>
        <dt>Atendida por</dt><dd>${esc(s.handled_by_name || '—')}</dd>
        <dt>Concluída</dt><dd>${fmtData(s.completed_at)}${s.tempo_ate_concluir !== null ? ` <span class="small-muted">(${dur(s.tempo_ate_concluir)} desde o pedido)</span>` : ''}</dd>
      </dl>
      ${s.description ? `<hr><div class="small-muted mb-1">Observação do gestor</div><div style="white-space:pre-wrap">${esc(s.description)}</div>` : ''}
      ${visita && !v ? `<hr><div class="small-muted mb-1">Tarefas da visita</div><ol class="mb-0 ps-3">${s.tarefas.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>` : ''}
      ${!visita && s.response ? `<hr><div class="small-muted mb-1">Resposta da TI</div><div style="white-space:pre-wrap">${esc(s.response)}</div>` : ''}
      </div>
      ${resultado}
      ${(s.reagendamentos || []).length ? `<div class="card-x mt-3" style="max-width:760px"><h3><i class="bi bi-calendar2-week"></i>Reagendamentos</h3>
        ${s.reagendamentos.map((r) => `<div class="py-2 border-top"><div><b>${dataBR(r.de)} → ${dataBR(r.para)}</b> <span class="small-muted">· ${esc(r.quem || '—')} · ${fmtData(r.created_at)}</span></div>
          <div class="small" style="white-space:pre-wrap">${esc(r.motivo)}</div></div>`).join('')}</div>` : ''}`;
    $$('[data-st]').forEach((b) => b.addEventListener('click', () => {
      const st = b.dataset.st;
      if (st === 'concluida') {
        janela('Concluir solicitação', `<label class="form-label" for="sol-resp">O que foi feito</label>
          <textarea class="form-control" id="sol-resp" rows="4">${esc(s.response || '')}</textarea>`, {
          ok: 'Concluir',
          onOk: async (el) => { await API.patch(`/solicitacoes/${s.id}`, { status: 'concluida', response: el.querySelector('#sol-resp').value }); toast('Solicitação concluída.'); render(); },
        });
      } else if (st === 'cancelada') {
        janela('Cancelar solicitação', '<p class="mb-0">Cancelar esta solicitação? A TI deixa de vê-la como pendente.</p>', {
          ok: 'Cancelar solicitação', perigo: true, onOk: async () => { await API.patch(`/solicitacoes/${s.id}`, { status: 'cancelada' }); render(); },
        });
      } else {
        API.patch(`/solicitacoes/${s.id}`, { status: st }).then(() => { toast('Atualizado.'); render(); }).catch((e) => toast(e.message, true));
      }
    }));
    ligarReagendar();
    ligarVisitaSolic();
  }

  // ------------------------------------------------------------------
  // Novo pedido: um formulário só. Primeiro escolhe Visita ou Atividade; o resto se ajusta.
  // Visita -> solicitação de visita (as tarefas viram o checklist). Atividade -> quadro de atividades.
  // ------------------------------------------------------------------
  // Página de notificações: filtros por tipo, marcar como lida, abrir o item
  const GRUPOS_NOTIF = [
    ['todas', 'Todas', null], ['nao_lidas', 'Não lidas', null], ['mencoes', 'Menções', ['mencao']],
    ['atividades', 'Atividades', ['atividade', 'atividade_prazo', 'atividade_atrasada']],
    ['comentarios', 'Comentários', ['comentario']],
    ['pedidos', 'Pedidos de visita', ['solicitacao']],
    ['visitas', 'Visitas', ['visita', 'visita_prevista']],
    ['reagendamentos', 'Reagendamentos', ['reagendamento']],
    ['cadastros', 'Postos e checklists', ['posto', 'checklist']],
  ];
  const ICONE_NOTIF = {
    mencao: 'at', atividade: 'check2-square', atividade_prazo: 'hourglass-split', atividade_atrasada: 'alarm', comentario: 'chat-left-text',
    solicitacao: 'megaphone', visita: 'geo-alt', visita_prevista: 'calendar-event', reagendamento: 'arrow-left-right',
    posto: 'shop', checklist: 'ui-checks', demanda_nova: 'inbox', demanda_status: 'inbox', demanda_atrasada: 'alarm',
  };
  async function vNotificacoes(qs, seq) {
    titulo('Notificações');
    const grupo = GRUPOS_NOTIF.some(([k]) => k === qs.get('f')) ? qs.get('f') : 'todas';
    const r = await API.get(`/notificacoes?limite=300${grupo === 'nao_lidas' ? '&nao_lidas=1' : ''}`);
    if (seq !== renderSeq) return;
    const tipos = GRUPOS_NOTIF.find(([k]) => k === grupo)[2];
    const itens = tipos ? r.itens.filter((n) => tipos.includes(n.kind)) : r.itens;
    const contar = (t) => r.itens.filter((n) => !n.is_read && (!t || t.includes(n.kind))).length;
    // agrupa por dia
    const dias = new Map();
    for (const n of itens) {
      const d = new Date(n.created_at).toLocaleDateString('en-CA', { timeZone: TZ });
      if (!dias.has(d)) dias.set(d, []);
      dias.get(d).push(n);
    }
    const nomeDia = (d) => (d === hojeSP() ? 'Hoje' : d === isoSoma(hojeSP(), -1) ? 'Ontem' : dataCurta(d));
    view().innerHTML = `
      <nav class="pg-abas" aria-label="Filtrar notificações">${GRUPOS_NOTIF.map(([k, nome, t]) => {
    const n = k === 'todas' ? r.nao_lidas : k === 'nao_lidas' ? r.nao_lidas : contar(t);
    return `<a href="#/notificacoes?f=${k}" class="${k === grupo ? 'on' : ''}">${nome}${n ? ` <b class="nt-n">${n}</b>` : ''}</a>`;
  }).join('')}</nav>
      <div class="d-flex justify-content-end mb-2"><button class="btn btn-sm btn-outline-secondary" id="nt-ler"><i class="bi bi-check2-all"></i> Marcar todas como lidas</button></div>
      ${itens.length ? [...dias.entries()].map(([d, lst]) => `<div class="nt-dia">${esc(nomeDia(d))}</div>
        <div class="card-x p-0 nt-lista">${lst.map((n) => `<a class="nt-item ${n.is_read ? '' : 'nova'}" href="${esc(n.link || '#/')}" data-nid="${n.id}">
          <span class="nt-ic"><i class="bi bi-${ICONE_NOTIF[n.kind] || 'bell'}"></i></span>
          <span class="nt-txt"><span class="nt-t">${esc(n.title)}</span>${n.message ? `<span class="nt-m">${esc(n.message)}</span>` : ''}</span>
          <span class="nt-w">${new Date(n.created_at).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}</span>
        </a>`).join('')}</div>`).join('')
    : `<div class="card-x">${vazio(grupo === 'nao_lidas' ? 'Nenhuma notificação não lida.' : 'Nenhuma notificação aqui.', 'bell-slash')}</div>`}`;
    $('#nt-ler').addEventListener('click', async () => {
      await API.post('/notificacoes/lidas', {}).catch(() => {});
      buscarNotificacoes(); render();
    });
    $$('.nt-item[data-nid]').forEach((a) => a.addEventListener('click', () => {
      API.post('/notificacoes/lidas', { ids: [Number(a.dataset.nid)] }).then(buscarNotificacoes).catch(() => {});
    }));
  }

  async function vNovoPedido(qs, seq) {
    titulo('Novo pedido');
    const g = ehGestor();
    const [postos, modelos, users] = await Promise.all([
      API.get('/postos'), g ? API.get('/solicitacoes/modelos') : [], g ? carregarUsuarios() : [],
    ]);
    if (seq !== renderSeq) return;
    let tipo = g ? (['visita', 'atividade'].includes(qs.get('tipo')) ? qs.get('tipo') : '') : 'atividade';
    const data0 = /^\d{4}-\d{2}-\d{2}$/.test(qs.get('data') || '') ? qs.get('data') : '';
    const tecnicos = users.filter((u) => u.role === 'tecnico' || u.faz_visitas);
    const respPadrao = fazVisitas() ? EU.id : (tecnicos[0]?.id || '');
    const tarefas = [];
    const URG = [[1, 'Requisição'], [2, 'Prejudicada'], [3, 'Parada iminente'], [4, 'Operação parada']];

    view().innerHTML = `
      <form class="np card-x" id="np" novalidate>
        ${g ? `<div class="np-tipos" role="radiogroup" aria-label="O que você precisa">
          <button type="button" class="np-tipo" data-tipo="visita" role="radio"><i class="bi bi-geo-alt"></i><b>Visita ao posto</b><small>ir até lá e fazer uma ou mais coisas</small></button>
          <button type="button" class="np-tipo" data-tipo="atividade" role="radio"><i class="bi bi-check2-square"></i><b>Atividade</b><small>algo a fazer, sem precisar ir ao posto</small></button>
        </div>` : ''}
        <div class="np-corpo">
          <div class="np-linha"><label for="np-tit">O que precisa?</label>
            <input class="form-control" id="np-tit" maxlength="200" placeholder="Ex.: Trocar nobreak do caixa" autocomplete="off"></div>
          <div class="np-linha"><label for="np-posto">Posto</label>
            <select class="form-select" id="np-posto"><option value="">${g ? 'Escolha o posto' : 'Nenhum'}</option>
            ${postos.map((p) => `<option value="${p.id}" data-ck="${p.checklist_id || ''}" ${String(p.id) === String(qs.get('posto')) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div class="np-linha"><label for="np-data">Para quando</label>
            <div class="np-quando">
              <input type="date" class="form-control" id="np-data" value="${esc(data0)}">
              <input type="time" class="form-control np-so-ativ" id="np-hora" aria-label="Horário (opcional)">
              <span class="small-muted np-so-ativ">vazio = dia todo</span>
            </div>
            <label class="form-check np-so-ativ mt-1"><input type="checkbox" class="form-check-input" id="np-varios"> <span class="form-check-label">Leva vários dias</span></label>
            <div class="np-inicio d-none"><span class="small-muted">Começa em</span> <input type="date" class="form-control form-control-sm" id="np-ini"></div></div>
          <div class="np-linha"><span class="np-rot">Urgência</span>
            <div class="np-urg" role="radiogroup" aria-label="Urgência">${URG.map(([v, n]) => `<label class="np-urg-op"><input type="radio" name="np-urg" value="${v}" ${v === 1 ? 'checked' : ''}><i class="cal-num urg-${v}"></i>${n}</label>`).join('')}</div></div>

          <div class="np-linha np-so-visita"><span class="np-rot">O que fazer lá</span>
            <div class="np-tarefas">
              <input class="form-control" id="np-tarefa" placeholder="Digite uma tarefa e aperte Enter" autocomplete="off">
              <div class="form-text mt-1">Tarefas avulsas. Para usar um checklist pronto, marque "Cumprir checklist" abaixo.</div>
              <ul id="np-lista" class="np-lista"></ul>
              <div class="np-ck">
                <label class="form-check mb-0"><input type="checkbox" class="form-check-input" id="np-ck"> <span class="form-check-label"><b>Cumprir checklist</b></span></label>
                <div class="np-ck-esc d-none" id="np-ck-esc">
                  <select class="form-select form-select-sm" id="np-ck-sel" aria-label="Qual checklist">
                    ${modelos.length ? modelos.map((m) => `<option value="${m.id}">${esc(m.name)} (${plural(m.itens.length, 'item', 'itens')})</option>`).join('') : '<option value="">Nenhum checklist cadastrado</option>'}
                  </select>
                  <div class="np-ck-dica small-muted" id="np-ck-dica"></div>
                  <ul class="np-ck-prev" id="np-ck-prev"></ul>
                </div>
              </div>
            </div></div>

          ${g ? `<div class="np-linha np-so-ativ"><label for="np-resp">Responsável</label>
            <select class="form-select" id="np-resp"><option value="">Sem responsável</option>
            ${users.filter((u) => u.role !== 'unidade').map((u) => `<option value="${u.id}" ${String(u.id) === String(respPadrao) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>` : ''}

          <div class="np-linha"><span class="np-rot"></span><div>
            <a href="#" class="small" id="np-mais-l">+ detalhes</a>
            <textarea class="form-control d-none mt-1" id="np-det" rows="3" placeholder="Algo mais que a TI precisa saber"></textarea></div></div>

          <div class="np-acoes"><button class="btn btn-brand" type="submit" id="np-ok">Enviar pedido</button></div>
        </div>
        <div class="np-escolha small-muted">Escolha acima o que você precisa.</div>
      </form>`;

    const form = $('#np');
    const aplicarTipo = () => {
      form.dataset.tipo = tipo;
      $$('.np-tipo').forEach((b) => { b.classList.toggle('on', b.dataset.tipo === tipo); b.setAttribute('aria-checked', String(b.dataset.tipo === tipo)); });
      $('#np-ok').textContent = tipo === 'visita' ? 'Pedir visita' : 'Criar atividade';
      atualizarCk();
    };
    const pintarTarefas = () => {
      $('#np-lista').innerHTML = tarefas.map((t, i) => `<li><span>${esc(t)}</span><button type="button" data-tira="${i}" aria-label="Tirar ${esc(t)}"><i class="bi bi-x"></i></button></li>`).join('');
    };
    // Checklist pré-configurado: por padrão, o do posto escolhido; dá para trocar por qualquer outro
    const ckDoPosto = () => $('#np-posto').selectedOptions[0]?.dataset.ck || '';
    let ckEscolhidoAMao = false;
    const itensCk = () => {
      if (!$('#np-ck').checked) return [];
      const m = modelos.find((x) => String(x.id) === $('#np-ck-sel').value);
      return m ? m.itens : [];
    };
    function atualizarCk() {
      if (!ckEscolhidoAMao && ckDoPosto() && modelos.some((x) => String(x.id) === ckDoPosto())) $('#np-ck-sel').value = ckDoPosto();
      const ligado = $('#np-ck').checked;
      $('#np-ck-esc').classList.toggle('d-none', !ligado);
      const m = modelos.find((x) => String(x.id) === $('#np-ck-sel').value);
      $('#np-ck-dica').textContent = !m ? '' : String(m.id) === ckDoPosto() ? 'É o checklist deste posto.' : (ckDoPosto() ? 'O posto usa outro checklist; este vale só para esta visita.' : '');
      $('#np-ck-prev').innerHTML = m ? m.itens.slice(0, 6).map((i) => `<li>${esc(i)}</li>`).join('') + (m.itens.length > 6 ? `<li class="mais">+${m.itens.length - 6} itens</li>` : '') : '';
    }
    $$('.np-tipo').forEach((b) => b.addEventListener('click', () => { tipo = b.dataset.tipo; aplicarTipo(); $('#np-tit').focus(); }));
    $('#np-posto').addEventListener('change', atualizarCk);
    $('#np-ck').addEventListener('change', atualizarCk);
    $('#np-ck-sel').addEventListener('change', () => { ckEscolhidoAMao = true; atualizarCk(); });
    $('#np-varios').addEventListener('change', (e) => $('.np-inicio').classList.toggle('d-none', !e.target.checked));
    $('#np-mais-l').addEventListener('click', (e) => { e.preventDefault(); e.target.classList.add('d-none'); $('#np-det').classList.remove('d-none'); $('#np-det').focus(); });
    $('#np-tarefa').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = e.target.value.trim();
      if (v && !tarefas.some((t) => t.toLowerCase() === v.toLowerCase())) { tarefas.push(v); pintarTarefas(); }
      e.target.value = '';
    });
    $('#np-lista').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tira]');
      if (b) { tarefas.splice(Number(b.dataset.tira), 1); pintarTarefas(); }
    });
    // Enter nos outros campos não envia sem querer
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.id !== 'np-tarefa') e.preventDefault(); });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const tit = $('#np-tit').value.trim();
      const posto = $('#np-posto').value;
      const data = $('#np-data').value;
      const urg = Number(form.querySelector('[name="np-urg"]:checked')?.value || 1);
      const det = $('#np-det').value.trim();
      const btn = $('#np-ok');
      try {
        if (!tipo) throw new Error('Escolha se é uma visita ou uma atividade.');
        btn.disabled = true;
        if (tipo === 'visita') {
          if (!posto) throw new Error('Escolha o posto da visita.');
          const pendente = $('#np-tarefa').value.trim();
          if (pendente && !tarefas.includes(pendente)) tarefas.push(pendente);
          const comCk = $('#np-ck').checked && itensCk().length > 0;
          if ($('#np-ck').checked && !comCk) throw new Error('Escolha um checklist com itens ou desmarque "Cumprir checklist".');
          let lista = [...(comCk ? itensCk() : []), ...tarefas];
          if (!lista.length && tit) lista = [tit];
          if (!lista.length) throw new Error('Diga o que fazer lá: marque "Cumprir checklist", adicione uma tarefa ou escreva no "O que precisa?".');
          const r = await API.post('/solicitacoes', {
            kind: 'visita', visit_type: comCk ? 'rotina' : 'pontual', location_id: posto, desired_date: data || null, priority: urg,
            description: [tit, det].filter(Boolean).join('\n\n') || null, tarefas: lista,
          });
          toast('Visita pedida. A TI foi avisada.');
          location.hash = `#/solicitacoes/${r.id}`;
        } else {
          if (!tit) throw new Error('Escreva o que precisa ser feito.');
          const varios = $('#np-varios').checked && $('#np-ini').value;
          if (varios && data && $('#np-ini').value > data) throw new Error('O início precisa ser antes da entrega.');
          const body = {
            title: tit, description: det, priority: urg, location_id: posto || null,
            due_date: data || '', due_time: data ? ($('#np-hora').value || '') : '', start_date: varios ? $('#np-ini').value : '',
          };
          if (g) body.assignee_id = $('#np-resp').value || null;
          const r = await API.post('/atividades', body);
          toast('Atividade criada.');
          location.hash = `#/atividades/${r.id}`;
        }
      } catch (e) { toast(e.message, true); btn.disabled = false; }
    });
    aplicarTipo();
    if (!g || tipo) $('#np-tit').focus();
  }

  async function vFormSolicitacao(id, qs, seq) {
    const [s, postos, modelos] = await Promise.all([
      id ? API.get(`/solicitacoes/${encodeURIComponent(id)}`) : null, API.get('/postos'), API.get('/solicitacoes/modelos'),
    ]);
    if (seq !== renderSeq) return;
    if (s && s.kind !== 'visita') return vFormSolicitacaoGeral(s, postos);
    titulo(id ? 'Editar solicitação de visita' : 'Solicitar visita');
    const postoSel = s ? s.location_id : qs.get('posto');
    view().innerHTML = `
      <a href="${id ? `#/solicitacoes/${id}` : '#/solicitacoes'}" class="small-muted text-decoration-none"><i class="bi bi-arrow-left"></i> Voltar</a>
      <form class="card-x mt-2 form-grande" id="form-sol" style="max-width:720px" novalidate>
        <div class="row g-3 mb-3">
          <div class="col-sm-6"><label class="form-label" for="sl-posto">Posto *</label><select class="form-select" id="sl-posto" name="location_id" required>
            <option value="">Escolha o posto</option>
            ${postos.map((p) => `<option value="${p.id}" data-ck="${p.checklist_id || ''}" ${String(p.id) === String(postoSel) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div class="col-sm-3"><label class="form-label" for="sl-data">Data desejada</label><input type="date" class="form-control" id="sl-data" name="desired_date" value="${esc(s?.desired_date || '')}"></div>
          <div class="col-sm-3"><label class="form-label" for="sl-prio">Urgência</label><select class="form-select" id="sl-prio" name="priority">
            ${[1, 2, 3, 4].map((p) => `<option value="${p}" ${(s?.priority || 1) === p ? 'selected' : ''}>${PRIO_TAREFA[p]}</option>`).join('')}</select></div>
        </div>
        <fieldset class="mb-3"><legend class="form-label mb-1" style="font-size:1rem">Tipo da visita</legend>
          <div class="sl-tipos">
            <label class="sl-tipo"><input type="radio" name="visit_type" value="rotina" ${(s?.visit_type || 'rotina') === 'rotina' ? 'checked' : ''}>
              <span><b>De rotina</b><small>O checklist do posto (internet, nobreak, caixas...)</small></span></label>
            <label class="sl-tipo"><input type="radio" name="visit_type" value="pontual" ${s?.visit_type === 'pontual' ? 'checked' : ''}>
              <span><b>Pontual</b><small>Só um pedido específico para aquele posto</small></span></label>
          </div></fieldset>
        <div class="d-flex flex-wrap align-items-end gap-2 mb-2">
          <div class="me-auto"><div class="form-label mb-0" id="sl-tit-tarefas">Tarefas da visita *</div>
            <div class="form-text mt-0" id="sl-ajuda-tarefas">Vêm do checklist do posto. Desmarque o que não precisa e acrescente o que faltar.</div></div>
          <div id="sl-modelo-box"><label class="form-label small mb-1" for="sl-modelo">Pegar tarefas do checklist</label>
            <select class="form-select form-select-sm" id="sl-modelo"><option value="">—</option>${modelos.map((m) => `<option value="${m.id}">${esc(m.name)} (${m.itens.length})</option>`).join('')}</select></div>
        </div>
        <div id="sl-tarefas" class="sl-tarefas"></div>
        <div class="input-group input-group-sm mt-2">
          <input class="form-control" id="sl-nova" maxlength="200" placeholder="Outra tarefa (ex.: trocar cabo do caixa 2)" aria-label="Outra tarefa">
          <button class="btn btn-outline-secondary" type="button" id="sl-add"><i class="bi bi-plus-lg"></i> Adicionar</button>
        </div>
        <div class="mt-3"><label class="form-label" for="sl-desc">Observação</label><textarea class="form-control" id="sl-desc" name="description" rows="3" placeholder="Ex.: o gerente disse que o caixa 3 está travando">${esc(s?.description || '')}</textarea></div>
        <div class="alert alert-danger py-2 mt-3 d-none" id="sl-erro" role="alert"></div>
        <button class="btn btn-brand btn-lg mt-3" type="submit">${id ? 'Salvar' : 'Enviar para a TI'}</button>
      </form>`;

    // tarefas: [{label, marcada}]
    let tarefas = (s?.tarefas || []).map((t) => ({ label: t, marcada: true }));
    const caixa = $('#sl-tarefas');
    const pintar = () => {
      caixa.innerHTML = tarefas.length ? tarefas.map((t, i) => `<label class="sl-tarefa">
        <input type="checkbox" class="form-check-input" data-i="${i}" ${t.marcada ? 'checked' : ''}> <span>${esc(t.label)}</span></label>`).join('')
        : `<div class="small-muted py-2">${tipo() === 'pontual' ? 'Escreva abaixo o que precisa ser feito e clique em Adicionar.' : 'Escolha o posto ou um checklist para trazer as tarefas.'}</div>`;
      $$('#sl-tarefas [data-i]').forEach((c) => c.addEventListener('change', () => { tarefas[Number(c.dataset.i)].marcada = c.checked; }));
    };
    const juntar = (labels) => {
      const tem = new Set(tarefas.map((t) => t.label.toLowerCase()));
      for (const l of labels) if (!tem.has(l.toLowerCase())) { tarefas.push({ label: l, marcada: true }); tem.add(l.toLowerCase()); }
      pintar();
    };
    const doChecklist = (ckId) => (modelos.find((m) => String(m.id) === String(ckId))?.itens || []);
    const tipo = () => ($('input[name=visit_type]:checked')?.value || 'rotina');
    const ajustarTipo = () => {
      const pontual = tipo() === 'pontual';
      $('#sl-modelo-box').classList.toggle('d-none', pontual);
      $('#sl-tit-tarefas').textContent = pontual ? 'O que precisa ser feito *' : 'Tarefas da visita *';
      $('#sl-ajuda-tarefas').textContent = pontual ? 'Escreva o pedido específico. Pode ter mais de um item.'
        : 'Vêm do checklist do posto. Desmarque o que não precisa e acrescente o que faltar.';
      $('#sl-nova').placeholder = pontual ? 'Ex.: impressora fiscal do caixa 1 não imprime' : 'Outra tarefa (ex.: trocar cabo do caixa 2)';
    };
    $$('input[name=visit_type]').forEach((r) => r.addEventListener('change', () => {
      if (tipo() === 'pontual') {
        const doPosto = doChecklist($('#sl-posto').selectedOptions[0]?.dataset.ck);
        tarefas = tarefas.filter((t) => !doPosto.includes(t.label));
        pintar();
        $('#sl-nova').focus();
      } else {
        const ck = $('#sl-posto').selectedOptions[0]?.dataset.ck;
        if (ck) juntar(doChecklist(ck));
      }
      ajustarTipo();
    }));
    $('#sl-posto').addEventListener('change', (ev) => {
      if (tipo() === 'pontual') return;
      const ck = ev.target.selectedOptions[0]?.dataset.ck;
      if (ck && !tarefas.some((t) => t.marcada)) { tarefas = []; juntar(doChecklist(ck)); }
      else if (ck) juntar(doChecklist(ck));
    });
    $('#sl-modelo').addEventListener('change', (ev) => { if (ev.target.value) juntar(doChecklist(ev.target.value)); ev.target.value = ''; });
    const adicionar = () => {
      const v = $('#sl-nova').value.trim();
      if (!v) { $('#sl-nova').focus(); return; }
      juntar([v]);
      $('#sl-nova').value = '';
      $('#sl-nova').focus();
    };
    $('#sl-add').addEventListener('click', adicionar);
    $('#sl-nova').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); adicionar(); } });
    if (!s && postoSel) { const ck = $('#sl-posto').selectedOptions[0]?.dataset.ck; if (ck) juntar(doChecklist(ck)); }
    ajustarTipo();
    pintar();

    const erro = $('#sl-erro');
    const mostrarErro = (msg) => { erro.textContent = msg; erro.classList.remove('d-none'); };
    $('#form-sol').addEventListener('input', () => erro.classList.add('d-none'));
    $('#form-sol').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      if (!f.location_id.value) { mostrarErro('Escolha o posto da visita.'); f.location_id.focus(); return; }
      const escolhidas = tarefas.filter((t) => t.marcada).map((t) => t.label);
      if (!escolhidas.length) {
        mostrarErro(tipo() === 'pontual' ? 'Escreva o que precisa ser feito e clique em Adicionar.' : 'Marque pelo menos uma tarefa.');
        $('#sl-nova').focus();
        return;
      }
      const body = {
        kind: 'visita', visit_type: tipo(), location_id: f.location_id.value, priority: Number(f.priority.value),
        desired_date: f.desired_date.value || null, description: f.description.value, tarefas: escolhidas,
      };
      try {
        const r = id ? await API.patch(`/solicitacoes/${id}`, body) : await API.post('/solicitacoes', body);
        toast(id ? 'Solicitação salva.' : 'Visita solicitada. A TI foi avisada.');
        location.hash = `#/solicitacoes/${id || r.id}`;
      } catch (e) { mostrarErro(e.message); }
    });
  }

  // Edição das solicitações antigas, de texto livre
  function vFormSolicitacaoGeral(s, postos) {
    titulo('Editar solicitação');
    view().innerHTML = `
      <a href="#/solicitacoes/${s.id}" class="small-muted text-decoration-none"><i class="bi bi-arrow-left"></i> Voltar</a>
      <form class="card-x mt-2 form-grande" id="form-sol" style="max-width:640px">
        <div class="mb-3"><label class="form-label" for="sl-tit">O que você precisa *</label><input class="form-control" id="sl-tit" name="title" required value="${esc(s.title || '')}"></div>
        <div class="mb-3"><label class="form-label" for="sl-desc">Detalhes</label><textarea class="form-control" id="sl-desc" name="description" rows="4">${esc(s.description || '')}</textarea></div>
        <div class="row g-3 mb-3">
          <div class="col-sm-6"><label class="form-label" for="sl-posto">Posto</label><select class="form-select" id="sl-posto" name="location_id"><option value="">Nenhum</option>
            ${postos.map((p) => `<option value="${p.id}" ${String(p.id) === String(s.location_id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div class="col-sm-6"><label class="form-label" for="sl-prio">Urgência</label><select class="form-select" id="sl-prio" name="priority">
            ${[1, 2, 3, 4].map((p) => `<option value="${p}" ${s.priority === p ? 'selected' : ''}>${PRIO_TAREFA[p]}</option>`).join('')}</select></div>
          <div class="col-sm-6"><label class="form-label" for="sl-data">Data desejada</label><input type="date" class="form-control" id="sl-data" name="desired_date" value="${esc(s.desired_date || '')}"></div>
        </div>
        <div class="alert alert-danger py-2 d-none" id="sl-erro"></div>
        <button class="btn btn-brand btn-lg" type="submit">Salvar</button>
      </form>`;
    $('#form-sol').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const body = { title: f.title.value, description: f.description.value, location_id: f.location_id.value || null, priority: Number(f.priority.value), desired_date: f.desired_date.value || null };
      try {
        await API.patch(`/solicitacoes/${s.id}`, body);
        toast('Solicitação salva.');
        location.hash = `#/solicitacoes/${s.id}`;
      } catch (e) { $('#sl-erro').textContent = e.message; $('#sl-erro').classList.remove('d-none'); }
    });
  }

  // --------------------------- Acompanhamento ---------------------------
  // Ordem da tela: 1) o que precisa do gestor agora, 2) hoje, 3) resultado do período
  // (comparado ao período anterior), 4) situação dos postos + o que foi feito.
  const PERIODOS_AC = [['hoje', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['mes', 'Mês']];
  const COMPARA_AC = { hoje: 'comparado a ontem até esta hora', 7: 'comparado aos 7 dias anteriores', 30: 'comparado aos 30 dias anteriores', mes: 'comparado ao mesmo trecho do mês passado' };
  const TITULO_AC = { hoje: 'Resultado de hoje', 7: 'Resultado dos últimos 7 dias', 30: 'Resultado dos últimos 30 dias', mes: 'Resultado do mês' };
  const acFeed = { filtro: 'tudo', tudo: false, itens: [] };

  function deltaAc(atual, antes, { menorMelhor = false } = {}) {
    const a = Number(atual) || 0;
    const b = Number(antes) || 0;
    if (a === b) return '<span class="ac-delta">=</span>';
    const bom = menorMelhor ? a < b : a > b;
    return `<span class="ac-delta ${bom ? 'up' : 'down'}" title="antes: ${b}">${a > b ? '+' : '−'}${Math.abs(a - b)}</span>`;
  }

  function diaFeed(d) {
    const dia = new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
    const hoje = hojeSP();
    const ontem = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: TZ });
    if (dia === hoje) return 'Hoje';
    if (dia === ontem) return 'Ontem';
    return new Date(d).toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' });
  }

  function renderFeedAc() {
    const el = $('#ac-feed');
    if (!el) return;
    const lista = acFeed.itens.filter((f) => acFeed.filtro === 'tudo' || f.tipo === acFeed.filtro);
    const mostrar = acFeed.tudo ? lista : lista.slice(0, 6);
    const icone = { visita: 'geo-alt', atividade: 'check2-square', solicitacao: 'megaphone' };
    let diaAtual = '';
    el.innerHTML = mostrar.length ? mostrar.map((f) => {
      const d = diaFeed(f.quando);
      const cab = d !== diaAtual ? `<div class="ac-feed-dia">${esc(d)}</div>` : '';
      diaAtual = d;
      return `${cab}<div class="ac-feed-item ${f.alerta ? 'alerta' : ''}" data-href="${f.link}">
        <i class="bi bi-${icone[f.tipo]}"></i>
        <div class="flex-grow-1 min-w-0"><div class="t">${esc(f.titulo)}</div>${f.detalhe ? `<div class="small-muted">${esc(f.detalhe)}</div>` : ''}</div>
        <div class="small-muted text-nowrap">${new Date(f.quando).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}${f.quem ? ` · ${esc(f.quem)}` : ''}</div></div>`;
    }).join('') + (lista.length > mostrar.length ? `<button class="btn btn-link btn-sm px-0 mt-1" id="ac-feed-mais">Ver tudo (${lista.length})</button>` : '')
      : '<div class="small-muted py-2">Nada concluído neste período.</div>';
    $$('#ac-feed-filtros [data-f]').forEach((b) => b.classList.toggle('on', b.dataset.f === acFeed.filtro));
    $('#ac-feed-mais')?.addEventListener('click', () => { acFeed.tudo = true; renderFeedAc(); });
    $$('#ac-feed [data-href]').forEach((x) => x.addEventListener('click', () => { location.hash = x.dataset.href; }));
  }

  async function vAcompanhamento(qs, seq) {
    titulo('Início');
    let periodo = qs.get('periodo') || (qs.get('dias') === '30' ? '30' : '7');
    if (!PERIODOS_AC.some(([k]) => k === periodo)) periodo = '7';
    const a = await API.get(`/acompanhamento?periodo=${periodo}`);
    if (seq !== renderSeq) return;
    const r = a.resumo;
    const ant = a.anterior;
    const h = a.hoje;
    acFeed.itens = a.feed;
    acFeed.tudo = false;
    acFeed.filtro = 'tudo';

    const altos = a.atencao.filter((x) => x.nivel === 'alto').length;
    const linhaAtencao = (x) => `
      <div class="ac-row" data-href="${x.link}">
        ${tag(x.nivel === 'alto' ? 'tag-red' : 'tag-amber', x.rotulo)}
        <div class="flex-grow-1 min-w-0"><div class="t">${esc(x.titulo)}</div><div class="small-muted">${esc(x.detalhe)}</div></div>
        ${x.acao.reagendar ? btnReag(x.acao.reagendar) : `<a class="btn btn-sm btn-outline-secondary" href="${x.acao.href}">${esc(x.acao.texto)}</a>`}
      </div>`;

    const cartaoHoje = [
      ...h.concluidas.map((v) => ({ hora: v.hora, html: `<div class="ac-hoje-card" data-href="#/visitas/${v.id}">
        <div class="small-muted">${esc(v.hora)}${v.quem ? ` · ${esc(v.quem)}` : ''}</div><div class="t">${esc(v.local)}</div>
        ${v.nao_ok ? tag('tag-red', `${v.nao_ok} com problema`) : tag('tag-green', 'Feita · tudo OK')}</div>` })),
      ...h.em_andamento.map((v) => ({ hora: v.hora, html: `<div class="ac-hoje-card agora" data-href="#/visitas/${v.id}">
        <div class="small-muted">Agora${v.quem ? ` · ${esc(v.quem)}` : ''}</div><div class="t">${esc(v.local)}</div>
        ${tag('tag-blue', `Em andamento ${v.feitos}/${v.itens}`)}</div>` })),
      ...h.previstas.map((p) => ({ hora: p.hora || '99:99', html: `<div class="ac-hoje-card" data-href="#/postos/${p.id}">
        <div class="small-muted">${esc(p.hora || 'sem horário')}</div><div class="t">${esc(p.local)}</div>
        ${tag('tag-gray', 'Prevista')}</div>` })),
    ].sort((x, y) => x.hora.localeCompare(y.hora));

    view().innerHTML = `
      <div class="ac-topo">
        <div class="pg-seg" role="group" aria-label="Período">${PERIODOS_AC.map(([k, t]) => `<a class="${k === periodo ? 'on' : ''}" aria-current="${k === periodo}" href="#/?periodo=${k}">${t}</a>`).join('')}</div>
        <a class="btn btn-brand btn-sm" href="#/solicitacoes/nova"><i class="bi bi-plus-lg"></i> Solicitar visita</a>
      </div>

      <section class="ac-sec">
        <div class="ac-head"><h2>Precisa de você</h2>${a.atencao.length ? tag(altos ? 'tag-red' : 'tag-amber', String(a.atencao.length)) : ''}</div>
        <div class="ac-box">${a.atencao.length ? a.atencao.map(linhaAtencao).join('')
    : '<div class="ac-row ac-ok"><i class="bi bi-check2-circle"></i><div>Tudo em dia.</div></div>'}</div>
      </section>

      <section class="ac-sec">
        <div class="ac-head"><h2>Hoje</h2><a class="small ms-auto" href="#/agenda">ver agenda</a></div>
        ${cartaoHoje.length ? `<div class="ac-hoje">${cartaoHoje.map((c) => c.html).join('')}</div>`
    : '<div class="ac-box"><div class="ac-row small-muted">Nenhuma visita para hoje.</div></div>'}
      </section>

      <section class="ac-sec">
        <div class="ac-head"><h2>${TITULO_AC[periodo]}</h2></div>
        ${faixa([
    { l: 'Visitas feitas', v: r.visitas, var: variacao(r.visitas, ant.visitas) },
    { l: 'Itens com problema', v: r.nao_ok, var: variacao(r.nao_ok, ant.nao_ok, { menorMelhor: true }) },
    { l: 'Solicitações atendidas', v: r.solicitacoes, var: variacao(r.solicitacoes, ant.solicitacoes) },
    { l: 'Atividades concluídas', v: r.atividades, var: variacao(r.atividades, ant.atividades) },
  ])}
        <div class="pg-card">${graficoLinhas(a.serie, [
    { campo: 'visitas', nome: 'Visitas feitas', cor: '#0f766e' },
    { campo: 'nao_ok', nome: 'Itens com problema', cor: '#d7263d' },
  ], { escala: a.escala, altura: 190, largura: 900 })}</div>
      </section>

      <section class="ac-sec">
        <div class="ac-head"><h2>Últimos registros</h2></div>
        <div class="ac-box ac-feed" id="ac-feed"></div>
      </section>`;
    renderFeedAc();
    ligarReagendar();
    $$('.ac-box [data-reag], .ac-box a.btn').forEach((b) => b.addEventListener('click', (ev) => ev.stopPropagation()));
    ligarCliques();
  }

  // ------------------------------------------------------------------
  // Tutoriais guiados: a tela escurece, o botão certo fica em destaque e um balão explica.
  // Cada passo pode abrir uma tela (rota), apontar um elemento (alvo) e mostrar um texto.
  // Se o elemento não existir (ex.: nenhuma visita em andamento), o balão aparece no meio da tela.
  // ------------------------------------------------------------------
  const acharTexto = (sel, texto) => () => $$(sel).find((el) => el.textContent.trim().toLowerCase().includes(texto.toLowerCase())) || null;
  const blocoComTitulo = (texto) => () => {
    const h = $$('.ac-head h2, .pg-bloco h3, .card-x h3').find((el) => el.textContent.trim().toLowerCase().startsWith(texto.toLowerCase()));
    return h ? (h.closest('.ac-sec, .pg-bloco, .card-x') || h) : null;
  };
  const primeiroPosto = async () => {
    const postos = await API.get('/postos');
    return postos.length ? `#/postos/${postos[0].id}/editar` : '#/postos';
  };

  // Categorias dos tutoriais (a parte da Orcim entra depois, quando as APIs estiverem prontas)
  const CATEGORIAS_TUT = [
    ['inicio', 'Primeiros passos', 'compass'],
    ['pedidos', 'Pedidos e atividades', 'kanban'],
    ['visitas', 'Visitas', 'geo-alt'],
    ['resultados', 'Acompanhar e resultados', 'graph-up-arrow'],
  ];
  const primeiraAtividade = async () => {
    const l = await API.get('/atividades?situacao=abertas').catch(() => []);
    return l.length ? `#/atividades/${l[0].id}` : '#/atividades';
  };

  const TUTORIAIS = [
    // ------------------------- Primeiros passos -------------------------
    {
      id: 'menu', cat: 'inicio', papeis: ['gestor', 'tecnico'], icone: 'signpost-split', titulo: 'Conhecer o painel',
      resumo: 'Onde fica cada coisa: o menu por cores, o Novo pedido e as notificações.',
      passos: [
        { titulo: 'Bem-vindo ao Painel Beija-Flor', texto: 'Aqui a TI do grupo organiza visitas aos postos, atividades e pedidos dos gestores. Este tour mostra onde fica cada coisa.' },
        { alvo: '.side-cta', titulo: 'Novo pedido', texto: 'O botão mais usado. De qualquer tela, pede uma visita ao posto ou cria uma atividade.' },
        { alvo: '.side-nav .grp.sec-vis', titulo: 'Seções por cor', texto: 'Cada parte do menu tem uma cor: Visitas (azul), Painel do Gestor (amarelo), Configurar (rosa). O item aberto fica destacado na cor da seção.' },
        { alvo: '.side-nav a[href="#/agenda"]', titulo: 'Agenda', texto: 'Tudo o que está marcado para a TI: visitas de rotina, visitas pedidas e atividades.' },
        { alvo: '.side-nav a[href="#/atividades"]', titulo: 'Atividades', texto: 'O quadro de tarefas da TI. O número ao lado mostra o que está esperando.' },
        { alvo: '#side-notif', titulo: 'Notificações', texto: 'Tudo o que acontece no painel aparece aqui: pedidos, mudanças, comentários e reagendamentos. O número vermelho são as não lidas.' },
        { alvo: '.tela-desc', titulo: 'Para que serve a tela', texto: 'Toda tela tem uma frase pequena no topo explicando para que ela serve.' },
        { alvo: '.side-nav a[href="#/tutoriais"]', titulo: 'Tutoriais', texto: 'Ficou com dúvida? Os tutoriais ficam aqui, separados por assunto.' },
      ],
    },
    {
      id: 'usuarios', cat: 'inicio', papeis: ['gestor'], icone: 'people', titulo: 'Cadastrar gestores e técnicos',
      resumo: 'Dê acesso ao Pedro, à Silvani e aos técnicos.',
      passos: [
        { alvo: '.side-nav a[href="#/usuarios"]', titulo: 'Usuários', texto: 'No menu, em Configurar → Usuários.' },
        { rota: '#/usuarios', alvo: '#form-user', titulo: 'Novo usuário', texto: 'Crie o acesso com usuário e senha inicial. A pessoa troca a senha no primeiro login.' },
        { alvo: '.papeis', titulo: 'Gestor, técnico ou os dois', texto: 'Gestor: pede visitas, cria checklists e vê o painel. Técnico: faz as visitas. Marque os dois para quem faz as duas coisas: ganha o "Meu dia" no menu e recebe os pedidos de visita.' },
        { alvo: 'table.table-x', titulo: 'Quem já tem acesso', texto: 'A lista de usuários. Clique em um para editar, trocar o papel ou desativar.' },
      ],
    },
    {
      id: 'notificacoes', cat: 'inicio', papeis: ['gestor', 'tecnico'], icone: 'bell', titulo: 'Acompanhar as notificações',
      resumo: 'Ver o que mudou, filtrar por assunto e marcar como lido.',
      passos: [
        { alvo: '#side-notif', titulo: 'Notificações no menu', texto: 'Fica no menu, logo abaixo do Novo pedido, com o número de não lidas. Clique para abrir a página com tudo.' },
        { rota: '#/notificacoes', alvo: '.pg-abas', titulo: 'Filtros', texto: 'Todas, Não lidas, Menções (quando alguém marca você com @), Atividades, Comentários, Pedidos de visita, Visitas, Reagendamentos e Postos e checklists. O número mostra as não lidas de cada assunto.' },
        { alvo: '.nt-lista', titulo: 'Por dia', texto: 'As notificações vêm separadas por dia. As novas ficam em verde-claro. Clique numa para abrir o item (ela fica lida).' },
        { alvo: '#nt-ler', titulo: 'Marcar todas como lidas', texto: 'Limpa o número vermelho de uma vez.' },
        { titulo: 'Quem recebe', texto: 'Quando alguém cria, muda, comenta, reagenda, inicia ou conclui algo, a equipe (gestores e técnicos) recebe o aviso. Quem fez a ação não recebe o próprio aviso.' },
        { alvo: '#btn-sino', titulo: 'Sino', texto: 'O sino mostra as últimas notificações rapidinho, sem sair da tela. Dá para ativar o aviso do navegador por ali.' },
      ],
    },
    // ----------------------- Pedidos e atividades -----------------------
    {
      id: 'novo-pedido', cat: 'pedidos', papeis: ['gestor', 'tecnico'], icone: 'plus-circle', titulo: 'Fazer um Novo pedido',
      resumo: 'Pedir uma visita ao posto (com as tarefas) ou criar uma atividade, numa tela só.',
      passos: [
        { alvo: '.side-cta', titulo: 'Novo pedido', texto: 'Este botão abre o pedido de qualquer tela. O "+" de cada dia na Agenda também abre, já com a data.' },
        { rota: '#/novo', alvo: '.np-tipos', titulo: 'Visita ou atividade', texto: 'Visita ao posto: alguém da TI vai até lá fazer uma ou mais coisas. Atividade: algo a fazer sem precisar ir ao posto. (Técnico só cria atividade.)' },
        { rota: () => (ehGestor() ? '#/novo?tipo=visita' : '#/novo?tipo=atividade'), alvo: '#np-tit', titulo: 'O que precisa?', texto: 'Uma frase curta, ex.: "Trocar nobreak do caixa".' },
        { alvo: '#np-posto', titulo: 'Posto', texto: 'Em qual posto. Na visita é obrigatório.' },
        { alvo: '#np-data', titulo: 'Para quando', texto: 'O dia. Na atividade, o horário é opcional: vazio = o dia todo.' },
        { alvo: '.np-urg', titulo: 'Urgência', texto: 'Requisição (azul), Prejudicada (amarelo), Parada iminente (laranja) ou Operação parada (vermelho). A cor aparece no calendário.' },
        { alvo: '#np-tarefa', titulo: 'O que fazer lá (visita)', texto: 'Tarefas avulsas: digite uma e aperte Enter; a próxima linha aparece. Para tirar, clique no X.' },
        { alvo: '.np-ck', titulo: 'Cumprir checklist', texto: 'Marque para a visita seguir um checklist pronto (ex.: "Rota padrão do posto"). Vem escolhido o checklist do posto, mas dá para trocar por qualquer outro. Os primeiros itens aparecem embaixo. As tarefas avulsas entram junto, depois do checklist.' },
        { alvo: '#np-mais-l', titulo: '+ detalhes', texto: 'Algo mais que a TI precisa saber. Fica escondido para não atrapalhar.' },
        { alvo: '#np-ok', titulo: 'Enviar', texto: 'Visita: a TI é avisada e ela entra no calendário. Com checklist, entra como visita de rotina; só com tarefas avulsas, como visita pontual. Atividade: vai para o quadro de Atividades.' },
      ],
    },
    {
      id: 'atividades', cat: 'pedidos', papeis: ['gestor', 'tecnico'], icone: 'kanban', titulo: 'Usar o quadro de atividades',
      resumo: 'Arrastar o cartão para mudar o status, filtrar e comentar.',
      passos: [
        { rota: '#/atividades', alvo: '.board', titulo: 'O quadro', texto: 'Quatro colunas: A fazer, Em andamento, Aguardando e Concluídas. Cada cartão é uma atividade.' },
        { alvo: '.board .task[data-drag]', titulo: 'Arraste como um post-it', texto: 'Segure o cartão e solte em outra coluna: o status muda na hora e a equipe é avisada. No celular, segure um instante antes de arrastar.' },
        { alvo: '.chips', titulo: 'Outras vistas', texto: 'Para hoje, Atrasadas, Em aberto, Concluídas ou Todas, em lista.' },
        { alvo: '#busca-at', titulo: 'Buscar', texto: 'Procure pelo nome da atividade. O gestor também filtra por responsável.' },
        { rota: primeiraAtividade, alvo: '.hist', titulo: 'Histórico e comentários', texto: 'Dentro da atividade: as ações ficam em linhas pequenas e roxas; os comentários, em destaque verde.' },
        { alvo: '#form-coment', titulo: 'Comentar e marcar com @', texto: 'Escreva uma atualização, ex.: "peça chega amanhã". Digite @ e escolha alguém para marcar: a pessoa recebe o aviso na aba Menções das notificações.' },
        { titulo: 'Aguardando', texto: 'Ao mudar para Aguardando (no botão ou arrastando no quadro), o painel pergunta "aguardando o quê?" (peça, resposta do posto, aprovação...) e deixa escrever um comentário. O motivo aparece no cartão e no calendário.' },
      ],
    },
    {
      id: 'varios-dias', cat: 'pedidos', papeis: ['gestor', 'tecnico'], icone: 'arrows-expand-vertical', titulo: 'Atividade de vários dias ou do dia todo',
      resumo: 'Prazo sem horário (dia todo) e atividade que começa num dia e entrega em outro.',
      passos: [
        { rota: '#/atividades/nova', alvo: 'input[name=due_date]', titulo: 'Dia da entrega', texto: 'O prazo da atividade.' },
        { alvo: 'input[name=due_time]', titulo: 'Horário (opcional)', texto: 'Deixe vazio para "o dia todo": ela só conta como atrasada depois das 23:59 daquele dia.' },
        { alvo: 'input[name=start_date]', titulo: 'Começa em', texto: 'Para atividade que leva vários dias: o dia em que começa. No calendário do Painel do gestor ela vira uma linha fina de "início" até "entrega".' },
        { titulo: 'No Novo pedido', texto: 'Lá é igual: marque "Leva vários dias" e escolha o dia em que começa.' },
      ],
    },
    // ------------------------------ Visitas ------------------------------
    {
      id: 'agenda', cat: 'visitas', papeis: ['gestor', 'tecnico'], icone: 'calendar3', titulo: 'Usar a Agenda',
      resumo: 'Ver por dia, semana ou mês, passar o mouse para detalhes e criar pelo "+".',
      passos: [
        { rota: '#/agenda?modo=mes', alvo: () => $('a[href^="#/agenda?modo=dia"]')?.parentElement, titulo: 'Dia, Semana, Mês ou Lista', texto: 'Escolha como ver. O Mês é o mesmo calendário do Painel do gestor: legenda, andamento de cada dia e a lista ao lado.' },
        { alvo: '.cal-leg', titulo: 'Legenda', texto: 'Cores da urgência, andamento (○ a fazer, ◐ em andamento, ✓ concluída), atrasado e atividade de vários dias.' },
        { alvo: '.cal-dia', titulo: 'Lista do dia', texto: 'Clique num dia para ver a lista aqui. Passe o mouse num item para os detalhes; arraste um item até outro dia do calendário para reagendar (pede o motivo).' },
        { alvo: '.cal-mais', titulo: '"+" do dia', texto: 'Passe o mouse num dia e clique no "+" para abrir o Novo pedido já com aquela data.' },
        { rota: '#/agenda?modo=semana', alvo: '.cal-grade', titulo: 'Semana', texto: 'De domingo a sábado, com cada item dentro do seu dia. Arraste um item para outro dia para reagendar; clique para abrir. Na lista ao lado ficam os botões Iniciar visita e Reagendar.' },
        { alvo: '[data-pop]', titulo: 'Passe o mouse', texto: 'Num item, aparece um resumo: responsável, quem pediu, urgência e detalhes. Clique para abrir.' },
        { alvo: '.cal-add', titulo: '"+" do dia', texto: 'Abre o Novo pedido já com aquela data.' },
        { alvo: '.arrastavel', titulo: 'Arrastar para outro dia', texto: 'Visitas previstas, pedidos e atividades em aberto podem ser arrastados para outro dia. Pede o motivo e avisa a equipe.' },
      ],
    },
    {
      id: 'reagendar', cat: 'visitas', papeis: ['gestor', 'tecnico'], icone: 'calendar2-week', titulo: 'Reagendar com motivo',
      resumo: 'Mudar a data de uma visita, pedido ou atividade e avisar os outros.',
      passos: [
        { titulo: 'Reagendar', texto: 'Gestor e técnico podem mudar a data de uma visita, de um pedido ou de uma atividade. O motivo é obrigatório e vai para a equipe nas notificações.' },
        { rota: '#/agenda', alvo: '[data-reag]', titulo: 'Botão Reagendar', texto: 'Aparece na Agenda, no "Meu dia", na ficha do posto e no pedido. Clique, escolha a nova data (o horário é opcional) e escreva o motivo.' },
        { alvo: '.arrastavel', titulo: 'Ou arraste', texto: 'Na Agenda, dá para arrastar o item para outro dia (no celular: segure e arraste). A janela do motivo abre do mesmo jeito.' },
        { alvo: '#side-notif', titulo: 'Quem fica sabendo', texto: 'Todos os gestores e técnicos recebem: "Reagendado: Visita ao Posto Centro — mudou de 20/11 para 22/11. Motivo: ...". No pedido fica o histórico.' },
      ],
    },
    {
      id: 'checklist', cat: 'visitas', papeis: ['gestor'], icone: 'ui-checks', titulo: 'Criar um checklist que se repete',
      resumo: 'Monte a lista de tarefas da visita de rotina e defina de quanto em quanto tempo o posto é visitado.',
      passos: [
        { titulo: 'Checklist + frequência = visita que se repete', texto: 'O checklist é a lista de tarefas que o técnico confere em cada visita (internet, nobreak, caixas...). Cada posto tem uma frequência (semanal, mensal...). Quando uma visita termina, o sistema já marca a próxima sozinho.' },
        { alvo: '.side-nav a[href="#/checklists"]', titulo: 'Os checklists ficam aqui', texto: 'No menu, em Configurar → Checklists.' },
        { rota: '#/checklists', alvo: 'a[href="#/checklists/novo"]', titulo: 'Novo checklist', texto: 'Clique aqui para criar um checklist novo. Para mudar um que já existe, clique nele na lista.' },
        { rota: '#/checklists/novo', alvo: '#ck-nome', titulo: 'Dê um nome', texto: 'Ex.: "Rota padrão do posto". É o nome que aparece para o técnico na visita.' },
        { alvo: '#ck-add', titulo: 'Adicione as tarefas', texto: 'Uma tarefa por item: "Testar internet", "Checar nobreak", "Computadores de caixa ligando"... Na visita, cada uma é respondida com OK, NÃO OK ou N/A. As setas mudam a ordem.' },
        { alvo: () => $('#form-ck input[name=posto]')?.closest('.row'), titulo: 'Em quais postos', texto: 'Marque os postos que usam este checklist. Um posto usa um checklist por vez.' },
        { alvo: '#form-ck button[type=submit]', titulo: 'Salvar', texto: 'Quando terminar, salve. Mudar o checklist depois não altera visitas já feitas.' },
        { rota: '#/postos', alvo: '.postos-grid .posto-card', titulo: 'Agora a repetição', texto: 'A frequência fica na ficha de cada posto. Vamos abrir a edição de um posto.' },
        { rota: primeiroPosto, alvo: '#fp-ck', titulo: 'Checklist do posto', texto: 'Escolha qual checklist a visita de rotina deste posto usa.' },
        { alvo: '#fp-freq', titulo: 'De quanto em quanto tempo', texto: 'Semanal, quinzenal, mensal ou "a cada X dias". Sem recorrência = só visitas pedidas.' },
        { alvo: '#fp-data', titulo: 'Próxima visita', texto: 'A data (e o horário, ao lado) da próxima visita. Depois de cada visita concluída, o sistema calcula a seguinte pela frequência.' },
        { alvo: '#form-posto button[type=submit]', titulo: 'Salvar o posto', texto: 'Salve. A visita aparece na Agenda e no "Meu dia" do técnico na data marcada.' },
      ],
    },
    {
      id: 'visita', cat: 'visitas', papeis: ['tecnico', 'gestor'], icone: 'clipboard-check', titulo: 'Fazer uma visita (técnico)',
      resumo: 'Do "Meu dia" até concluir a visita com os comentários.',
      passos: [
        { rota: () => (ehGestor() && fazVisitas() ? '#/meu-dia' : '#/hoje'), alvo: blocoComTitulo('Visitas de hoje'), titulo: 'Visitas de hoje', texto: 'As visitas de rotina do dia (e as atrasadas). Cada uma tem o botão INICIAR VISITA.' },
        { alvo: blocoComTitulo('Visitas pedidas'), titulo: 'Visitas pedidas pelo gestor', texto: 'Os pedidos de visita. O botão INICIAR VISITA já traz as tarefas que o gestor pediu.' },
        { alvo: '[data-visita-sol], [data-iniciar]', titulo: 'Iniciar visita', texto: 'Clique ao chegar no posto. A hora de início já vem preenchida e o gestor é avisado.' },
        { titulo: 'Durante a visita', texto: 'Para cada tarefa, toque em OK, NÃO OK ou N/A. Toque em "+ observação" para escrever o que viu, ex.: "nobreak apitando, bateria fraca". Cada toque já fica salvo.' },
        { titulo: 'Concluir', texto: 'No fim, escreva os comentários gerais, as pendências (se houver; dá para criar uma atividade, com prazo de dia todo ou horário) e fotos se quiser. Toque em CONCLUIR VISITA: o gestor é avisado, o pedido se fecha e os problemas vão para o painel.' },
      ],
    },
    // --------------------- Acompanhar e resultados ---------------------
    {
      id: 'acompanhar', cat: 'resultados', papeis: ['gestor'], icone: 'binoculars', titulo: 'Acompanhar o dia a dia',
      resumo: 'O que olhar todo dia na tela de Início: pendências, visitas de hoje e o período.',
      passos: [
        { rota: '#/', alvo: blocoComTitulo('Precisa de você'), titulo: 'Precisa de você', texto: 'Tudo o que está atrasado ou com problema, do mais grave para o menos grave, com a ação ao lado (Reagendar, Criar atividade, Abrir).' },
        { alvo: blocoComTitulo('Hoje'), titulo: 'Hoje', texto: 'As visitas do dia: feitas, em andamento (com quantas tarefas faltam) e previstas.' },
        { alvo: '.ac-topo .pg-seg', titulo: 'Período', texto: 'Hoje, 7 dias, 30 dias ou o mês: muda os números e o gráfico abaixo.' },
        { alvo: () => $$('.ac-sec')[2] || null, titulo: 'Como foi o período', texto: 'Quatro números comparados com o período anterior e um gráfico de linha com as visitas feitas e os itens com problema.' },
        { alvo: blocoComTitulo('Últimos registros'), titulo: 'Últimos registros', texto: 'O que foi feito por último: visitas, atividades e pedidos. Clique para abrir.' },
      ],
    },
    {
      id: 'calendario', cat: 'resultados', papeis: ['gestor'], icone: 'calendar-week', titulo: 'Usar o calendário do Painel',
      resumo: 'Todas as atividades, visitas e pedidos do mês: hover, lista do dia e linhas de vários dias.',
      passos: [
        { alvo: '.side-nav a[href="#/painel"]', titulo: 'Fica no Painel do gestor', texto: 'No menu, em Painel do Gestor - Resultados → Painel do gestor. Ele já abre no Calendário.' },
        { rota: '#/painel?aba=calendario', alvo: '.cal-grade', titulo: 'O mês', texto: 'Em cada dia, um número por urgência, na cor dela. O reloginho indica que algo daquele dia está atrasado.' },
        { alvo: '.cal-leg', titulo: 'Legenda', texto: 'Urgência: vermelho = operação parada, laranja = parada iminente, amarelo = operação prejudicada, azul = requisição. Andamento (ao lado do número do dia): ○ a fazer, ◐ em andamento ou aguardando, ✓ concluída. O reloginho é atrasado e a linha fina é atividade de vários dias.' },
        { alvo: '.cal-grade', titulo: 'Passe o mouse num dia', texto: 'O cursor vira um olho e aparece um resumo pequeno: quantos itens, quantos concluídos e os últimos comentários.' },
        { alvo: '.cal-dia', titulo: 'Clique no dia', texto: 'A lista do dia aparece aqui ao lado, ligada ao dia por uma linha. Passe o mouse num item para ele abrir como sanfona, com os detalhes e comentários. Clique no item para abrir.' },
        { alvo: () => $('.cal-faixa')?.closest('.cal-cel') || $('.cal-grade'), titulo: 'Atividades de vários dias', texto: 'Aparecem como uma linha bem fina, de "início" até "entrega", na cor da urgência.' },
        { alvo: '.cal-filtros', titulo: 'O que mostrar', texto: 'O que é da TI do Beija-Flor e "só em aberto".' },
        { alvo: '.cal-topo .btn', titulo: 'Outros meses', texto: 'Use as setas para ir ao mês anterior ou ao seguinte.' },
      ],
    },
    {
      id: 'painel', cat: 'resultados', papeis: ['gestor'], icone: 'graph-up-arrow', titulo: 'Ver resultados no Painel do gestor',
      resumo: 'Números e gráficos do período: TI, postos e cada funcionário.',
      passos: [
        { rota: '#/painel?aba=ti', alvo: '.pg-abas', titulo: 'Abas do painel', texto: 'Calendário, TI do Beija-Flor (o nosso trabalho), Por posto e Por funcionário. Cada aba tem uma frase dizendo o que mostra.' },
        { alvo: '.pg-filtro .pg-seg', titulo: 'Escolha o período', texto: 'Dia, Semana, Mês, Ano ou Personalizado. Os gráficos acompanham: Dia mostra por hora, Semana e Mês por dia, Ano por mês.' },
        { alvo: '.pg-filtro .pg-nav', titulo: 'Anterior e seguinte', texto: 'As setas vão para o período anterior ou o seguinte. "Hoje" volta para o atual.' },
        { alvo: '.ti-tres', titulo: 'Visitas, Atividades e Pedidos', texto: 'Três cartões, cada um na cor da sua linha no gráfico: Visitas (idas aos postos), Atividades (tarefas do quadro) e Pedidos de visita (o que os gestores pediram). O número pequeno compara com o período anterior; clique no cartão para abrir a lista.' },
        { alvo: () => $('.pg-card'), titulo: 'Gráficos de linha', texto: 'Passe o mouse (ou toque) num ponto para ver o valor.' },
        { alvo: blocoComTitulo('Problemas encontrados'), titulo: 'Problemas encontrados', texto: 'Cada item marcado NÃO OK nas visitas, com o comentário do técnico. Clique para abrir a visita.' },
        { rota: '#/painel?aba=orcim', alvo: () => blocoComTitulo('Por que os chamados aconteceram')() || $('.pg-faixa'), titulo: 'Causas dos chamados', texto: 'Quando o técnico da Orcim resolve um chamado, ele informa a causa (mau uso, acidente, falha do equipamento...). Aqui aparece quantos chamados teve cada causa, o que aconteceu com os equipamentos e as causas por posto. Laranja = causado por pessoas.' },
        { rota: '#/painel?aba=funcionarios', alvo: '.fn-grade', titulo: 'Por funcionário', texto: 'Um cartão por pessoa: visitas, atividades, no prazo, em aberto, atrasadas e problemas achados. Inclui quem é gestor e técnico ao mesmo tempo.' },
        { rota: '#/painel?aba=ti', alvo: '#pg-pdf', titulo: 'Relatório em PDF', texto: 'Gera o relatório do período escolhido para guardar ou enviar.' },
      ],
    },
  ];

  const tourFeitos = () => { try { return JSON.parse(store.get('gbf_tutoriais_feitos') || '[]'); } catch { return []; } };
  const tourEstado = { t: null, i: 0, el: null, raf: 0, abriuMenu: false };

  function tourDom() {
    let raiz = $('#tour');
    if (!raiz) {
      raiz = document.createElement('div');
      raiz.id = 'tour';
      raiz.innerHTML = `<div class="tour-fundo"></div><div class="tour-foco"></div>
        <svg class="tour-linha" aria-hidden="true"><path d=""></path><circle r="4"></circle></svg>
        <div class="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tour-tit" aria-describedby="tour-txt">
          <div class="tour-passo" id="tour-passo"></div>
          <h4 id="tour-tit"></h4><p id="tour-txt"></p>
          <div class="tour-acoes">
            <button type="button" class="btn btn-sm btn-link text-secondary px-0" id="tour-sair">Sair</button>
            <button type="button" class="btn btn-sm btn-outline-secondary ms-auto" id="tour-volta">Voltar</button>
            <button type="button" class="btn btn-sm btn-brand" id="tour-vai">Próximo</button>
          </div></div>`;
      document.body.appendChild(raiz);
      $('#tour-sair').addEventListener('click', () => tourFechar());
      $('#tour-volta').addEventListener('click', () => tourIr(tourEstado.i - 1));
      $('#tour-vai').addEventListener('click', () => tourIr(tourEstado.i + 1));
      document.addEventListener('keydown', (ev) => {
        if (!tourEstado.t) return;
        if (ev.key === 'Escape') tourFechar();
        else if (ev.key === 'ArrowRight') tourIr(tourEstado.i + 1);
        else if (ev.key === 'ArrowLeft' && tourEstado.i > 0) tourIr(tourEstado.i - 1);
      });
      window.addEventListener('resize', tourPosicionar);
      window.addEventListener('scroll', tourPosicionar, true);
      $('#side')?.addEventListener('transitionend', tourPosicionar);
    }
    return raiz;
  }

  async function tourAlvo(passo) {
    if (!passo.alvo) return null;
    const achar = () => {
      const el = typeof passo.alvo === 'function' ? passo.alvo() : $(passo.alvo);
      return el && el.getClientRects().length ? el : null;
    };
    for (let t = 0; t < 40; t += 1) { // espera a tela carregar (até ~6 s)
      const el = achar();
      if (el) return el;
      await new Promise((r) => setTimeout(r, 150));
    }
    return null;
  }

  async function tourIr(i) {
    const t = tourEstado.t;
    if (!t) return;
    if (i >= t.passos.length) {
      const feitos = new Set(tourFeitos());
      feitos.add(t.id);
      store.set('gbf_tutoriais_feitos', JSON.stringify([...feitos]));
      tourFechar();
      toast(`Tutorial concluído: ${t.titulo}`);
      return;
    }
    if (i < 0) return;
    tourEstado.i = i;
    const passo = t.passos[i];
    const raiz = tourDom();
    raiz.classList.add('on', 'carregando');
    if (tourEstado.abriuMenu) { $('#side')?.classList.remove('open'); tourEstado.abriuMenu = false; }
    if (passo.rota) {
      const destino = typeof passo.rota === 'function' ? await passo.rota() : passo.rota;
      if (location.hash !== destino) location.hash = destino;
    }
    if (tourEstado.t !== t || tourEstado.i !== i) return; // usuário saiu ou mudou de passo enquanto carregava
    let el = await tourAlvo(passo);
    if (tourEstado.t !== t || tourEstado.i !== i) return;
    // item do menu lateral no celular: abre o menu para mostrar
    if (el && el.closest('#side') && window.matchMedia('(max-width: 991px)').matches) {
      $('#side')?.classList.add('open');
      tourEstado.abriuMenu = true;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (el) {
      const r0 = el.getBoundingClientRect();
      const fora = r0.top < 70 || r0.bottom > window.innerHeight - 20 || r0.left < 0 || r0.right > window.innerWidth;
      const noMenu = !!el.closest('#side');
      // no menu: rola só o menu; na página: centraliza o item (suave, o destaque acompanha)
      if (noMenu) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      else if (fora) el.scrollIntoView({ block: r0.height > window.innerHeight * 0.6 ? 'start' : 'center', inline: 'nearest', behavior: 'smooth' });
    }
    tourEstado.linhaNova = true;
    if (el && !el.getClientRects().length) el = null;
    tourEstado.el = el;
    $('#tour-passo').textContent = `${t.titulo} · ${i + 1} de ${t.passos.length}`;
    $('#tour-tit').textContent = passo.titulo;
    $('#tour-txt').textContent = passo.texto;
    $('#tour-volta').classList.toggle('invisible', i === 0);
    $('#tour-vai').textContent = i === t.passos.length - 1 ? 'Concluir' : 'Próximo';
    raiz.classList.toggle('sem-alvo', !el);
    raiz.classList.remove('carregando');
    tourPosicionar();
    // o menu do celular e a rolagem têm animação: reposiciona quando terminam
    setTimeout(tourPosicionar, 300);
    setTimeout(tourPosicionar, 700);
    setTimeout(tourPosicionar, 1100);
    $('#tour-vai').focus({ preventScroll: true });
  }

  function tourPosicionar() {
    if (!tourEstado.t) return;
    cancelAnimationFrame(tourEstado.raf);
    tourEstado.raf = requestAnimationFrame(() => {
      const foco = $('#tour .tour-foco');
      const pop = $('#tour .tour-pop');
      const el = tourEstado.el;
      const vw = window.innerWidth; const vh = window.innerHeight;
      const celular = vw < 600;
      pop.style.maxWidth = celular ? `${vw - 24}px` : '360px';
      const linha = $('#tour .tour-linha');
      if (!el || !document.body.contains(el)) {
        linha.classList.remove('on');
        foco.style.cssText = 'opacity:0';
        pop.style.left = `${Math.max(12, (vw - pop.offsetWidth) / 2)}px`;
        pop.style.top = `${Math.max(12, (vh - pop.offsetHeight) / 2)}px`;
        return;
      }
      const r = el.getBoundingClientRect();
      const m = 6;
      foco.style.cssText = `opacity:1;left:${r.left - m}px;top:${r.top - m}px;width:${r.width + m * 2}px;height:${r.height + m * 2}px`;
      const pw = pop.offsetWidth; const ph = pop.offsetHeight;
      let top; let left;
      if (celular) {
        left = 12;
        top = r.bottom + m + 28 + ph < vh ? r.bottom + m + 28 : Math.max(12, r.top - m - 28 - ph);
        if (top < 12 || top + ph > vh - 12) top = vh - ph - 12;
      } else {
        // espaço entre o balão e o destaque, para a linha aparecer; item do menu: balão à direita
        const G = 44;
        const noMenu = !!el.closest('#side');
        if (noMenu && r.right + m + G + pw < vw) { left = r.right + m + G; top = r.top + r.height / 2 - ph / 2; }
        else if (r.bottom + m + G + ph < vh) { top = r.bottom + m + G; left = r.left + Math.min(40, r.width / 3); }
        else if (r.top - m - G - ph > 0) { top = r.top - m - G - ph; left = r.left + Math.min(40, r.width / 3); }
        else if (r.right + m + G + pw < vw) { left = r.right + m + G; top = r.top; }
        else { left = r.left - m - G - pw; top = r.top; }
      }
      left = Math.min(Math.max(12, left), vw - pw - 12);
      top = Math.min(Math.max(12, top), vh - ph - 12);
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
      desenharLinhaTour(linha, { l: left, t: top, r: left + pw, b: top + ph }, { l: r.left - m, t: r.top - m, r: r.right + m, b: r.bottom + m });
    });
  }

  // Linha curva do balão até o item em destaque (sai da borda do balão mais próxima e termina num pontinho)
  function desenharLinhaTour(svg, p, f) {
    const preso = (v, a, b) => Math.min(Math.max(v, a), b);
    const fc = { x: (f.l + f.r) / 2, y: (f.t + f.b) / 2 };
    const pc = { x: (p.l + p.r) / 2, y: (p.t + p.b) / 2 };
    // ponto no balão mais perto do destaque, e no destaque mais perto do balão
    const a = { x: preso(fc.x, p.l + 14, p.r - 14), y: preso(fc.y, p.t + 14, p.b - 14) };
    if (fc.y < p.t) a.y = p.t; else if (fc.y > p.b) a.y = p.b; else a.x = fc.x < p.l ? p.l : p.r;
    const z = { x: preso(pc.x, f.l + 6, f.r - 6), y: preso(pc.y, f.t, f.b) };
    if (pc.y < f.t) z.y = f.t; else if (pc.y > f.b) z.y = f.b; else z.x = pc.x < f.l ? f.l : f.r;
    const dist = Math.hypot(z.x - a.x, z.y - a.y);
    // balão encostado ou por cima do item: sem linha
    const sobrepoe = !(p.r < f.l || p.l > f.r || p.b < f.t || p.t > f.b);
    if (dist < 12 || sobrepoe) { svg.classList.remove('on'); return; }
    const vertical = Math.abs(z.y - a.y) >= Math.abs(z.x - a.x);
    const c1 = vertical ? { x: a.x, y: (a.y + z.y) / 2 } : { x: (a.x + z.x) / 2, y: a.y };
    const c2 = vertical ? { x: z.x, y: (a.y + z.y) / 2 } : { x: (a.x + z.x) / 2, y: z.y };
    svg.querySelector('path').setAttribute('d', `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${z.x},${z.y}`);
    const ponto = svg.querySelector('circle');
    ponto.setAttribute('cx', z.x); ponto.setAttribute('cy', z.y);
    if (tourEstado.linhaNova) { // passo novo: a linha se desenha de novo
      tourEstado.linhaNova = false;
      svg.classList.remove('on', 'desenha'); void svg.getBoundingClientRect(); svg.classList.add('desenha');
    }
    svg.classList.add('on');
  }

  function tourComecar(id) {
    const t = TUTORIAIS.find((x) => x.id === id);
    if (!t) return;
    tourEstado.t = t;
    tourIr(0);
  }

  function tourFechar() {
    tourEstado.t = null;
    tourEstado.el = null;
    if (tourEstado.abriuMenu) { $('#side')?.classList.remove('open'); tourEstado.abriuMenu = false; }
    $('#tour')?.classList.remove('on', 'sem-alvo', 'carregando');
  }

  async function vTutoriais(seq) {
    titulo('Tutoriais');
    if (seq !== renderSeq) return;
    const papel = ehGestor() ? 'gestor' : 'tecnico';
    const feitos = new Set(tourFeitos());
    // quem é gestor e técnico vê os dois conjuntos
    const lista = TUTORIAIS.filter((t) => t.papeis.includes(papel) || (fazVisitas() && t.papeis.includes('tecnico')));
    const cartao = (t) => `<div class="tut-card">
        <div class="tut-ic"><i class="bi bi-${t.icone}"></i></div>
        <div class="flex-grow-1 min-w-0">
          <div class="fw-semibold">${esc(t.titulo)} ${feitos.has(t.id) ? tag('tag-green', 'feito', 'check2') : ''}</div>
          <div class="small-muted">${esc(t.resumo)}</div>
          <div class="small-muted mt-1">${t.passos.length} passos</div>
        </div>
        <button type="button" class="btn btn-sm ${feitos.has(t.id) ? 'btn-outline-secondary' : 'btn-brand'}" data-tour="${t.id}">${feitos.has(t.id) ? 'Rever' : 'Começar'}</button>
      </div>`;
    const total = lista.length; const feitosN = lista.filter((t) => feitos.has(t.id)).length;
    view().innerHTML = `
      <div class="tut-topo"><div class="small-muted">Dica: Esc sai do tutorial e as setas do teclado avançam ou voltam.</div>
        <div class="tut-prog"><div class="tut-barra"><i style="width:${total ? Math.round((feitosN / total) * 100) : 0}%"></i></div><span>${feitosN} de ${total} feitos</span></div></div>
      ${CATEGORIAS_TUT.map(([k, nome, ic]) => {
    const doGrupo = lista.filter((t) => t.cat === k);
    if (!doGrupo.length) return '';
    const f = doGrupo.filter((t) => feitos.has(t.id)).length;
    return `<section class="tut-cat"><h3><i class="bi bi-${ic}"></i>${esc(nome)} <span class="small-muted">${f}/${doGrupo.length}</span></h3>
      <div class="tut-grade">${doGrupo.map(cartao).join('')}</div></section>`;
  }).join('')}
      <div class="tut-depois small-muted"><i class="bi bi-hourglass-split"></i> Os tutoriais da parte da Orcim (chamados, visão e manutenções) entram quando a ligação com o sistema da Orcim estiver pronta.</div>`;
    $$('[data-tour]').forEach((b) => b.addEventListener('click', () => tourComecar(b.dataset.tour)));
  }

  // ------------------------------------------------------------------
  // Notificações (sino + aviso do navegador)
  // ------------------------------------------------------------------
  let timerNotif = null;
  var naoLidasNotif = 0; // var: o menu é montado antes desta parte do arquivo
  let ultimoId = null;

  function iniciarNotificacoes() {
    pararNotificacoes();
    ultimoId = null;
    buscarNotificacoes();
    timerNotif = setInterval(buscarNotificacoes, 30000);
    atualizarBotaoAvisos();
  }
  function pararNotificacoes() { if (timerNotif) clearInterval(timerNotif); timerNotif = null; }

  function atualizarBotaoAvisos() {
    const ok = 'Notification' in window && Notification.permission === 'default';
    $('#notif-browser').classList.toggle('d-none', !ok);
  }

  async function buscarNotificacoes() {
    if (!EU) return;
    atualizarContadores(true);
    let r;
    try { r = await API.get('/notificacoes'); } catch { return; }
    const badge = $('#sino-badge');
    badge.textContent = r.nao_lidas > 99 ? '99+' : r.nao_lidas;
    badge.classList.toggle('d-none', !r.nao_lidas);
    naoLidasNotif = r.nao_lidas;
    const sn = $('#side-notif-n');
    if (sn) { sn.textContent = badge.textContent; sn.classList.toggle('d-none', !r.nao_lidas); }
    $('#notif-list').innerHTML = r.itens.length ? r.itens.map((n) => `
      <a class="notif-item ${n.is_read ? '' : 'unread'}" href="${esc(n.link || '#/')}" data-nid="${n.id}">
        <div class="t">${esc(n.title)}</div>${n.message ? `<div class="m">${esc(n.message)}</div>` : ''}
        <div class="w">${relativo(n.created_at)}</div></a>`).join('') : '<div class="notif-empty">Nenhuma notificação.</div>';
    $$('#notif-list [data-nid]').forEach((a) => a.addEventListener('click', () => {
      $('#notif-panel').classList.add('d-none');
      API.post('/notificacoes/lidas', { ids: [Number(a.dataset.nid)] }).then(buscarNotificacoes).catch(() => {});
    }));
    const maior = r.itens.reduce((m, n) => Math.max(m, Number(n.id)), 0);
    if (ultimoId !== null && 'Notification' in window && Notification.permission === 'granted') {
      r.itens.filter((n) => Number(n.id) > ultimoId && !n.is_read).slice(0, 3).forEach((n) => {
        try {
          const aviso = new Notification(n.title, { body: n.message || '', tag: `gbf-${n.id}` });
          aviso.onclick = () => { window.focus(); location.hash = n.link || '#/'; };
        } catch { /* navegador sem suporte */ }
      });
    }
    ultimoId = Math.max(ultimoId || 0, maior);
  }

  $('#btn-sino').addEventListener('click', (ev) => {
    ev.stopPropagation();
    $('#notif-panel').classList.toggle('d-none');
    atualizarBotaoAvisos();
  });
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('#notif-panel')) $('#notif-panel').classList.add('d-none');
  });
  $('#notif-ver-todas').addEventListener('click', () => $('#notif-panel').classList.add('d-none'));
  $('#notif-ler-todas').addEventListener('click', async () => {
    await API.post('/notificacoes/lidas', {}).catch(() => {});
    buscarNotificacoes();
  });
  $('#btn-ativar-avisos').addEventListener('click', async () => {
    try { await Notification.requestPermission(); } catch { /* ignorado */ }
    atualizarBotaoAvisos();
    if (Notification.permission === 'granted') toast('Avisos do navegador ativados.');
  });

  // ------------------------------------------------------------------
  // Início
  // ------------------------------------------------------------------
  (async () => {
    API.get('/config/publica').then((c) => {
      $('#login-titulo').textContent = c.nome;
      $('#side-titulo').textContent = c.nome;
      if (c.versao) $('#side-versao').textContent = `Versão ${c.versao}`;
    }).catch(() => {});
    if (EMBED) { await entrarPelaCentral(); return; }
    if (!API.token) { mostrarLogin(); return; }
    try {
      await entrar(await API.get('/auth/me'));
    } catch {
      mostrarLogin();
    }
  })();
})();
