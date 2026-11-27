// ---------------------------------------------------------------
// Views.tickets — Chamados em Quadro (Kanban), Lista ou Calendário
//   opts.team = true     → "Chamados da Equipe" (gestor: todos das suas empresas)
//   opts.watching = true → "Chamados a observar"
//   (padrao)             → equipe: todos; cliente: os proprios
//
// Quadro: colunas por Status, Urgencia ou Localidade. Arrastar um cartao
// para outra coluna muda o status / a urgencia / a localidade do chamado.
// A cor de cada cartao vem da urgencia.
// ---------------------------------------------------------------

// Cor por prioridade interna da urgencia (4 = operacao parada ... 1 = requisicao)
const URGENCY_TONE = { 4: 'u-stop', 3: 'u-soon', 2: 'u-slow', 1: 'u-req' };

const BOARD_STATUS = [
  { id: 1, label: 'Novo' },
  { id: 2, label: 'Atribuído' },
  { id: 3, label: 'Em andamento' },
  { id: 4, label: 'Em pausa' },
  { id: 5, label: 'Resolvido' },
  { id: 6, label: 'Fechado', closed: true },
  { id: 7, label: 'Cancelado', closed: true },
];

const SORTS = {
  urgency: { label: 'Mais urgente primeiro', fn: (a, b) => (b.priority - a.priority) || (new Date(a.created_at) - new Date(b.created_at)) },
  oldest: { label: 'Mais antigo primeiro', fn: (a, b) => new Date(a.created_at) - new Date(b.created_at) },
  newest: { label: 'Mais recente primeiro', fn: (a, b) => new Date(b.created_at) - new Date(a.created_at) },
  needed: { label: 'Precisa até (data)', fn: (a, b) => (a.needed_by ? new Date(a.needed_by) : Infinity) - (b.needed_by ? new Date(b.needed_by) : Infinity) },
  updated: { label: 'Atualizado por último', fn: (a, b) => new Date(b.updated_at) - new Date(a.updated_at) },
};

function loadBoardPrefs(key) {
  try { return JSON.parse(localStorage.getItem('board_prefs_' + key)) || {}; } catch { return {}; }
}
function saveBoardPrefs(key, prefs) {
  try { localStorage.setItem('board_prefs_' + key, JSON.stringify(prefs)); } catch {}
}

