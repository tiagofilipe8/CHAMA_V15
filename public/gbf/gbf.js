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
  const PRIO_TAREFA = { 1: 'Baixa', 2: 'Normal', 3: 'Alta', 4: 'Urgente' };
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
      ['grp', 'Orcim'],
      ['#/', 'speedometer2', 'Visão geral'],
      ['#/demandas', 'inboxes', 'Demandas'],
      ['#/manutencoes', 'tools', 'Manutenções'],
      ['grp', 'Nosso time'],
      ['#/atividades', 'kanban', ehGestor() ? 'Atividades' : 'Minhas atividades'],
    ];
    if (ehGestor()) {
      itens.push(['grp', 'Administração'], ['#/usuarios', 'people', 'Usuários'], ['#/config', 'sliders', 'Configurações']);
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
    if (EU.must_change_password && partes[0] !== 'conta') { location.hash = '#/conta'; return; }
    const [a, b] = partes;
    try {
      carregando();
      if (!a) { marcarMenu('#/'); await vVisao(seq); }
      else if (a === 'demandas' && b) { marcarMenu('#/demandas'); await vDemanda(b, seq); }
      else if (a === 'demandas') { marcarMenu('#/demandas'); await vDemandas(qs, seq); }
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
  // Visão geral
  // ------------------------------------------------------------------
  let periodo = Number(store.get('gbf_periodo')) || 30;

  async function vVisao(seq) {
    titulo('Visão geral');
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
        ${sel('prioridade', [[4, 'Urgente'], [3, 'Alta'], [2, 'Média'], [1, 'Baixa']], f.prioridade, 'Prioridade')}
        <input type="date" class="form-control form-control-sm" data-f="de" value="${esc(f.de || '')}" title="Aberta a partir de">
        <input type="date" class="form-control form-control-sm" data-f="ate" value="${esc(f.ate || '')}" title="Aberta até">
      </div>
      <div class="small-muted mb-2">${lista.length} demanda(s)${lista.length >= 300 ? ' — mostrando as primeiras 300, refine os filtros' : ''}</div>
      ${lista.length ? `
      <div class="card-x p-0 hide-mobile"><div class="table-wrap"><table class="table-x">
        <thead><tr><th>Nº</th><th>Demanda</th><th>Status</th><th>Prioridade</th><th>Técnico Orcim</th><th>Aberta em</th><th>Tempo</th><th>Prazo</th><th>Nossas atividades</th></tr></thead>
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
    const [t, users, demandas] = await Promise.all([
      id ? API.get(`/atividades/${encodeURIComponent(id)}`) : null,
      ehGestor() ? carregarUsuarios() : [],
      API.get('/demandas?situacao=todas&limite=400'),
    ]);
    if (seq !== renderSeq) return;
    titulo(id ? 'Editar atividade' : 'Nova atividade');
    const demandaSel = t ? t.ticket_id : qs.get('demanda');
    const opcoesDemanda = demandas
      .filter((d) => d.aberto || String(d.id) === String(demandaSel))
      .map((d) => `<option value="${d.id}" ${String(d.id) === String(demandaSel) ? 'selected' : ''}>${esc(d.number || '#' + d.id)} — ${esc(d.title)} (${esc(d.entity_name)})</option>`).join('');
    view().innerHTML = `
      <a href="${id ? `#/atividades/${id}` : '#/atividades'}" class="small-muted text-decoration-none"><i class="bi bi-arrow-left"></i> Voltar</a>
      <form class="card-x mt-2" id="form-at" style="max-width:760px">
        <div class="mb-3"><label class="form-label">O que precisa ser feito *</label>
          <input class="form-control" name="title" maxlength="200" required value="${esc(t?.title || '')}"></div>
        <div class="mb-3"><label class="form-label">Detalhes</label>
          <textarea class="form-control" name="description" rows="4">${esc(t?.description || '')}</textarea></div>
        <div class="row g-3 mb-3">
          <div class="col-sm-6"><label class="form-label">Prazo</label><input type="datetime-local" class="form-control" name="due_at" value="${paraInputLocal(t?.due_at)}"></div>
          <div class="col-sm-6"><label class="form-label">Prioridade</label><select class="form-select" name="priority">
            ${[1, 2, 3, 4].map((p) => `<option value="${p}" ${(t?.priority || 2) === p ? 'selected' : ''}>${PRIO_TAREFA[p]}</option>`).join('')}</select></div>
          ${ehGestor() ? `<div class="col-sm-6"><label class="form-label">Responsável</label><select class="form-select" name="assignee_id">
            <option value="">Sem responsável</option>${users.map((u) => `<option value="${u.id}" ${String(t ? t.assignee_id : EU.id) === String(u.id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>` : ''}
          <div class="col-sm-6"><label class="form-label">Local / unidade</label><input class="form-control" name="location" value="${esc(t?.location || '')}" placeholder="Ex.: Posto Centro, sala do servidor"></div>
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
      };
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
  // Configurações (gestor)
  // ------------------------------------------------------------------
  async function vConfig(seq) {
    titulo('Configurações');
    const c = await API.get('/config');
    if (seq !== renderSeq) return;
    const marcadas = new Set(c.entidades.map(String));
    view().innerHTML = `
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
      ${EU.must_change_password ? '<div class="alert alert-warning" style="max-width:520px"><i class="bi bi-shield-lock"></i> Primeiro acesso: defina uma senha só sua para continuar.</div>' : ''}
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
    }).catch(() => {});
    if (!API.token) { mostrarLogin(); return; }
    try {
      await entrar(await API.get('/auth/me'));
    } catch {
      mostrarLogin();
    }
  })();
})();
