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
  { id: 4, label: 'Pendente' },
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
    locations: [], impacts: [], assigned: '', entity: '', showClosed: false,
  }, loadBoardPrefs(prefKey));
  const save = () => saveBoardPrefs(prefKey, prefs);

  let all = [];
  let levels = [];
  let locs = [];

  el.innerHTML = `
    ${(isManager && !opts.watching && !opts.mine) ? `<div class="d-flex justify-content-end mb-2">
          <a class="btn btn-sm btn-outline-primary" href="${opts.team ? '#/tickets' : '#/team-tickets'}">
            <i class="bi ${opts.team ? 'bi-person-lines-fill' : 'bi-people'}"></i> ${opts.team ? 'Meus chamados' : 'Chamados da equipe'}</a>
        </div>` : ''}

    <div class="board-toolbar">
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
        <button type="button" class="btn btn-sm btn-outline-secondary tb-toggle" id="tb-toggle"><i class="bi bi-sliders"></i> Filtros</button>
        <select class="form-select form-select-sm tb-select tb-adv" id="f-group" title="Organizar colunas por">
          <option value="status">Colunas: status</option>
          <option value="impact">Colunas: urgência</option>
          <option value="location">Colunas: localidade</option>
        </select>
        <select class="form-select form-select-sm tb-select tb-adv" id="f-sort" title="Ordenar">
          ${Object.entries(SORTS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}
        </select>
        ${!isClient ? `
        <select class="form-select form-select-sm tb-select tb-adv" id="f-assigned" title="Técnico">
          <option value="">Todos os técnicos</option>
          <option value="me">Atribuídos a mim</option>
          <option value="none">Sem técnico</option>
        </select>` : ''}
        <select class="form-select form-select-sm tb-select tb-adv" id="f-entity" title="Empresa" style="display:none"></select>
        <label class="tb-check tb-adv"><input type="checkbox" id="f-closed"> Mostrar encerrados</label>
        <a class="btn btn-primary btn-sm ms-auto" href="#/new"><i class="bi bi-plus-lg"></i> Novo chamado</a>
      </div>
      <div class="tb-row tb-chips tb-adv">
        <span class="tb-label">Urgência</span>
        <div id="f-impacts" class="chip-row"></div>
      </div>
      <div class="tb-row tb-chips tb-adv" id="f-locations-row">
        <span class="tb-label">Localidade</span>
        <div id="f-locations" class="chip-row"></div>
      </div>
    </div>

    <div id="tickets-body">${spinner()}</div>`;

  // ---------------- controles ----------------
  const $ = (sel) => el.querySelector(sel);
  $('#f-group').value = prefs.group;
  $('#f-sort').value = prefs.sort;
  if ($('#f-assigned')) $('#f-assigned').value = prefs.assigned;
  $('#f-closed').checked = !!prefs.showClosed;

  $('#tb-toggle').addEventListener('click', () => el.querySelector('.board-toolbar').classList.toggle('show-adv'));
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
  $('#f-entity').addEventListener('change', (e) => { prefs.entity = e.target.value; save(); load(); });
  let qTimer;
  $('#f-q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { prefs.q = e.target.value.trim(); save(); render(); }, 200);
  });

  // empresas (equipe, ou gestor com mais de uma)
  const mine = new Set([user.entity_id, ...(user.extra_entity_ids || [])].filter(Boolean).map(String));
  if (Roles.isStaff(user) || (isManager && mine.size > 1)) {
    API.get('/entities').then((ents) => {
      const sel = $('#f-entity');
      if (!sel) return;
      const list = ents.filter((e) => e.active && (Roles.isStaff(user) || mine.has(String(e.id))));
      if (list.length < 2) return;
      sel.innerHTML = '<option value="">Todas as empresas</option>' +
        list.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
      sel.value = prefs.entity;
      sel.style.display = '';
    }).catch(() => {});
  }

  function chip(active, label, attrs, tone) {
    return `<button type="button" class="f-chip ${tone || ''} ${active ? 'on' : ''}" ${attrs}>${label}</button>`;
  }

  function paintChips() {
    const counts = (key) => all.reduce((m, t) => { m[t[key]] = (m[t[key]] || 0) + 1; return m; }, {});
    const byImpact = counts('impact_id');
    $('#f-impacts').innerHTML = levels.filter((l) => l.active || byImpact[l.id]).slice().sort((a, b) => b.priority - a.priority || b.sort_order - a.sort_order).map((l) =>
      chip(prefs.impacts.includes(String(l.id)),
        `<span class="dot"></span>${esc(l.name)} <b>${byImpact[l.id] || 0}</b>`,
        `data-impact="${l.id}"`, URGENCY_TONE[l.priority])).join('');
    const byLoc = counts('location_id');
    const usedLocs = locs.filter((l) => byLoc[l.id] || prefs.locations.includes(String(l.id)));
    $('#f-locations-row').style.display = usedLocs.length ? '' : 'none';
    const multiEnt = new Set(usedLocs.map((l) => l.entity_id)).size > 1;
    $('#f-locations').innerHTML = usedLocs.map((l) =>
      chip(prefs.locations.includes(String(l.id)),
        `<i class="bi bi-geo-alt"></i>${esc(l.name)}${multiEnt ? ` <small>${esc(l.entity_name)}</small>` : ''} <b>${byLoc[l.id] || 0}</b>`,
        `data-loc="${l.id}"`)).join('') +
      (byLoc.null || byLoc.undefined ? chip(prefs.locations.includes('none'), `Sem localidade <b>${(byLoc.null || 0) + (byLoc.undefined || 0)}</b>`, 'data-loc="none"') : '');
    el.querySelectorAll('[data-impact]').forEach((b) => b.addEventListener('click', () => {
      toggle(prefs.impacts, b.dataset.impact); save(); paintChips(); render();
    }));
    el.querySelectorAll('[data-loc]').forEach((b) => b.addEventListener('click', () => {
      toggle(prefs.locations, b.dataset.loc); save(); paintChips(); render();
    }));
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
    if (prefs.entity) p.set('entity_id', prefs.entity);
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
      (!q || `${t.number} ${t.title} ${t.requester_name || ''}`.toLowerCase().includes(q))
      && (!prefs.impacts.length || prefs.impacts.includes(String(t.impact_id)))
      && (!prefs.locations.length || prefs.locations.includes(t.location_id ? String(t.location_id) : 'none')))
      .sort(SORTS[prefs.sort]?.fn || SORTS.urgency.fn);
  }

  // ---------------- colunas ----------------
  function columns(list) {
    if (prefs.group === 'impact') {
      const cols = levels.filter((l) => l.active || list.some((t) => String(t.impact_id) === String(l.id))).slice().sort((a, b) => b.priority - a.priority || b.sort_order - a.sort_order).map((l) => ({
        key: String(l.id), label: l.name, tone: URGENCY_TONE[l.priority], drop: { impact_id: l.id },
      }));
      if (list.some((t) => !t.impact_id)) cols.push({ key: 'none', label: 'Sem urgência', drop: null });
      return cols.map((c) => ({ ...c, items: list.filter((t) => String(t.impact_id || 'none') === c.key) }));
    }
    if (prefs.group === 'location') {
      const used = new Map();
      list.forEach((t) => used.set(String(t.location_id || 'none'), t));
      const cols = locs.filter((l) => used.has(String(l.id)))
        .map((l) => ({ key: String(l.id), label: l.name, sub: l.entity_name, entity_id: l.entity_id, drop: { location_id: l.id } }));
      if (used.has('none')) cols.push({ key: 'none', label: 'Sem localidade', drop: null });
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
    const shortNum = `#${t.id}`;
    const cat = t.display_category ? String(t.display_category).split(' > ').pop() : '';
    return `
      <article class="kcard ${tone}" data-id="${t.id}" tabindex="0" aria-label="Chamado ${esc(t.number)}: ${esc(t.title)}">
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
          ${t.assigned_name
            ? `<span class="kavatar" title="Técnico: ${esc(t.assigned_name)}">${esc(initials(t.assigned_name))}</span>`
            : `<span class="kavatar empty" title="Sem técnico"><i class="bi bi-person-plus"></i></span>`}
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
      body.innerHTML = emptyState('Nenhum chamado por aqui', opts.watching ? 'Quando alguém adicionar você como observador(a), o chamado aparece aqui.' : 'Abra um chamado em "Novo chamado".', 'bi-kanban');
      return;
    }
    body.innerHTML = `
      <div class="board ${canDragAny() ? '' : 'readonly'}" id="board">
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
    body.querySelectorAll('.kcard').forEach((c) => {
      c.addEventListener('click', () => { if (!Board.justDragged) location.hash = `#/tickets/${c.dataset.id}`; });
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = `#/tickets/${c.dataset.id}`; });
    });
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

  async function onDrop(t, col) {
    if (!t || !col || !col.drop) return;
    try {
      if (col.drop.status !== undefined) {
        const to = col.drop.status;
        if (to === t.status) return;
        if (to === 5) { TicketModals.resolve(t, { onDone: load, onCancel: render }); return; }
        if (to === 2 && !t.assigned_user_id) {
          if (P('ticket.take') && !P('ticket.assign')) { await API.post(`/tickets/${t.id}/assign`, {}); toast(`${t.number} assumido por você.`, 'success'); return load(); }
          TicketModals.assign(t, { onDone: load, onCancel: render }); return;
        }
        await API.post(`/tickets/${t.id}/status`, { status: to });
        toast(`${t.number} → ${LABELS.status[to]}`, 'success');
      } else if (col.drop.impact_id !== undefined) {
        if (String(col.drop.impact_id) === String(t.impact_id)) return;
        await API.patch(`/tickets/${t.id}`, { impact_id: col.drop.impact_id });
        toast(`${t.number}: urgência alterada para ${col.label}`, 'success');
      } else if (col.drop.location_id !== undefined) {
        if (String(col.drop.location_id) === String(t.location_id)) return;
        if (col.entity_id && String(col.entity_id) !== String(t.entity_id)) {
          toast('Essa localidade é de outra empresa.', 'warning'); return render();
        }
        await API.patch(`/tickets/${t.id}`, { location_id: col.drop.location_id });
        toast(`${t.number} movido para ${col.label}`, 'success');
      }
    } catch (e) {
      if (e.data?.request_approval) { TicketModals.resolve(t, { onDone: load, onCancel: render }); return; }
      showError(e);
    }
    load();
  }

  // ---------------- lista ----------------
  // ---------------- calendário ----------------
  // Cada chamado aparece no dia escolhido (precisa até / aberto em / prazo SLA).
  // Passar o mouse num dia mostra, ao lado do mouse, a lista dos chamados do dia.
  const CAL_DATAS = {
    needed: { label: 'Precisa até', get: (t) => t.needed_by },
    created: { label: 'Aberto em', get: (t) => t.created_at },
    due: { label: 'Prazo (SLA)', get: (t) => t.due_at },
  };
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const diaLocal = (v) => {
    if (!v) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v);
    const d = new Date(v);
    return isNaN(d) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  let calMes = (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })();
  if (!CAL_DATAS[prefs.calDate]) prefs.calDate = 'needed';

  function renderCalendar(list, body) {
    const pegar = CAL_DATAS[prefs.calDate].get;
    const porDia = {};
    let semData = 0;
    list.forEach((t) => {
      const k = diaLocal(pegar(t));
      if (!k) { semData += 1; return; }
      (porDia[k] = porDia[k] || []).push(t);
    });
    const { y, m } = calMes;
    const primeiro = new Date(y, m, 1);
    const inicio = new Date(y, m, 1 - primeiro.getDay()); // começa no domingo
    const hoje = diaLocal(new Date());
    const celulas = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
      if (i >= 35 && d.getMonth() !== m) break; // não mostra semana extra vazia
      const k = diaLocal(d);
      const its = porDia[k] || [];
      const abertos = its.filter((t) => ![5, 6, 7].includes(t.status));
      const pior = abertos.reduce((a, t) => Math.max(a, t.priority || 0), 0);
      celulas.push(`
        <div class="tcal-day ${d.getMonth() !== m ? 'fora' : ''} ${k === hoje ? 'hoje' : ''} ${its.length ? 'tem' : ''} ${pior ? (URGENCY_TONE[pior] || '') : ''}" data-dia="${k}">
          <div class="tcal-num"><span>${d.getDate()}</span>${its.length ? `<b class="tcal-qtd">${its.length}</b>` : ''}</div>
          ${its.slice(0, 3).map((t) => `<div class="tcal-it ${URGENCY_TONE[t.priority] || 'u-req'} ${[5, 6, 7].includes(t.status) ? 'fechado' : ''}" data-id="${t.id}">
            <i></i><span>${esc(t.title)}</span></div>`).join('')}
          ${its.length > 3 ? `<div class="tcal-mais">+${its.length - 3}</div>` : ''}
        </div>`);
    }
    body.innerHTML = `
      <div class="card panel-card tcal">
        <div class="tcal-head">
          <button class="btn btn-sm btn-outline-secondary" id="tcal-prev" aria-label="Mês anterior"><i class="bi bi-chevron-left"></i></button>
          <strong class="tcal-titulo">${MESES[m]} de ${y}</strong>
          <button class="btn btn-sm btn-outline-secondary" id="tcal-next" aria-label="Próximo mês"><i class="bi bi-chevron-right"></i></button>
          <button class="btn btn-sm btn-link" id="tcal-hoje">Hoje</button>
          <label class="ms-auto small text-muted d-flex align-items-center gap-1">Data:
            <select class="form-select form-select-sm" id="tcal-data" style="width:auto">
              ${Object.entries(CAL_DATAS).map(([k, v]) => `<option value="${k}" ${k === prefs.calDate ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select></label>
        </div>
        <div class="tcal-grid">
          ${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => `<div class="tcal-sem">${d}</div>`).join('')}
          ${celulas.join('')}
        </div>
        ${semData ? `<div class="tcal-rodape"><i class="bi bi-info-circle"></i> ${semData} chamado(s) sem "${CAL_DATAS[prefs.calDate].label.toLowerCase()}" não aparecem no calendário.</div>` : ''}
      </div>
      <div class="tcal-pop" id="tcal-pop" role="tooltip"></div>`;

    const muda = (n) => { calMes = { y: new Date(y, m + n, 1).getFullYear(), m: new Date(y, m + n, 1).getMonth() }; render(); };
    body.querySelector('#tcal-prev').onclick = () => muda(-1);
    body.querySelector('#tcal-next').onclick = () => muda(1);
    body.querySelector('#tcal-hoje').onclick = () => { const d = new Date(); calMes = { y: d.getFullYear(), m: d.getMonth() }; render(); };
    body.querySelector('#tcal-data').onchange = (e) => { prefs.calDate = e.target.value; save(); render(); };

    // listinha ao lado do mouse
    const pop = body.querySelector('#tcal-pop');
    let fechar = null;
    const mostrar = (cel, x, yy) => {
      const its = porDia[cel.dataset.dia] || [];
      if (!its.length) { pop.classList.remove('on'); return; }
      clearTimeout(fechar);
      const [ano, mes, dia] = cel.dataset.dia.split('-');
      pop.innerHTML = `<div class="tcal-pop-tit">${dia}/${mes}/${ano} · ${its.length} chamado(s)</div>
        ${its.slice(0, 8).map((t) => `<a class="tcal-pop-it ${URGENCY_TONE[t.priority] || 'u-req'}" href="#/tickets/${t.id}">
          <i></i><span class="t">${esc(t.title)}</span>${badgeStatus(t.status)}</a>`).join('')}
        ${its.length > 8 ? `<div class="tcal-pop-mais">e mais ${its.length - 8}…</div>` : ''}`;
      pop.classList.add('on');
      const w = pop.offsetWidth; const h = pop.offsetHeight;
      let left = x + 16; let top = yy + 12;
      if (left + w > window.innerWidth - 8) left = x - w - 16;
      if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
      pop.style.left = `${Math.max(8, left)}px`;
      pop.style.top = `${top}px`;
    };
    const esconder = () => { fechar = setTimeout(() => pop.classList.remove('on'), 180); };
    body.querySelectorAll('.tcal-day.tem').forEach((cel) => {
      cel.addEventListener('mouseenter', (e) => mostrar(cel, e.clientX, e.clientY));
      cel.addEventListener('mouseleave', esconder);
      // toque (celular): abre a lista do dia
      cel.addEventListener('click', (e) => {
        const it = e.target.closest('.tcal-it');
        if (it && window.matchMedia('(hover: hover)').matches) { location.hash = `#/tickets/${it.dataset.id}`; return; }
        const r = cel.getBoundingClientRect();
        mostrar(cel, r.left + r.width / 2, r.top + r.height / 2);
      });
    });
    pop.addEventListener('mouseenter', () => clearTimeout(fechar));
    pop.addEventListener('mouseleave', esconder);
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.tcal-day') && !e.target.closest('#tcal-pop')) pop.classList.remove('on');
    }, { once: true });
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
            <th>Chamado</th><th>Status</th><th>Urgência</th><th>Localidade</th><th>Técnico</th><th>Solicitante</th><th>Aberto</th>
          </tr></thead>
          <tbody>
            ${list.map((t) => `
              <tr class="ticket-row ${URGENCY_TONE[t.priority] || ''}" data-id="${t.id}">
                <td><span class="fw-semibold text-primary">${esc(t.number)}</span>
                  <span class="knovo ${window.temNovidade && window.temNovidade(t.id) ? '' : 'd-none'}" data-tk-novidade="${t.id}" title="Teve novidade desde a última vez que você abriu"><i class="bi bi-bell-fill"></i></span><br>${esc(t.title)}
                  <br><small class="text-muted">${esc(t.display_category || '')}</small></td>
                <td>${badgeStatus(t.status)}</td>
                <td>${badgeImpact(t)}</td>
                <td>${esc(t.location_name || '—')}<br><small class="text-muted multi-empresa">${esc(t.entity_name || '')}</small></td>
                <td>${t.assigned_name ? esc(t.assigned_name) : '<span class="text-muted">—</span>'}</td>
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
  Views.tickets.refresh = () => { if (!Board.dragging && document.body.contains(el.querySelector('#tickets-body'))) load(); };

  try {
    [levels, locs] = await Promise.all([
      API.get('/impact-levels?all=true').catch(() => []),
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
      const c = e.target.closest('.kcard');
      if (!c || e.button !== 0 || !canDrag(c.dataset.id)) return;
      Board.st = { sx: e.clientX, sy: e.clientY, pending: c };
      e.preventDefault();
    });
    // toque: segurar ~0,3s para arrastar (assim a rolagem continua normal)
    board.addEventListener('touchstart', (e) => {
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