Views.tickets = async function tickets(el, opts = {}) {
  const user = API.user || {};
  const isClient = Roles.isClient(user);
  const isManager = Roles.isManager(user);

  if (opts.team && !isManager) {
    location.hash = '#/tickets';
    toast('Apenas gestores acessam "Chamados da Equipe".', 'warning');
    return;
  }

  const prefKey = opts.watching ? 'watching' : opts.team ? 'team' : opts.mine ? 'mine' : 'main';
  const prefs = Object.assign({
    view: 'board', group: 'status', sort: 'urgency', q: '',
    locations: [], impacts: [], entities: [], assigned: '', showClosed: false, filtrosAbertos: false,
  }, loadBoardPrefs(prefKey));
  if (!Array.isArray(prefs.entities)) prefs.entities = [];
  const save = () => saveBoardPrefs(prefKey, prefs);

  let all = [];
  let levels = [];
  let locs = [];

  el.innerHTML = `
    ${(isManager && !opts.watching && !opts.mine) ? `<div class="d-flex justify-content-end mb-2">
          <a class="btn btn-sm btn-outline-primary" href="${opts.team ? '#/tickets' : '#/team-tickets'}">
            <i class="bi ${opts.team ? 'bi-ticket-detailed' : 'bi-people'}"></i> ${opts.team ? 'Meus chamados' : 'Chamados da equipe'}</a>
        </div>` : ''}

    <div class="board-toolbar ${prefs.filtrosAbertos ? 'show-adv' : ''}">
      <div class="tb-row">
        <div class="seg" role="group" aria-label="Modo de exibição">
          <button type="button" data-view="board" title="Quadro"><i class="bi bi-kanban"></i><span> Quadro</span></button>
          <button type="button" data-view="list" title="Lista"><i class="bi bi-list-ul"></i><span> Lista</span></button>
          <button type="button" data-view="calendar" title="Calendário"><i class="bi bi-calendar3"></i><span> Calendário</span></button>
        </div>
        <div class="tb-search">
          <i class="bi bi-search"></i>
          <input class="form-control form-control-sm" id="f-q" placeholder="Buscar por título ou número" value="${esc(prefs.q)}">
        </div>
        <button type="button" class="btn btn-sm btn-outline-secondary tb-toggle" id="tb-toggle" aria-expanded="${!!prefs.filtrosAbertos}">
          <i class="bi bi-sliders"></i> Filtros <span class="tb-n" id="tb-n"></span><i class="bi bi-chevron-down tb-seta"></i></button>
        <div class="tb-ativos" id="tb-ativos"></div>
        <a class="btn btn-primary btn-sm ms-auto" href="#/new"><i class="bi bi-plus-lg"></i><span class="tb-novo-tx"> Abrir chamado</span></a>
      </div>
      <div class="tb-painel tb-adv">
        <div class="tb-linha">
          <span class="tb-label">Mostrar</span>
          <select class="form-select form-select-sm tb-select" id="f-group" title="Organizar colunas por">
            <option value="status">Colunas: situação</option>
            <option value="impact">Colunas: urgência</option>
            <option value="location">Colunas: localização</option>
          </select>
          <select class="form-select form-select-sm tb-select" id="f-sort" title="Ordenar">
            ${Object.entries(SORTS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}
          </select>
          ${!isClient ? `
          <select class="form-select form-select-sm tb-select" id="f-assigned" title="Técnico">
            <option value="">Todos os técnicos</option>
            <option value="me">Atribuídos a mim</option>
            <option value="none">Sem técnico</option>
          </select>` : ''}
          <label class="tb-check"><input type="checkbox" id="f-closed"> Encerrados</label>
        </div>
        <div class="tb-linha"><span class="tb-label">Urgência</span><div id="f-impacts" class="chip-row"></div></div>
        <div class="tb-linha" id="f-entities-row"><span class="tb-label">Empresa</span><div id="f-entities" class="chip-row"></div></div>
        <div class="tb-linha" id="f-locations-row"><span class="tb-label">Localização</span><div id="f-locations" class="chip-row"></div></div>
      </div>
    </div>

    <div id="tickets-body">${spinner()}</div>`;

  // ---------------- controles ----------------
  const $ = (sel) => el.querySelector(sel);
  $('#f-group').value = prefs.group;
  $('#f-sort').value = prefs.sort;
  if ($('#f-assigned')) $('#f-assigned').value = prefs.assigned;
  $('#f-closed').checked = !!prefs.showClosed;

  $('#tb-toggle').addEventListener('click', () => {
    prefs.filtrosAbertos = el.querySelector('.board-toolbar').classList.toggle('show-adv');
    $('#tb-toggle').setAttribute('aria-expanded', String(prefs.filtrosAbertos));
    save();
  });
  const paintView = () => el.querySelectorAll('.seg button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === prefs.view));
  paintView();
  el.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    prefs.view = b.dataset.view; save(); paintView(); render();
  }));
  $('#f-group').addEventListener('change', (e) => { prefs.group = e.target.value; save(); render(); });
  $('#f-sort').addEventListener('change', (e) => { prefs.sort = e.target.value; save(); render(); });
  $('#f-assigned')?.addEventListener('change', (e) => { prefs.assigned = e.target.value; save(); load(); });
  $('#f-closed').addEventListener('change', (e) => { prefs.showClosed = e.target.checked; save(); load(); });
  let qTimer;
  $('#f-q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { prefs.q = e.target.value.trim(); save(); render(); }, 200);
  });

  function chip(active, label, attrs, tone) {
    return `<button type="button" class="f-chip ${tone || ''} ${active ? 'on' : ''}" ${attrs}>${label}</button>`;
  }

  // Urgências de todos os perfis de opções: mostra as do Padrão (ativas) e as que algum chamado
  // da lista usa; as de outro perfil levam o nome do perfil para não confundir.
  const urgVisivel = (l, usada) => !!usada || (!l.profile_id && l.active);
  const nomeUrg = (l) => (l.profile_name ? `${l.name} (${l.profile_name})` : l.name);

  function paintChips() {
    const counts = (key) => all.reduce((m, t) => { m[t[key]] = (m[t[key]] || 0) + 1; return m; }, {});
    const byImpact = counts('impact_id');
    $('#f-impacts').innerHTML = levels.filter((l) => urgVisivel(l, byImpact[l.id])).slice().sort((a, b) => b.priority - a.priority || b.sort_order - a.sort_order).map((l) =>
      chip(prefs.impacts.includes(String(l.id)),
        `<span class="dot"></span>${esc(nomeUrg(l))} <b>${byImpact[l.id] || 0}</b>`,
        `data-impact="${l.id}"`, URGENCY_TONE[l.priority])).join('');
    // Empresa: as que têm chamado na lista (ou estão escolhidas); só aparece se houver mais de uma
    const byEnt = counts('entity_id');
    const empresas = new Map();
    all.forEach((t) => { if (t.entity_id) empresas.set(String(t.entity_id), t.entity_name || 'Empresa'); });
    prefs.entities.forEach((id) => { if (!empresas.has(id)) empresas.set(id, (locs.find((l) => String(l.entity_id) === id) || {}).entity_name || 'Empresa'); });
    $('#f-entities-row').style.display = empresas.size > 1 || prefs.entities.length ? '' : 'none';
    $('#f-entities').innerHTML = [...empresas.entries()].sort((x, y) => x[1].localeCompare(y[1], 'pt-BR')).map(([id, nome]) =>
      chip(prefs.entities.includes(id), `<i class="bi bi-building"></i>${esc(nome)} <b>${byEnt[id] || 0}</b>`, `data-ent="${id}"`)).join('');
    const byLoc = counts('location_id');
    // Localização: só as das empresas escolhidas (se escolheu alguma)
    const usedLocs = locs.filter((l) => (byLoc[l.id] || prefs.locations.includes(String(l.id)))
      && (!prefs.entities.length || prefs.entities.includes(String(l.entity_id))));
    $('#f-locations-row').style.display = usedLocs.length ? '' : 'none';
    const multiEnt = new Set(usedLocs.map((l) => l.entity_id)).size > 1;
    $('#f-locations').innerHTML = usedLocs.map((l) =>
      chip(prefs.locations.includes(String(l.id)),
        `<i class="bi bi-geo-alt"></i>${esc(l.name)}${multiEnt ? ` <small>${esc(l.entity_name)}</small>` : ''} <b>${byLoc[l.id] || 0}</b>`,
        `data-loc="${l.id}"`)).join('') +
      (byLoc.null || byLoc.undefined ? chip(prefs.locations.includes('none'), `Sem localização <b>${(byLoc.null || 0) + (byLoc.undefined || 0)}</b>`, 'data-loc="none"') : '');
    el.querySelectorAll('[data-impact]').forEach((b) => b.addEventListener('click', () => {
      toggle(prefs.impacts, b.dataset.impact); save(); paintChips(); render();
    }));
    el.querySelectorAll('[data-loc]').forEach((b) => b.addEventListener('click', () => {
      toggle(prefs.locations, b.dataset.loc); save(); paintChips(); render();
    }));
    el.querySelectorAll('[data-ent]').forEach((b) => b.addEventListener('click', () => {
      toggle(prefs.entities, b.dataset.ent);
      // localização escolhida de empresa que saiu do filtro não vale mais
      if (prefs.entities.length) {
        prefs.locations = prefs.locations.filter((id) => id === 'none'
          || prefs.entities.includes(String((locs.find((l) => String(l.id) === id) || {}).entity_id)));
      }
      save(); paintChips(); render();
    }));
    pintarAtivos();
  }

  // Filtros ativos em chips pequenos ao lado do botão Filtros (clicar no × tira)
  function pintarAtivos() {
    const nomeLv = (id) => { const l = levels.find((x) => String(x.id) === id); return l ? nomeUrg(l) : 'Urgência'; };
    const nomeLoc = (id) => (id === 'none' ? 'Sem localização' : (locs.find((x) => String(x.id) === id) || {}).name || 'Localização');
    const nomeEnt = (id) => ((all.find((t) => String(t.entity_id) === id) || {}).entity_name
      || (locs.find((l) => String(l.entity_id) === id) || {}).entity_name || 'Empresa');
    const ativos = [
      ...prefs.impacts.map((id) => ({ tipo: 'impact', id, txt: nomeLv(id) })),
      ...prefs.entities.map((id) => ({ tipo: 'ent', id, txt: nomeEnt(id) })),
      ...prefs.locations.map((id) => ({ tipo: 'loc', id, txt: nomeLoc(id) })),
      ...(prefs.assigned ? [{ tipo: 'assigned', id: '', txt: prefs.assigned === 'me' ? 'Atribuídos a mim' : 'Sem técnico' }] : []),
      ...(prefs.showClosed ? [{ tipo: 'closed', id: '', txt: 'Com encerrados' }] : []),
    ];
    $('#tb-n').textContent = ativos.length ? String(ativos.length) : '';
    $('#tb-ativos').innerHTML = ativos.map((a) => `<button type="button" class="tb-ativo" data-tipo="${a.tipo}" data-id="${esc(a.id)}" title="Tirar este filtro">${esc(a.txt)} <i class="bi bi-x"></i></button>`).join('')
      + (ativos.length > 1 ? '<button type="button" class="tb-limpar" id="tb-limpar">limpar</button>' : '');
    el.querySelectorAll('.tb-ativo').forEach((b) => b.addEventListener('click', () => {
      const { tipo, id } = b.dataset;
      if (tipo === 'impact') toggle(prefs.impacts, id);
      if (tipo === 'ent') toggle(prefs.entities, id);
      if (tipo === 'loc') toggle(prefs.locations, id);
      if (tipo === 'assigned') { prefs.assigned = ''; if ($('#f-assigned')) $('#f-assigned').value = ''; save(); load(); return; }
      if (tipo === 'closed') { prefs.showClosed = false; $('#f-closed').checked = false; save(); load(); return; }
      save(); paintChips(); render();
    }));
    $('#tb-limpar')?.addEventListener('click', () => {
      const recarrega = !!prefs.assigned || prefs.showClosed;
      prefs.impacts = []; prefs.entities = []; prefs.locations = []; prefs.assigned = ''; prefs.showClosed = false;
      if ($('#f-assigned')) $('#f-assigned').value = '';
      $('#f-closed').checked = false;
      save();
      if (recarrega) load(); else { paintChips(); render(); }
    });
  }
  const toggle = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); };

  // ---------------- dados ----------------
  async function load() {
    const p = new URLSearchParams();
    p.set('status', prefs.showClosed ? 'all' : 'open');
    p.set('limit', '500');
    if (opts.watching) p.set('watching', 'me');
    else if (opts.mine) p.set('mine', 'me');
    else if (isClient && !opts.team) p.set('requester', 'me');
    if (prefs.assigned) p.set('assigned', prefs.assigned);
    try {
      all = await API.get('/tickets?' + p.toString());
      paintChips();
      render();
    } catch (e) {
      $('#tickets-body').innerHTML = emptyState('Não foi possível carregar os chamados', e.message, 'bi-exclamation-triangle');
    }
  }

  function filtered() {
    const q = prefs.q.toLowerCase();
    return all.filter((t) =>
      (!q || `${t.number} ${t.numero_antigo || ''} ${t.title} ${t.requester_name || ''}`.toLowerCase().includes(q))
      && (!prefs.impacts.length || prefs.impacts.includes(String(t.impact_id)))
      && (!prefs.entities.length || prefs.entities.includes(String(t.entity_id)))
      && (!prefs.locations.length || prefs.locations.includes(t.location_id ? String(t.location_id) : 'none')))
      .sort(SORTS[prefs.sort]?.fn || SORTS.urgency.fn);
  }

  // ---------------- colunas ----------------
  function columns(list) {
    if (prefs.group === 'impact') {
      const cols = levels.filter((l) => urgVisivel(l, list.some((t) => String(t.impact_id) === String(l.id)))).slice().sort((a, b) => b.priority - a.priority || b.sort_order - a.sort_order).map((l) => ({
        key: String(l.id), label: nomeUrg(l), tone: URGENCY_TONE[l.priority], drop: { impact_id: l.id },
      }));
      if (list.some((t) => !t.impact_id)) cols.push({ key: 'none', label: 'Sem urgência', drop: null });
      return cols.map((c) => ({ ...c, items: list.filter((t) => String(t.impact_id || 'none') === c.key) }));
    }
    if (prefs.group === 'location') {
      const used = new Map();
      list.forEach((t) => used.set(String(t.location_id || 'none'), t));
      const cols = locs.filter((l) => used.has(String(l.id)))
        .map((l) => ({ key: String(l.id), label: l.name, sub: l.entity_name, entity_id: l.entity_id, drop: { location_id: l.id } }));
      if (used.has('none')) cols.push({ key: 'none', label: 'Sem localização', drop: null });
      return cols.map((c) => ({ ...c, items: list.filter((t) => String(t.location_id || 'none') === c.key) }));
    }
    return BOARD_STATUS.filter((s) => !s.closed || prefs.showClosed).map((s) => ({
      key: String(s.id), label: s.label, status: s.id, drop: { status: s.id },
      items: list.filter((t) => t.status === s.id),
    }));
  }

  function card(t) {
    const tone = URGENCY_TONE[t.priority] || 'u-req';
    const late = t.due_at && ![5, 6, 7].includes(t.status) && new Date(t.due_at) < new Date();
    const needSoon = t.needed_by && ![5, 6, 7].includes(t.status)
      && new Date(String(t.needed_by).slice(0, 10) + 'T23:59:59') - new Date() < 86400000 * 2;
    const initials = (n) => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
    const shortNum = t.number || String(t.id);
    const cat = t.display_category ? String(t.display_category).split(' > ').pop() : '';
    const semTec = window.semTecnicoParaMim && window.semTecnicoParaMim(t);
    return `
      <article class="kcard ${tone} ${(window.temNovidade && window.temNovidade(t.id)) || semTec ? 'atencao' : ''}" data-sem-tecnico="${semTec ? 1 : 0}" data-id="${t.id}" tabindex="0" aria-label="Chamado ${esc(t.number)}: ${esc(t.title)}">
        <header>
          <span class="kurg"><i></i>${esc(t.impact_name || LABELS.priority[t.priority] || '')}</span>
          <span class="knum" title="Chamado ${esc(t.number)} · aberto em ${fmt.dateTime(t.created_at)}">${esc(shortNum)} · ${fmt.timeAgo(t.created_at)}</span>
          <span class="knovo ${window.temNovidade && window.temNovidade(t.id) ? '' : 'd-none'}" data-tk-novidade="${t.id}" title="Teve novidade desde a última vez que você abriu"><i class="bi bi-bell-fill"></i></span>
        </header>
        <h4>${esc(t.title)}</h4>
        ${(t.location_name || cat || prefs.group !== 'status') ? `
        <div class="kmeta">
          ${t.location_name ? `<span class="kloc"><i class="bi bi-geo-alt-fill"></i>${esc(t.location_name)}</span>` : ''}
          ${cat ? `<span class="kcat" title="${esc(t.display_category)}">${esc(cat)}</span>` : ''}
          ${prefs.group !== 'status' ? `<span class="kstatus">${esc(LABELS.status[t.status])}</span>` : ''}
        </div>` : ''}
        <footer>
          <span class="kreq" title="Solicitante: ${esc(t.requester_name || '')}"><i class="bi bi-person"></i>${esc(t.requester_name || '')}</span>
          ${late ? `<span class="kflag late" title="Prazo (SLA) vencido"><i class="bi bi-alarm-fill"></i></span>` : ''}
          ${needSoon ? `<span class="kflag need" title="Precisa até ${fmt.date(String(t.needed_by).slice(0, 10) + 'T12:00:00')}"><i class="bi bi-calendar-event-fill"></i></span>` : ''}
          ${t.approval_status === 'pending' ? `<span class="kflag appr" title="Aguardando aprovação"><i class="bi bi-hourglass-split"></i></span>` : ''}
          ${t.asset_pendente ? '<span class="kflag need" title="Falta marcar o equipamento: o usuário não encontrou a etiqueta"><i class="bi bi-upc-scan"></i></span>' : ''}
          ${canDrag(t) ? `<button type="button" class="kmove" data-move="${t.id}" title="Mover para outra coluna" aria-label="Mover chamado ${esc(t.number)} para outra coluna"><i class="bi bi-arrow-left-right"></i></button>` : ''}
          ${t.assigned_name
            ? `<span class="kavatar" title="Técnico: ${esc(t.assigned_name)}">${esc(initials(t.assigned_name))}</span>`
            : `<span class="ksem ${semTec ? 'pisca-anel' : ''}" title="Ninguém pegou este chamado ainda"><i class="bi bi-person-plus"></i>Não atribuído</span>`}
        </footer>
      </article>`;
  }

  function render() {
    const body = $('#tickets-body');
    if (!body) return;
    const list = filtered();
    if (prefs.view === 'list') return renderList(list, body);
    if (prefs.view === 'calendar') return renderCalendar(list, body);
    const cols = columns(list);
    if (!all.length) {
      body.innerHTML = emptyState('Nenhum chamado por aqui', 'Abra um chamado em "Novo chamado".', 'bi-kanban');
      return;
    }
    // guarda onde a pessoa estava no quadro (coluna e rolagem) para não voltar ao começo
    const antes = body.querySelector('#board');
    const rolagem = antes ? {
      x: antes.scrollLeft,
      cols: Object.fromEntries([...antes.querySelectorAll('.kcol')].map((c) => [c.dataset.key, c.querySelector('.kcol-body')?.scrollTop || 0])),
    } : null;
    body.innerHTML = `
      <div class="board sem-sigla ${canDragAny() ? '' : 'readonly'}" id="board">
        ${cols.map((c) => `
          <section class="kcol ${c.tone || ''} ${c.items.length ? '' : 'is-empty'}" data-key="${esc(c.key)}">
            <header class="kcol-head">
              <span class="kcol-title">${c.tone ? '<span class="dot"></span>' : ''}${esc(c.label)}</span>
              ${c.sub ? `<small>${esc(c.sub)}</small>` : ''}
              <span class="kcount">${c.items.length}</span>
            </header>
            <div class="kcol-body">
              ${c.items.map(card).join('') || '<div class="kempty">Nenhum chamado</div>'}
            </div>
          </section>`).join('')}
      </div>
      ${canDragAny() ? '<p class="board-tip"><i class="bi bi-arrows-move"></i> Arraste um cartão para outra coluna para mudar o chamado. No celular, segure o cartão por um instante antes de arrastar.</p>' : ''}`;
    if (rolagem) {
      const b = body.querySelector('#board');
      b.scrollLeft = rolagem.x;
      b.querySelectorAll('.kcol').forEach((c) => {
        const corpo = c.querySelector('.kcol-body');
        if (corpo && rolagem.cols[c.dataset.key]) corpo.scrollTop = rolagem.cols[c.dataset.key];
      });
    }
    body.querySelectorAll('.kcard').forEach((c) => {
      c.addEventListener('click', (e) => {
        if (e.target.closest('.kmove')) return;
        if (!Board.justDragged) location.hash = `#/tickets/${c.dataset.id}`;
      });
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.target.closest('.kmove')) location.hash = `#/tickets/${c.dataset.id}`; });
    });
    // "Mover para…": alternativa ao arrastar (mais fácil no celular e no teclado)
    body.querySelectorAll('.kmove').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = all.find((x) => String(x.id) === b.dataset.move);
      const atual = cols.find((c) => c.items.includes(t));
      abrirMenuMover(b, cols.filter((c) => c.drop && c !== atual), (col) => onDrop(t, col));
    }));
    if (canDragAny()) {
      Board.enable(body.querySelector('#board'), {
        canDrag: (id) => canDrag(all.find((t) => String(t.id) === String(id))),
        onDrop: (id, key) => onDrop(all.find((t) => String(t.id) === String(id)), cols.find((c) => c.key === key)),
      });
    }
  }

  // ---------------- arrastar e soltar ----------------
  // Quem pode arrastar depende das permissoes do perfil
  const myEnts = new Set([user.entity_id, ...(user.extra_entity_ids || [])].filter(Boolean).map(String));
  const P = (perm) => Roles.can(user, perm);
  const canDragAny = () => prefs.group !== 'none'
    && (P('ticket.status_any') || P('ticket.triage') || P('ticket.work') || P('ticket.take'));
  function inMyScope(t) { return P('ticket.view_all') || myEnts.has(String(t.entity_id)); }
  function canDrag(t) {
    if (!t) return false;
    if (Roles.isMaster(user)) return true;
    if ((P('ticket.status_any') || P('ticket.triage')) && inMyScope(t)) return true;
    if (P('ticket.work') && String(t.assigned_user_id) === String(user.id)) return true;
    if (P('ticket.take') && !t.assigned_user_id && prefs.group === 'status') return true;
    return false;
  }

  // Mudanca rapida com "Desfazer" (so quando voltar e simples e seguro)
  function avisoComDesfazer(msg, desfazer) {
    toast(msg, 'success', desfazer ? { acao: { texto: 'Desfazer', aoClicar: async () => {
      try { await desfazer(); toast('Desfeito.', 'info'); } catch (e) { showError(e); }
      load();
    } } } : {});
  }

  async function onDrop(t, col) {
    if (!t || !col || !col.drop) return;
    try {
      if (col.drop.status !== undefined) {
        const to = col.drop.status;
        const de = t.status;
        if (to === de) return;
        if (to === 5 || (to === 6 && (de !== 5 || t.awaiting_evaluation))) { TicketModals.resolve(t, { toStatus: to, onDone: load, onCancel: render }); return; }
        if (to === 4) { TicketModals.pause(t, { onDone: load, onCancel: render }); return; }
        if (to === 2 && !t.assigned_user_id) {
          if (P('ticket.take') && !P('ticket.assign')) { await API.post(`/tickets/${t.id}/assign`, { assumir: true }); toast(`${t.number} assumido por você.`, 'success'); return load(); }
          TicketModals.assign(t, { onDone: load, onCancel: render }); return;
        }
        await API.post(`/tickets/${t.id}/status`, { status: to });
        const simples = [1, 2, 3].includes(de) && [1, 2, 3].includes(to);
        avisoComDesfazer(`${t.number} → ${LABELS.status[to]}`,
          simples ? () => API.post(`/tickets/${t.id}/status`, { status: de }) : null);
      } else if (col.drop.impact_id !== undefined) {
        if (String(col.drop.impact_id) === String(t.impact_id)) return;
        const de = t.impact_id;
        await API.patch(`/tickets/${t.id}`, { impact_id: col.drop.impact_id });
        avisoComDesfazer(`${t.number}: urgência alterada para ${col.label}`,
          de ? () => API.patch(`/tickets/${t.id}`, { impact_id: de }) : null);
      } else if (col.drop.location_id !== undefined) {
        if (String(col.drop.location_id) === String(t.location_id)) return;
        if (col.entity_id && String(col.entity_id) !== String(t.entity_id)) {
          toast('Essa localização é de outra empresa.', 'warning'); return render();
        }
        const de = t.location_id;
        await API.patch(`/tickets/${t.id}`, { location_id: col.drop.location_id });
        avisoComDesfazer(`${t.number} movido para ${col.label}`,
          de ? () => API.patch(`/tickets/${t.id}`, { location_id: de }) : null);
      }
    } catch (e) {
      if (e.data?.request_approval || e.data?.resolution_form) {
        TicketModals.resolve(t, { toStatus: col.drop.status === 6 ? 6 : 5, onDone: load, onCancel: render }); return;
      }
      showError(e);
    }
    load();
  }

  // ---------------- lista ----------------
  // ---------------- calendário ----------------
  // Mesmo calendario do Painel (jeito do Sistema TI GBF): cada chamado aparece no dia escolhido
  // (precisa até / aberto em / prazo SLA); passar o mouse mostra a previa e clicar abre a lista do dia.
  const CAL_DATAS = {
    needed: { label: 'Precisa até', get: (t) => t.needed_by },
    created: { label: 'Aberto em', get: (t) => t.created_at },
    due: { label: 'Prazo (SLA)', get: (t) => t.due_at },
  };
  const diaLocal = (v) => {
    if (!v) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(String(v)) && String(v).length <= 10) return String(v).slice(0, 10);
    const d = new Date(v);
    return isNaN(d) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  Views.tickets._calState = Views.tickets._calState || {};
  if (!CAL_DATAS[prefs.calDate]) prefs.calDate = 'needed';

  function renderCalendar(list, body) {
    const dataEscolhida = CAL_DATAS[prefs.calDate];
    const semData = list.filter((t) => !diaLocal(dataEscolhida.get(t))).length;
    body.innerHTML = `
      <div class="card panel-card"><div class="card-body"><div id="tcal-cg"></div>
        ${semData ? `<div class="cg-resumo"><i class="bi bi-info-circle"></i> ${semData} chamado(s) sem "${dataEscolhida.label.toLowerCase()}" não aparecem no calendário.</div>` : ''}
      </div></div>`;
    CalendarUI.grade(body.querySelector('#tcal-cg'), {
      state: Views.tickets._calState,
      load: () => list,
      dateOf: (t) => diaLocal(dataEscolhida.get(t)),
      dateLabel: dataEscolhida.label,
      atraso: prefs.calDate !== 'created',
      nota: `Cada chamado aparece no dia de "${dataEscolhida.label}". Os filtros acima também valem aqui.`,
      ferramentas: `<label class="small text-muted d-flex align-items-center gap-1 mb-0">Data:
          <select class="form-select form-select-sm" id="tcal-data" style="width:auto">
            ${Object.entries(CAL_DATAS).map(([k, v]) => `<option value="${k}" ${k === prefs.calDate ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select></label>`,
      onFerramentas: (cal) => {
        cal.querySelector('#tcal-data').onchange = (e) => { prefs.calDate = e.target.value; save(); render(); };
      },
    });
  }

  function renderList(list, body) {
    if (!list.length) {
      body.innerHTML = emptyState('Nenhum chamado encontrado', 'Mude os filtros ou abra um novo chamado.', 'bi-search');
      return;
    }
    body.innerHTML = `
      <div class="card panel-card"><div class="table-responsive">
        <table class="table table-hover align-middle mb-0 ticket-table">
          <thead><tr>
            <th>Chamado</th><th>Status</th><th>Urgência</th><th>Localização</th><th>Técnico</th><th>Solicitante</th><th>Aberto</th>
          </tr></thead>
          <tbody>
            ${list.map((t) => `
              <tr class="ticket-row ${URGENCY_TONE[t.priority] || ''} ${(window.temNovidade && window.temNovidade(t.id)) || (window.semTecnicoParaMim && window.semTecnicoParaMim(t)) ? 'atencao' : ''}" data-sem-tecnico="${window.semTecnicoParaMim && window.semTecnicoParaMim(t) ? 1 : 0}" data-id="${t.id}">
                <td class="tk-col"><div class="tk-linha"><span class="tk-num">${esc(t.number)}</span>
                  <span class="knovo ${window.temNovidade && window.temNovidade(t.id) ? '' : 'd-none'}" data-tk-novidade="${t.id}" title="Teve novidade desde a última vez que você abriu"><i class="bi bi-bell-fill"></i></span>
                  <span class="tk-tit" title="${esc(t.title)}">${esc(t.title)}</span></div>
                  <small class="text-muted">${esc(t.display_category || '')}</small></td>
                <td>${badgeStatus(t.status)}</td>
                <td>${badgeImpact(t)}</td>
                <td>${esc(t.location_name || '—')}<br><small class="text-muted multi-empresa">${esc(t.entity_name || '')}</small></td>
                <td>${t.assigned_name ? esc(t.assigned_name) : window.semTecnicoParaMim && window.semTecnicoParaMim(t) ? '<span class="ksem pisca-anel"><i class="bi bi-person-plus"></i>Não atribuído</span>' : '<span class="text-muted">—</span>'}</td>
                <td>${esc(t.requester_name || '—')}</td>
                <td class="text-muted small" title="${fmt.dateTime(t.created_at)}">${fmt.timeAgo(t.created_at)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div></div>`;
    body.querySelectorAll('.ticket-row').forEach((row) => {
      row.addEventListener('click', () => { location.hash = `#/tickets/${row.dataset.id}`; });
    });
  }

  // atualizacao em tempo real (chamada pelo socket em app.js)
  // espera um instante e junta várias mudanças seguidas numa atualização só
  let esperaRefresh = null;
  Views.tickets.refresh = () => {
    clearTimeout(esperaRefresh);
    esperaRefresh = setTimeout(() => {
      if (Board.dragging || document.querySelector('.menu-mover')) return Views.tickets.refresh();
      if (document.body.contains(el.querySelector('#tickets-body'))) load();
    }, 600);
  };

  try {
    [levels, locs] = await Promise.all([
      API.get('/impact-levels?all=true&todos=true').catch(() => []),
      API.get('/locations').catch(() => []),
    ]);
  } catch {}
  await load();
};

// ---------------------------------------------------------------
// Board — arrastar e soltar com mouse e toque (sem bibliotecas)
//   Mouse: arrasta ao mover com o botao pressionado.
//   Toque: segure o cartao ~0,3s e arraste (assim a rolagem continua normal).
// ---------------------------------------------------------------
const Board = {
  dragging: false,
  justDragged: false,
  ctx: null,   // { board, canDrag, onDrop } do quadro atual
  st: null,    // estado do arraste em andamento
  installed: false,

  enable(board, { canDrag, onDrop }) {
    if (!board) return;
    Board.ctx = { board, canDrag, onDrop };
    Board.install();
    // mouse
    board.addEventListener('mousedown', (e) => {
      if (e.target.closest('.kmove')) return;
      const c = e.target.closest('.kcard');
      if (!c || e.button !== 0 || !canDrag(c.dataset.id)) return;
      Board.st = { sx: e.clientX, sy: e.clientY, pending: c };
      e.preventDefault();
    });
    // toque: segurar ~0,3s para arrastar (assim a rolagem continua normal)
    board.addEventListener('touchstart', (e) => {
      if (e.target.closest('.kmove')) return;
      const c = e.target.closest('.kcard');
      if (!c || !canDrag(c.dataset.id)) return;
      const t = e.touches[0];
      const st = { sx: t.clientX, sy: t.clientY, pending: c };
      st.timer = setTimeout(() => {
        if (Board.st !== st) return;
        if (navigator.vibrate) navigator.vibrate(15);
        Board.start(c, st.sx, st.sy);
      }, 280);
      Board.st = st;
    }, { passive: true });
    board.addEventListener('touchmove', (e) => {
      const st = Board.st;
      if (!st) return;
      const t = e.touches[0];
      if (!st.ghost) {
        if (Math.hypot(t.clientX - st.sx, t.clientY - st.sy) > 8) { clearTimeout(st.timer); Board.st = null; }
        return;
      }
      e.preventDefault();
      Board.move(t.clientX, t.clientY);
    }, { passive: false });
    board.addEventListener('touchend', (e) => {
      const st = Board.st;
      if (!st) return;
      const t = e.changedTouches[0];
      if (st.ghost) e.preventDefault();
      Board.finish(t.clientX, t.clientY, false);
    });
    board.addEventListener('touchcancel', () => Board.finish(0, 0, true));
  },

  // ouvintes globais do mouse: instalados uma unica vez
  install() {
    if (Board.installed) return;
    Board.installed = true;
    window.addEventListener('mousemove', (e) => {
      const st = Board.st;
      if (!st) return;
      if (!st.ghost && Math.hypot(e.clientX - st.sx, e.clientY - st.sy) > 6) Board.start(st.pending, e.clientX, e.clientY);
      else Board.move(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', (e) => { if (Board.st) Board.finish(e.clientX, e.clientY, false); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && Board.st) Board.finish(0, 0, true); });
  },

  colAt(x, y) {
    const elAt = document.elementFromPoint(x, y);
    return elAt ? elAt.closest('.kcol') : null;
  },

  start(cardEl, x, y) {
    const st = Board.st;
    if (!st || !document.body.contains(cardEl)) { Board.st = null; return; }
    const r = cardEl.getBoundingClientRect();
    const ghost = cardEl.cloneNode(true);
    ghost.classList.add('kghost');
    ghost.style.width = r.width + 'px';
    document.body.appendChild(ghost);
    cardEl.classList.add('kplaceholder');
    Object.assign(st, { cardEl, ghost, dx: x - r.left, dy: y - r.top, over: null });
    Board.dragging = true;
    document.body.classList.add('is-dragging');
    Board.move(x, y);
  },

  move(x, y) {
    const st = Board.st;
    if (!st || !st.ghost) return;
    st.ghost.style.transform = `translate(${x - st.dx}px, ${y - st.dy}px) rotate(1.5deg)`;
    const col = Board.colAt(x, y);
    if (col !== st.over) {
      st.over?.classList.remove('kover');
      col?.classList.add('kover');
      st.over = col;
    }
    // rola o quadro perto das bordas
    const board = Board.ctx?.board;
    if (board) {
      const br = board.getBoundingClientRect();
      if (x > br.right - 60) board.scrollLeft += 18;
      else if (x < br.left + 60) board.scrollLeft -= 18;
    }
  },

  finish(x, y, cancel) {
    const st = Board.st;
    Board.st = null;
    if (!st) return;
    clearTimeout(st.timer);
    if (!st.ghost) return;
    const col = cancel ? null : Board.colAt(x, y);
    st.ghost.remove();
    st.cardEl.classList.remove('kplaceholder');
    st.over?.classList.remove('kover');
    document.body.classList.remove('is-dragging');
    Board.dragging = false;
    Board.justDragged = true;
    setTimeout(() => { Board.justDragged = false; }, 50);
    const fromCol = st.cardEl.closest('.kcol');
    if (col && col !== fromCol && Board.ctx) Board.ctx.onDrop(st.cardEl.dataset.id, col.dataset.key);
  },
};

// Menu "Mover para…" do cartão do quadro
function abrirMenuMover(botao, colunas, escolher) {
  document.querySelector('.menu-mover')?.remove();
  const menu = document.createElement('div');
  menu.className = 'dropdown-menu show menu-mover';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `<h6 class="dropdown-header">Mover para…</h6>` + (colunas.length
    ? colunas.map((c, i) => `<button type="button" class="dropdown-item" role="menuitem" data-i="${i}">${esc(c.label)}</button>`).join('')
    : '<span class="dropdown-item-text text-muted small">Nenhuma outra coluna</span>');
  document.body.appendChild(menu);
  const r = botao.getBoundingClientRect();
  const larg = menu.offsetWidth, alt = menu.offsetHeight;
  menu.style.position = 'fixed';
  menu.style.left = Math.max(8, Math.min(r.right - larg, window.innerWidth - larg - 8)) + 'px';
  menu.style.top = (r.bottom + alt + 8 > window.innerHeight ? Math.max(8, r.top - alt - 4) : r.bottom + 4) + 'px';
  const fechar = () => { menu.remove(); document.removeEventListener('click', foraDoMenu, true); document.removeEventListener('keydown', tecla); botao.focus(); };
  const foraDoMenu = (e) => { if (!menu.contains(e.target)) { e.stopPropagation(); fechar(); } };
  const tecla = (e) => { if (e.key === 'Escape') fechar(); };
  setTimeout(() => { document.addEventListener('click', foraDoMenu, true); document.addEventListener('keydown', tecla); }, 0);
  menu.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { const c = colunas[Number(b.dataset.i)]; fechar(); escolher(c); }));
  menu.querySelector('[data-i]')?.focus();
}
