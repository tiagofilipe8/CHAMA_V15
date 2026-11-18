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
  const TAG_PRIO = { 1: 'tag-gray', 2: 'tag-blue', 3: 'tag-amber', 4: 'tag-red' };
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
    $('#side-papel').textContent = ehGestor() ? 'Gestor' : 'Técnico';
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
  function montarMenu() {
    const itens = [
      ...(ehGestor() ? [['grp', 'Gestão'], ['#/painel', 'graph-up-arrow', 'Painel do gestor']] : []),
      ['grp', 'Dia a dia da TI'],
      ehGestor() ? ['#/', 'binoculars', 'Acompanhamento'] : ['#/', 'sun', 'Meu dia'],
      ['#/agenda', 'calendar3', 'Agenda'],
      ['#/postos', 'geo-alt', 'Postos'],
      ['#/solicitacoes', 'megaphone', 'Solicitações'],
      ['#/materiais', 'box-seam', 'Materiais'],
      ['#/atividades', 'kanban', ehGestor() ? 'Atividades' : 'Minhas atividades'],
      ['#/checklists', 'ui-checks', 'Checklists'],
      ['grp', 'Orcim'],
      ['#/orcim', 'speedometer2', 'Visão Orcim'],
      ['#/demandas', 'inboxes', 'Demandas'],
      ['#/manutencoes', 'tools', 'Manutenções'],
      ...(ehGestor() ? [['#/tudo', 'database', 'Tudo da Orcim']] : []),
    ];
    if (ehGestor()) {
      itens.push(['grp', 'Administração'], ['#/hoje', 'sun', 'Dia do técnico'], ['#/usuarios', 'people', 'Usuários'], ['#/config', 'sliders', 'Configurações']);
    }
    itens.push(['#/conta', 'person-lock', 'Minha conta']);
    $('#side-nav').innerHTML = itens.map((i) => (i[0] === 'grp'
      ? `<div class="grp">${esc(i[1])}</div>`
      : `<a href="${i[0]}" data-rota="${i[0]}"><i class="bi bi-${i[1]}"></i><span>${esc(i[2])}</span></a>`)).join('');
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
    try {
      carregando();
      if (!a) { marcarMenu('#/'); if (ehGestor()) await vAcompanhamento(qs, seq); else await vHoje(seq); }
      else if (a === 'hoje') { marcarMenu(ehGestor() ? '#/hoje' : '#/'); await vHoje(seq); }
      else if (a === 'painel' && ehGestor()) { marcarMenu('#/painel'); await vPainelGestor(qs, seq); }
      else if (a === 'orcim') { marcarMenu('#/orcim'); await vVisao(seq); }
      else if (a === 'agenda') { marcarMenu('#/agenda'); await vAgenda(qs, seq); }
      else if (a === 'postos' && b === 'novo') { marcarMenu('#/postos'); await vFormPosto(null, seq); }
      else if (a === 'postos' && b && partes[2] === 'editar') { marcarMenu('#/postos'); await vFormPosto(b, seq); }
      else if (a === 'postos' && b) { marcarMenu('#/postos'); await vPosto(b, seq); }
      else if (a === 'postos') { marcarMenu('#/postos'); await vPostos(qs, seq); }
      else if (a === 'visitas' && b) { marcarMenu('#/postos'); await vVisita(b, seq); }
      else if (a === 'checklists' && b) { marcarMenu('#/checklists'); await vFormChecklist(b === 'novo' ? null : b, seq); }
      else if (a === 'checklists') { marcarMenu('#/checklists'); await vChecklists(seq); }
      else if (a === 'solicitacoes' && b === 'nova' && ehGestor()) { marcarMenu('#/solicitacoes'); await vFormSolicitacao(null, qs, seq); }
      else if (a === 'solicitacoes' && b && partes[2] === 'editar' && ehGestor()) { marcarMenu('#/solicitacoes'); await vFormSolicitacao(b, qs, seq); }
      else if (a === 'solicitacoes' && b) { marcarMenu('#/solicitacoes'); await vSolicitacao(b, seq); }
      else if (a === 'solicitacoes') { marcarMenu('#/solicitacoes'); await vSolicitacoes(qs, seq); }
      else if (a === 'materiais') { marcarMenu('#/materiais'); await vMateriais(seq); }
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
      else if (a === 'conta') { marcarMenu('#/conta'); vConta(); }
      else { location.hash = '#/'; }
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
    return `<div class="bars">${top.map((x) => `
      <div class="bar-row"><span class="nm" title="${esc(x.nome)}">${esc(x.nome)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, (x.total / maior) * 100)}%"></div></div>
        <span class="v">${x.total}</span></div>`).join('')}</div>`;
  }

  function tendencia(serie) {
    if (!serie?.length) return '';
    const W = 600; const H = 140; const n = serie.length;
    const max = Math.max(1, ...serie.map((s) => Math.max(s.abertas, s.resolvidas)));
    const larg = W / n; const b = Math.max(1, larg * 0.36);
    const rects = serie.map((s, i) => {
      const x = i * larg + larg * 0.12;
      const h1 = (s.abertas / max) * (H - 6); const h2 = (s.resolvidas / max) * (H - 6);
      return `<rect x="${x}" y="${H - h1}" width="${b}" height="${h1}" rx="1.5" fill="#94a3b8"><title>${fmtDia(s.dia)}: ${s.abertas} abertas</title></rect>
              <rect x="${x + b + 1}" y="${H - h2}" width="${b}" height="${h2}" rx="1.5" fill="#0f766e"><title>${fmtDia(s.dia)}: ${s.resolvidas} resolvidas</title></rect>`;
    }).join('');
    return `<svg class="trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Abertas e resolvidas por dia">
      <line x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}" stroke="#e2e8f0"/>${rects}</svg>
      <div class="d-flex justify-content-between small-muted"><span>${fmtDia(serie[0].dia)}</span><span>${fmtDia(serie[n - 1].dia)}</span></div>
      <div class="legend"><span><i style="background:#94a3b8"></i>Abertas</span><span><i style="background:#0f766e"></i>Resolvidas</span></div>`;
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
    if (escala === 'mes') return `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
    if (escala === 'semana') return `sem. ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
    return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  }

  // Colunas por período (agrupadas ou empilhadas). Devolve SVG puro (serve na tela e no PDF).
  function graficoColunas(serie, series, { escala = 'dia', empilhado = false, altura = 170 } = {}) {
    if (!serie?.length) return '<div class="small-muted">Sem dados no período.</div>';
    const W = 640; const H = altura; const base = H - 22; const topo = 14; const esq = 30;
    const n = serie.length; const larg = (W - esq) / n;
    const totais = serie.map((s) => (empilhado
      ? series.reduce((a, c) => a + (s[c.campo] || 0), 0)
      : Math.max(...series.map((c) => s[c.campo] || 0))));
    const max = Math.max(1, ...totais);
    const y = (v) => base - (v / max) * (base - topo);
    const nGrupo = empilhado ? 1 : series.length;
    const bw = Math.max(1, (larg * 0.72) / nGrupo);
    let barras = '';
    serie.forEach((s, i) => {
      const x0 = esq + i * larg + larg * 0.14;
      let acumulado = 0;
      series.forEach((c, j) => {
        const v = s[c.campo] || 0;
        if (!v) return;
        const dica = `${rotuloBalde(s.periodo, escala)}: ${v} ${c.nome.toLowerCase()}`;
        if (empilhado) {
          barras += `<rect x="${x0}" y="${y(acumulado + v)}" width="${bw}" height="${y(acumulado) - y(acumulado + v)}" fill="${c.cor}"><title>${esc(dica)}</title></rect>`;
          acumulado += v;
        } else {
          barras += `<rect x="${x0 + j * bw}" y="${y(v)}" width="${Math.max(1, bw - 1)}" height="${base - y(v)}" rx="1.5" fill="${c.cor}"><title>${esc(dica)}</title></rect>`;
        }
      });
    });
    // rótulos do eixo X: no máximo ~8, sempre o primeiro e o último
    const passo = Math.max(1, Math.ceil(n / 8));
    const rotulos = serie.map((s, i) => (((i % passo === 0 && n - 1 - i >= passo / 2) || i === n - 1)
      ? `<text x="${esq + i * larg + larg / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#64748b">${esc(rotuloBalde(s.periodo, escala))}</text>` : '')).join('');
    const grade = [0, 0.5, 1].map((f) => {
      const v = Math.round(max * f);
      return `<line x1="${esq}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#e2e8f0"/>
        <text x="${esq - 6}" y="${y(v) + 3}" text-anchor="end" font-size="10" fill="#64748b">${v}</text>`;
    }).join('');
    const legenda = series.map((c) => `<span><i style="background:${c.cor}"></i>${esc(c.nome)}</span>`).join('');
    return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((c) => c.nome).join(' e '))} por período" style="width:100%;height:auto">
      ${grade}${barras}${rotulos}</svg><div class="legend">${legenda}</div>`;
  }

  // Barras horizontais em SVG (para o PDF; na tela usamos barras())
  function graficoBarrasSvg(lista, { max = 8, cor = '#0f766e' } = {}) {
    if (!lista?.length) return '<p class="muted">Nada no período.</p>';
    const top = lista.slice(0, max);
    const maior = Math.max(...top.map((x) => x.total), 1);
    const W = 640; const lh = 22; const H = top.length * lh + 4; const nomeW = 220;
    const linhas = top.map((x, i) => {
      const w = Math.max(3, ((x.total / maior) * (W - nomeW - 50)));
      const nome = String(x.nome).length > 34 ? `${String(x.nome).slice(0, 33)}…` : String(x.nome);
      return `<text x="0" y="${i * lh + 15}" font-size="11" fill="#0f172a">${esc(nome)}</text>
        <rect x="${nomeW}" y="${i * lh + 5}" width="${w}" height="12" rx="3" fill="${cor}"/>
        <text x="${nomeW + w + 6}" y="${i * lh + 15}" font-size="11" fill="#0f172a">${x.total}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Ranking">${linhas}</svg>`;
  }

  // Medidor de % (anel)
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
    { campo: 'solicitacoes', nome: 'Solicitações', cor: '#f59e0b' },
  ];

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

  // Painel do gestor: 4 abas compactas (TI do Beija-Flor, Orcim, Por posto, Materiais).
  // Números pequenos numa faixa no topo, listas com barrinha e tabelas; nada de cartão grande.
  const ABAS_PAINEL = [['ti', 'TI do Beija-Flor'], ['orcim', 'Orcim'], ['postos', 'Por posto'], ['materiais', 'Materiais']];

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
    <span class="l">${esc(i.l)}</span><b>${esc(i.v ?? '—')}</b> ${i.var || ''}${i.sub ? ` <span class="s">${esc(i.sub)}</span>` : ''}</div>`).join('')}</div>`;
  function listaBarras(lista, { valor = (x) => x.total, texto = (x) => x.total, cor = '', vazio = 'Nada no período.', max = 6, link = null } = {}) {
    const itens = (lista || []).filter((x) => valor(x)).slice(0, max);
    if (!itens.length) return `<div class="small-muted py-1">${esc(vazio)}</div>`;
    const topo = Math.max(...itens.map(valor));
    return itens.map((x) => `<div class="pg-barra"${link ? ` data-href="${link(x)}"` : ''}><span class="n" title="${esc(x.nome)}">${esc(x.nome)}</span>
      <span class="b"><i style="width:${Math.max(4, Math.round((valor(x) / topo) * 100))}%${cor ? `;background:${typeof cor === 'function' ? cor(x) : cor}` : ''}"></i></span><span class="v">${esc(texto(x))}</span></div>`).join('');
  }
  const blocoPg = (titulo, corpo, nota = '') => `<section class="pg-bloco"><h3>${esc(titulo)}${nota ? `<span>${nota}</span>` : ''}</h3>${corpo}</section>`;
  const emBreveApi = '<span class="pg-api">API Orcim</span>';
  const pctTxt = (v) => (v === null || v === undefined ? '—' : `${v}%`);

  async function vPainelGestor(qs, seq) {
    titulo('Painel do gestor');
    const salvo = (store.get('gbf_painel_periodo') || '').split('|');
    const pre = presetsPeriodo();
    const de = qs.get('de') || salvo[0] || pre[1][2];
    const ate = qs.get('ate') || salvo[1] || pre[1][3];
    let aba = qs.get('aba') || store.get('gbf_painel_aba') || 'ti';
    if (!ABAS_PAINEL.some(([k]) => k === aba)) aba = 'ti';
    const d = await API.get(`/painel-gestor?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`);
    if (seq !== renderSeq) return;
    ultimoPainel = d;
    store.set('gbf_painel_periodo', `${d.periodo.de}|${d.periodo.ate}`);
    store.set('gbf_painel_aba', aba);
    const ativo = pre.find((p) => p[2] === d.periodo.de && p[3] === d.periodo.ate)?.[0];
    const url = (x = {}) => `#/painel?${new URLSearchParams({ de: d.periodo.de, ate: d.periodo.ate, aba, ...x })}`;

    const conteudo = { ti: abaTi, orcim: abaOrcim, postos: abaPostos, materiais: abaMateriais }[aba](d);
    view().innerHTML = `
      <div class="pg-topo">
        <div class="btn-group btn-group-sm flex-wrap" role="group" aria-label="Períodos prontos">
          ${pre.map(([k, nome]) => `<button class="btn ${k === ativo ? 'btn-dark' : 'btn-outline-secondary'}" data-preset="${k}">${nome}</button>`).join('')}
        </div>
        <label class="small-muted d-flex align-items-center gap-1">De <input type="date" class="form-control form-control-sm" id="pg-de" value="${esc(d.periodo.de)}"></label>
        <label class="small-muted d-flex align-items-center gap-1">Até <input type="date" class="form-control form-control-sm" id="pg-ate" value="${esc(d.periodo.ate)}"></label>
        <button class="btn btn-sm btn-outline-secondary" id="pg-aplicar">Aplicar</button>
        <button class="btn btn-sm btn-outline-secondary ms-auto" id="pg-pdf"><i class="bi bi-file-earmark-pdf"></i> PDF</button>
      </div>
      <div class="small-muted mb-2">${fmtIso(d.periodo.de)} a ${fmtIso(d.periodo.ate)} · comparado com ${fmtIso(d.periodo.anterior.de)} a ${fmtIso(d.periodo.anterior.ate)}.
        "Agora" é a situação neste momento.</div>
      <nav class="pg-abas" aria-label="Abas do painel">${ABAS_PAINEL.map(([k, nome]) => `<a href="${url({ aba: k })}" class="${k === aba ? 'on' : ''}">${nome}</a>`).join('')}</nav>
      <div id="pg-conteudo">${conteudo}</div>`;

    const ir = (a, b) => { location.hash = `#/painel?${new URLSearchParams({ de: a, ate: b, aba })}`; };
    $('#pg-aplicar').addEventListener('click', () => {
      const a = $('#pg-de').value; const b = $('#pg-ate').value;
      if (!a || !b) { toast('Escolha as duas datas.', true); return; }
      ir(a, b);
    });
    $$('[data-preset]').forEach((btn) => btn.addEventListener('click', () => {
      const p = pre.find((x) => x[0] === btn.dataset.preset);
      ir(p[2], p[3]);
    }));
    $('#pg-pdf').addEventListener('click', () => exportarPdf(ultimoPainel));
    if (aba === 'materiais') await ligarMateriais($('#pg-conteudo'), { comFormulario: true });
    ligarCliques();
  }

  function abaTi(d) {
    const k = d.ti.kpis; const a = d.ti.anterior || {}; const pr = d.ti.planejado_reativo;
    return `
      ${faixa([
    { l: 'Atividades concluídas', v: k.atividades, var: variacao(k.atividades, a.atividades), href: '#/atividades?situacao=concluidas' },
    { l: 'Tempo médio', v: dur(k.tempo_medio_atividade), var: variacao(k.tempo_medio_atividade, a.tempo_medio_atividade, { menorMelhor: true, tempo: true }) },
    { l: 'No prazo', v: pctTxt(k.no_prazo_pct), sub: k.no_prazo_base ? `de ${k.no_prazo_base} com prazo` : '' },
    { l: 'Visitas feitas', v: k.visitas, var: variacao(k.visitas, a.visitas), sub: `${k.postos_visitados} posto(s)` },
    { l: 'Solicitações', v: k.solicitacoes, var: variacao(k.solicitacoes, a.solicitacoes), sub: k.tempo_medio_solicitacao ? `${dur(k.tempo_medio_solicitacao)} méd.` : '' },
    { l: 'Em aberto agora', v: k.atividades_abertas_agora, sub: k.atividades_atrasadas_agora ? `${k.atividades_atrasadas_agora} atrasada(s)` : '', href: '#/atividades' },
  ])}
      <div class="pg-duas">
        ${blocoPg('Problemas mais encontrados nas visitas', listaBarras(d.ti.nao_ok_por_item, { vazio: 'Nenhum item NÃO OK no período.' }), 'itens NÃO OK')}
        ${blocoPg('Atividades abertas por idade', listaBarras(d.ti.abertas_por_idade, {
    max: 4, vazio: 'Nenhuma atividade em aberto.', cor: (x) => (x.nome.startsWith('mais') ? '#dc2626' : x.nome.startsWith('3') ? '#f59e0b' : ''),
  }), pr.planejado + pr.reativo ? `planejado ${pr.planejado_pct}% · reativo ${100 - pr.planejado_pct}%` : '')}
      </div>
      ${blocoPg('Por técnico', d.ti.tecnicos.length ? `<div class="table-responsive"><table class="table table-sm pg-tabela mb-0">
        <thead><tr><th>Técnico</th><th>Visitas</th><th>Atividades</th><th>Solicitações</th><th>Tempo médio</th><th>No prazo</th><th>Em aberto</th></tr></thead>
        <tbody>${d.ti.tecnicos.map((t) => `<tr><td>${esc(t.nome)}</td><td>${t.visitas}</td><td>${t.atividades}</td><td>${t.solicitacoes}</td>
          <td>${dur(t.tempo_medio)}</td><td>${pctTxt(t.no_prazo_pct)}</td><td>${t.em_aberto}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="small-muted">Nenhuma entrega no período.</div>')}`;
  }

  function abaOrcim(d) {
    const k = d.orcim.kpis; const a = d.orcim.anterior || {};
    const corUrg = { 4: '#dc2626', 3: '#f59e0b', 2: '', 1: '#94a3b8' };
    return `
      ${faixa([
    { l: 'Abertos', v: k.criadas, var: variacao(k.criadas, a.criadas, { menorMelhor: true }) },
    { l: 'Resolvidos', v: k.resolvidas, var: variacao(k.resolvidas, a.resolvidas) },
    { l: 'Tempo médio', v: dur(k.tempo_medio_resolucao), var: variacao(k.tempo_medio_resolucao, a.tempo_medio_resolucao, { menorMelhor: true, tempo: true }), sub: k.tempo_mediano_resolucao !== null ? `mediana ${dur(k.tempo_mediano_resolucao)}` : '' },
    { l: 'No prazo', v: pctTxt(k.prazo_cumprido_pct), var: variacao(k.prazo_cumprido_pct, a.prazo_cumprido_pct, { pp: true }) },
    { l: '1ª resposta', v: dur(k.tempo_medio_primeira_resposta), var: variacao(k.tempo_medio_primeira_resposta, a.tempo_medio_primeira_resposta, { menorMelhor: true, tempo: true }) },
    { l: 'Em aberto agora', v: k.abertas_agora, sub: k.atrasadas_agora ? `${k.atrasadas_agora} atrasado(s)` : '', href: '#/demandas?situacao=abertas' },
  ])}
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
    return blocoPg('Postos', d.postos.length ? `<div class="table-responsive"><table class="table table-sm pg-tabela mb-0">
      <thead><tr><th>Posto</th><th>Chamados</th><th>Mais repete ${emBreveApi}</th><th>Tempo médio</th><th>NÃO OK</th><th>Visitas</th><th>Última visita</th><th>Atividades abertas</th><th>Materiais</th></tr></thead>
      <tbody>${d.postos.map((p) => `<tr data-href="#/postos/${p.id}" class="clicavel">
        <td class="text-nowrap"><span class="ac-dot ${cor[p.situacao]} d-inline-block me-2"></span>${esc(p.nome)}${p.dias_atraso ? ` <span class="small text-danger">${p.dias_atraso} d</span>` : ''}</td>
        <td>${p.chamados ?? '—'}</td><td>${p.mais_repete ? `${esc(p.mais_repete.nome)} (${p.mais_repete.total})` : '—'}</td><td>${dur(p.tempo_medio)}</td>
        <td>${p.nao_ok || '—'}</td><td>${p.visitas}</td><td>${p.ultima_visita ? fmtDia(p.ultima_visita) : '—'}</td>
        <td>${p.atividades_abertas || '—'}</td><td>${p.materiais || '—'}</td></tr>`).join('')}</tbody></table></div>
      <div class="small-muted mt-2">Bolinha: vermelho = visita atrasada · amarelo = item NÃO OK sem atividade · verde = em dia · cinza = sem próxima visita.
        ${semChamados ? 'A Central ainda não informa o posto de cada chamado; a coluna de chamados aparece quando essa ligação existir.' : 'Chamados ligados ao posto pela localização da Central.'}</div>`
      : vazio('Nenhum posto cadastrado.', 'geo-alt'), 'clique num posto para ver o detalhe');
  }

  function abaMateriais(d) {
    const m = d.materiais;
    return `
      ${faixa([
    { l: 'Pedidos no período', v: m.pedidos },
    { l: 'Itens pedidos', v: m.itens },
    { l: 'Aguardando', v: m.aguardando, sub: m.aguardando_mais_antigo ? `mais antigo ${dur(m.aguardando_mais_antigo)}` : '' },
    { l: 'Separando', v: m.separando },
    { l: 'Atrasados', v: m.atrasados, sub: 'passou da data' },
    { l: 'Entrega média', v: dur(m.entrega_media), sub: m.entregues ? `${m.entregues} entregue(s)` : '' },
  ])}
      <div id="mt-area"></div>
      <div class="pg-duas">
        ${blocoPg('Mais pedidos', listaBarras(m.mais_pedidos, { texto: (x) => `${x.total}${x.unidade ? ` ${x.unidade}` : ''}`, vazio: 'Nenhum pedido no período.' }), 'quantidade no período')}
        ${blocoPg('Pedidos por posto', listaBarras(m.por_posto, { cor: '#534AB7', vazio: 'Nenhum pedido no período.' }))}
      </div>`;
  }

  // ---------------------------- Materiais ----------------------------
  // Usado na aba Materiais do painel (com formulário) e na tela "Materiais" (TI separa e entrega).
  const SIT_MATERIAL = { aguardando: 'tag-gray', separando: 'tag-blue', entregue: 'tag-green', cancelado: 'tag-gray' };

  function linhaItemMaterial(catalogo) {
    return `<div class="mt-item">
      <select class="form-select form-select-sm mt-material" aria-label="Material">
        <option value="">Escolha o material</option>
        ${catalogo.map((c) => `<option value="${c.id}" data-unit="${esc(c.unit || '')}">${esc(c.name)}${c.unit ? ` (${esc(c.unit)})` : ''}</option>`).join('')}
        <option value="outro">Outro item (digitar)</option>
      </select>
      <input class="form-control form-control-sm mt-outro d-none" maxlength="120" placeholder="Nome do item" aria-label="Nome do item">
      <input type="number" min="1" max="9999" value="1" class="form-control form-control-sm mt-qtd" aria-label="Quantidade">
      <button type="button" class="btn btn-sm btn-link text-secondary mt-tirar" aria-label="Tirar item"><i class="bi bi-x-lg"></i></button>
    </div>`;
  }

  async function ligarMateriais(raiz, { comFormulario = false } = {}) {
    const area = $('#mt-area', raiz) || raiz;
    const gestor = ehGestor();
    const [pedidos, catalogo, postos] = await Promise.all([
      API.get('/materiais/pedidos?situacao=todos&limite=40'),
      comFormulario && gestor ? API.get('/materiais/catalogo') : [],
      comFormulario && gestor ? API.get('/postos') : [],
    ]);
    const form = comFormulario && gestor ? `
      <form class="pg-bloco mt-form" id="mt-form" novalidate>
        <h3><i class="bi bi-box-seam"></i> Novo pedido de material</h3>
        <div class="row g-2 mb-2">
          <div class="col-md-5"><label class="form-label small mb-1" for="mt-posto">Para qual posto</label>
            <select class="form-select form-select-sm" id="mt-posto"><option value="">Sem posto</option>${postos.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
          <div class="col-md-3"><label class="form-label small mb-1" for="mt-data">Precisa até</label><input type="date" class="form-control form-control-sm" id="mt-data"></div>
          <div class="col-md-4"><label class="form-label small mb-1" for="mt-urg">Urgência</label>
            <select class="form-select form-select-sm" id="mt-urg">${[1, 2, 3, 4].map((p) => `<option value="${p}">${PRIO_TAREFA[p]}</option>`).join('')}</select></div>
        </div>
        <div class="small-muted mb-1">Itens</div>
        <div id="mt-itens">${linhaItemMaterial(catalogo)}</div>
        <button type="button" class="btn btn-sm btn-link px-0" id="mt-mais"><i class="bi bi-plus-lg"></i> Adicionar item</button>
        <div class="d-flex gap-2 mt-2 flex-wrap">
          <input class="form-control form-control-sm flex-grow-1" id="mt-obs" maxlength="1000" placeholder="Observação (ex.: entregar ao gerente do posto)" aria-label="Observação" style="min-width:220px">
          <button class="btn btn-sm btn-brand" type="submit">Enviar pedido</button>
        </div>
        <div class="text-danger small mt-2 d-none" id="mt-erro" role="alert"></div>
      </form>` : '';

    const podeMover = (p) => !['entregue', 'cancelado'].includes(p.status);
    const lista = pedidos.length ? `<div class="table-responsive"><table class="table table-sm pg-tabela mb-0">
      <thead><tr><th>Nº</th><th>Posto</th><th>Itens</th><th>Pedido</th><th>Precisa até</th><th>Situação</th><th></th></tr></thead>
      <tbody>${pedidos.map((p) => `<tr>
        <td class="text-nowrap">${esc(p.numero)}</td><td>${esc(p.location_name || '—')}</td>
        <td>${esc(p.resumo_itens)}${p.notes ? `<div class="small-muted">${esc(p.notes)}</div>` : ''}${p.priority >= 3 ? ` ${tag(p.priority === 4 ? 'tag-red' : 'tag-amber', p.priority_label)}` : ''}</td>
        <td class="text-nowrap">${fmtDia(p.created_at)}<div class="small-muted">${esc(p.requested_by_name || '')}</div></td>
        <td class="text-nowrap">${p.needed_by ? fmtIso(p.needed_by) : '—'}</td>
        <td class="text-nowrap">${p.atrasado ? tag('tag-red', 'Atrasado') : ''} ${tag(SIT_MATERIAL[p.status], p.status_label)}
          ${p.handled_by_name && p.status !== 'aguardando' ? `<div class="small-muted">${esc(p.handled_by_name)}${p.delivered_at ? ` · ${fmtDia(p.delivered_at)}` : ''}</div>` : ''}</td>
        <td class="text-end text-nowrap">${podeMover(p) ? `
          ${p.status === 'aguardando' ? `<button class="btn btn-sm btn-outline-secondary" data-mt="${p.id}" data-st="separando">Separar</button>` : ''}
          <button class="btn btn-sm btn-outline-success" data-mt="${p.id}" data-st="entregue">Entregue</button>
          ${gestor ? `<button class="btn btn-sm btn-link text-secondary" data-mt="${p.id}" data-st="cancelado" data-num="${esc(p.numero)}">Cancelar</button>` : ''}` : ''}</td>
      </tr>`).join('')}</tbody></table></div>`
      : '<div class="small-muted py-1">Nenhum pedido de material ainda.</div>';

    area.innerHTML = `${form}${blocoPg('Pedidos', lista, 'em aberto primeiro · atrasados no topo')}`;

    $$('[data-mt]', area).forEach((b) => b.addEventListener('click', async () => {
      const mudar = async () => {
        await API.patch(`/materiais/pedidos/${b.dataset.mt}`, { status: b.dataset.st });
        toast(b.dataset.st === 'entregue' ? 'Pedido marcado como entregue.' : b.dataset.st === 'separando' ? 'Pedido em separação.' : 'Pedido cancelado.');
        render();
      };
      if (b.dataset.st === 'cancelado') {
        janela('Cancelar pedido', `<p class="mb-0">Cancelar o pedido ${esc(b.dataset.num)}? A TI deixa de vê-lo como pendente.</p>`, { ok: 'Cancelar pedido', perigo: true, onOk: mudar });
      } else {
        try { await mudar(); } catch (e) { toast(e.message, true); }
      }
    }));

    const f = $('#mt-form', area);
    if (!f) return;
    const ligarItem = (el) => {
      const sel = $('.mt-material', el);
      sel.addEventListener('change', () => {
        $('.mt-outro', el).classList.toggle('d-none', sel.value !== 'outro');
        if (sel.value === 'outro') $('.mt-outro', el).focus();
      });
      $('.mt-tirar', el).addEventListener('click', () => {
        if ($$('.mt-item', f).length > 1) el.remove();
        else { sel.value = ''; $('.mt-qtd', el).value = 1; $('.mt-outro', el).classList.add('d-none'); }
      });
    };
    $$('.mt-item', f).forEach(ligarItem);
    $('#mt-mais', f).addEventListener('click', () => {
      $('#mt-itens', f).insertAdjacentHTML('beforeend', linhaItemMaterial(catalogo));
      const novo = $$('.mt-item', f).pop();
      ligarItem(novo);
      $('.mt-material', novo).focus();
    });
    const erro = $('#mt-erro', f);
    f.addEventListener('input', () => erro.classList.add('d-none'));
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const itens = [];
      for (const el of $$('.mt-item', f)) {
        const v = $('.mt-material', el).value;
        const qtd = Number($('.mt-qtd', el).value);
        const nome = $('.mt-outro', el).value.trim();
        if (!v) continue;
        if (v === 'outro' && !nome) { erro.textContent = 'Escreva o nome do item que não está na lista.'; erro.classList.remove('d-none'); $('.mt-outro', el).focus(); return; }
        if (!Number.isInteger(qtd) || qtd < 1) { erro.textContent = 'A quantidade precisa ser 1 ou mais.'; erro.classList.remove('d-none'); $('.mt-qtd', el).focus(); return; }
        itens.push(v === 'outro' ? { name: nome, quantity: qtd } : { material_id: v, quantity: qtd });
      }
      if (!itens.length) { erro.textContent = 'Escolha pelo menos um material.'; erro.classList.remove('d-none'); return; }
      try {
        const r = await API.post('/materiais/pedidos', {
          location_id: $('#mt-posto', f).value || null, needed_by: $('#mt-data', f).value || null,
          priority: Number($('#mt-urg', f).value), notes: $('#mt-obs', f).value, itens,
        });
        toast(`Pedido ${r.numero} enviado para a TI.`);
        render();
      } catch (e) {
        erro.textContent = e.message;
        erro.classList.remove('d-none');
      }
    });
  }

  // Tela "Materiais" (menu): a TI vê os pedidos e marca separando / entregue; o gestor também pede por aqui.
  async function vMateriais(seq) {
    titulo('Pedidos de material');
    if (seq !== renderSeq) return;
    view().innerHTML = `<div class="small-muted mb-3">${ehGestor() ? 'Peça material para um posto; a TI separa e entrega.' : 'Pedidos do gestor: marque quando começar a separar e quando entregar.'}</div><div id="mt-area"></div>`;
    await ligarMateriais(view(), { comFormulario: true });
  }

  // Relatório para imprimir / salvar em PDF (sem bibliotecas: o navegador gera o PDF)
  function exportarPdf(d) {
    if (!d) return;
    const o = d.orcim.kpis; const t = d.ti.kpis; const per = d.periodo;
    const esc_ = per.escala;
    const tituloEscala = esc_ === 'dia' ? 'por dia' : esc_ === 'semana' ? 'por semana' : 'por mês';
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
  <div class="grafico-box"><h3>Chamados abertos × resolvidos ${tituloEscala}</h3>${graficoColunas(d.orcim.serie, CORES_ORCIM, { escala: esc_, altura: 190 })}</div>
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
  <div class="grafico-box"><h3>Entregas da TI ${tituloEscala}</h3>${graficoColunas(d.ti.serie, CORES_TI, { escala: esc_, empilhado: true, altura: 190 })}</div>
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
            <div class="meta">${tagTarefa(t.status)}${t.assignee_name ? `<span>${esc(t.assignee_name)}</span>` : ''}${t.due_at ? `<span>· prazo ${fmtData(t.due_at)}</span>` : ''}</div></div>`).join('')
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

  function cartaoTarefa(t) {
    const cls = t.prazo === 'atrasada' ? 'late' : t.prazo === 'vence_logo' ? 'soon' : '';
    return `<div class="task ${cls}" data-href="#/atividades/${t.id}">
      <div class="ttl">${esc(t.title)}</div>
      <div class="meta">
        ${t.priority >= 3 ? tag(t.priority === 4 ? 'tag-red' : 'tag-amber', PRIO_TAREFA[t.priority]) : ''}
        ${tagPrazoTarefa(t.prazo)}
        ${t.due_at ? `<span><i class="bi bi-calendar"></i> ${fmtData(t.due_at)}</span>` : ''}
        ${t.ticket_number ? `<span><i class="bi bi-link-45deg"></i>${esc(t.ticket_number)}</span>` : ''}
        ${t.location_name ? `<span><i class="bi bi-geo-alt"></i>${esc(t.location_name)}</span>` : ''}
        ${ehGestor() && t.assignee_name ? `<span><i class="bi bi-person"></i> ${esc(t.assignee_name)}</span>` : ''}
      </div></div>`;
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
        return `<div class="col"><h4><span>${nome}</span><span class="muted">${itens.length}</span></h4>${itens.map(cartaoTarefa).join('') || '<div class="small-muted px-1">—</div>'}</div>`;
      }).join('')}</div>`;
    } else {
      corpo = lista.length ? `<div class="card-x p-0"><div class="table-wrap"><table class="table-x">
        <thead><tr><th>Atividade</th><th>Status</th><th class="hide-mobile">Responsável</th><th>Prazo</th><th class="hide-mobile">Demanda</th></tr></thead><tbody>
        ${lista.map((t) => `<tr class="click" data-href="#/atividades/${t.id}"><td><div class="fw-semibold">${esc(t.title)}</div>${t.location ? `<div class="small-muted">${esc(t.location)}</div>` : ''}</td>
          <td>${tagTarefa(t.status)}</td><td class="hide-mobile">${esc(t.assignee_name || '—')}</td>
          <td class="text-nowrap">${t.due_at ? fmtData(t.due_at) : '—'} ${tagPrazoTarefa(t.prazo)}</td>
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
          <div class="col-sm-6"><label class="form-label">Prazo</label><input type="datetime-local" class="form-control" name="due_at" value="${paraInputLocal(t?.due_at)}"></div>
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
        due_at: deInputLocal(fd.get('due_at')), location: fd.get('location'), ticket_id: fd.get('ticket_id') || null,
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
    const t = await API.get(`/atividades/${encodeURIComponent(id)}`);
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
          <div class="d-flex flex-wrap gap-2 mt-2">${tagTarefa(t.status)}${tagPrazoTarefa(t.prazo)}${t.priority >= 3 ? tag(t.priority === 4 ? 'tag-red' : 'tag-amber', PRIO_TAREFA[t.priority]) : ''}</div>
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
            <dt>Prazo</dt><dd>${fmtData(t.due_at)}</dd>
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
          ${t.eventos.map((e) => `<div class="msg ${e.kind === 'system' ? 'sys' : ''}">
            <div class="d-flex justify-content-between gap-2"><span class="who">${esc(e.user_name || 'Sistema')}</span><span class="small-muted">${fmtData(e.created_at)}</span></div>
            <div class="body">${esc(e.content)}</div></div>`).join('')}
          <form id="form-coment" class="mt-2">
            <textarea class="form-control mb-2" name="content" rows="2" placeholder="Escreva um comentário ou atualização" required></textarea>
            <button class="btn btn-sm btn-brand" type="submit">Comentar</button>
          </form>
        </div>
      </div>`;
    $$('[data-status]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.status === 'cancelada' && !confirm('Cancelar esta atividade?')) return;
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
            <td>${u.role === 'gestor' ? tag('tag-violet', 'Gestor') : tag('tag-teal', 'Técnico')}</td>
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
            <div class="col-sm-6"><label class="form-label">Papel</label><select class="form-select" name="role">
              <option value="tecnico">Técnico</option><option value="gestor">Gestor</option></select></div>
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
      form.email.value = u.email || ''; form.phone.value = u.phone || ''; form.role.value = u.role;
      form.active.value = u.active ? '1' : '0'; form.password.value = '';
      $('#fu-titulo').innerHTML = `<i class="bi bi-pencil"></i>Editar ${esc(u.name)}`;
      $('#fu-senha-lbl').textContent = 'Nova senha (deixe em branco para manter)';
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = {
        name: form.name.value, username: form.username.value, email: form.email.value, phone: form.phone.value,
        role: form.role.value, active: form.active.value === '1',
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
  const segunda = (iso) => isoMais(iso, -((diaSemana(iso) + 6) % 7));
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

  function iniciarVisita(postoId, nome, emAndamentoId) {
    if (emAndamentoId) { location.hash = `#/visitas/${emAndamentoId}`; return; }
    janela(`Iniciar visita — ${nome}`, `
      <label class="form-label">Data e hora de início</label>
      <input type="datetime-local" class="form-control form-control-lg" name="inicio" value="${paraInputLocal(new Date())}">
      <div class="form-text">Já vem com agora. Mude só se a visita começou em outro horário.</div>`, {
      ok: 'Iniciar visita',
      onOk: async (el) => {
        const r = await API.post('/visitas', { location_id: postoId, started_at: deInputLocal(el.querySelector('[name=inicio]').value) });
        location.hash = `#/visitas/${r.id}`;
      },
    });
  }

  // Reagendar: visita prevista do posto, atividade ou solicitação
  function reagendar(alvo) {
    const comHora = alvo.tipo !== 'solicitacao';
    janela('Reagendar', `
      <label class="form-label">Nova data</label>
      <input type="date" class="form-control form-control-lg mb-3" name="data" value="${esc(alvo.data || hojeISO())}">
      ${comHora ? `<label class="form-label">Novo horário</label>
      <input type="time" class="form-control form-control-lg" name="hora" value="${esc(alvo.hora || '')}">` : ''}`, {
      onOk: async (el) => {
        const data = el.querySelector('[name=data]').value;
        const hora = comHora ? el.querySelector('[name=hora]').value : '';
        if (!data) throw new Error('Escolha a nova data.');
        if (alvo.tipo === 'posto') await API.patch(`/postos/${alvo.id}`, { next_visit_date: data, next_visit_time: hora || null });
        else if (alvo.tipo === 'atividade') await API.patch(`/atividades/${alvo.id}`, { due_at: deInputLocal(`${data}T${hora || '09:00'}`) });
        else await API.patch(`/solicitacoes/${alvo.id}`, { desired_date: data });
        toast('Reagendado.');
        render();
      },
    });
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
  async function vHoje(seq) {
    titulo(ehGestor() ? 'Dia do técnico' : 'Meu dia');
    const h = await API.get('/hoje');
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
        <div class="card-x"><h3><i class="bi bi-megaphone"></i>Solicitações do gestor <a class="sub" href="#/solicitacoes">ver todas</a></h3>
          ${h.solicitacoes.length ? h.solicitacoes.map((s) => `<div class="task" data-href="#/solicitacoes/${s.id}">
            <div class="ttl">${esc(s.title)}</div>
            <div class="meta">${tagSolic(s.status)}${s.priority >= 3 ? tag(s.priority === 4 ? 'tag-red' : 'tag-amber', PRIO_TAREFA[s.priority]) : ''}
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

  function itemAgenda(i) {
    const reag = arrastavel(i) ? btnReag({ tipo: i.reagendar, id: i.posto_id || i.id, data: i.data, hora: i.hora }) : '';
    const iniciar = i.tipo === 'visita' && i.status !== 'em_andamento'
      ? btnIniciar({ id: i.posto_id, name: i.local }, null, false) : '';
    return `<div class="ag-item ag-${i.tipo} st-${i.status} ${arrastavel(i) ? 'arrastavel' : ''}" data-href="${i.link}"
        ${arrastavel(i) ? `data-drag="${dadosArrasto(i)}" title="Arraste para outro dia"` : ''}>
      <div class="ag-hora">${i.hora || '<span class="muted">dia</span>'}</div>
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
    if (alvo.tipo === 'atividade') return { url: `/atividades/${alvo.id}`, corpo: { due_at: deInputLocal(`${novoDia}T${alvo.hora || '09:00'}`) } };
    if (alvo.tipo === 'solicitacao') return { url: `/solicitacoes/${alvo.id}`, corpo: { desired_date: novoDia } };
    return null;
  }

  /**
   * Arrastar e soltar entre dias (semana e mês), sem biblioteca.
   * Mouse: começa depois de mover ~6px (clique continua abrindo o item).
   * Toque (iPhone): segurar ~0,4 s para pegar; antes disso o dedo só rola a tela.
   */
  let suprimirClique = false;
  function ativarArrasto(raiz) {
    // #view é o mesmo elemento em todas as telas: registra os eventos uma vez só (delegação)
    if (raiz.dataset.arrastoAtivo) return;
    raiz.dataset.arrastoAtivo = '1';
    let a = null;
    const alvoEm = (x, y) => document.elementFromPoint(x, y)?.closest('[data-drop-dia]') || null;
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
      const chamada = destino && moverPara(dados, destino.dataset.dropDia);
      if (!chamada) return;
      // Atualização otimista: o bloco já aparece no novo dia; se o servidor recusar, a tela volta
      (destino.querySelector('[data-drop-lista]') || destino).appendChild(el);
      try {
        await API.patch(chamada.url, chamada.corpo);
        toast(`Movido para ${dataCurta(destino.dataset.dropDia)}.`);
      } catch (e) { toast(e.message, true); }
      render();
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
        <div class="col-6"><label class="form-label" for="na-hora">Horário</label><input type="time" class="form-control" id="na-hora" value="09:00"></div>
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
          due_at: deInputLocal(`${d}T${el.querySelector('#na-hora').value || '09:00'}`),
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

  async function vAgenda(qs, seq) {
    titulo('Agenda');
    const modo = ['dia', 'semana', 'mes', 'lista'].includes(qs.get('modo')) ? qs.get('modo') : (store.get('gbf_ag_modo') || 'semana');
    store.set('gbf_ag_modo', modo);
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
        return `<div class="cal-dia ${d === hoje ? 'hoje' : ''}" data-drop-dia="${d}">
          <div class="cal-dia-cab"><a class="cal-dia-tit" href="${ir({ modo: 'dia', data: d })}">${dataCurta(d)}</a>${btnMais(d)}</div>
          <div data-drop-lista>${(porDia[d] || []).map(itemAgenda).join('')}</div></div>`;
      }).join('')}</div>`;
    } else if (modo === 'mes') {
      const dias = [];
      for (let d = de; d <= ate; d = isoMais(d, 1)) dias.push(d);
      corpo = `<div class="small-muted mb-2"><i class="bi bi-arrows-move"></i> Arraste para outro dia · clique no item para abrir · <strong>+</strong> cria atividade.</div>
        <div class="cal-mes"><div class="cal-mes-cab">${['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((s) => `<div>${s}</div>`).join('')}</div>
        <div class="cal-mes-grade">${dias.map((d) => {
    const its = porDia[d] || [];
    return `<div class="cal-cel ${d.slice(0, 7) !== base.slice(0, 7) ? 'fora' : ''} ${d === hoje ? 'hoje' : ''}" data-drop-dia="${d}">
            <div class="cal-cel-cab"><a class="n" href="${ir({ modo: 'dia', data: d })}" title="Ver o dia">${Number(d.slice(8, 10))}</a>${btnMais(d)}</div>
            <div data-drop-lista class="cal-cel-itens">
            ${its.slice(0, 4).map((i) => `<span class="mini st-${i.status} ${arrastavel(i) ? 'arrastavel' : ''}" data-href="${i.link}" title="${esc(i.titulo)}"
                ${arrastavel(i) ? `data-drag="${dadosArrasto(i)}"` : ''}><i class="bi bi-${TIPO_AG[i.tipo][0]}"></i> ${esc(i.hora ? `${i.hora} ` : '')}${esc(i.tipo === 'atividade' || i.tipo === 'solicitacao' ? i.titulo : (i.local || i.titulo))}</span>`).join('')}
            ${its.length > 4 ? `<a class="mini mais" href="${ir({ modo: 'dia', data: d })}">+${its.length - 4} mais</a>` : ''}</div></div>`;
  }).join('')}</div></div>`;
    } else {
      const datas = Object.keys(porDia).sort();
      corpo = datas.length ? datas.map((d) => `<div class="card-x mb-2"><h3 class="${d === hoje ? 'text-success' : ''}">${dataCurta(d)}${d === hoje ? ' · hoje' : ''}</h3>${porDia[d].map(itemAgenda).join('')}</div>`).join('')
        : `<div class="card-x">${vazio('Nada agendado nos próximos 30 dias.', 'calendar')}</div>`;
    }
    view().innerHTML = `
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
      novaAtividadeNoDia(b.dataset.addDia).catch((e) => toast(e.message, true));
    }));
    if (modo === 'semana' || modo === 'mes') ativarArrasto(view());
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
            <div class="meta">${tagTarefa(t.status)}${t.due_at ? `<span>${fmtData(t.due_at)}</span>` : ''}</div></div>`).join('') : vazio('Nenhuma atividade aberta.', 'check2-all')}
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
          <input type="datetime-local" class="form-control" id="vs-ativ-prazo">
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
        body.pendencia = { title: $('#vs-ativ-tit').value, due_at: deInputLocal($('#vs-ativ-prazo').value), description: $('#vs-pend').value };
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
  async function vSolicitacoes(qs, seq) {
    titulo('Solicitações');
    const sit = qs.get('situacao') || 'abertas';
    const lista = await API.get(`/solicitacoes?situacao=${sit}`);
    if (seq !== renderSeq) return;
    view().innerHTML = `
      <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
        <div class="chips mb-0 me-auto">${[['abertas', 'Abertas'], ['concluidas', 'Concluídas'], ['todas', 'Todas']].map(([k, t]) => `<a class="chip ${sit === k ? 'active' : ''}" href="#/solicitacoes?situacao=${k}">${t}</a>`).join('')}</div>
        ${ehGestor() ? '<a class="btn btn-brand" href="#/solicitacoes/nova"><i class="bi bi-plus-lg"></i> Nova solicitação</a>' : ''}
      </div>
      ${lista.length ? lista.map((s) => `<div class="task solic" data-href="#/solicitacoes/${s.id}">
        <div class="d-flex justify-content-between gap-2"><div class="ttl">${esc(s.title)}</div>${tagSolic(s.status)}</div>
        <div class="meta">${s.priority >= 3 ? tag(s.priority === 4 ? 'tag-red' : 'tag-amber', s.priority_label) : ''}
          ${s.location_name ? `<span><i class="bi bi-geo-alt"></i>${esc(s.location_name)}</span>` : ''}
          ${s.desired_date ? `<span><i class="bi bi-calendar"></i> para ${dataBR(s.desired_date)}</span>` : ''}
          <span>· pedida por ${esc(s.requested_by_name || '—')} ${relativo(s.created_at)}</span>
          ${s.tempo_ate_concluir !== null ? `<span>· resolvida em ${dur(s.tempo_ate_concluir)}</span>` : ''}</div></div>`).join('')
    : `<div class="card-x">${vazio(sit === 'abertas' ? 'Nenhuma solicitação aberta.' : 'Nada por aqui.', 'megaphone')}</div>`}`;
    ligarCliques();
  }

  async function vSolicitacao(id, seq) {
    const s = await API.get(`/solicitacoes/${encodeURIComponent(id)}`);
    if (seq !== renderSeq) return;
    titulo('Solicitação');
    const aberta = ['a_fazer', 'em_andamento'].includes(s.status);
    view().innerHTML = `
      <a href="#/solicitacoes" class="small-muted text-decoration-none"><i class="bi bi-arrow-left"></i> Solicitações</a>
      <div class="detail-head"><div class="min-w-0"><div class="mt-2">${tagSolic(s.status)} ${s.priority >= 3 ? tag(s.priority === 4 ? 'tag-red' : 'tag-amber', s.priority_label) : ''}</div>
        <h3>${esc(s.title)}</h3></div></div>
      <div class="acoes-grandes">
        ${s.status === 'a_fazer' ? '<button type="button" class="btn btn-lg btn-brand btn-acao" data-st="em_andamento"><i class="bi bi-play-circle"></i> COMEÇAR</button>' : ''}
        ${aberta ? '<button type="button" class="btn btn-lg btn-success btn-acao" data-st="concluida"><i class="bi bi-check2-circle"></i> CONCLUIR</button>' : ''}
        ${!aberta && s.status !== 'cancelada' ? '<button type="button" class="btn btn-lg btn-outline-secondary btn-acao" data-st="em_andamento"><i class="bi bi-arrow-counterclockwise"></i> Reabrir</button>' : ''}
        ${aberta ? btnReag({ tipo: 'solicitacao', id: s.id, data: s.desired_date }, 'btn-lg') : ''}
        ${ehGestor() ? `<a class="btn btn-lg btn-outline-secondary" href="#/solicitacoes/${s.id}/editar"><i class="bi bi-pencil"></i> Editar</a>` : ''}
        ${ehGestor() && aberta ? '<button type="button" class="btn btn-lg btn-outline-danger" data-st="cancelada">Cancelar</button>' : ''}
      </div>
      <div class="card-x" style="max-width:760px"><dl class="kv">
        <dt>Pedida por</dt><dd>${esc(s.requested_by_name || '—')} em ${fmtData(s.created_at)}</dd>
        <dt>Posto</dt><dd>${s.location_id ? `<a href="#/postos/${s.location_id}">${esc(s.location_name)}</a>` : '—'}</dd>
        <dt>Data desejada</dt><dd>${dataBR(s.desired_date)}</dd>
        <dt>Atendida por</dt><dd>${esc(s.handled_by_name || '—')}</dd>
        <dt>Começou</dt><dd>${fmtData(s.started_at)}</dd>
        <dt>Concluída</dt><dd>${fmtData(s.completed_at)}${s.tempo_ate_concluir !== null ? ` <span class="small-muted">(${dur(s.tempo_ate_concluir)} desde o pedido)</span>` : ''}</dd>
      </dl>
      ${s.description ? `<hr><div style="white-space:pre-wrap">${esc(s.description)}</div>` : ''}
      ${s.response ? `<hr><div class="small-muted mb-1">Resposta da TI</div><div style="white-space:pre-wrap">${esc(s.response)}</div>` : ''}
      </div>`;
    $$('[data-st]').forEach((b) => b.addEventListener('click', () => {
      const st = b.dataset.st;
      if (st === 'concluida') {
        janela('Concluir solicitação', `<label class="form-label" for="sol-resp">O que foi feito</label>
          <textarea class="form-control" id="sol-resp" rows="4">${esc(s.response || '')}</textarea>`, {
          ok: 'Concluir',
          onOk: async (el) => { await API.patch(`/solicitacoes/${s.id}`, { status: 'concluida', response: el.querySelector('#sol-resp').value }); toast('Solicitação concluída.'); render(); },
        });
      } else if (st === 'cancelada') {
        janela('Cancelar solicitação', '<p class="mb-0">Cancelar esta solicitação?</p>', {
          ok: 'Cancelar solicitação', perigo: true, onOk: async () => { await API.patch(`/solicitacoes/${s.id}`, { status: 'cancelada' }); render(); },
        });
      } else {
        API.patch(`/solicitacoes/${s.id}`, { status: st }).then(() => { toast('Atualizado.'); render(); }).catch((e) => toast(e.message, true));
      }
    }));
    ligarReagendar();
  }

  async function vFormSolicitacao(id, qs, seq) {
    const [s, postos] = await Promise.all([id ? API.get(`/solicitacoes/${encodeURIComponent(id)}`) : null, API.get('/postos')]);
    if (seq !== renderSeq) return;
    titulo(id ? 'Editar solicitação' : 'Nova solicitação');
    const postoSel = s ? s.location_id : qs.get('posto');
    view().innerHTML = `
      <a href="${id ? `#/solicitacoes/${id}` : '#/solicitacoes'}" class="small-muted text-decoration-none"><i class="bi bi-arrow-left"></i> Voltar</a>
      <form class="card-x mt-2 form-grande" id="form-sol" style="max-width:640px">
        <div class="mb-3"><label class="form-label" for="sl-tit">O que você precisa *</label><input class="form-control" id="sl-tit" name="title" required value="${esc(s?.title || '')}"></div>
        <div class="mb-3"><label class="form-label" for="sl-desc">Detalhes</label><textarea class="form-control" id="sl-desc" name="description" rows="4">${esc(s?.description || '')}</textarea></div>
        <div class="row g-3 mb-3">
          <div class="col-sm-6"><label class="form-label" for="sl-posto">Posto</label><select class="form-select" id="sl-posto" name="location_id"><option value="">Nenhum</option>
            ${postos.map((p) => `<option value="${p.id}" ${String(p.id) === String(postoSel) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div class="col-sm-6"><label class="form-label" for="sl-prio">Urgência</label><select class="form-select" id="sl-prio" name="priority">
            ${[1, 2, 3, 4].map((p) => `<option value="${p}" ${(s?.priority || 1) === p ? 'selected' : ''}>${PRIO_TAREFA[p]}</option>`).join('')}</select></div>
          <div class="col-sm-6"><label class="form-label" for="sl-data">Data desejada</label><input type="date" class="form-control" id="sl-data" name="desired_date" value="${esc(s?.desired_date || '')}"></div>
        </div>
        <div class="alert alert-danger py-2 d-none" id="sl-erro"></div>
        <button class="btn btn-brand btn-lg" type="submit">${id ? 'Salvar' : 'Enviar para a TI'}</button>
      </form>`;
    $('#form-sol').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const body = { title: f.title.value, description: f.description.value, location_id: f.location_id.value || null, priority: Number(f.priority.value), desired_date: f.desired_date.value || null };
      try {
        const r = id ? await API.patch(`/solicitacoes/${id}`, body) : await API.post('/solicitacoes', body);
        toast(id ? 'Solicitação salva.' : 'Solicitação enviada para a TI.');
        location.hash = `#/solicitacoes/${id || r.id}`;
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
    const mostrar = acFeed.tudo ? lista : lista.slice(0, 12);
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
    titulo('Acompanhamento da TI');
    let periodo = qs.get('periodo') || (qs.get('dias') === '30' ? '30' : '7');
    if (!PERIODOS_AC.some(([k]) => k === periodo)) periodo = '7';
    const a = await API.get(`/acompanhamento?periodo=${periodo}`);
    if (seq !== renderSeq) return;
    const r = a.resumo;
    const ant = a.anterior;
    const h = a.hoje;
    acFeed.itens = a.feed;
    acFeed.tudo = false;

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
        ${v.nao_ok ? tag('tag-red', `Concluída · ${v.nao_ok} NÃO OK`) : tag('tag-green', 'Concluída · tudo OK')}</div>` })),
      ...h.em_andamento.map((v) => ({ hora: v.hora, html: `<div class="ac-hoje-card agora" data-href="#/visitas/${v.id}">
        <div class="small-muted">Agora${v.quem ? ` · ${esc(v.quem)}` : ''}</div><div class="t">${esc(v.local)}</div>
        ${tag('tag-blue', `Em andamento ${v.feitos}/${v.itens}`)}</div>` })),
      ...h.previstas.map((p) => ({ hora: p.hora || '99:99', html: `<div class="ac-hoje-card" data-href="#/postos/${p.id}">
        <div class="small-muted">${esc(p.hora || 'sem horário')}</div><div class="t">${esc(p.local)}</div>
        ${tag('tag-gray', 'Prevista')}</div>` })),
    ].sort((x, y) => x.hora.localeCompare(y.hora));
    const totalHoje = h.concluidas.length + h.em_andamento.length + h.previstas.length;

    const metr = (lbl, val, delta, sub) => `<div class="ac-metric"><div class="lbl">${esc(lbl)}</div>
      <div class="val">${esc(val)} ${delta}</div><div class="small-muted">${sub}</div></div>`;

    const COR_POSTO = { atrasado: 'red', atencao: 'amber', andamento: 'blue', ok: 'green', sem_data: 'gray' };
    const semData = a.postos.filter((p) => p.situacao === 'sem_data').length;

    view().innerHTML = `
      <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
        <div class="small-muted me-auto">O que precisa de você, o dia de hoje e o resultado do período.</div>
        <div class="btn-group btn-group-sm" role="group" aria-label="Período">${PERIODOS_AC.map(([k, t]) => `<a class="btn ${k === periodo ? 'btn-dark' : 'btn-outline-secondary'}" href="#/?periodo=${k}">${t}</a>`).join('')}</div>
        <a class="btn btn-brand btn-sm" href="#/solicitacoes/nova"><i class="bi bi-plus-lg"></i> Nova solicitação</a>
      </div>

      <section class="ac-sec">
        <div class="ac-head"><span class="ac-num">1</span><h2>Precisa de você</h2>
          ${a.atencao.length ? tag(altos ? 'tag-red' : 'tag-amber', String(a.atencao.length)) : ''}
          <span class="small-muted ms-auto">${a.atencao.length ? 'do mais grave para o menos grave' : ''}</span></div>
        <div class="ac-box">${a.atencao.length ? a.atencao.map(linhaAtencao).join('')
          : '<div class="ac-row ac-ok"><i class="bi bi-check2-circle"></i><div>Tudo em dia: nenhuma visita atrasada, item NÃO OK sem atividade, atividade vencida ou solicitação parada.</div></div>'}</div>
      </section>

      <section class="ac-sec">
        <div class="ac-head"><span class="ac-num">2</span><h2>Hoje</h2>
          <span class="small-muted">· ${totalHoje} visita(s) · ${h.concluidas.length} concluída(s) · ${h.atividades} atividade(s) com prazo hoje</span>
          <a class="small ms-auto" href="#/agenda">ver agenda</a></div>
        ${cartaoHoje.length ? `<div class="ac-hoje">${cartaoHoje.map((c) => c.html).join('')}</div>`
          : '<div class="ac-box"><div class="ac-row small-muted">Nenhuma visita para hoje. Visitas atrasadas aparecem em "Precisa de você".</div></div>'}
      </section>

      <section class="ac-sec">
        <div class="ac-head"><span class="ac-num">3</span><h2>${TITULO_AC[periodo]}</h2><span class="small-muted ms-auto">${COMPARA_AC[periodo]}</span></div>
        <div class="ac-metrics">
          ${metr('Visitas feitas', r.visitas, deltaAc(r.visitas, ant.visitas), `em ${r.postos_visitados} posto(s)`)}
          ${metr('Atividades concluídas', r.atividades, deltaAc(r.atividades, ant.atividades), r.atividades_com_atraso ? `${r.atividades_com_atraso} com atraso` : 'todas no prazo')}
          ${metr('Solicitações atendidas', r.solicitacoes, deltaAc(r.solicitacoes, ant.solicitacoes), r.tempo_medio_solicitacao ? `média ${dur(r.tempo_medio_solicitacao)}` : 'sem tempo médio')}
          ${metr('Itens NÃO OK', r.nao_ok, deltaAc(r.nao_ok, ant.nao_ok, { menorMelhor: true }), r.nao_ok ? `${r.nao_ok_com_atividade} com atividade` : 'nenhum problema')}
        </div>
      </section>

      <section class="ac-sec ac-duo">
        <div>
          <div class="ac-head"><span class="ac-num">4</span><h2>Postos</h2><a class="small ms-auto" href="#/postos">todos</a></div>
          <div class="ac-box ac-postos">${a.postos.filter((p) => p.situacao !== 'sem_data').map((p) => `
            <div class="ac-posto" data-href="#/postos/${p.id}"><span class="ac-dot ${COR_POSTO[p.situacao]}"></span>
              <span class="flex-grow-1 min-w-0 text-truncate">${esc(p.nome)}</span><span class="small-muted text-nowrap">${esc(p.motivo)}</span></div>`).join('')
            || '<div class="ac-posto small-muted">Nenhum posto com próxima visita.</div>'}
            ${semData ? `<div class="ac-posto small-muted" data-href="#/postos">${semData} posto(s) sem próxima visita</div>` : ''}
          </div>
        </div>
        <div>
          <div class="ac-head"><h2>O que foi feito</h2>
            <div class="ac-filtros ms-auto" id="ac-feed-filtros">${[['tudo', 'Tudo'], ['visita', 'Visitas'], ['atividade', 'Atividades'], ['solicitacao', 'Solicitações']]
              .map(([k, t]) => `<button type="button" data-f="${k}">${t}</button>`).join('')}</div></div>
          <div class="ac-box ac-feed" id="ac-feed"></div>
        </div>
      </section>`;
    $$('#ac-feed-filtros [data-f]').forEach((b) => b.addEventListener('click', () => {
      acFeed.filtro = b.dataset.f;
      acFeed.tudo = false;
      renderFeedAc();
    }));
    renderFeedAc();
    ligarReagendar();
    $$('.ac-box [data-reag], .ac-box a.btn').forEach((b) => b.addEventListener('click', (ev) => ev.stopPropagation()));
    ligarCliques();
  }

  // ------------------------------------------------------------------
  // Notificações (sino + aviso do navegador)
  // ------------------------------------------------------------------
  let timerNotif = null;
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
    let r;
    try { r = await API.get('/notificacoes'); } catch { return; }
    const badge = $('#sino-badge');
    badge.textContent = r.nao_lidas > 99 ? '99+' : r.nao_lidas;
    badge.classList.toggle('d-none', !r.nao_lidas);
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
