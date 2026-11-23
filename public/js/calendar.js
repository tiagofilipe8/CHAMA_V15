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
  function picker(el, { value = null, loadCounts, onChange, atalhos = true } = {}) {
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
    // sem contagem (quem abre o chamado não precisa ver a carga da equipe): esconde a legenda
    if (!loadCounts) el.querySelector('.cal-legend')?.remove();
    if (!atalhos) el.querySelector('.cal-quick')?.remove();

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
        const label = `${fmtLong(key)}${past || !loadCounts ? '' : `: ${n} chamado${n === 1 ? '' : 's'} em aberto`}`;
        return `<button type="button" class="${cls}" data-day="${key}" ${past ? 'disabled' : ''} aria-label="${label}" aria-pressed="${key === selected}">
          <span class="cal-n">${d.getDate()}</span>
          ${!past && n ? `<span class="cal-count">${n}</span>` : ''}
        </button>`;
      }).join('');
      const pickedEl = el.querySelector('.cal-picked');
      if (selected) {
        const n = counts[selected] || 0;
        pickedEl.innerHTML = `<i class="bi bi-calendar-check"></i> Precisa até <b>${fmtLong(selected).toLowerCase()}</b>
          ${loadCounts ? `<span class="text-muted">· ${n ? `${n} chamado${n === 1 ? '' : 's'} já marcado${n === 1 ? '' : 's'} para este dia` : 'dia livre'}</span>` : ''}`;
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
      set(key) { if (key) choose(key); else { selected = null; paint(); } },
      flagInvalid() { el.classList.add('cal-invalid'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
    };
  }

  // ------------------------------------------------------------
  // Calendario de chamados (mesmo jeito do calendario do Sistema TI GBF)
  //   - em cada dia, um numero por urgencia, na cor da urgencia; reloginho = atrasados
  //   - passar o mouse num dia: cartao pequeno perto do mouse com a previa dos comentarios
  //   - clicar no dia: a lista do dia abre ao lado, ligada ao dia por uma linha; passar o
  //     mouse num chamado abre os detalhes e clicar abre o chamado
  //   - a lista do dia escolhido tambem fica ao lado do calendario
  // opts:
  //   load(de, ate)   -> chamados (array ou Promise)
  //   dateOf(t)       -> 'AAAA-MM-DD' do chamado (ou null)
  //   dateLabel       -> nome da data usada (ex.: 'Precisa até')
  //   atraso          -> true: chamado aberto com a data no passado conta como atrasado
  //   state           -> guarda mes, dia e filtro entre atualizacoes da tela
  //   ferramentas     -> html extra no topo (ex.: escolher a data) e onFerramentas(el)
  //   nota            -> texto pequeno ao lado da legenda
  // ------------------------------------------------------------
  const URG_CLS = { 4: 'urg-4', 3: 'urg-3', 2: 'urg-2', 1: 'urg-1' };
  const URG_NOME = { 4: 'Operação parada', 3: 'Parada iminente', 2: 'Operação prejudicada', 1: 'Requisição' };
  const MESES_MIN = MONTHS.map((m) => m.toLowerCase());
  const SEMANA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  const ABERTO = [1, 2, 3, 4];
  const FEITO = [5, 6];
  const somaDias = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const curta = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  const corta = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const tituloDia = (s) => {
    const t = parse(s).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const temHover = () => window.matchMedia('(hover: hover)').matches;

  // Elementos flutuantes (um so por pagina): cartao do mouse, lista fixa e a linha que liga
  let flut = null;
  function flutuantes() {
    if (flut) return flut;
    const criar = (id, html) => {
      const el = document.createElement('div');
      el.id = id; el.innerHTML = html; document.body.appendChild(el); return el;
    };
    flut = {
      dica: criar('cg-dica', ''),
      pop: criar('cg-pop', '<div class="cg-pop-in"></div>'),
      linha: criar('cg-linha', '<svg width="100%" height="100%"><path d="" /></svg>'),
      dono: null, // o calendario que abriu a lista
    };
    const fechar = () => {
      flut.pop.classList.remove('on', 'fixo');
      flut.linha.classList.remove('on');
      flut.dica.classList.remove('on');
      if (flut.dono) flut.dono.celFixa = null;
    };
    flut.fechar = fechar;
    flut.pop.addEventListener('click', (ev) => {
      if (ev.target.closest('.cg-pop-x')) { fechar(); return; }
      const li = ev.target.closest('li[data-id]');
      if (li) { fechar(); location.hash = `#/tickets/${li.dataset.id}`; }
    });
    flut.pop.addEventListener('keydown', (ev) => {
      const li = ev.target.closest('li[data-id]');
      if (li && ev.key === 'Enter') { fechar(); location.hash = `#/tickets/${li.dataset.id}`; }
    });
    document.addEventListener('mousedown', (ev) => {
      if (flut.pop.classList.contains('fixo') && !flut.pop.contains(ev.target) && !ev.target.closest('.cg-dias')) fechar();
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') fechar(); });
    document.addEventListener('scroll', (ev) => { if (!flut.pop.contains(ev.target)) fechar(); }, true);
    window.addEventListener('resize', fechar);
    window.addEventListener('hashchange', fechar);
    return flut;
  }

  function grade(el, {
    load, dateOf, dateLabel = 'Data', atraso = true, state = {}, ferramentas = '', onFerramentas = null, nota = '',
  } = {}) {
    const hoje = todayIso();
    const agora = new Date();
    let year = state.year ?? agora.getFullYear();
    let mon = state.mon ?? agora.getMonth();
    let diaSel = state.selected || hoje;
    const filtro = { abertos: !!state.soAbertos };
    let itens = [];          // chamados com o dia calculado
    let antigos = [];        // atrasados com data antes da grade (aparecem na lista de hoje)
    let comentarios = {};    // id -> ultimos comentarios
    const nomes = { ...URG_NOME };
    const eu = { celFixa: null };
    const salvar = () => { state.year = year; state.mon = mon; state.selected = diaSel; state.soAbertos = filtro.abertos; };

    // grade de segunda a domingo
    const faixa = () => {
      const p = new Date(year, mon, 1);
      const ini = new Date(year, mon, 1 - ((p.getDay() + 6) % 7));
      const u = new Date(year, mon + 1, 0);
      const fim = new Date(year, mon, u.getDate() + ((7 - u.getDay()) % 7));
      return { ini: iso(ini), fim: iso(fim) };
    };

    el.classList.add('cg');
    el.innerHTML = `
      <div class="cg-topo">
        <button type="button" class="btn btn-sm btn-outline-secondary" data-nav="-1" aria-label="Mês anterior"><i class="bi bi-chevron-left"></i></button>
        <strong class="cg-mes" aria-live="polite"></strong>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-nav="1" aria-label="Próximo mês"><i class="bi bi-chevron-right"></i></button>
        <button type="button" class="btn btn-sm btn-link cg-hoje-btn" data-hoje>Hoje</button>
        <div class="cg-tools ms-auto">
          ${ferramentas}
          <div class="cg-filtros" role="group" aria-label="Mostrar">
            <button type="button" data-f="abertos">Só em aberto</button>
          </div>
        </div>
      </div>
      <div class="cg-legenda"></div>
      <div class="cg-corpo">
        <div class="cg-grade" role="grid" aria-label="Calendário de chamados">
          ${SEMANA.map((d) => `<div class="cg-sem" role="columnheader">${d}</div>`).join('')}
          <div class="cg-dias" style="display:contents"></div>
        </div>
        <aside class="cg-lado" aria-live="polite"></aside>
      </div>
      <div class="cg-resumo"></div>`;
    if (onFerramentas) onFerramentas(el);
    const $ = (s) => el.querySelector(s);
    const dias = $('.cg-dias');

    const visiveis = () => itens.filter((i) => !filtro.abertos || i.aberto);
    const porDia = () => {
      const m = new Map();
      visiveis().forEach((i) => { if (!m.has(i.dia)) m.set(i.dia, []); m.get(i.dia).push(i); });
      return m;
    };
    const ordena = (a, b) => Number(a.feito) - Number(b.feito) || b.prioridade - a.prioridade
      || Number(b.atrasado) - Number(a.atrasado) || a.t.id - b.t.id;
    const doDia = (d) => (porDia().get(d) || []).slice().sort(ordena);

    const etiqueta = (i) => (i.atrasado ? '<span class="tg tg-red">Atrasado</span>' : badgeStatus(i.t.status)); // mesma etiqueta de status do resto do sistema

    function pintar() {
      salvar();
      $('.cg-mes').textContent = `${MESES_MIN[mon].replace(/^./, (x) => x.toUpperCase())} de ${year}`;
      $('.cg-hoje-btn').classList.toggle('d-none', agora.getFullYear() === year && agora.getMonth() === mon);
      const m = porDia();
      const { ini, fim } = faixa();
      const lista = [];
      for (let d = ini; d <= fim; d = somaDias(d, 1)) lista.push(d);
      const mesIso = `${year}-${pad(mon + 1)}`;
      dias.innerHTML = lista.map((d) => {
        const lst = m.get(d) || [];
        const cont = [4, 3, 2, 1].map((p) => [p, lst.filter((i) => i.prioridade === p).length]).filter(([, n]) => n);
        const atr = lst.filter((i) => i.atrasado).length;
        const fora = d.slice(0, 7) !== mesIso;
        return `<button type="button" class="cg-cel${fora ? ' fora' : ''}${d === hoje ? ' hoje' : ''}${d === diaSel ? ' sel' : ''}" data-dia="${d}"
            aria-label="${tituloDia(d)}: ${plural(lst.length, 'chamado', 'chamados')}" aria-pressed="${d === diaSel}">
          <span class="cg-d">${Number(d.slice(8, 10))}</span>
          ${atr ? `<span class="cg-atr" title="${plural(atr, 'atrasado', 'atrasados')}"><i class="bi bi-alarm"></i>${atr}</span>` : ''}
          <span class="cg-nums">${cont.map(([p, n]) => `<i class="cg-num ${URG_CLS[p]}" title="${n} · ${esc(nomes[p])}">${n}</i>`).join('')}</span>
        </button>`;
      }).join('');

      $('.cg-legenda').innerHTML = `${[4, 3, 2, 1].map((p) => `<span><i class="cg-num ${URG_CLS[p]}"></i>${esc(nomes[p])}</span>`).join('')}
        ${atraso ? '<span><i class="bi bi-alarm cg-alarme"></i>atrasado</span>' : ''}
        <span class="ms-auto cg-nota">${esc(nota || `Cada chamado aparece no dia de "${dateLabel}".`)}</span>`;

      // lista do dia escolhido (ao lado)
      const lst = doDia(diaSel);
      const extras = diaSel === hoje ? antigos.filter((i) => !filtro.abertos || i.aberto) : [];
      const abertos = lst.filter((i) => i.aberto).length;
      const itemLado = (i) => `<a class="cg-item" href="#/tickets/${i.t.id}">
          <i class="cg-num ${URG_CLS[i.prioridade]}" title="${esc(nomes[i.prioridade])}"></i>
          <span class="cg-item-tx">
            <span class="t">${esc(i.t.title)}</span>
            <span class="cg-sub">${esc(i.t.number || String(i.t.id))}${i.t.location_name ? ` · ${esc(i.t.location_name)}` : ''} · ${i.t.assigned_name ? esc(i.t.assigned_name) : '<em>sem técnico</em>'}${i.dia !== diaSel ? ` · ${dateLabel.toLowerCase()} ${curta(i.dia)}` : ''}</span>
          </span>
          <span class="cg-item-tg">${etiqueta(i)}</span>
        </a>`;
      $('.cg-lado').innerHTML = `<h3>${esc(tituloDia(diaSel))}${diaSel === hoje ? ' <span class="tg tg-teal">hoje</span>' : ''}</h3>
        <div class="cg-sub mb-2">${lst.length ? `${plural(lst.length, 'chamado', 'chamados')} · ${abertos} em aberto` : 'Nenhum chamado neste dia.'}</div>
        ${lst.map(itemLado).join('')}
        ${extras.length ? `<div class="cg-sep">Atrasados de antes (${extras.length})</div>${extras.map(itemLado).join('')}` : ''}`;

      const doMes = visiveis().filter((i) => i.dia.slice(0, 7) === mesIso);
      $('.cg-resumo').textContent = `No mês: ${plural(doMes.length, 'chamado', 'chamados')} · ${[4, 3, 2, 1]
        .map((p) => `${doMes.filter((i) => i.prioridade === p).length} ${nomes[p].toLowerCase()}`).join(' · ')} · ${doMes.filter((i) => i.aberto).length} ainda em aberto`;
      el.querySelectorAll('.cg-filtros [data-f]').forEach((b) => {
        b.classList.toggle('on', !!filtro[b.dataset.f]);
        b.setAttribute('aria-pressed', String(!!filtro[b.dataset.f]));
      });
    }

    async function carregar() {
      pintar();
      const { ini, fim } = faixa();
      let rows = [];
      try { rows = (await load(ini, fim)) || []; } catch { rows = []; }
      itens = []; antigos = [];
      rows.forEach((t) => {
        const dia = dateOf(t);
        if (!dia) return;
        const aberto = ABERTO.includes(t.status);
        const i = {
          t, dia, aberto, feito: FEITO.includes(t.status) || t.status === 7,
          prioridade: Number(t.priority) || 1, atrasado: atraso && aberto && dia < hoje,
        };
        if (t.impact_name && t.priority) nomes[t.priority] = t.impact_name;
        if (dia < ini) { if (i.atrasado) antigos.push(i); return; }
        if (dia > fim) return;
        itens.push(i);
      });
      pintar();
      // previa dos comentarios (para o cartao do mouse e os detalhes)
      const ids = [...new Set(itens.concat(antigos).map((i) => i.t.id))];
      comentarios = {};
      if (ids.length) {
        try { comentarios = (await API.get(`/tickets/comments-preview?ids=${ids.slice(0, 500).join(',')}`)) || {}; } catch { comentarios = {}; }
      }
    }

    el.addEventListener('click', (ev) => {
      const nav = ev.target.closest('[data-nav]');
      if (nav) {
        mon += Number(nav.dataset.nav);
        if (mon < 0) { mon = 11; year -= 1; } else if (mon > 11) { mon = 0; year += 1; }
        diaSel = `${year}-${pad(mon + 1)}-01`;
        if (agora.getFullYear() === year && agora.getMonth() === mon) diaSel = hoje;
        carregar(); return;
      }
      if (ev.target.closest('[data-hoje]')) { year = agora.getFullYear(); mon = agora.getMonth(); diaSel = hoje; carregar(); return; }
      const f = ev.target.closest('.cg-filtros [data-f]');
      if (f) { filtro[f.dataset.f] = !filtro[f.dataset.f]; pintar(); return; }
      const cel = ev.target.closest('.cg-cel');
      if (cel) {
        diaSel = cel.dataset.dia;
        pintar();
        const nova = dias.querySelector(`[data-dia="${diaSel}"]`);
        if (temHover() && nova) mostrarLista(nova);
        else if (window.matchMedia('(max-width: 900px)').matches) $('.cg-lado').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    // ---- passar o mouse: cartao pequeno que segue o mouse ----
    const comsDoDia = (lst) => lst.flatMap((i) => (comentarios[i.t.id] || []).map((k) => ({ ...k, titulo: i.t.title })))
      .sort((a, b) => new Date(b.quando) - new Date(a.quando));
    let diaDica = null;
    dias.addEventListener('mousemove', (ev) => {
      if (!temHover()) return;
      const F = flutuantes();
      const cel = ev.target.closest('[data-dia]');
      if (!cel || (F.pop.classList.contains('fixo') && eu.celFixa === cel.dataset.dia)) { F.dica.classList.remove('on'); diaDica = null; return; }
      if (cel.dataset.dia !== diaDica) {
        diaDica = cel.dataset.dia;
        const lst = doDia(diaDica);
        const feitos = lst.filter((i) => i.feito).length;
        const coms = comsDoDia(lst).slice(0, 2);
        F.dica.innerHTML = `<div class="cg-dica-l1"><i class="bi bi-eye"></i> ${lst.length ? `${plural(lst.length, 'chamado', 'chamados')} · ${feitos} resolvido(s)` : 'Nenhum chamado'}</div>
          ${coms.map((k) => `<div class="cg-dica-com"><i class="bi bi-chat-left-text"></i><span><b>${esc((k.quem || '').split(' ')[0])}:</b> ${esc(corta(k.texto, 70))}</span></div>`).join('')}
          ${lst.length ? '<div class="cg-dica-l2">clique para ver a lista</div>' : ''}`;
        F.dica.classList.add('on');
      }
      const w = F.dica.offsetWidth; const h = F.dica.offsetHeight;
      let x = ev.clientX + 16; if (x + w > innerWidth - 6) x = ev.clientX - w - 12;
      let y = ev.clientY + 18; if (y + h > innerHeight - 6) y = ev.clientY - h - 12;
      F.dica.style.transform = `translate(${x}px, ${y}px)`;
    });
    dias.addEventListener('mouseleave', () => { if (flut) flut.dica.classList.remove('on'); diaDica = null; });

    // ---- clique: lista fixa ao lado do dia, ligada por uma linha ----
    function desenharLinha(cel) {
      const F = flutuantes();
      const r = cel.getBoundingClientRect(); const p = F.pop.getBoundingClientRect();
      const direita = p.left >= r.right;
      const x1 = direita ? r.right : r.left; const y1 = r.top + r.height / 2;
      const x2 = direita ? p.left : p.right; const y2 = Math.min(Math.max(y1, p.top + 18), p.top + 44);
      const meio = (x1 + x2) / 2;
      F.linha.querySelector('path').setAttribute('d', `M${x1},${y1} C${meio},${y1} ${meio},${y2} ${x2},${y2}`);
      F.linha.classList.remove('on'); void F.linha.offsetWidth; F.linha.classList.add('on');
    }
    function mostrarLista(cel) {
      const F = flutuantes();
      F.dono = eu;
      eu.celFixa = cel.dataset.dia;
      F.dica.classList.remove('on'); diaDica = null;
      const lst = doDia(eu.celFixa);
      const feitos = lst.filter((i) => i.feito).length;
      const det = (i) => {
        const t = i.t;
        const coms = comentarios[t.id] || [];
        return `<div class="cg-pop-det"><div><dl>
            <dt>Urgência</dt><dd>${esc(nomes[i.prioridade] || '—')}</dd>
            <dt>${esc(dateLabel)}</dt><dd>${fmtLong(i.dia)}</dd>
            <dt>Situação</dt><dd>${esc(LABELS.status[t.status] || '—')}</dd>
            <dt>Técnico</dt><dd>${t.assigned_name ? esc(t.assigned_name) : 'sem técnico'}</dd>
            ${t.location_name ? `<dt>Local</dt><dd>${esc(t.location_name)}</dd>` : ''}
            ${t.requester_name ? `<dt>Solicitante</dt><dd>${esc(t.requester_name)}</dd>` : ''}
            <dt>Chamado</dt><dd>${esc(t.number || String(t.id))}</dd>
          </dl>
          ${coms.length ? `<div class="cg-pop-coms">${coms.map((k) => `<div class="cg-pop-com"><b>${esc(k.quem || '—')}</b> <span>${esc(fmt.timeAgo(k.quando))}</span><div>${esc(corta(k.texto, 160))}</div></div>`).join('')}</div>` : ''}
          <span class="cg-pop-abrir">Abrir <i class="bi bi-arrow-right"></i></span></div></div>`;
      };
      F.pop.firstElementChild.innerHTML = `<div class="cg-pop-cab"><b>${esc(tituloDia(eu.celFixa))}</b>
          <span>${lst.length ? `${feitos}/${lst.length} resolvido(s)` : ''}</span>
          <button type="button" class="cg-pop-x" aria-label="Fechar"><i class="bi bi-x-lg"></i></button></div>
        ${lst.length ? `<ul>${lst.slice(0, 30).map((i, n) => `<li style="--n:${n}" data-id="${i.t.id}" tabindex="0">
            <div class="cg-pop-lin"><i class="cg-num ${URG_CLS[i.prioridade]}"></i><span class="t">${esc(i.t.title)}</span>${etiqueta(i)}</div>
            ${det(i)}</li>`).join('')}</ul>${lst.length > 30 ? `<div class="cg-pop-mais">+${lst.length - 30} na lista ao lado</div>` : ''}`
    : '<div class="cg-pop-vazio">Nenhum chamado neste dia.</div>'}`;
      F.pop.classList.add('fixo');
      const r = cel.getBoundingClientRect();
      const pw = F.pop.offsetWidth || 340; const ph = F.pop.offsetHeight || 140;
      let x = r.right + 34; if (x + pw > innerWidth - 8) x = Math.max(8, r.left - pw - 34);
      let y = r.top - 10;
      y = Math.max(8, Math.min(y, innerHeight - Math.max(ph, 360) - 8));
      F.pop.firstElementChild.style.maxHeight = `${innerHeight - y - 8}px`;
      const primeira = !F.pop.classList.contains('on');
      if (primeira) F.pop.classList.add('sem-mov');
      F.pop.style.transform = `translate(${x}px, ${y}px)`;
      F.pop.firstElementChild.classList.remove('troca'); void F.pop.offsetWidth; F.pop.firstElementChild.classList.add('troca');
      F.pop.classList.add('on');
      if (primeira) setTimeout(() => F.pop.classList.remove('sem-mov'), 30);
      setTimeout(() => desenharLinha(cel), primeira ? 30 : 230); // espera a lista chegar no lugar
    }

    carregar();
    return { reload: carregar };
  }

  // Calendario do painel: chamados pela data de necessidade (mesmo calendario da lista)
  function month(el, { loadTickets, state = {} } = {}) {
    return grade(el, {
      load: loadTickets, state, atraso: true, dateLabel: 'Precisa até',
      dateOf: (t) => (t.needed_by ? String(t.needed_by).slice(0, 10) : null),
      nota: 'Cada chamado aparece no dia em que o solicitante precisa dele resolvido.',
    });
  }

  return { picker, month, grade, iso, todayIso };
})();
