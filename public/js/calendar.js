// ---------------------------------------------------------------
// Calendario (sem bibliotecas)
//   CalendarUI.picker(el, opts)  -> escolher a data de necessidade (Novo chamado)
//   CalendarUI.month(el, opts)   -> calendario do painel com os chamados por dia
// ---------------------------------------------------------------
const CalendarUI = (() => {
  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
    'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayIso = () => iso(new Date());
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtLong = (s) => {
    const d = parse(s);
    const t = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  // Primeiro e ultimo dia exibidos na grade do mes (semanas completas)
  function gridRange(year, month) {
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    const last = new Date(year, month + 1, 0);
    const end = new Date(year, month + 1, 0 + (6 - last.getDay()));
    return { start, end };
  }
  function daysBetween(start, end) {
    const out = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) out.push(new Date(d));
    return out;
  }

  // Nivel de ocupacao do dia (para a cor)
  const loadLevel = (n) => (!n ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : 3);

  // ------------------------------------------------------------
  // Seletor de data com carga por dia
  // ------------------------------------------------------------
  function picker(el, { value = null, loadCounts, onChange } = {}) {
    const today = todayIso();
    let selected = value;
    const base = selected ? parse(selected) : new Date();
    let year = base.getFullYear();
    let month = base.getMonth();
    let counts = {};

    el.classList.add('cal', 'cal-picker');
    el.innerHTML = `
      <div class="cal-head">
        <button type="button" class="cal-nav" data-nav="-1" aria-label="Mês anterior"><i class="bi bi-chevron-left"></i></button>
        <strong class="cal-title" aria-live="polite"></strong>
        <button type="button" class="cal-nav" data-nav="1" aria-label="Próximo mês"><i class="bi bi-chevron-right"></i></button>
      </div>
      <div class="cal-week">${WEEK.map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid" role="grid"></div>
      <div class="cal-quick">
        <button type="button" class="btn btn-sm btn-outline-secondary" data-quick="0">Hoje</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-quick="1">Amanhã</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-quick="7">Em 1 semana</button>
      </div>
      <div class="cal-legend">
        <span class="cal-legend-row"><span class="cal-legend-num">3</span>
        <span>= chamados em aberto que precisam ficar prontos naquele dia.
          Dias mais cheios podem demorar mais; se puder esperar, escolha um dia mais livre.</span></span>
        <span class="cal-legend-scale">
          <i class="lv1"></i>tranquilo <i class="lv2"></i>movimentado <i class="lv3"></i>cheio
        </span>
      </div>
      <div class="cal-picked"></div>`;

    const grid = el.querySelector('.cal-grid');

    function paint() {
      el.querySelector('.cal-title').textContent = `${MONTHS[month]} ${year}`;
      const { start, end } = gridRange(year, month);
      const thisMonth = new Date(); const minMonth = thisMonth.getFullYear() * 12 + thisMonth.getMonth();
      el.querySelector('[data-nav="-1"]').disabled = year * 12 + month <= minMonth;
      grid.innerHTML = daysBetween(start, end).map((d) => {
        const key = iso(d);
        const out = d.getMonth() !== month;
        const past = key < today;
        const n = counts[key] || 0;
        const lv = loadLevel(n);
        const cls = ['cal-day', out ? 'out' : '', past ? 'past' : '', key === today ? 'today' : '',
          key === selected ? 'sel' : '', d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : '', `lv${lv}`].join(' ');
        const label = `${fmtLong(key)}${past ? '' : `: ${n} chamado${n === 1 ? '' : 's'} em aberto`}`;
        return `<button type="button" class="${cls}" data-day="${key}" ${past ? 'disabled' : ''} aria-label="${label}" aria-pressed="${key === selected}">
          <span class="cal-n">${d.getDate()}</span>
          ${!past && n ? `<span class="cal-count">${n}</span>` : ''}
        </button>`;
      }).join('');
      const pickedEl = el.querySelector('.cal-picked');
      if (selected) {
        const n = counts[selected] || 0;
        pickedEl.innerHTML = `<i class="bi bi-calendar-check"></i> Precisa até <b>${fmtLong(selected).toLowerCase()}</b>
          <span class="text-muted">· ${n ? `${n} chamado${n === 1 ? '' : 's'} já marcado${n === 1 ? '' : 's'} para este dia` : 'dia livre'}</span>`;
        pickedEl.classList.add('on');
      } else {
        pickedEl.innerHTML = '<i class="bi bi-hand-index"></i> Toque no dia em que você precisa disso resolvido.';
        pickedEl.classList.remove('on');
      }
    }

    async function load() {
      paint();
      if (!loadCounts) return;
      const { start, end } = gridRange(year, month);
      try { counts = (await loadCounts(iso(start), iso(end))) || {}; } catch { counts = {}; }
      paint();
    }

    function choose(key) {
      selected = key;
      const d = parse(key);
      if (d.getMonth() !== month || d.getFullYear() !== year) { year = d.getFullYear(); month = d.getMonth(); load(); } else paint();
      el.classList.remove('cal-invalid');
      if (onChange) onChange(key);
    }

    el.addEventListener('click', (ev) => {
      const nav = ev.target.closest('[data-nav]');
      if (nav) {
        month += Number(nav.dataset.nav);
        if (month < 0) { month = 11; year--; } else if (month > 11) { month = 0; year++; }
        load(); return;
      }
      const q = ev.target.closest('[data-quick]');
      if (q) { const d = new Date(); d.setDate(d.getDate() + Number(q.dataset.quick)); choose(iso(d)); return; }
      const day = ev.target.closest('.cal-day');
      if (day && !day.disabled) choose(day.dataset.day);
    });

    load();
    return {
      get value() { return selected; },
      flagInvalid() { el.classList.add('cal-invalid'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
    };
  }

  // ------------------------------------------------------------
  // Calendario do painel: chamados por data de necessidade
  // ------------------------------------------------------------
  // state (opcional) guarda mes e dia escolhidos entre atualizacoes da tela
  function month(el, { loadTickets, state = {} } = {}) {
    const now = new Date();
    let year = state.year ?? now.getFullYear();
    let mon = state.mon ?? now.getMonth();
    let byDay = {};
    let overdue = [];
    let selected = state.selected || todayIso();
    const save = () => { state.year = year; state.mon = mon; state.selected = selected; };
    const today = todayIso();
    const OPEN = [1, 2, 3, 4];

    el.classList.add('cal', 'cal-board');
    el.innerHTML = `
      <div class="cal-board-main">
        <div class="cal-head">
          <button type="button" class="cal-nav" data-nav="-1" aria-label="Mês anterior"><i class="bi bi-chevron-left"></i></button>
          <strong class="cal-title" aria-live="polite"></strong>
          <button type="button" class="cal-nav" data-nav="1" aria-label="Próximo mês"><i class="bi bi-chevron-right"></i></button>
          <button type="button" class="btn btn-sm btn-link cal-today-btn" data-today>Hoje</button>
        </div>
        <div class="cal-week">${WEEK.map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="cal-grid"></div>
        <div class="cal-legend small">
          <span><i class="dot u-stop"></i>urgência do chamado mais crítico do dia</span>
          <span><i class="bi bi-exclamation-triangle-fill text-danger"></i> passou da data e ainda está aberto</span>
        </div>
      </div>
      <aside class="cal-side">
        <div class="cal-side-head"></div>
        <ul class="cal-list"></ul>
      </aside>`;

    const grid = el.querySelector('.cal-grid');
    const TONE = { 4: 'u-stop', 3: 'u-soon', 2: 'u-slow', 1: 'u-req' };

    function dayTickets(key) { return byDay[key] || []; }

    function paint() {
      save();
      el.querySelector('.cal-title').textContent = `${MONTHS[mon]} ${year}`;
      const { start, end } = gridRange(year, mon);
      grid.innerHTML = daysBetween(start, end).map((d) => {
        const key = iso(d);
        const list = dayTickets(key);
        const open = list.filter((t) => OPEN.includes(t.status));
        const done = list.length - open.length;
        const top = open.reduce((m, t) => Math.max(m, t.priority || 1), 0);
        const late = key < today && open.length;
        return `<button type="button" class="cal-day ${d.getMonth() !== mon ? 'out' : ''} ${key === today ? 'today' : ''} ${key === selected ? 'sel' : ''} ${late ? 'late' : ''}"
            data-day="${key}" aria-label="${fmtLong(key)}: ${open.length} em aberto${done ? `, ${done} resolvidos` : ''}">
          <span class="cal-n">${d.getDate()}</span>
          ${open.length ? `<span class="cal-pill ${TONE[top] || 'u-req'}">${late ? '<i class="bi bi-exclamation-triangle-fill"></i>' : ''}${open.length}</span>` : ''}
          ${done ? `<span class="cal-done" title="${done} resolvido(s)"><i class="bi bi-check2"></i>${done}</span>` : ''}
        </button>`;
      }).join('');
      paintSide();
    }

    function item(t) {
      const isOpen = OPEN.includes(t.status);
      const late = isOpen && String(t.needed_by).slice(0, 10) < today;
      return `<li class="${TONE[t.priority] || 'u-req'} ${isOpen ? '' : 'closed'}">
        <a href="#/tickets/${t.id}">
          <span class="cal-li-top">
            <span class="cal-li-urg">${esc(t.impact_name || LABELS.priority[t.priority] || '')}</span>
            <span class="cal-li-num">#${t.id} · ${esc(LABELS.status[t.status] || '')}</span>
          </span>
          <span class="cal-li-title">${esc(t.title)}</span>
          <span class="cal-li-meta">${t.location_name ? `<i class="bi bi-geo-alt"></i>${esc(t.location_name)}` : ''}
            ${t.assigned_name ? ` · ${esc(t.assigned_name)}` : ' · <em>sem técnico</em>'}
            ${late ? ` · <b class="text-danger">precisava em ${fmt.date(String(t.needed_by).slice(0, 10) + 'T12:00:00')}</b>` : ''}</span>
        </a></li>`;
    }

    function paintSide() {
      const head = el.querySelector('.cal-side-head');
      const ul = el.querySelector('.cal-list');
      const list = dayTickets(selected).slice().sort((a, b) =>
        (OPEN.includes(b.status) - OPEN.includes(a.status)) || (b.priority - a.priority));
      const open = list.filter((t) => OPEN.includes(t.status)).length;
      head.innerHTML = `<strong>${fmtLong(selected)}</strong>
        <span class="text-muted small">${list.length ? `${open} em aberto${list.length - open ? ` · ${list.length - open} resolvido(s)` : ''}` : 'Nenhum chamado para este dia'}</span>`;
      let html = list.map(item).join('');
      if (selected === today && overdue.length) {
        html += `<li class="cal-sep">Atrasados (data já passou)</li>` + overdue.map(item).join('');
      }
      ul.innerHTML = html || '<li class="cal-empty">Clique num dia para ver os chamados que precisam ficar prontos nele.</li>';
    }

    async function load() {
      paint();
      const { start, end } = gridRange(year, mon);
      let rows = [];
      try { rows = (await loadTickets(iso(start), iso(end))) || []; } catch { rows = []; }
      byDay = {}; overdue = [];
      const s = iso(start);
      rows.forEach((t) => {
        const k = String(t.needed_by).slice(0, 10);
        if (k < s) { overdue.push(t); return; }
        (byDay[k] = byDay[k] || []).push(t);
      });
      // atrasados do proprio mes visivel tambem entram na lista de "Hoje"
      Object.keys(byDay).filter((k) => k < today).forEach((k) => {
        byDay[k].filter((t) => OPEN.includes(t.status)).forEach((t) => overdue.push(t));
      });
      paint();
    }

    el.addEventListener('click', (ev) => {
      const nav = ev.target.closest('[data-nav]');
      if (nav) {
        mon += Number(nav.dataset.nav);
        if (mon < 0) { mon = 11; year--; } else if (mon > 11) { mon = 0; year++; }
        load(); return;
      }
      if (ev.target.closest('[data-today]')) {
        selected = today; const n = new Date();
        if (n.getMonth() !== mon || n.getFullYear() !== year) { mon = n.getMonth(); year = n.getFullYear(); load(); } else paint();
        return;
      }
      const day = ev.target.closest('.cal-day');
      if (day) { selected = day.dataset.day; paint(); }
    });

    load();
    return { reload: load };
  }

  return { picker, month, iso, todayIso };
})();
