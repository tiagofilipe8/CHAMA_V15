// ---------------------------------------------------------------
// Views.dashboard — NOC Dashboard (Network Operations Center)
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
  const isClient = !Roles.isStaff(user); // gestor / admin local: painel das próprias empresas
  const v = noc?.volume || {};
  const sla = noc?.sla || {};
  const dist = noc?.distribution || {};
  const team = noc?.team || {};

  const statCard = (label, value, icon, tone, sub, extra) => `
    <div class="stat-card ${tone || ''}">
      <div class="stat-icon"><i class="bi ${icon}"></i></div>
      <div class="stat-info">
        <div class="stat-value">${value}</div>
        <div class="stat-label">${label}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
        ${extra || ''}
      </div>
    </div>`;

  const prioLabel = LABELS.priority;
  const PRIO_BADGE_D = { 1: 'prio-low', 2: 'prio-med', 3: 'prio-high', 4: 'prio-urgent' };

  // 1. Visão Geral e Volume
  const backlogByPrio = (v.backlog_by_priority || []).map(p => `<span class="badge ${PRIO_BADGE_D[p.priority]} me-1">${prioLabel[p.priority]}: ${p.total}</span>`).join('') || '<span class="text-muted small">sem backlog</span>';

  const volumeCards = `
    <div class="stats-row">
      ${statCard('Abertos', v.open_total ?? c.open_total ?? 0, 'bi-journal-text', 'tone-primary', `${v.open_today ?? c.open_today ?? 0} hoje · ${v.closed_today ?? 0} fechados hoje`)}
      ${statCard('Backlog', v.backlog_total ?? c.open_total ?? 0, 'bi-stack', 'tone-amber', backlogByPrio)}
      ${statCard(isClient ? 'Chamados abertos' : 'Meus em aberto', data.my_open ?? 0, 'bi-person-check', 'tone-green', isClient ? '' : 'Atribuídos a mim')}
      ${statCard('Fechados', v.closed_total ?? 0, 'bi-check-circle', 'tone-success', `${v.closed_today ?? 0} hoje`)}
    </div>`;

  // 2. SLA
  const compliance = sla.compliance || { pct: 100, with_sla: 0, within_sla: 0 };
  const realtime = sla.realtime_compliance ?? 100;
  const slaCards = `
    <div class="row g-3 mt-1">
      <div class="col-md-3">
        <div class="card panel-card h-100">
          <div class="card-body text-center">
            <div class="display-6 fw-bold ${realtime >= 98 ? 'text-success' : realtime >= 90 ? 'text-warning' : 'text-danger'}">${realtime}%</div>
            <div class="small text-muted">Dentro do SLA agora</div>
            <div class="progress mt-2" style="height:8px"><div class="progress-bar ${realtime >= 98 ? 'bg-success' : realtime >= 90 ? 'bg-warning' : 'bg-danger'}" style="width:${realtime}%"></div></div>
            <div class="small mt-1">${sla.overdue ?? 0} vencidos · ${sla.without_sla ?? 0} sem SLA</div>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card panel-card h-100">
          <div class="card-body text-center">
            <div class="display-6 fw-bold ${compliance.pct >= 98 ? 'text-success' : 'text-warning'}">${compliance.pct}%</div>
            <div class="small text-muted">SLA Resolução (30d)</div>
            <div class="small">${compliance.within_sla}/${compliance.with_sla} dentro do prazo</div>
            <div class="small text-muted">TMA ${sla.tma_hours ?? 0}h · TMR ${sla.tmr_hours ?? 0}h</div>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card panel-card h-100 border-warning">
          <div class="card-body text-center">
            <div class="h4 mb-1"><span class="badge text-bg-warning">${sla.risk_30m ?? 0}</span> <span class="badge text-bg-danger">${sla.risk_1h ?? 0}</span></div>
            <div class="small text-muted">Radar de risco</div>
            <div class="small">≤30min · ≤1h para estourar</div>
            <div class="small ${(sla.risk_30m || 0) > 0 ? 'text-danger fw-bold' : 'text-muted'}">${(sla.risk_30m || 0) > 0 ? '<i class="bi bi-exclamation-triangle-fill me-1"></i>Atenção: prazo quase vencendo' : 'Sem risco iminente'}</div>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card panel-card h-100">
          <div class="card-body">
            <div class="small fw-bold mb-1"><i class="bi bi-stopwatch me-1"></i> SLA 1ª Resposta / Resolução</div>
            <div class="small">TMR médio: <b>${sla.tmr_hours ?? 0}h</b> (1ª resposta)</div>
            <div class="small">TMA médio: <b>${sla.tma_hours ?? 0}h</b> (resolução)</div>
            <div class="small text-muted mt-1">Prazo (SLA) de cada chamado</div>
          </div>
        </div>
      </div>
    </div>`;

  // Radar tabela
  const radarRows = (sla.radar || []).map(t => {
    const mins = Math.round(t.minutes_left);
    const tone = mins < 0 ? 'table-danger' : mins <= 30 ? 'table-warning' : '';
    const badge = mins < 0 ? '<span class="badge text-bg-danger">VENCIDO</span>' : mins <= 30 ? '<span class="badge text-bg-warning text-dark">≤30m</span>' : '<span class="badge text-bg-info">≤1h</span>';
    return `<tr class="${tone} ticket-row" data-id="${t.id}">
      <td class="fw-bold">${esc(t.number)}</td>
      <td>${esc(t.title)}</td>
      <td>${badgePriority(t.priority)}</td>
      <td class="multi-empresa">${esc(t.entity_name||'')}</td>
      <td>${esc(t.assigned_name||'—')}</td>
      <td>${t.due_at ? fmt.dateTime(t.due_at) : '—'}</td>
      <td>${badge} ${mins < 0 ? Math.abs(mins)+'m atraso' : mins+'m restantes'}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="text-center text-muted py-3">Nenhum chamado em risco</td></tr>`;

  const radarCard = `
    <div class="card panel-card mt-3">
      <div class="card-header d-flex justify-content-between align-items-center">
        <strong><i class="bi bi-radar me-1 text-danger"></i> Radar de Risco — SLA próximo do estouro</strong>
        <span class="badge text-bg-dark">${(sla.radar||[]).length} chamados</span>
      </div>
      <div class="table-responsive"><table class="table table-sm table-hover mb-0">
        <thead><tr><th>Chamado</th><th>Título</th><th>Urgência</th><th class="multi-empresa">Empresa</th><th>Técnico</th><th>Prazo SLA</th><th>Status</th></tr></thead>
        <tbody>${radarRows}</tbody>
      </table></div>
    </div>`;

  // 3. Distribuição
  const byStatus = (dist.by_status || []).map(r => {
    const label = {1:'Novo',2:'Atribuído',3:'Em andamento',4:'Pendente',5:'Resolvido',6:'Fechado',7:'Cancelado'}[r.status] || r.status;
    return `<div class="d-flex justify-content-between align-items-center mb-1"><span>${label}</span><span class="badge text-bg-primary">${r.total}</span></div><div class="progress mb-2" style="height:6px"><div class="progress-bar" style="width:${Math.round((r.total/Math.max(1,(dist.by_status||[]).reduce((a,b)=>a+b.total,0)))*100)}%"></div></div>`;
  }).join('') || '<span class="text-muted small">sem dados</span>';

  const byCat = (dist.by_category || []).map(r => `<div class="d-flex justify-content-between"><span>${esc(r.category)}</span><span class="badge text-bg-secondary">${r.total}</span></div>`).join('') || '<span class="text-muted small">sem dados</span>';

  const byPrio = (dist.by_priority || []).map(r => `<span class="badge ${PRIO_BADGE_D[r.priority]} me-1">${prioLabel[r.priority]}: ${r.total}</span>`).join('');

  const distRow = `
    <div class="row g-3 mt-1">
      <div class="col-md-4"><div class="card panel-card h-100"><div class="card-header">Por status</div><div class="card-body small">${byStatus}</div></div></div>
      <div class="col-md-4"><div class="card panel-card h-100"><div class="card-header">Por categoria</div><div class="card-body small">${byCat}</div></div></div>
      <div class="col-md-4"><div class="card panel-card h-100"><div class="card-header">Por urgência / fila</div><div class="card-body small">${byPrio}<hr><div>Não atribuídos: <span class="badge text-bg-warning">${team.unassigned ?? 0}</span></div></div></div></div>
    </div>`;

  // 4. Equipe
  const workloadRows = (team.workload || []).map(u => {
    const bar = Math.min(100, (u.open_count/ Math.max(1, Math.max(...team.workload.map(x=>x.open_count))))*100);
    const tone = u.open_count >=8 ? 'bg-danger' : u.open_count >=5 ? 'bg-warning' : 'bg-success';
    return `<div class="mb-2"><div class="d-flex justify-content-between small"><span>${esc(u.name)}</span><span class="badge text-bg-primary">${u.open_count}</span></div><div class="progress" style="height:6px"><div class="progress-bar ${tone}" style="width:${bar}%"></div></div></div>`;
  }).join('') || '<span class="text-muted small">sem técnicos</span>';

  const prodRows = (team.productivity || []).map(u => `<div class="d-flex justify-content-between small"><span>${esc(u.name)}</span><span class="badge text-bg-success">${u.closed_today} fechados hoje</span></div>`).join('') || '<span class="text-muted small">nenhum fechamento hoje</span>';

  // (o antigo "Status dos Analistas" foi tirado: era adivinhado pela quantidade de chamados, não era real)
  const teamRow = `
    <div class="row g-3 mt-1">
      <div class="col-md-6"><div class="card panel-card h-100"><div class="card-header"><i class="bi bi-people me-1"></i> Chamados abertos por técnico</div><div class="card-body">${workloadRows}</div></div></div>
      <div class="col-md-6"><div class="card panel-card h-100"><div class="card-header"><i class="bi bi-trophy me-1"></i> Fechados hoje por técnico</div><div class="card-body small">${prodRows}</div></div></div>
    </div>`;

  // Tabela de chamados em aberto (original)
  const rows = (data.tickets || []).slice(0, 20).map((t) => `
    <tr class="ticket-row" data-id="${t.id}">
      <td class="fw-bold text-primary">${esc(t.number)}</td>
      <td>${badgeStatus(t.status)} ${t.approval_status === 'pending' ? '<span class="badge bd-pending-approval ms-1"><i class="bi bi-check2-circle"></i> aprovação</span>' : ''}</td>
      <td class="ticket-title">${esc(t.title)}</td>
      <td>${t.assigned_name ? `<span class="tech-chip"><i class="bi bi-person-badge"></i> ${esc(t.assigned_name)}</span>` : '<span class="text-muted">— não atribuído —</span>'}</td>
      <td>${esc(t.requester_name || '—')}<br><small class="text-muted multi-empresa">${esc(t.entity_name || '')}</small></td>
      <td>${badgePriority(t.priority)}</td>
      <td class="text-muted small">${fmt.timeAgo(t.updated_at)}</td>
    </tr>`).join('');

  const table = `
    <div class="card panel-card mt-3">
      <div class="card-header d-flex align-items-center justify-content-between">
        <div><i class="bi bi-activity me-1 text-success blink-dot"></i><strong>Chamados em aberto — tempo real</strong> <span class="badge text-bg-warning ms-2">${team.unassigned ?? 0} não atribuídos</span></div>
        <div class="d-flex align-items-center gap-2"><span class="text-muted small" id="dash-clock"></span><button class="btn btn-sm btn-outline-secondary" id="btn-refresh"><i class="bi bi-arrow-clockwise"></i> Atualizar</button></div>
      </div>
      <div class="table-responsive"><table class="table table-hover align-middle dashboard-table mb-0">
        <thead><tr><th style="width:120px">Chamado</th><th style="width:110px">Status</th><th>Título</th><th style="width:180px">Técnico</th><th style="width:180px">Solicitante</th><th style="width:110px">Urgência</th><th style="width:110px">Atualização</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="text-center py-5 text-muted">Nenhum chamado em aberto.</td></tr>`}</tbody>
      </table></div>
    </div>`;

  const header = `
    <div class="d-flex justify-content-between align-items-center mb-2">
      <h4 class="mb-0"><i class="bi bi-broadcast me-2 text-danger"></i> Painel NOC</h4>
      <span class="badge text-bg-dark"><i class="bi bi-circle-fill text-success blink-dot me-1"></i> Tempo real</span>
    </div>`;

  const maint = noc?.maintenance || {};
  const maintAlert = (maint.overdue_count || 0) > 0 ? `
    <div class="card panel-card mt-3 border-danger">
      <div class="card-header bg-danger text-white d-flex justify-content-between align-items-center">
        <strong><i class="bi bi-tools me-1"></i> Manutenção de equipamentos vencida</strong>
        <span class="badge text-bg-dark">${maint.overdue_count} vencida(s)</span>
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-hover mb-0">
          <thead><tr><th>Equipamento</th><th class="multi-empresa">Empresa</th><th>Vencimento</th><th>Atraso</th></tr></thead>
          <tbody>
            ${(maint.items || []).map(a => `
              <tr class="table-danger asset-row" data-id="${a.id}" style="cursor:pointer">
                <td><b>${esc(a.name)}</b> ${esc(a.asset_tag || '')}${a.next_maintenance_notes ? `<br><small class="text-muted">${esc(a.next_maintenance_notes)}</small>` : ''}</td>
                <td class="multi-empresa">${esc(a.entity_name || '')}</td>
                <td>${String(a.next_maintenance_date).slice(0, 10)}</td>
                <td><span class="badge text-bg-danger">${a.days_overdue} dia(s)</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  const calCard = `
    <div class="card panel-card mt-3">
      <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
        <span><i class="bi bi-calendar3 me-1"></i> <strong>Calendário de necessidade</strong>
          <span class="text-muted small ms-1">o dia em que cada solicitante precisa do chamado resolvido</span></span>
      </div>
      <div class="card-body"><div id="dash-cal"></div></div>
    </div>`;

  // Atualização sem piscar: na primeira vez monta tudo; depois troca só os blocos que mudaram
  // (o calendário fica no lugar, sem perder o mês nem o dia escolhido).
  const secoes = { topo: header + volumeCards, manut: maintAlert, sla: slaCards + radarCard, dist: distRow, equipe: teamRow, tabela: table };
  const montado = !!el.querySelector('[data-dash="topo"]') && opts.silent;
  if (!montado) {
    el.innerHTML = `<div data-dash="topo"></div>${calCard}<div data-dash="manut"></div><div data-dash="sla"></div><div data-dash="dist"></div><div data-dash="equipe"></div><div data-dash="tabela"></div>`;
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
  // limpeza extra ao navegar
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
  el.querySelectorAll('.asset-row:not([data-ok])').forEach((row) => {
    row.dataset.ok = '1';
    row.addEventListener('click', () => { location.hash = `#/inventory/${row.dataset.id}`; });
  });
};
