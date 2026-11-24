// ---------------------------------------------------------------
// Views.dashboard — Painel
//   1. Resumo (4 cartões): Abertos · Por urgência · Comigo e fechados · Radar de prazo
//   2. Calendário (esquerda) + Equipe e Novos sem técnico (direita)
//   3. Prazos (SLA) numa faixa só · manutenção vencida · distribuição · tabela de abertos
// ---------------------------------------------------------------

Views.dashboard = async function dashboard(el, opts = {}) {
  const user = API.user || {};
  if (!Roles.canSeeDashboard(user)) { location.replace('#/tickets'); return; }
  let data, noc;
  try {
    [data, noc] = await Promise.all([
      API.get('/dashboard').catch(() => ({ counts: {}, tickets: [], my_open: 0 })),
      API.get('/dashboard/noc').catch(() => null),
    ]);
  } catch (e) {
    el.innerHTML = emptyState('Erro ao carregar o painel', e.message, 'bi-exclamation-triangle');
    return;
  }

  const c = data.counts || {};
  const isClient = !Roles.isStaff(user); // gestor: painel das próprias empresas
  const v = noc?.volume || {};
  const sla = noc?.sla || {};
  const dist = noc?.distribution || {};
  const team = noc?.team || {};
  const equipe = noc?.equipe || [];
  const novos = noc?.novos_sem_tecnico || [];
  const URG = { 4: 'Operação parada', 3: 'Parada iminente', 2: 'Operação prejudicada', 1: 'Requisição' };
  const TOM = { 4: 'u-stop', 3: 'u-soon', 2: 'u-slow', 1: 'u-req' };
  const num = (n) => Number(n || 0);

  // ---------------- 1. Resumo ----------------
  const porPrio = {};
  (v.backlog_by_priority || []).forEach((p) => { porPrio[p.priority] = p.total; });
  const totalAbertos = v.open_total ?? c.open_total ?? 0;

  const radar = (sla.radar || []).map((t) => ({ ...t, min: Math.round(Number(t.minutes_left)) }));
  const vencidos = radar.filter((t) => t.min < 0);
  const em1h = radar.filter((t) => t.min >= 0 && t.min <= 60);
  const hoje24 = radar.filter((t) => t.min > 60);

  // Faixa fina de indicadores (uma linha só, acima do calendário): o calendário é o que a
  // pessoa bate o olho; os números ficam logo em cima, sem empurrar ele para baixo.
  const resumo = `
    <div class="dp-faixa">
      <a class="dp-ind" href="#/tickets" title="Chamados ainda não resolvidos">
        <b>${totalAbertos}</b><span>abertos<small>${num(v.open_today ?? c.open_today)} hoje · ${num(team.unassigned)} sem técnico</small></span></a>
      <div class="dp-ind dp-ind-urg" title="Abertos por urgência">
        ${[4, 3, 2, 1].map((p) => `<span class="dp-pill ${TOM[p]}" title="${URG[p]}">${num(porPrio[p])}</span>`).join('')}
        <span>por urgência</span></div>
      <a class="dp-ind" href="${isClient ? '#/team-tickets' : '#/mine'}" title="${isClient ? 'Chamados em aberto da sua empresa' : 'Chamados atribuídos a você'}">
        <b class="dp-tx-azul">${num(data.my_open)}</b><span>${isClient ? 'da empresa' : 'comigo'}</span></a>
      <div class="dp-ind" title="Resolvidos e fechados">
        <b class="dp-tx-verde">${num(v.closed_total)}</b><span>fechados<small>${num(v.closed_today)} hoje</small></span></div>
      <div class="dp-ind dp-radar ${vencidos.length ? 'alerta' : ''}" id="dp-radar" tabindex="0" title="Passe o mouse para ver os chamados">
        <i class="bi bi-radar"></i>
        <span class="dp-rad" data-grupo="vencidos"><b class="dp-tx-vermelho">${vencidos.length}</b> vencidos</span>
        <span class="dp-rad" data-grupo="em1h"><b class="dp-tx-laranja">${em1h.length}</b> em 1h</span>
        <span class="dp-rad" data-grupo="hoje24"><b class="dp-tx-amarelo">${hoje24.length}</b> em 24h</span>
      </div>
      <div class="dp-ind dp-ind-tempo">
        <span class="dp-vivo" title="O painel se atualiza sozinho a cada 30 segundos"><i class="bi bi-circle-fill blink-dot"></i><span id="dash-clock"></span></span>
        <button class="btn btn-sm btn-outline-secondary" id="btn-refresh" title="Atualizar agora"><i class="bi bi-arrow-clockwise"></i></button>
      </div>
    </div>`;

  // ---------------- 2. Lado direito: Equipe e Novos sem técnico ----------------
  const pill = (p, n) => (n ? `<span class="dp-pill ${TOM[p]}" title="${n} · ${URG[p]}">${n}</span>` : '');
  const equipeCard = isClient && !equipe.length ? '' : `
    <div class="card panel-card dp-bloco">
      <div class="dp-bloco-cab"><span><i class="bi bi-people"></i> Equipe</span>
        <a class="small" href="#/atendimento">meu atendimento <i class="bi bi-arrow-right"></i></a></div>
      ${equipe.length ? `<div class="dp-equipe">${equipe.map((u) => `
        <div class="dp-tec">
          <div class="dp-tec-l1">
            <span class="dp-avatar">${esc((u.name || '?').trim().charAt(0).toUpperCase())}</span>
            <b class="dp-tec-nome">${esc(u.name)}</b>
            <span class="dp-pills">${pill(4, u.p4)}${pill(3, u.p3)}${pill(2, u.p2)}${pill(1, u.p1)}${u.total ? '' : '<span class="text-muted small">sem chamados</span>'}</span>
          </div>
          ${u.atendendo ? `<a class="dp-tec-l2 dp-ativo" href="#/tickets/${u.atendendo.id}" title="Atendendo agora${u.working_since ? ` desde ${fmt.timeAgo(u.working_since)}` : ''}">
              <i class="dp-pulso"></i>Atendendo: <b>#${u.atendendo.id}</b> ${esc(u.atendendo.title)}</a>`
    : u.prioritario ? `<a class="dp-tec-l2" href="#/tickets/${u.prioritario.id}" title="O mais urgente da fila dele">
              <i class="bi bi-flag-fill ${TOM[u.prioritario.priority]}-tx"></i>Prioritário: <b>#${u.prioritario.id}</b> ${esc(u.prioritario.title)}</a>`
      : '<div class="dp-tec-l2 text-muted">Nenhum chamado com ele.</div>'}
        </div>`).join('')}</div>` : '<div class="dp-vazio">Nenhum técnico cadastrado.</div>'}
    </div>`;

  const novosCard = `
    <div class="card panel-card dp-bloco">
      <div class="dp-bloco-cab"><span><i class="bi bi-inbox"></i> Novos sem técnico</span>
        <span class="tg ${num(team.unassigned) ? 'tg-amber' : 'tg-gray'}">${num(team.unassigned)}</span></div>
      ${novos.length ? `<div class="dp-novos">${novos.map((t) => `
        <a class="dp-novo ${TOM[t.priority] || 'u-req'}" href="#/tickets/${t.id}">
          <div class="dp-novo-l1"><b>${esc(t.title)}</b><span class="tg tg-amber">Não atribuído</span></div>
          <div class="dp-novo-l2">#${t.id} · ${esc(t.impact_name || URG[t.priority] || '')}${t.category_name ? ` · ${esc(t.category_name)}` : ''}</div>
          <div class="dp-novo-l2">${t.location_name ? `<i class="bi bi-geo-alt"></i>${esc(t.location_name)} · ` : ''}${esc(t.requester_name || '')} · aberto ${fmt.timeAgo(t.created_at)}</div>
        </a>`).join('')}</div>` : '<div class="dp-vazio"><i class="bi bi-check2-circle text-success"></i> Todos os chamados têm técnico.</div>'}
    </div>`;

  const calCard = `
    <div class="card panel-card dp-bloco">
      <div class="dp-bloco-cab"><span><i class="bi bi-calendar3"></i> Calendário de necessidade</span>
        <span class="small text-muted">o dia em que cada solicitante precisa do chamado resolvido</span></div>
      <div class="dp-cal-corpo"><div id="dash-cal"></div></div>
    </div>`;

  // ---------------- 3. Prazos, manutenção, distribuição e tabela ----------------
  const compliance = sla.compliance || { pct: 100, with_sla: 0, within_sla: 0 };
  const realtime = sla.realtime_compliance ?? 100;
  const corPct = (p) => (p >= 98 ? 'text-success' : p >= 90 ? 'text-warning' : 'text-danger');
  const prazos = `
    <div class="card panel-card dp-prazos">
      <div class="dp-prazo"><b class="${corPct(realtime)}">${realtime}%</b><span>no prazo agora</span><small>${num(sla.overdue)} vencidos · ${num(sla.without_sla)} sem prazo</small></div>
      <div class="dp-prazo"><b class="${corPct(compliance.pct)}">${compliance.pct}%</b><span>resolvidos no prazo</span><small>${compliance.within_sla}/${compliance.with_sla} nos últimos 30 dias</small></div>
      <div class="dp-prazo"><b>${num(sla.tmr_hours)}h</b><span>até a 1ª resposta</span><small>média, 30 dias</small></div>
      <div class="dp-prazo"><b>${num(sla.tma_hours)}h</b><span>até resolver</span><small>média, 30 dias</small></div>
    </div>`;

  const maint = noc?.maintenance || {};
  const maintAlert = num(maint.overdue_count) > 0 ? `
    <div class="card panel-card dp-bloco dp-manut">
      <div class="dp-bloco-cab"><span><i class="bi bi-tools"></i> Manutenção de equipamentos vencida</span>
        <span class="tg tg-red">${maint.overdue_count}</span></div>
      <div class="dp-manut-lista">${(maint.items || []).map((a) => `
        <a class="dp-manut-item" href="#/inventory/${a.id}"><b>${esc(a.name)}</b> ${esc(a.asset_tag || '')}
          <span class="multi-empresa text-muted">· ${esc(a.entity_name || '')}</span>
          <span class="tg tg-red ms-auto">${a.days_overdue} dia(s)</span></a>`).join('')}</div>
    </div>` : '';

  const STATUS = { 1: 'Novo', 2: 'Atribuído', 3: 'Em andamento', 4: 'Em pausa', 5: 'Resolvido', 6: 'Fechado', 7: 'Cancelado' };
  const totStatus = Math.max(1, (dist.by_status || []).reduce((a, b) => a + b.total, 0));
  const distRow = `
    <div class="card panel-card dp-bloco">
      <div class="dp-bloco-cab"><span><i class="bi bi-pie-chart"></i> Distribuição</span></div>
      <div class="dp-dist">
        <div><div class="dp-dist-tit">Por situação</div>${(dist.by_status || []).map((r) => `
          <div class="dp-barra"><span>${STATUS[r.status] || r.status}</span><i style="--w:${Math.round((r.total / totStatus) * 100)}%"></i><b>${r.total}</b></div>`).join('') || '<span class="text-muted small">sem dados</span>'}</div>
        <div><div class="dp-dist-tit">Abertos por categoria</div>${(dist.by_category || []).map((r) => `
          <div class="dp-barra"><span>${esc(r.category)}</span><i style="--w:${Math.round((r.total / Math.max(1, ...(dist.by_category || []).map((x) => x.total))) * 100)}%"></i><b>${r.total}</b></div>`).join('') || '<span class="text-muted small">sem dados</span>'}</div>
      </div>
    </div>`;

  const rows = (data.tickets || []).slice(0, 12).map((t) => `
    <tr class="ticket-row ${TOM[t.priority] || ''}" data-id="${t.id}">
      <td class="fw-bold text-primary">#${t.id}</td>
      <td class="ticket-title">${esc(t.title)}</td>
      <td>${badgeStatus(t.status)} ${t.approval_status === 'pending' ? '<span class="badge bd-pending-approval ms-1"><i class="bi bi-check2-circle"></i> aprovação</span>' : ''}</td>
      <td>${t.assigned_name ? esc(t.assigned_name) : '<span class="tg tg-amber">Não atribuído</span>'}</td>
      <td class="text-muted small">${fmt.timeAgo(t.updated_at)}</td>
    </tr>`).join('');
  const table = `
    <div class="card panel-card dp-bloco">
      <div class="dp-bloco-cab"><span><i class="bi bi-activity text-success blink-dot"></i> Últimas movimentações</span>
        <a class="small" href="#/tickets">ver todos <i class="bi bi-arrow-right"></i></a></div>
      <div class="table-responsive"><table class="table table-sm table-hover align-middle dashboard-table mb-0">
        <thead><tr><th style="width:70px">Nº</th><th>Título</th><th style="width:150px">Situação</th><th style="width:170px">Técnico</th><th style="width:110px">Atualizado</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="text-center py-4 text-muted">Nenhum chamado em aberto.</td></tr>'}</tbody>
      </table></div>
    </div>`;

  const header = '';

  // Atualização sem piscar: na primeira vez monta tudo; depois troca só os blocos que mudaram
  // (o calendário fica no lugar, sem perder o mês nem o dia escolhido).
  const secoes = {
    topo: header + resumo, lado: equipeCard + novosCard, prazos, manut: maintAlert, dist: distRow, tabela: table,
  };
  const montado = !!el.querySelector('[data-dash="topo"]') && opts.silent;
  if (!montado) {
    el.innerHTML = `<div data-dash="topo"></div>
      <div class="dp-meio"><div class="dp-meio-cal">${calCard}</div><div class="dp-meio-lado" data-dash="lado"></div></div>
      <div data-dash="prazos"></div><div data-dash="manut"></div><div data-dash="dist"></div><div data-dash="tabela"></div>`;
    dashboard._calState = dashboard._calState || {};
    dashboard._cal = CalendarUI.month(document.getElementById('dash-cal'), {
      state: dashboard._calState,
      loadTickets: (from, to) => API.get(`/tickets/calendar?from=${from}&to=${to}`),
    });
  } else if (dashboard._cal?.reload && !el.querySelector('#dash-cal:hover')) {
    dashboard._cal.reload();
  }
  for (const [k, html] of Object.entries(secoes)) {
    const box = el.querySelector(`[data-dash="${k}"]`);
    if (box && box._html !== html) { box.innerHTML = html; box._html = html; }
  }

  // ---- Radar de prazo: passar o mouse mostra a prévia dos chamados (mesmo jeito do calendário) ----
  const radarEl = document.getElementById('dp-radar');
  if (radarEl && !radarEl.dataset.ok) {
    radarEl.dataset.ok = '1';
    let dica = document.getElementById('dash-dica');
    if (!dica) { dica = document.createElement('div'); dica.id = 'dash-dica'; document.body.appendChild(dica); }
    const grupos = { vencidos: ['Prazo vencido', vencidos], em1h: ['Vence em até 1h', em1h], hoje24: ['Vence nas próximas 24h', hoje24] };
    const tempo = (m) => (m < 0 ? `venceu há ${fmtMin(-m)}` : `vence em ${fmtMin(m)}`);
    const montar = (chave) => {
      const lista = chave ? [[...grupos[chave]]] : Object.values(grupos);
      const html = lista.filter(([, l]) => l.length).map(([tit, l]) => `
        <div class="dd-grupo">${esc(tit)} (${l.length})</div>
        ${l.slice(0, 6).map((t) => `<div class="dd-item"><i class="dd-dot ${TOM[t.priority] || 'u-req'}"></i>
          <span><b>#${t.id}</b> ${esc(t.title)}<small>${tempo(t.min)} · ${esc(t.assigned_name || 'sem técnico')}${t.location_name ? ` · ${esc(t.location_name)}` : ''}</small></span></div>`).join('')}
        ${l.length > 6 ? `<div class="dd-mais">+${l.length - 6}</div>` : ''}`).join('');
      dica.innerHTML = html || '<div class="dd-vazio"><i class="bi bi-check2-circle"></i> Nenhum chamado com prazo perto de vencer.</div>';
    };
    let atual = null;
    radarEl.addEventListener('mousemove', (ev) => {
      const linha = ev.target.closest('[data-grupo]');
      const chave = linha ? linha.dataset.grupo : '';
      if (chave !== atual) { atual = chave; montar(chave || null); }
      dica.classList.add('on');
      const w = dica.offsetWidth; const h = dica.offsetHeight;
      let x = ev.clientX + 16; if (x + w > innerWidth - 6) x = ev.clientX - w - 12;
      let y = ev.clientY + 18; if (y + h > innerHeight - 6) y = ev.clientY - h - 12;
      dica.style.transform = `translate(${x}px, ${y}px)`;
    });
    radarEl.addEventListener('mouseleave', () => { dica.classList.remove('on'); atual = null; });
    radarEl.addEventListener('click', () => {
      const primeiro = vencidos[0] || em1h[0] || hoje24[0];
      if (primeiro) location.hash = `#/tickets/${primeiro.id}`;
    });
    window.addEventListener('hashchange', () => dica.classList.remove('on'), { once: true });
  }

  const clock = document.getElementById('dash-clock');
  if (clock) {
    if (dashboard._clockTimer) clearInterval(dashboard._clockTimer);
    const tick = () => {
      if (location.hash !== '#/dashboard') {
        clearInterval(dashboard._clockTimer); dashboard._clockTimer = null;
        if (dashboard._nocTimer) { clearInterval(dashboard._nocTimer); dashboard._nocTimer = null; }
        return;
      }
      const relogio = document.getElementById('dash-clock');
      if (relogio) relogio.textContent = new Date().toLocaleTimeString('pt-BR');
    };
    tick(); dashboard._clockTimer = setInterval(tick, 1000);
  }
  if (dashboard._nocTimer) clearInterval(dashboard._nocTimer);
  dashboard._nocTimer = setInterval(() => {
    if (location.hash !== '#/dashboard') {
      clearInterval(dashboard._nocTimer); dashboard._nocTimer = null;
      if (dashboard._clockTimer) { clearInterval(dashboard._clockTimer); dashboard._clockTimer = null; }
      return;
    }
    if (document.hidden) return; // aba escondida: não gasta
    dashboard(el, { silent: true });
  }, 30000);
  if (!dashboard._hashListener) {
    dashboard._hashListener = true;
    window.addEventListener('hashchange', () => {
      if (location.hash !== '#/dashboard') {
        if (dashboard._nocTimer) { clearInterval(dashboard._nocTimer); dashboard._nocTimer = null; }
        if (dashboard._clockTimer) { clearInterval(dashboard._clockTimer); dashboard._clockTimer = null; }
      }
    });
  }
  document.getElementById('btn-refresh').onclick = () => dashboard(el, { silent: true });
  el.querySelectorAll('.ticket-row:not([data-ok])').forEach((row) => {
    row.dataset.ok = '1';
    row.addEventListener('click', () => { location.hash = `#/tickets/${row.dataset.id}`; });
  });
};

// minutos -> "35 min" / "2h 10min" / "3 dias"
function fmtMin(m) {
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}min` : ''}`;
  const d = Math.floor(m / (60 * 24));
  return `${d} dia${d > 1 ? 's' : ''}`;
}
