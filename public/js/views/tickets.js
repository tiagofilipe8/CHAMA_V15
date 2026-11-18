// ---------------------------------------------------------------
// Views.tickets — Lista de chamados com filtros (portal + equipe)
//   opts.team = true  → "Chamados da Equipe" (gestor: todos da entidade)
//   (default)         → "Meus Chamados" (cliente: apenas abertos por ele)
// ---------------------------------------------------------------

Views.tickets = async function tickets(el, opts = {}) {
  const user = API.user || {};
  const params = new URLSearchParams();
  const isClient = user.role === 'client';
  const isManager = isClient && (user.client_level || 1) === 2;

  if (opts.team && !isManager) {
    location.hash = '#/tickets';
    toast('Apenas gestores acessam "Chamados da Equipe".', 'warning');
    return;
  }

  function renderToolbar() {
    const entFilter = user.role === 'admin'
      ? `<select class="form-select form-select-sm" id="f-entity"></select>` : '';
    const asgFilter = user.role !== 'client'
      ? `<select class="form-select form-select-sm" id="f-assigned">
           <option value="">Todos os técnicos</option>
           <option value="me">Meus chamados</option>
           <option value="none">Não atribuídos</option>
         </select>` : '';
    return `
      <div class="card panel-card mb-3">
        <div class="card-body py-3">
          <div class="row g-2 align-items-center">
            <div class="col-md-4 col-lg-3">
              <input class="form-control form-control-sm" id="f-q" placeholder="Buscar por título, número...">
            </div>
            <div class="col-6 col-md-2 col-lg-2">
              <select class="form-select form-select-sm" id="f-status">
                <option value="open">Em aberto</option>
                <option value="1">Novo</option>
                <option value="2">Atribuído</option>
                <option value="3">Em andamento</option>
                <option value="4">Pendente</option>
                <option value="5">Resolvido</option>
                <option value="closed">Fechados/Cancelados</option>
                <option value="all">Todos</option>
              </select>
            </div>
            <div class="col-6 col-md-2 col-lg-2">
              <select class="form-select form-select-sm" id="f-priority">
                <option value="">Prioridade</option>
                <option value="1">Baixa</option>
                <option value="2">Média</option>
                <option value="3">Alta</option>
                <option value="4">Urgente</option>
              </select>
            </div>
            <div class="col-6 col-md-2 col-lg-2">${asgFilter}</div>
            <div class="col-6 col-md-2 col-lg-2">${entFilter}</div>
            <div class="col-auto ms-auto">
              <button class="btn btn-primary btn-sm" onclick="location.hash='#/new'"><i class="bi bi-plus-lg"></i> Novo</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  async function loadEntities(selectEl) {
    if (!selectEl) return;
    try {
      const ents = await API.get('/entities');
      selectEl.innerHTML = `<option value="">Todas as entidades</option>` +
        ents.filter((e) => e.active).map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    } catch {}
  }

  function buildParams() {
    const p = new URLSearchParams();
    const q = document.getElementById('f-q')?.value?.trim();
    const st = document.getElementById('f-status')?.value;
    const pr = document.getElementById('f-priority')?.value;
    const asg = document.getElementById('f-assigned')?.value;
    const ent = document.getElementById('f-entity')?.value;
    if (q) p.set('q', q);
    if (st) p.set('status', st);
    if (pr) p.set('priority', pr);
    if (asg) p.set('assigned', asg);
    if (ent) p.set('entity_id', ent);
    if (isClient && !opts.team) p.set('requester', 'me');
    return p;
  }

  el.innerHTML = `
    ${isClient
      ? `<div class="d-flex align-items-center justify-content-between gap-2 mb-2">
           <div class="alert alert-info d-flex align-items-center gap-2 py-2 small mb-0 flex-grow-1">
             <i class="bi bi-info-circle"></i>
             ${opts.team
               ? 'Você é <b>gestor</b>: visualiza todos os chamados da sua entidade.'
               : 'Você visualiza os chamados abertos por você.'}
           </div>
           ${isManager ? `
             <a class="btn btn-sm btn-outline-primary text-nowrap" href="${opts.team ? '#/tickets' : '#/team-tickets'}">
               <i class="bi ${opts.team ? 'bi-person-lines-fill' : 'bi-people'}"></i>
               ${opts.team ? 'Meus Chamados' : 'Chamados da Equipe'}
             </a>` : ''}
         </div>`
      : ''}
    ${renderToolbar()}
    <div id="tickets-body">${spinner()}</div>`;

  loadEntities(document.getElementById('f-entity'));

  const filters = ['f-q', 'f-status', 'f-priority', 'f-assigned', 'f-entity'];
  const apply = async () => {
    const body = document.getElementById('tickets-body');
    if (!body) return;
    try {
      const tk = await API.get('/tickets?' + buildParams().toString());
      renderList(tk, body);
    } catch (e) {
      body.innerHTML = emptyState('Erro ao carregar', e.message, 'bi-exclamation-triangle');
    }
  };
  filters.forEach((id) => {
    const elId = document.getElementById(id);
    if (elId) elId.addEventListener('change', apply);
  });
  const q = document.getElementById('f-q');
  if (q) {
    let timer;
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(apply, 350); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
  }

  await apply();
};

function renderList(tk, body) {
  if (!tk || !tk.length) {
    body.innerHTML = emptyState('Nenhum chamado encontrado', 'Ajuste os filtros ou abra um novo chamado.', 'bi-search');
    return;
  }
  body.innerHTML = `
    <div class="table-responsive">
      <table class="table table-hover align-middle mb-0">
        <thead>
          <tr>
            <th>ID</th><th>Status</th><th>Título</th><th>Técnico</th>
            <th>Requerente</th><th>Prioridade</th><th>Abertura</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${tk.map((t) => `
            <tr class="ticket-row" data-id="${t.id}">
              <td class="fw-bold text-primary">${esc(t.number)}</td>
              <td>${badgeStatus(t.status)}</td>
              <td>${esc(t.title)}<br><small class="text-muted">${esc(t.entity_name || '')} · ${esc(t.category_name || '')}</small></td>
              <td>${t.assigned_name ? `<span class="tech-chip"><i class="bi bi-person-badge"></i> ${esc(t.assigned_name)}</span>` : '—'}</td>
              <td>${esc(t.requester_name || '—')}</td>
              <td>${badgePriority(t.priority)}</td>
              <td class="text-muted small">${fmt.date(t.created_at)}</td>
              <td><a class="btn btn-sm btn-outline-primary" href="#/tickets/${t.id}"><i class="bi bi-eye"></i></a></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  body.querySelectorAll('.ticket-row').forEach((row) => {
    row.addEventListener('click', () => { location.hash = `#/tickets/${row.dataset.id}`; });
  });
}