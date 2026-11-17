// ---------------------------------------------------------------
// Views administrativas + perfil
// ---------------------------------------------------------------

// ---------------- Usuarios ----------------
// Perfil com a cor do módulo: gestão = violeta, equipe Orcim = azul, posto = verde-água, usuário = cinza
function tagPerfil(u) {
  const posto = u.role === 'client' && u.location_name && u.name === u.location_name;
  const [cor, icone] = posto ? ['tg-teal', 'bi-shop']
    : ({ admin: ['tg-violet', 'bi-shield-lock'], admin_local: ['tg-violet', 'bi-shield'], moderator: ['tg-blue', 'bi-funnel'],
      technician: ['tg-blue', 'bi-tools'] }[u.role]
      || (Number(u.client_level) === 2 ? ['tg-violet', 'bi-briefcase'] : ['tg-gray', 'bi-person']));
  return `<span class="tg ${cor}"><i class="bi ${icone}"></i>${esc(posto ? 'Posto' : Roles.label(u))}</span>`;
}

Views.adminUsers = async function adminUsers(el) {
  const _u = currentUser();
  // admin local e gestor administram somente usuarios da propria empresa
  const _isManager = !Roles.isMaster(_u);
  if (!Roles.canManageUsers(_u)) {
    location.hash = '#/dashboard';
    toast('Seu perfil não pode gerenciar usuários.', 'warning');
    return;
  }
  el.innerHTML = `
    <div class="card panel-card mb-3">
      <div class="card-body py-3 d-flex flex-wrap gap-2 align-items-center">
        <input class="form-control form-control-sm" id="u-q" style="max-width:260px" placeholder="Buscar usuário...">
        <select class="form-select form-select-sm" id="u-role" style="max-width:170px">
          <option value="">Todos os perfis</option>
          <option value="admin">Administrador Mestre</option>
          <option value="admin_local">Administrador Local</option>
          <option value="moderator">Moderador</option>
          <option value="technician">Técnico</option>
          <option value="client">Usuário / Gestor</option>
        </select>
        <select class="form-select form-select-sm multi-empresa" id="u-entity" style="max-width:220px">
          <option value="">Todas as empresas</option>
        </select>
        <button class="btn btn-primary btn-sm ms-auto" id="btn-new-user"><i class="bi bi-person-plus"></i> Novo usuário</button>
      </div>
    </div>
    <div class="card panel-card">
      <div class="table-responsive"><table class="table table-hover align-middle mb-0">
        <thead><tr><th>Usuário</th><th>Perfil</th><th class="multi-empresa">Empresa</th><th>Localização</th><th>Contato</th><th>Ativo</th><th class="text-end">Ações</th></tr></thead>
        <tbody id="u-body"><tr><td colspan="7" class="text-center py-3 text-muted">Carregando usuários...</td></tr></tbody>
      </table></div>
    </div>`;

  const load = async () => {
    const p = new URLSearchParams();
    const q = document.getElementById('u-q').value.trim();
    const role = document.getElementById('u-role').value;
    const ent = document.getElementById('u-entity').value;
    if (q) p.set('q', q);
    if (role) p.set('role', role);
    if (_isManager) {
      // gestor só vê própria entidade — ignora filtro
      if (_u.entity_id) p.set('entity_id', _u.entity_id);
    } else if (ent) p.set('entity_id', ent);
    try {
      const users = await API.get('/users?' + p);
      document.getElementById('u-body').innerHTML = users.length
        ? users.map((u) => {
            const isSelf = String(u.id) === String(API.user.id);
            return `
          <tr>
            <td><strong>${esc(u.name)}</strong><br><small class="text-muted">@${esc(u.username)}</small></td>
            <td>${tagPerfil(u)}</td>
            <td class="multi-empresa">${esc(u.entity_name || '—')}${(u.extra_entity_ids || []).length ? `<br><small class="text-muted">+${u.extra_entity_ids.length} empresa(s)</small>` : ''}</td>
            <td>${esc(u.location_name || '—')}</td>
            <td>${esc(u.email || '')}<br><small class="text-muted">${esc(u.phone || '')}</small></td>
            <td>${u.active ? '<span class="tg tg-green">Ativo</span>' : '<span class="tg tg-gray">Inativo</span>'}</td>
            <td class="text-end">
              <button class="btn btn-sm btn-outline-primary u-edit" data-id="${u.id}" title="Editar"><i class="bi bi-pencil"></i></button>
              ${u.active
                ? `<button class="btn btn-sm btn-outline-warning u-deactivate" data-id="${u.id}" ${isSelf ? 'disabled' : ''} title="Desativar"><i class="bi bi-person-slash"></i></button>`
                : `<button class="btn btn-sm btn-outline-success u-activate" data-id="${u.id}" title="Ativar"><i class="bi bi-person-check"></i></button>`}
              <button class="btn btn-sm btn-outline-danger u-delete" data-id="${u.id}" ${isSelf ? 'disabled' : ''} title="Excluir permanentemente"><i class="bi bi-trash"></i></button>
            </td>
          </tr>`; }).join('')
        : `<tr><td colspan="7" class="text-center py-4 text-muted">Nenhum usuário encontrado.</td></tr>`;
      wireRows();
    } catch (e) { document.getElementById('u-body').innerHTML = `<tr><td colspan="7" class="text-center py-3 text-danger">Erro ao carregar usuários: ${esc(e.message)}</td></tr>`; showError(e); }
  };

  function wireRows() {
    document.querySelectorAll('.u-edit').forEach((b) => b.addEventListener('click', () => openUserModal(parseInt(b.dataset.id, 10))));
    document.querySelectorAll('.u-deactivate').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Desativar usuário', body: 'O usuário não poderá mais acessar o sistema, mas poderá ser reativado.', confirmText: 'Desativar', danger: true });
      if (!ok) return;
      try { await API.del('/users/' + b.dataset.id); toast('Usuário desativado.', 'warning'); load(); } catch (e) { showError(e); }
    }));
    document.querySelectorAll('.u-activate').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Ativar usuário', body: 'Reativar o acesso deste usuário?', confirmText: 'Ativar' });
      if (!ok) return;
      try { await API.patch('/users/' + b.dataset.id, { active: true }); toast('Usuário ativado.', 'success'); load(); } catch (e) { showError(e); }
    }));
    document.querySelectorAll('.u-delete').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Excluir usuário', body: 'Excluir permanentemente? Esta ação não pode ser desfeita. Se o usuário possuir chamados, use Desativar.', confirmText: 'Excluir', danger: true });
      if (!ok) return;
      try { await API.del('/users/' + b.dataset.id + '?hard=true'); toast('Usuário excluído.', 'danger'); load(); } catch (e) { showError(e); }
    }));
  }

  ['u-q', 'u-role', 'u-entity'].forEach((id) => {
    document.getElementById(id).addEventListener('change', load);
  });
  const uq = document.getElementById('u-q');
  let timer;
  uq.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });

  try {
    const ents = await API.get('/entities');
    const sel = document.getElementById('u-entity');
    if (_isManager) {
      const own = ents.find((e) => String(e.id) === String(_u.entity_id));
      sel.innerHTML = own ? `<option value="${own.id}">${esc(own.name)} (sua empresa)</option>` : `<option value="">Sem empresa</option>`;
      sel.disabled = true;
      sel.title = 'Você só visualiza usuários da própria empresa';
    } else {
      sel.innerHTML = `<option value="">Todas as empresas</option>` +
        ents.filter((e) => e.active).map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    }
  } catch {}

  document.getElementById('btn-new-user').onclick = () => openUserModal(null);
  await load();

  // ---------- modal usuario ----------
  async function openUserModal(id) {
    let u = null;
    if (id) { try { const all = await API.get('/users'); u = all.find((x) => String(x.id) === String(id)); } catch {} }
    const ents = await API.get('/entities').catch(() => []);
    const isMgrModal = _isManager;
    // perfil = papel + nivel (Usuario e Gestor sao "client" com nivel 1 ou 2)
    const ALL_PROFILES = [
      { value: 'client:1', label: 'Usuário', help: 'Abre e acompanha os próprios chamados.' },
      { value: 'client:2', label: 'Gestor', help: 'Acompanha chamados e painel da(s) empresa(s) e aprova soluções.' },
      { value: 'admin_local', label: 'Administrador Local', help: 'Administra usuários, localizações e chamados de UMA empresa.' },
      { value: 'technician', label: 'Técnico', help: 'Atende os chamados atribuídos a ele.' },
      { value: 'moderator', label: 'Moderador', help: 'Faz a triagem: atribui técnico, ajusta categoria/urgência, previsão e observadores.' },
      { value: 'admin', label: 'Administrador Mestre', help: 'Acesso total a todas as empresas.' },
    ];
    const allowed = Roles.isMaster(_u) ? ALL_PROFILES.map((p) => p.value)
      : Roles.isLocalAdmin(_u) ? ['client:1', 'client:2', 'admin_local'] : ['client:1', 'client:2'];
    const profileOptions = ALL_PROFILES.filter((p) => allowed.includes(p.value));
    const curProfile = u ? (u.role === 'client' ? `client:${u.client_level === 2 ? 2 : 1}` : u.role) : 'client:1';
    const m = document.createElement('div');
    m.className = 'modal fade';
    m.innerHTML = `<div class="modal-dialog"><div class="modal-content">
      <div class="modal-header">
        <h6>${u ? 'Editar usuário' : 'Novo usuário'}</h6>
        <button class="btn-close" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        ${isMgrModal ? '<div class="alert alert-info small py-2">Você só pode criar usuários para <b>' + esc(ents.find((e)=> String(e.id)===String(_u.entity_id))?.name || 'sua empresa') + '</b>. Todos os campos com * são obrigatórios.</div>' : ''}
        <div class="row">
          <div class="col-md-6 mb-2"><label class="form-label small">Nome *</label>
            <input class="form-control" id="f-name" value="${esc((u && u.name) || '')}"></div>
          <div class="col-md-6 mb-2"><label class="form-label small">Usuário *</label>
            <input class="form-control" id="f-username" value="${esc((u && u.username) || '')}" ${u ? 'disabled' : ''}></div>
        </div>
        <div class="row">
          <div class="col-md-6 mb-2"><label class="form-label small">E-mail ${isMgrModal ? '*' : ''}</label>
            <input class="form-control" id="f-email" type="email" value="${esc((u && u.email) || '')}" ${isMgrModal ? 'required' : ''}></div>
          <div class="col-md-6 mb-2"><label class="form-label small">WhatsApp / Telefone ${isMgrModal ? '*' : ''}</label>
            <input class="form-control" id="f-phone" type="tel" placeholder="" maxlength="14" value="${esc((u && u.phone) || '')}" ${isMgrModal ? 'required' : ''}></div>
        </div>
        <div class="row">
          <div class="col-md-6 mb-2"><label class="form-label small">Perfil *</label>
            <select class="form-select" id="f-profile">
              ${profileOptions.map((o) => `<option value="${o.value}" ${o.value === curProfile ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select>
            <div class="form-text" id="f-profile-help"></div></div>
          <div class="col-md-6 mb-2 multi-empresa"><label class="form-label small">Empresa <span id="f-entity-req"></span></label>
            <select class="form-select" id="f-entity" ${isMgrModal ? 'disabled' : ''}></select></div>
        </div>
        <div class="row">
          <div class="col-md-6 mb-2"><label class="form-label small">Localização (posto)</label>
            <select class="form-select" id="f-location"><option value="">—</option></select></div>
          <div class="col-md-6 mb-2 multi-empresa" id="f-extra-box" style="display:none"><label class="form-label small">Outras empresas que o gestor acompanha</label>
            <select class="form-select" id="f-extra" multiple size="4"></select>
            <div class="form-text">Segure Ctrl para escolher mais de uma.</div></div>
        </div>
        <div class="mb-2">
          <label class="form-label small">${u ? 'Nova senha (deixe em branco para manter)' : 'Senha *'}</label>
          <input class="form-control" id="f-pass" type="password" autocomplete="new-password">
        </div>
        <div class="form-check">
          <input class="form-check-input" type="checkbox" id="f-active" ${!u || u.active ? 'checked' : ''}>
          <label class="form-check-label small">Usuário ativo</label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
        <button class="btn btn-primary" id="f-save">Salvar</button>
      </div>
    </div></div>`;
    document.body.appendChild(m);
    const modal = new bootstrap.Modal(m);
    // máscara (DDD) — padrão exigido: (xx) xxxxxxxxx (11 dígitos)
    const phoneInput = m.querySelector('#f-phone');
    const formatPhone = (v) => {
      const d = String(v).replace(/\D/g, '').slice(0, 11);
      if (!d) return '';
      if (d.length <= 2) return `(${d}`;
      return `(${d.slice(0,2)}) ${d.slice(2)}`;
    };
    if (phoneInput) {
      if (phoneInput.value) phoneInput.value = formatPhone(phoneInput.value);
      phoneInput.addEventListener('input', () => { phoneInput.value = formatPhone(phoneInput.value); });
    }
    const entSel = m.querySelector('#f-entity');
    if (isMgrModal) {
      const own = ents.find((e) => String(e.id) === String(_u.entity_id));
      entSel.innerHTML = own ? `<option value="${own.id}" selected>${esc(own.name)}</option>` : `<option value="">Sem empresa</option>`;
      entSel.disabled = true;
    } else {
      entSel.innerHTML = `<option value="">— sem empresa (equipe de suporte) —</option>` +
        ents.filter((e) => e.active).map((e) => `<option value="${e.id}" ${u && u.entity_id === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
      if (window.EMPRESA_UNICA && !entSel.value) entSel.value = String(window.EMPRESA_UNICA.id);
    }
    const profSel = m.querySelector('#f-profile');
    const locSel = m.querySelector('#f-location');
    const extraSel = m.querySelector('#f-extra');
    const loadLocs = async () => {
      const entId = entSel.value || (isMgrModal ? _u.entity_id : '');
      if (!entId) { locSel.innerHTML = '<option value="">— escolha a empresa —</option>'; return; }
      try {
        const locs = await API.get(`/locations?entity_id=${entId}&active=true`);
        locSel.innerHTML = '<option value="">— nenhuma —</option>' + locs.map((l) =>
          `<option value="${l.id}" ${u && String(u.location_id) === String(l.id) ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
      } catch { locSel.innerHTML = '<option value="">—</option>'; }
    };
    const onProfile = () => {
      const v = profSel.value;
      const p = ALL_PROFILES.find((x) => x.value === v);
      m.querySelector('#f-profile-help').textContent = p ? p.help : '';
      m.querySelector('#f-entity-req').textContent = ['client:1', 'client:2', 'admin_local'].includes(v) ? '*' : '';
      m.querySelector('#f-extra-box').style.display = v === 'client:2' && Roles.isMaster(_u) ? '' : 'none';
    };
    if (extraSel) {
      extraSel.innerHTML = ents.filter((e) => e.active).map((e) =>
        `<option value="${e.id}" ${u && (u.extra_entity_ids || []).map(String).includes(String(e.id)) ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
    }
    profSel.onchange = onProfile;
    entSel.addEventListener('change', loadLocs);
    onProfile();
    loadLocs();

    m.querySelector('#f-save').onclick = async () => {
      const nameVal = m.querySelector('#f-name').value.trim();
      const userVal = m.querySelector('#f-username').value.trim();
      const emailVal = m.querySelector('#f-email').value.trim();
      const phoneVal = m.querySelector('#f-phone').value.trim();
      const profVal = m.querySelector('#f-profile').value;
      const roleVal = profVal.startsWith('client') ? 'client' : profVal;
      const pass = m.querySelector('#f-pass').value;
      // validacao obrigatoria para gestor
      if (isMgrModal) {
        const missing = [];
        if (!nameVal) missing.push('nome');
        if (!u && !userVal) missing.push('usuário');
        if (!u && !pass) missing.push('senha');
        if (!emailVal) missing.push('e-mail');
        if (!phoneVal) missing.push('telefone');
        if (!roleVal) missing.push('perfil');
        if (missing.length) { toast('Campos obrigatórios: ' + missing.join(', ') + '.', 'warning'); return; }
      }
      const phoneDigits = phoneVal.replace(/\D/g, '');
      if (phoneVal && phoneDigits.length !== 11) { toast('Telefone deve conter 11 dígitos no formato (xx) xxxxxxxxx.', 'warning'); return; }
      const body = {
        name: nameVal,
        email: emailVal || null,
        phone: phoneVal || null,
        role: roleVal,
        client_level: profVal === 'client:2' ? 2 : 1,
        entity_id: isMgrModal ? _u.entity_id : (parseInt(m.querySelector('#f-entity').value, 10) || null),
        location_id: parseInt(locSel.value, 10) || null,
        active: m.querySelector('#f-active').checked,
      };
      if (['client', 'admin_local'].includes(roleVal) && !body.entity_id) { toast('Escolha a empresa.', 'warning'); return; }
      if (Roles.isMaster(_u)) {
        body.extra_entity_ids = profVal === 'client:2' ? Array.from(extraSel.selectedOptions).map((o) => o.value) : [];
      }
      if (pass) body.password = pass;
      if (u) {
        if (!userVal) {} // username nao muda
        delete body.username;
      } else {
        body.username = userVal;
        if (!body.username || !body.name) { toast('Preencha nome e usuário.', 'warning'); return; }
        if (!pass) { toast('Informe a senha inicial.', 'warning'); return; }
      }
      try {
        if (u) await API.patch('/users/' + u.id, body);
        else await API.post('/users', body);
        modal.hide(); m.addEventListener('hidden.bs.modal', () => m.remove());
        toast('Usuário salvo.', 'success');
        load();
      } catch (e) { showError(e); }
    };
    modal.show();
  }
};

// ---------------- Entidades ----------------
Views.adminEntities = async function adminEntities(el) {
  if (!(await guardRole('admin'))) return;
  el.innerHTML = `
    <div class="d-flex justify-content-end mb-3">
      <button class="btn btn-primary multi-empresa" id="btn-new-entity"><i class="bi bi-building-add"></i> Nova empresa</button>
    </div>
    <div class="row g-3" id="ent-grid">${spinner()}</div>`;

  const load = async () => {
    try {
      const ents = await API.get('/entities');
      const grid = document.getElementById('ent-grid');
      grid.innerHTML = ents.length ? ents.map((e) => `
        <div class="col-md-6 col-xl-4">
          <div class="card panel-card h-100">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-start">
                <div class="d-flex align-items-center gap-2">
                  ${e.logo ? `<img src="${esc(e.logo)}" class="entity-logo" alt="logo ${esc(e.name)}">` : ''}
                  <div>
                    <h6 class="mb-1">${esc(e.name)}</h6>
                    <span class="text-muted small">${esc(e.description || '')}</span>
                  </div>
                </div>
                <span class="badge ${e.active ? 'text-bg-success' : 'text-bg-secondary'}">${e.active ? 'Ativa' : 'Inativa'}</span>
              </div>
              <div class="small text-muted mt-2">
                <div><i class="bi bi-telephone me-1"></i>${esc(e.phone || '—')}</div>
                <div><i class="bi bi-envelope me-1"></i>${esc(e.email || '—')}</div>
                <div><i class="bi bi-geo-alt me-1"></i>${esc(e.address || '—')}</div>
                <div><i class="bi bi-stopwatch me-1"></i>SLA: ${e.sla_days || 0}d ${e.sla_hours || 0}h</div>
              </div>
              <div class="d-flex flex-wrap gap-3 mt-2 small">
                <span><b>${e.open_tickets}</b> chamados abertos</span>
                <span><b>${e.users_count}</b> usuários</span>
                <a href="#/admin/locations?entity_id=${e.id}"><b>${e.locations_count || 0}</b> localizações</a>
                <span class="text-muted"><i class="bi bi-pc-display me-1"></i><b>${e.computers_count||0}</b> computadores</span>
                <span class="text-muted"><i class="bi bi-hdd-rack me-1"></i><b>${e.servers_count||0}</b> servidores</span>
                <span class="text-muted"><i class="bi bi-laptop me-1"></i><b>${e.notebooks_count||0}</b> notebooks</span>
              </div>
              <div class="text-end mt-3">
                <button class="btn btn-sm btn-outline-primary ent-edit" data-id="${e.id}"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-sm btn-outline-danger ent-del multi-empresa" data-id="${e.id}"><i class="bi bi-trash"></i></button>
              </div>
            </div>
          </div>
        </div>`).join('')
      : emptyState('Nenhuma empresa cadastrada', 'Crie a primeira empresa/cliente.', 'bi-building');
      grid.querySelectorAll('.ent-edit').forEach((b) => b.addEventListener('click', () => openEntityModal(parseInt(b.dataset.id, 10))));
      grid.querySelectorAll('.ent-del').forEach((b) => b.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Remover entidade', body: 'Se houver chamados, a entidade será desativada.', confirmText: 'Remover', danger: true });
        if (!ok) return;
        try { await API.del('/entities/' + b.dataset.id); toast('Entidade removida/desativada.', 'warning'); load(); } catch (e) { showError(e); }
      }));
    } catch (e) { showError(e); }
  };

  document.getElementById('btn-new-entity').onclick = () => openEntityModal(null);
  await load();

  async function openEntityModal(id) {
    let e = null;
    if (id) { try { e = (await API.get('/entities')).find((x) => String(x.id) === String(id)); } catch {} }
    const m = document.createElement('div');
    m.className = 'modal fade';
    m.innerHTML = `<div class="modal-dialog"><div class="modal-content">
      <div class="modal-header"><h6>${e ? 'Editar empresa' : 'Nova empresa'}</h6>
        <button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div class="mb-2"><label class="form-label small">Nome *</label>
          <input class="form-control" id="e-name" value="${esc((e && e.name) || '')}"></div>
        <div class="mb-2"><label class="form-label small">Descrição</label>
          <input class="form-control" id="e-desc" value="${esc((e && e.description) || '')}"></div>
        <div class="mb-2">
          <label class="form-label small">Logomarca do cliente</label>
          <div class="upload-box" id="e-logo-box" style="height:96px">
            ${e && e.logo ? `<img src="${esc(e.logo)}" alt="logo">` : '<i class="bi bi-image"></i><span>Enviar logomarca</span>'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden>
          </div>
          <div class="form-text">PNG/JPG/WEBP/SVG · até 5MB. Exibida no perfil dos membros.</div>
        </div>
        <div class="row">
          <div class="col-md-6 mb-2"><label class="form-label small">E-mail</label>
            <input class="form-control" id="e-email" value="${esc((e && e.email) || '')}"></div>
          <div class="col-md-6 mb-2"><label class="form-label small">Telefone</label>
            <input class="form-control" id="e-phone" value="${esc((e && e.phone) || '')}"></div>
        </div>
        <div class="mb-2"><label class="form-label small">Endereço</label>
          <input class="form-control" id="e-address" value="${esc((e && e.address) || '')}"></div>
        <div class="row">
          <div class="col-6 mb-2"><label class="form-label small">SLA — Dias</label>
            <input class="form-control" id="e-sla-days" type="number" min="0" max="365" value="${esc(String((e && e.sla_days) ?? 0))}"></div>
          <div class="col-6 mb-2"><label class="form-label small">SLA — Horas</label>
            <input class="form-control" id="e-sla-hours" type="number" min="0" max="23" value="${esc(String((e && e.sla_hours) ?? 0))}"></div>
        </div>
        <div class="form-text mb-2">Prazo padrão para chamados desta entidade. Ex.: 2 dias e 4 horas → vencimento automático.</div>
        <div class="form-check">
          <input class="form-check-input" type="checkbox" id="e-active" ${e ? (e.active ? 'checked' : '') : 'checked'}>
          <label class="form-check-label small">Ativa</label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
        <button class="btn btn-primary" id="e-save">Salvar</button>
      </div>
    </div></div>`;
    document.body.appendChild(m);
    const modal = new bootstrap.Modal(m);

    // upload da logomarca (envia e guarda a URL para salvar junto)
    let logoUrl = (e && e.logo) || '';
    const logoBox = m.querySelector('#e-logo-box');
    const logoInput = logoBox.querySelector('input');
    logoBox.onclick = () => logoInput.click();
    logoInput.onclick = () => { logoInput.value = null; };
    logoInput.onchange = async () => {
      const file = logoInput.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      const btn = m.querySelector('#e-save');
      btn.disabled = true;
      try {
        const r = await API.post('/entities/upload', fd, true);
        logoUrl = r.url;
        logoBox.innerHTML = `<img src="${esc(r.url)}" alt="logo">`;
        toast('Logomarca enviada.', 'success');
      } catch (err) { showError(err); }
      finally { btn.disabled = false; }
    };

    m.querySelector('#e-save').onclick = async () => {
      const body = {
        name: m.querySelector('#e-name').value.trim(),
        description: m.querySelector('#e-desc').value.trim() || null,
        email: m.querySelector('#e-email').value.trim() || null,
        phone: m.querySelector('#e-phone').value.trim() || null,
        address: m.querySelector('#e-address').value.trim() || null,
        logo: logoUrl || null,
        active: m.querySelector('#e-active').checked,
        sla_days: parseInt(m.querySelector('#e-sla-days').value, 10) || 0,
        sla_hours: parseInt(m.querySelector('#e-sla-hours').value, 10) || 0,
        category_mode: 'simple',
      };
      if (!body.name) { toast('Informe o nome.', 'warning'); return; }
      try {
        if (e) await API.patch('/entities/' + e.id, body);
        else await API.post('/entities', body);
        modal.hide(); m.addEventListener('hidden.bs.modal', () => m.remove());
        toast('Entidade salva.', 'success');
        load();
      } catch (err) { showError(err); }
    };
    modal.show();
  }
};

// ---------------- Categorias e urgencia ----------------
// Categorias complexas: arvore detalhada (ex.: Rede > Problemas de conexão > DNS).
// Categorias simples: lista facil com icone; cada uma aponta para uma complexa,
// onde o chamado e gravado. O modo (simples/complexo) e escolhido por empresa.
Views.adminCategories = async function adminCategories(el) {
  if (!(await guardRole('admin'))) return;
  let tab = sessionStorage.getItem('cat_tab') || 'simple';
  if (tab === 'complex') tab = 'simple';
  el.innerHTML = `
    <ul class="nav nav-tabs mb-3" id="cat-tabs">
      <li class="nav-item"><a class="nav-link" href="#" data-tab="simple">Categorias</a></li>
      <li class="nav-item"><a class="nav-link" href="#" data-tab="impact">Urgência</a></li>
      <li class="nav-item"><a class="nav-link" href="#" data-tab="causes">Causas de encerramento</a></li>
    </ul>
    <div id="cat-tab-body">${spinner()}</div>`;

  el.querySelectorAll('#cat-tabs a').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    tab = a.dataset.tab;
    try { sessionStorage.setItem('cat_tab', tab); } catch {}
    render();
  }));

  async function render() {
    el.querySelectorAll('#cat-tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    const body = document.getElementById('cat-tab-body');
    body.innerHTML = spinner();
    try {
      if (tab === 'impact') return renderImpact(body);
      if (tab === 'causes') return renderCauses(body);
      const cats = await API.get('/categories');
      renderSimple(body, cats);
    } catch (e) { body.innerHTML = emptyState('Erro ao carregar', e.message, 'bi-exclamation-triangle'); }
  }

  function renderSimple(body, cats) {
    const simple = cats.filter((c) => c.kind === 'simple');
    body.innerHTML = `
      <div class="alert alert-info small">
        <i class="bi bi-info-circle me-1"></i> É a lista que todos veem ao abrir chamado. O chamado fica registrado
        na própria categoria escolhida (ex.: "🌐 Internet ou rede").
      </div>
      <div class="d-flex justify-content-end mb-2">
        <button class="btn btn-primary btn-sm" id="btn-new-simple"><i class="bi bi-plus-lg"></i> Nova categoria</button>
      </div>
      <div class="card panel-card"><div class="table-responsive"><table class="table table-hover align-middle mb-0">
        <thead><tr><th>Ordem</th><th>Categoria</th><th>Abertos</th><th>Status</th><th class="text-end">Ações</th></tr></thead>
        <tbody>${simple.map((c) => `
          <tr>
            <td class="text-muted">${c.sort_order}</td>
            <td><span class="fs-5 me-1">${esc(c.icon || '')}</span><strong>${esc(c.name)}</strong>
              ${c.examples ? `<br><small class="text-muted">Ex.: ${esc(c.examples)}</small>` : ''}</td>
            <td><span class="badge text-bg-${c.open_tickets > 0 ? 'warning' : 'secondary'}">${c.open_tickets}</span></td>
            <td>${c.active ? '<span class="tg tg-green">Ativa</span>' : '<span class="tg tg-gray">Inativa</span>'}</td>
            <td class="text-end">
              <button class="btn btn-sm btn-outline-primary cat-edit" data-id="${c.id}"><i class="bi bi-pencil"></i></button>
              <button class="btn btn-sm btn-outline-danger cat-del" data-id="${c.id}"><i class="bi bi-trash"></i></button>
            </td>
          </tr>`).join('') || '<tr><td colspan="5" class="text-center py-4 text-muted">Nenhuma categoria.</td></tr>'}</tbody>
      </table></div></div>`;
    body.querySelector('#btn-new-simple').onclick = () => openCatModal(null, 'simple', cats);
    wireRows(body, cats);
  }

  function renderComplex(body, cats) {
    const complex = cats.filter((c) => c.kind === 'complex').sort((a, b) => (a.path || '').localeCompare(b.path || '', 'pt-BR'));
    const simpleByTarget = {};
    cats.filter((c) => c.kind === 'simple' && c.maps_to_id).forEach((c) => {
      (simpleByTarget[c.maps_to_id] = simpleByTarget[c.maps_to_id] || []).push(c);
    });
    body.innerHTML = `
      <div class="alert alert-info small">
        <i class="bi bi-info-circle me-1"></i> Árvore detalhada usada pela equipe e pelas empresas no modo <b>Complexo</b>.
        A equipe pode detalhar um chamado (ex.: de <i>Rede › Problemas de conexão</i> para <i>… › DNS</i>) sem perder a ligação com a categoria simples.
      </div>
      <div class="d-flex justify-content-end mb-2">
        <button class="btn btn-primary btn-sm" id="btn-new-complex"><i class="bi bi-plus-lg"></i> Nova categoria complexa</button>
      </div>
      <div class="card panel-card"><div class="table-responsive"><table class="table table-hover align-middle mb-0">
        <thead><tr><th>Categoria</th><th>Simples ligadas</th><th>Abertos</th><th>Status</th><th class="text-end">Ações</th></tr></thead>
        <tbody>${complex.map((c) => {
          const depth = (c.path || '').split(' > ').length - 1;
          return `
          <tr>
            <td><span class="text-muted">${'&nbsp;&nbsp;&nbsp;'.repeat(depth)}${depth ? '└ ' : ''}</span><strong>${esc(c.name)}</strong>
              ${depth ? `<br><small class="text-muted">${'&nbsp;&nbsp;&nbsp;'.repeat(depth)}${esc(c.path)}</small>` : ''}</td>
            <td class="small">${(simpleByTarget[c.id] || []).map((x) => `${esc(x.icon || '')} ${esc(x.name)}`).join('<br>') || '—'}</td>
            <td><span class="badge text-bg-${c.open_tickets > 0 ? 'warning' : 'secondary'}">${c.open_tickets}</span></td>
            <td>${c.active ? '<span class="tg tg-green">Ativa</span>' : '<span class="tg tg-gray">Inativa</span>'}</td>
            <td class="text-end">
              <button class="btn btn-sm btn-outline-primary cat-edit" data-id="${c.id}"><i class="bi bi-pencil"></i></button>
              <button class="btn btn-sm btn-outline-danger cat-del" data-id="${c.id}"><i class="bi bi-trash"></i></button>
            </td>
          </tr>`; }).join('') || '<tr><td colspan="5" class="text-center py-4 text-muted">Nenhuma categoria.</td></tr>'}</tbody>
      </table></div></div>`;
    body.querySelector('#btn-new-complex').onclick = () => openCatModal(null, 'complex', cats);
    wireRows(body, cats);
  }

  function wireRows(body, cats) {
    body.querySelectorAll('.cat-edit').forEach((b) => b.addEventListener('click', () => {
      const c = cats.find((x) => String(x.id) === b.dataset.id);
      openCatModal(c, c.kind, cats);
    }));
    body.querySelectorAll('.cat-del').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Remover categoria', body: 'Se estiver em uso, ela será apenas desativada.', confirmText: 'Remover', danger: true });
      if (!ok) return;
      try { const r = await API.del('/categories/' + b.dataset.id); toast(r.message || 'Categoria removida.', 'warning'); render(); } catch (e) { showError(e); }
    }));
  }

  function openCatModal(c, kind, cats) {
    const complex = cats.filter((x) => x.kind === 'complex' && x.active && (!c || x.id !== c.id))
      .sort((a, b) => (a.path || '').localeCompare(b.path || '', 'pt-BR'));
    const m = document.createElement('div');
    m.className = 'modal fade';
    m.innerHTML = `<div class="modal-dialog"><div class="modal-content">
      <div class="modal-header"><h6>${c ? 'Editar' : 'Nova'} categoria</h6>
        <button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div class="row">
          ${kind === 'simple' ? `<div class="col-3 mb-2"><label class="form-label small">Ícone</label>
            <input class="form-control" id="c-icon" maxlength="4" value="${esc((c && c.icon) || '')}" placeholder="🌐"></div>` : ''}
          <div class="${kind === 'simple' ? 'col-9' : 'col-12'} mb-2"><label class="form-label small">Nome *</label>
            <input class="form-control" id="c-name" value="${esc((c && c.name) || '')}"></div>
        </div>
        ${kind === 'simple' ? `
          <div class="mb-2"><label class="form-label small">Explicação para o usuário</label>
            <input class="form-control" id="c-desc" value="${esc((c && c.description) || '')}" placeholder="Ex.: Sem internet, internet lenta ou Wi-Fi."></div>
          <div class="mb-2"><label class="form-label small">Exemplos (separe com ;)</label>
            <input class="form-control" id="c-examples" value="${esc((c && c.examples) || '')}" placeholder="Sem internet; Wi-Fi caiu"></div>
          <div class="mb-2"><label class="form-label small">Ordem na lista</label>
            <input class="form-control" id="c-order" type="number" value="${esc(String((c && c.sort_order) || 0))}"></div>` : `
          <div class="mb-2"><label class="form-label small">Categoria pai</label>
            <select class="form-select" id="c-parent">
              <option value="">— raiz —</option>
              ${complex.map((x) => `<option value="${x.id}" ${c && c.parent_id === x.id ? 'selected' : ''}>${esc(x.path)}</option>`).join('')}
            </select></div>`}
        <div class="form-check">
          <input class="form-check-input" type="checkbox" id="c-active" ${!c || c.active ? 'checked' : ''}>
          <label class="form-check-label small">Ativa</label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
        <button class="btn btn-primary" id="c-save">Salvar</button>
      </div>
    </div></div>`;
    document.body.appendChild(m);
    const modal = new bootstrap.Modal(m);
    m.addEventListener('hidden.bs.modal', () => m.remove());
    m.querySelector('#c-save').onclick = async () => {
      const name = m.querySelector('#c-name').value.trim();
      if (!name) { toast('Informe o nome.', 'warning'); return; }
      const body = { name, active: m.querySelector('#c-active').checked };
      if (kind === 'simple') {
        body.icon = m.querySelector('#c-icon').value.trim();
        body.description = m.querySelector('#c-desc').value.trim();
        body.examples = m.querySelector('#c-examples').value.trim();
        body.sort_order = parseInt(m.querySelector('#c-order').value, 10) || 0;
      } else {
        body.parent_id = parseInt(m.querySelector('#c-parent').value, 10) || null;
      }
      if (!c) body.kind = kind;
      try {
        if (c) await API.patch('/categories/' + c.id, body);
        else await API.post('/categories', body);
        modal.hide();
        toast('Categoria salva.', 'success');
        render();
      } catch (e) { showError(e); }
    };
    modal.show();
  }

  async function renderImpact(body) {
    const levels = await API.get('/impact-levels?all=true');
    body.innerHTML = `
      <div class="alert alert-info small">
        <i class="bi bi-info-circle me-1"></i> Opções da pergunta <b>"Isso está afetando a operação?"</b> ao abrir chamado.
        Cada uma equivale a uma prioridade interna, usada no painel e no SLA.
      </div>
      <div class="d-flex justify-content-end mb-2">
        <button class="btn btn-primary btn-sm" id="btn-new-impact"><i class="bi bi-plus-lg"></i> Nova opção</button>
      </div>
      <div class="card panel-card"><div class="table-responsive"><table class="table table-hover align-middle mb-0">
        <thead><tr><th>Ordem</th><th>Urgência</th><th>Prioridade interna</th><th>Status</th><th class="text-end">Ações</th></tr></thead>
        <tbody>${levels.map((l) => `
          <tr>
            <td class="text-muted">${l.sort_order}</td>
            <td><strong>${esc(l.name)}</strong><br><small class="text-muted">${esc(l.description || '')}</small></td>
            <td>${badgePriority(l.priority)}</td>
            <td>${l.active ? '<span class="tg tg-green">Ativa</span>' : '<span class="tg tg-gray">Inativa</span>'}</td>
            <td class="text-end">
              <button class="btn btn-sm btn-outline-primary imp-edit" data-id="${l.id}"><i class="bi bi-pencil"></i></button>
              ${l.active ? `<button class="btn btn-sm btn-outline-danger imp-del" data-id="${l.id}" title="Desativar"><i class="bi bi-slash-circle"></i></button>` : ''}
            </td>
          </tr>`).join('')}</tbody>
      </table></div></div>`;
    body.querySelector('#btn-new-impact').onclick = () => openImpactModal(null);
    body.querySelectorAll('.imp-edit').forEach((b) => b.addEventListener('click', () =>
      openImpactModal(levels.find((l) => String(l.id) === b.dataset.id))));
    body.querySelectorAll('.imp-del').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Desativar opção', body: 'Chamados antigos mantêm o registro. Ela só deixa de aparecer para novos chamados.', confirmText: 'Desativar', danger: true });
      if (!ok) return;
      try { await API.del('/impact-levels/' + b.dataset.id); render(); } catch (e) { showError(e); }
    }));
  }

  async function renderCauses(body) {
    const causes = await API.get('/resolution-causes?all=true');
    body.innerHTML = `
      <div class="alert alert-info small">
        <i class="bi bi-info-circle me-1"></i> Opções da pergunta <b>"Qual foi a causa?"</b> no formulário de encerramento do chamado.
        Só a equipe vê a causa. Use para relatórios (ex.: quantos chamados foram erro do usuário ou acidente).
      </div>
      <div class="d-flex justify-content-end mb-2">
        <button class="btn btn-primary btn-sm" id="btn-new-cause"><i class="bi bi-plus-lg"></i> Nova causa</button>
      </div>
      <div class="card panel-card"><div class="table-responsive"><table class="table table-hover align-middle mb-0">
        <thead><tr><th>Ordem</th><th>Causa</th><th>Status</th><th class="text-end">Ações</th></tr></thead>
        <tbody>${causes.map((c) => `
          <tr>
            <td class="text-muted">${c.sort_order}</td>
            <td><strong>${esc(c.name)}</strong><br><small class="text-muted">${esc(c.description || '')}</small></td>
            <td>${c.active ? '<span class="tg tg-green">Ativa</span>' : '<span class="tg tg-gray">Inativa</span>'}</td>
            <td class="text-end">
              <button class="btn btn-sm btn-outline-primary cause-edit" data-id="${c.id}"><i class="bi bi-pencil"></i></button>
              ${c.active ? `<button class="btn btn-sm btn-outline-danger cause-del" data-id="${c.id}" title="Desativar"><i class="bi bi-slash-circle"></i></button>` : ''}
            </td>
          </tr>`).join('')}</tbody>
      </table></div></div>`;
    const open = (c) => {
      const m = document.createElement('div');
      m.className = 'modal fade';
      m.innerHTML = `<div class="modal-dialog"><div class="modal-content">
        <div class="modal-header"><h6>${c ? 'Editar' : 'Nova'} causa</h6><button class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="mb-2"><label class="form-label small">Nome *</label><input class="form-control" id="rc-name" value="${esc((c && c.name) || '')}"></div>
          <div class="mb-2"><label class="form-label small">Explicação</label><input class="form-control" id="rc-desc" value="${esc((c && c.description) || '')}"></div>
          <div class="mb-2"><label class="form-label small">Ordem</label><input class="form-control" id="rc-order" type="number" value="${esc(String((c && c.sort_order) || 0))}"></div>
          <div class="form-check"><input class="form-check-input" type="checkbox" id="rc-active" ${!c || c.active ? 'checked' : ''}><label class="form-check-label small">Ativa</label></div>
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-primary" id="rc-save">Salvar</button></div>
      </div></div>`;
      document.body.appendChild(m);
      const modal = new bootstrap.Modal(m);
      m.addEventListener('hidden.bs.modal', () => m.remove());
      m.querySelector('#rc-save').onclick = async () => {
        const b = {
          name: m.querySelector('#rc-name').value.trim(),
          description: m.querySelector('#rc-desc').value.trim(),
          sort_order: parseInt(m.querySelector('#rc-order').value, 10) || 0,
          active: m.querySelector('#rc-active').checked,
        };
        if (!b.name) { toast('Informe o nome.', 'warning'); return; }
        try {
          if (c) await API.patch('/resolution-causes/' + c.id, b); else await API.post('/resolution-causes', b);
          modal.hide(); toast('Salvo.', 'success'); render();
        } catch (e) { showError(e); }
      };
      modal.show();
    };
    body.querySelector('#btn-new-cause').onclick = () => open(null);
    body.querySelectorAll('.cause-edit').forEach((b) => b.addEventListener('click', () => open(causes.find((c) => String(c.id) === b.dataset.id))));
    body.querySelectorAll('.cause-del').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Desativar causa', body: 'Chamados antigos mantêm o registro.', confirmText: 'Desativar', danger: true });
      if (!ok) return;
      try { await API.del('/resolution-causes/' + b.dataset.id); render(); } catch (e) { showError(e); }
    }));
  }

  function openImpactModal(l) {
    const m = document.createElement('div');
    m.className = 'modal fade';
    m.innerHTML = `<div class="modal-dialog"><div class="modal-content">
      <div class="modal-header"><h6>${l ? 'Editar' : 'Nova'} opção de urgência</h6>
        <button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div class="mb-2"><label class="form-label small">Nome *</label>
          <input class="form-control" id="i-name" value="${esc((l && l.name) || '')}"></div>
        <div class="mb-2"><label class="form-label small">Explicação para o usuário</label>
          <input class="form-control" id="i-desc" value="${esc((l && l.description) || '')}"></div>
        <div class="mb-2"><label class="form-label small">Exemplos</label>
          <input class="form-control" id="i-examples" value="${esc((l && l.examples) || '')}"></div>
        <div class="row">
          <div class="col-6 mb-2"><label class="form-label small">Prioridade interna</label>
            <select class="form-select" id="i-prio">
              ${[1, 2, 3, 4].map((p) => `<option value="${p}" ${l && l.priority === p ? 'selected' : ''}>${LABELS.priority[p]}</option>`).join('')}
            </select></div>
          <div class="col-6 mb-2"><label class="form-label small">Ordem</label>
            <input class="form-control" id="i-order" type="number" value="${esc(String((l && l.sort_order) || 0))}"></div>
        </div>
        <div class="form-check">
          <input class="form-check-input" type="checkbox" id="i-active" ${!l || l.active ? 'checked' : ''}>
          <label class="form-check-label small">Ativa</label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
        <button class="btn btn-primary" id="i-save">Salvar</button>
      </div>
    </div></div>`;
    document.body.appendChild(m);
    const modal = new bootstrap.Modal(m);
    m.addEventListener('hidden.bs.modal', () => m.remove());
    m.querySelector('#i-save').onclick = async () => {
      const body = {
        name: m.querySelector('#i-name').value.trim(),
        description: m.querySelector('#i-desc').value.trim(),
        examples: m.querySelector('#i-examples').value.trim(),
        priority: parseInt(m.querySelector('#i-prio').value, 10),
        sort_order: parseInt(m.querySelector('#i-order').value, 10) || 0,
        active: m.querySelector('#i-active').checked,
      };
      if (!body.name) { toast('Informe o nome.', 'warning'); return; }
      try {
        if (l) await API.patch('/impact-levels/' + l.id, body);
        else await API.post('/impact-levels', body);
        modal.hide();
        toast('Salvo.', 'success');
        render();
      } catch (e) { showError(e); }
    };
    modal.show();
  }

  render();
};

// ---------------- Localizacoes (postos) ----------------
Views.adminLocations = async function adminLocations(el) {
  const u = currentUser();
  if (!Roles.canManageLocations(u)) {
    location.hash = '#/dashboard';
    toast('Seu perfil não pode gerenciar localizações.', 'warning');
    return;
  }
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  let entityFilter = !Roles.isMaster(u) ? String(u.entity_id) : (params.get('entity_id') || '');
  const ents = (await API.get('/entities').catch(() => [])).filter((e) => Roles.isMaster(u) || String(e.id) === String(u.entity_id));

  el.innerHTML = `
    <div class="card panel-card mb-3"><div class="card-body py-3 d-flex flex-wrap gap-2 align-items-center">
      <select class="form-select form-select-sm multi-empresa" id="l-entity" style="max-width:280px" ${!Roles.isMaster(u) ? 'disabled' : ''}>
        ${Roles.isMaster(u) ? '<option value="">Todas as empresas</option>' : ''}
        ${ents.map((e) => `<option value="${e.id}" ${String(e.id) === entityFilter ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-sm ms-auto" id="btn-new-loc"><i class="bi bi-geo-alt"></i> Nova localização</button>
    </div></div>
    <div class="card panel-card"><div class="table-responsive"><table class="table table-hover align-middle mb-0">
      <thead><tr><th>Localização</th><th class="multi-empresa">Empresa</th><th>Cidade/UF</th><th>Acesso do posto</th><th>Usuários</th><th>Chamados abertos</th><th>Status</th><th class="text-end">Ações</th></tr></thead>
      <tbody id="l-body"><tr><td colspan="8">${spinner()}</td></tr></tbody>
    </table></div></div>`;

  const load = async () => {
    const q = entityFilter ? `?entity_id=${entityFilter}` : '';
    try {
      const locs = await API.get('/locations' + q);
      document.getElementById('l-body').innerHTML = locs.map((l) => `
        <tr>
          <td><strong>${esc(l.name)}</strong>${l.code ? ` <small class="text-muted">(${esc(l.code)})</small>` : ''}
            ${l.address ? `<br><small class="text-muted">${esc(l.address)}</small>` : ''}</td>
          <td class="multi-empresa">${esc(l.entity_name)}</td>
          <td>${esc([l.city, l.state].filter(Boolean).join('/') || '—')}</td>
          <td>${l.posto_username ? `<span class="tg tg-teal"><i class="bi bi-shop"></i>@${esc(l.posto_username)}</span>` : '<span class="tg tg-gray">sem acesso</span>'}</td>
          <td><a href="#/admin/users">${l.users_count}</a></td>
          <td>${l.open_tickets}</td>
          <td>${l.active ? '<span class="tg tg-green">Ativa</span>' : '<span class="tg tg-gray">Inativa</span>'}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-primary l-edit" data-id="${l.id}"><i class="bi bi-pencil"></i></button>
            ${l.active ? `<button class="btn btn-sm btn-outline-danger l-off" data-id="${l.id}" title="Desativar"><i class="bi bi-slash-circle"></i></button>` : ''}
          </td>
        </tr>`).join('') || '<tr><td colspan="8" class="text-center py-4 text-muted">Nenhuma localização cadastrada.</td></tr>';
      document.querySelectorAll('.l-edit').forEach((b) => b.addEventListener('click', () => openModal(locs.find((x) => String(x.id) === b.dataset.id))));
      document.querySelectorAll('.l-off').forEach((b) => b.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Desativar localização', body: 'Ela deixa de aparecer para novos chamados. O histórico é mantido.', confirmText: 'Desativar', danger: true });
        if (!ok) return;
        try { await API.del('/locations/' + b.dataset.id); toast('Localização desativada.', 'warning'); load(); } catch (e) { showError(e); }
      }));
    } catch (e) { showError(e); }
  };

  document.getElementById('l-entity').addEventListener('change', (ev) => { entityFilter = ev.target.value; load(); });
  document.getElementById('btn-new-loc').onclick = () => openModal(null);

  function openModal(l) {
    const m = document.createElement('div');
    m.className = 'modal fade';
    const defaultEnt = l ? l.entity_id : (entityFilter || (ents[0] && ents[0].id));
    m.innerHTML = `<div class="modal-dialog"><div class="modal-content">
      <div class="modal-header"><h6>${l ? 'Editar localização' : 'Nova localização'}</h6>
        <button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div class="mb-2 multi-empresa"><label class="form-label small">Empresa *</label>
          <select class="form-select" id="lm-entity" ${l || !Roles.isMaster(u) ? 'disabled' : ''}>
            ${ents.map((e) => `<option value="${e.id}" ${String(e.id) === String(defaultEnt) ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
          </select></div>
        <div class="row">
          <div class="col-8 mb-2"><label class="form-label small">Nome *</label>
            <input class="form-control" id="lm-name" value="${esc((l && l.name) || '')}" placeholder="Ex.: Posto X"></div>
          <div class="col-4 mb-2"><label class="form-label small">Código</label>
            <input class="form-control" id="lm-code" value="${esc((l && l.code) || '')}"></div>
        </div>
        <div class="mb-2"><label class="form-label small">Endereço</label>
          <input class="form-control" id="lm-address" value="${esc((l && l.address) || '')}"></div>
        <div class="row">
          <div class="col-8 mb-2"><label class="form-label small">Cidade</label>
            <input class="form-control" id="lm-city" value="${esc((l && l.city) || '')}"></div>
          <div class="col-4 mb-2"><label class="form-label small">UF</label>
            <input class="form-control" id="lm-state" maxlength="2" value="${esc((l && l.state) || '')}"></div>
        </div>
        <div class="form-check">
          <input class="form-check-input" type="checkbox" id="lm-active" ${!l || l.active ? 'checked' : ''}>
          <label class="form-check-label small">Ativa</label>
        </div>
        <hr>
        <div class="mb-1 fw-semibold small"><i class="bi bi-person-badge me-1"></i>Acesso do posto</div>
        ${l && l.posto_username ? `<div class="small text-muted">Este posto já entra no sistema como <b>@${esc(l.posto_username)}</b>.
          Para trocar a senha, use <a href="#/admin/users">Usuários</a>.</div>` : `
        <div class="form-check mb-2">
          <input class="form-check-input" type="checkbox" id="lm-acesso" ${l ? '' : 'checked'}>
          <label class="form-check-label small" for="lm-acesso">Criar um usuário para o próprio posto abrir chamados</label>
        </div>
        <div class="row" id="lm-acesso-box">
          <div class="col-6 mb-2"><label class="form-label small">Usuário de acesso *</label>
            <input class="form-control" id="lm-user" autocomplete="off" placeholder="ex.: palhaseca"></div>
          <div class="col-6 mb-2"><label class="form-label small">Senha * (mín. 6)</label>
            <input class="form-control" id="lm-pass" type="password" autocomplete="new-password"></div>
        </div>`}
        <div class="form-text">O posto também aparece sozinho nos <b>Postos</b> do Dia a dia da TI, onde se definem as visitas e o checklist.
          Pessoas (gestor, TI) se ligam a uma localização em <a href="#/admin/users">Usuários</a>.</div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
        <button class="btn btn-primary" id="lm-save">Salvar</button>
      </div>
    </div></div>`;
    document.body.appendChild(m);
    const modal = new bootstrap.Modal(m);
    m.addEventListener('hidden.bs.modal', () => m.remove());
    // sugere o usuário do posto a partir do nome (ex.: "Posto Palha Seca" -> "palhaseca")
    const sugerir = () => {
      const uIn = m.querySelector('#lm-user');
      if (!uIn || uIn.dataset.mexido) return;
      uIn.value = m.querySelector('#lm-name').value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/^posto\s+/, '').replace(/[^a-z0-9]/g, '');
    };
    m.querySelector('#lm-name').addEventListener('input', sugerir);
    const uInput = m.querySelector('#lm-user');
    if (uInput) uInput.addEventListener('input', () => { uInput.dataset.mexido = '1'; });
    const acesso = m.querySelector('#lm-acesso');
    const syncAcesso = () => { if (acesso) m.querySelector('#lm-acesso-box').style.display = acesso.checked ? '' : 'none'; };
    if (acesso) acesso.addEventListener('change', syncAcesso);
    syncAcesso();
    m.querySelector('#lm-save').onclick = async () => {
      const body = {
        name: m.querySelector('#lm-name').value.trim(),
        code: m.querySelector('#lm-code').value.trim(),
        address: m.querySelector('#lm-address').value.trim(),
        city: m.querySelector('#lm-city').value.trim(),
        state: m.querySelector('#lm-state').value.trim().toUpperCase(),
        active: m.querySelector('#lm-active').checked,
      };
      if (!body.name) { toast('Informe o nome.', 'warning'); return; }
      if (acesso && acesso.checked) {
        const username = m.querySelector('#lm-user').value.trim();
        const password = m.querySelector('#lm-pass').value;
        if (!username || password.length < 6) { toast('Informe o usuário e uma senha de ao menos 6 caracteres para o posto.', 'warning'); return; }
        body.posto_user = { username, password };
      }
      try {
        if (l) await API.patch('/locations/' + l.id, body);
        else await API.post('/locations', { ...body, entity_id: parseInt(m.querySelector('#lm-entity').value, 10) });
        modal.hide();
        toast('Localização salva.', 'success');
        load();
      } catch (e) { showError(e); }
    };
    modal.show();
  }

  await load();
};

// ---------------- Configuracoes ----------------
Views.adminSettings = async function adminSettings(el) {
  if (!(await guardRole('admin'))) return;
  el.innerHTML = spinner();
  const s = await API.get('/settings').catch((e) => { showError(e); return {}; });

  el.innerHTML = `
    <div class="row g-3" style="max-width:1060px">
      <div class="col-lg-6">
        <div class="card panel-card mb-3">
          <div class="card-header"><i class="bi bi-palette me-1"></i> Identidade visual</div>
          <div class="card-body">
            <div class="mb-3">
              <label class="form-label small">Nome do sistema</label>
              <input class="form-control" id="s-appname" value="${esc(s['app.name'] || '')}">
            </div>
            <div class="row">
              <div class="col-6 mb-2">
                <label class="form-label small">Logo (tela de login)</label>
                <div class="upload-box" id="upload-logo">
                  ${s['app.logo'] ? `<img src="${esc(s['app.logo'])}" alt="logo">` : '<i class="bi bi-image"></i><span>Enviar logo</span>'}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden>
                </div>
                <div class="form-text">PNG/JPG/WEBP/SVG · até 5MB</div>
              </div>
              <div class="col-6 mb-2">
                <label class="form-label small">Fundo (tela de login)</label>
                <div class="upload-box bg-box" id="upload-bg">
                  ${s['app.background'] ? `<img src="${esc(s['app.background'])}" alt="fundo">` : '<i class="bi bi-image"></i><span>Enviar imagem</span>'}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden>
                </div>
                <div class="form-text">Recomendado 1920×1080</div>
              </div>
            </div>
          </div>
        </div>

        <div class="card panel-card">
          <div class="card-header"><i class="bi bi-bell me-1"></i> Notificações</div>
          <div class="card-body">
            <div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="s-notify-email" ${s['app.notify_email'] ? 'checked' : ''}><label class="form-check-label">Enviar notificações por e-mail</label></div>
            <div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="s-notify-wa" ${s['app.notify_whatsapp'] ? 'checked' : ''}><label class="form-check-label">Enviar notificações por WhatsApp</label></div>
            <div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="s-notify-techs" ${s['app.notify_techs_new'] ? 'checked' : ''}><label class="form-check-label">Notificar equipe técnica sobre novos chamados</label></div>
            <div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="s-notify-clients" ${s['app.notify_clients'] ? 'checked' : ''}><label class="form-check-label">Notificar clientes sobre movimentações</label></div>
            <div class="form-check form-switch mb-3"><input class="form-check-input" type="checkbox" id="s-approval" ${s['app.approval_on_solve'] ? 'checked' : ''}><label class="form-check-label">Exigir aprovação do cliente ao resolver (fluxo GLPI)</label></div>
            <div class="mb-2"><label class="form-label small">E-mail do administrador (contato)</label>
              <input class="form-control" id="s-adminmail" value="${esc(s['app.admin_email'] || '')}"></div>
            <div class="alert alert-light border small mb-0">
              <i class="bi bi-gear me-1"></i> Configure o SMTP no arquivo <code>.env</code>. Para WhatsApp, escaneie o QR code no card abaixo.
            </div>
          </div>
        </div>

        <div class="card panel-card">
          <div class="card-header"><i class="bi bi-whatsapp me-1"></i> WhatsApp (conexão local)</div>
          <div class="card-body">
            <div id="wa-status-line" class="mb-2"></div>
            <div id="wa-qr-area" class="text-center mb-2"></div>
            <div id="wa-info" class="small text-muted"></div>
            <div class="d-flex gap-2 mt-2">
              <button class="btn btn-sm btn-outline-secondary" id="btn-wa-refresh"><i class="bi bi-arrow-clockwise"></i> Atualizar</button>
              <button class="btn btn-sm btn-primary d-none" id="btn-wa-reconnect"><i class="bi bi-plug"></i> Conectar WhatsApp</button>
              <button class="btn btn-sm btn-outline-danger d-none" id="btn-wa-disconnect"><i class="bi bi-box-arrow-left"></i> Desconectar</button>
            </div>
          </div>
        </div>

        <div class="card panel-card">
          <div class="card-header d-flex justify-content-between align-items-center"><span><i class="bi bi-chat-left-text me-1"></i> Modelos de notificação</span><button class="btn btn-sm btn-outline-secondary" id="btn-tpl-reset" title="Restaurar padrões"><i class="bi bi-arrow-counterclockwise"></i></button></div>
          <div class="card-body">
            <p class="small text-muted">Personalize as mensagens enviadas por e-mail e WhatsApp. Use os placeholders: <code>{{number}}</code> <code>{{title}}</code> <code>{{status_label}}</code> <code>{{priority_label}}</code> <code>{{assigned_name}}</code> <code>{{requester_name}}</code> <code>{{entity_name}}</code> <code>{{body}}</code> <code>{{author_name}}</code> <code>{{responder_name}}</code></p>
            <div class="accordion" id="tpl-accordion"></div>
            <div class="d-flex gap-2 mt-3">
              <button class="btn btn-primary btn-sm" id="btn-save-tpl"><i class="bi bi-check-lg"></i> Salvar modelos</button>
              <span class="small text-muted align-self-center" id="tpl-save-hint"></span>
            </div>
          </div>
        </div>
      </div>

      <div class="col-lg-6">
        <div class="card panel-card mb-3">
          <div class="card-header"><i class="bi bi-volume-up me-1"></i> Painel em tempo real</div>
          <div class="card-body">
            <div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="s-voice" ${s['app.voice_enabled'] ? 'checked' : ''}><label class="form-check-label">Notificação por voz no navegador (novos chamados)</label></div>
            <div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="s-voice-new" ${s['app.voice_new_ticket'] ? 'checked' : ''}><label class="form-check-label">Anunciar chamados novos por voz</label></div>
            <div class="mt-2">
              <label class="form-label small">Intervalo de atualização automática (ms)</label>
              <input class="form-control" id="s-refresh" type="number" value="${esc(s['app.refresh_interval'] || '30000')}">
            </div>
          </div>
        </div>

        <div class="card panel-card">
          <div class="card-header"><i class="bi bi-info-circle me-1"></i> Ações</div>
          <div class="card-body d-flex flex-column gap-2">
            <button class="btn btn-primary" id="btn-save-settings"><i class="bi bi-check-lg"></i> Salvar configurações</button>
            <div class="alert alert-info small mb-0">
              Clientes com nível <b>2 (Gestor)</b> aprovam/reprovam soluções, abrem e acompanham todos os chamados da empresa e
              inserem instruções. Nível <b>1</b> gerencia apenas os próprios chamados. Ajustes em <b>Usuários</b>.
            </div>
          </div>
        </div>

        <div class="card panel-card">
          <div class="card-header"><i class="bi bi-database-down me-1"></i> Backup do banco de dados</div>
          <div class="card-body">
            <p class="small text-muted mb-2">Gera uma cópia completa da base em SQL (estrutura + dados) usando o
              <code>pg_dump</code>. Os arquivos ficam armazenados na pasta <code>backups/</code> do servidor.</p>
            <div class="d-flex gap-2 mb-3">
              <button class="btn btn-primary btn-sm" id="btn-backup-now"><i class="bi bi-download"></i> Gerar backup agora</button>
            </div>
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="s-backup-auto" ${s['backup.auto_enabled'] ? 'checked' : ''}>
              <label class="form-check-label">Backup automático diário</label>
            </div>
            <div class="mb-3">
              <label class="form-label small">Hora do backup automático</label>
              <select class="form-select" id="s-backup-hour">
                ${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${String(s['backup.auto_hour'] || '3') === String(h) ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}
              </select>
            </div>
            <hr>
            <div class="d-flex justify-content-between align-items-center mb-2">
              <strong class="small">Backups armazenados</strong>
              <button class="btn btn-sm btn-outline-secondary" id="btn-refresh-backups" title="Atualizar lista"><i class="bi bi-arrow-clockwise"></i></button>
            </div>
            <div id="backup-list"></div>
          </div>
        </div>
      </div>
    </div>`;

  const doUpload = (key, inputEl, boxId) => {
    inputEl.onchange = async () => {
      const file = inputEl.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      fd.append('key', key);
      try {
        const r = await API.post('/settings/upload', fd, true);
        const box = document.getElementById(boxId);
        box.innerHTML = `<img src="${esc(r.url)}" alt="${key}">`;
        toast('Imagem enviada.', 'success');
      } catch (e) { showError(e); }
    };
    inputEl.onclick = () => inputEl.value = null;
  };
  const logoBox = document.getElementById('upload-logo');
  const bgBox = document.getElementById('upload-bg');
  logoBox.onclick = () => logoBox.querySelector('input').click();
  bgBox.onclick = () => bgBox.querySelector('input').click();
  doUpload('logo', logoBox.querySelector('input'), 'upload-logo');
  doUpload('background', bgBox.querySelector('input'), 'upload-bg');

  document.getElementById('btn-save-settings').onclick = async () => {
    const payload = {
      'app.name': document.getElementById('s-appname').value.trim(),
      'app.notify_email': document.getElementById('s-notify-email').checked,
      'app.notify_whatsapp': document.getElementById('s-notify-wa').checked,
      'app.notify_techs_new': document.getElementById('s-notify-techs').checked,
      'app.notify_clients': document.getElementById('s-notify-clients').checked,
      'app.approval_on_solve': document.getElementById('s-approval').checked,
      'app.admin_email': document.getElementById('s-adminmail').value.trim(),
      'app.voice_enabled': document.getElementById('s-voice').checked,
      'app.voice_new_ticket': document.getElementById('s-voice-new').checked,
      'app.refresh_interval': parseInt(document.getElementById('s-refresh').value, 10) || 30000,
      'backup.auto_enabled': document.getElementById('s-backup-auto').checked,
      'backup.auto_hour': parseInt(document.getElementById('s-backup-hour').value, 10) || 3,
    };
    try {
      await API.post('/settings', payload);
      toast('Configurações salvas.', 'success');
    } catch (e) { showError(e); }
  };

  // ---------------- Modelos de notificação ----------------
  const DEFAULT_TPL = {
    'ticket.created': { label: 'Chamado criado (equipe)', title: 'Novo chamado recebido', subject: '[Novo] {{number}} - {{title}}', message: 'Um novo chamado foi aberto por {{requester_name}} ({{entity_name}}).\nNúmero: {{number}}\nTítulo: {{title}}\nPrioridade: {{priority_label}}\nStatus: {{status_label}}' },
    'ticket.created.confirmation': { label: 'Confirmação ao requisitante', title: 'Chamado aberto com sucesso', subject: 'Chamado {{number}} aberto', message: 'Seu chamado foi registrado. Número: {{number}}\nTítulo: {{title}}\nAcompanhe as atualizações pelo sistema ou por e-mail/WhatsApp.' },
    'status.changed': { label: 'Mudança de status (genérico)', title: 'Status do chamado {{number}} alterado para {{status_label}}', subject: '[{{status_label}}] {{number}} - {{title}}', message: 'O chamado {{number}} - "{{title}}" teve o status alterado para {{status_label}}.' },
    'status.changed.1': { label: 'Status: Novo', title: 'Chamado {{number}} — Novo', subject: '[Novo] {{number}} - {{title}}', message: 'O chamado {{number}} foi reaberto como *Novo*. Título: "{{title}}"\nAguardando atribuição.' },
    'status.changed.2': { label: 'Status: Atribuído', title: 'Chamado {{number}} — Atribuído', subject: '[Atribuído] {{number}} - {{title}}', message: 'O chamado {{number}} - "{{title}}" foi atribuído ao técnico {{assigned_name}}.\nEm breve o atendimento será iniciado.' },
    'status.changed.3': { label: 'Status: Em andamento', title: 'Chamado {{number}} — Em andamento', subject: '[Em andamento] {{number}} - {{title}}', message: 'Boa notícia! O chamado {{number}} - "{{title}}" está *em andamento*.\nTécnico responsável: {{assigned_name}}\nAcompanhe as atualizações por aqui.' },
    'status.changed.4': { label: 'Status: Pendente', title: 'Chamado {{number}} — Pendente', subject: '[Pendente] {{number}} - {{title}}', message: 'O chamado {{number}} - "{{title}}" está *pendente*.\nMotivo: aguardando informações ou ação externa. Retornaremos em breve.' },
    'status.changed.5': { label: 'Status: Resolvido', title: 'Chamado {{number}} — Resolvido', subject: '[Resolvido] {{number}} - {{title}}', message: 'O chamado {{number}} - "{{title}}" foi *resolvido*.\nAcesse o sistema para avaliar a solução.' },
    'status.changed.6': { label: 'Status: Fechado', title: 'Chamado {{number}} — Fechado', subject: '[Fechado] {{number}} - {{title}}', message: 'O chamado {{number}} - "{{title}}" foi *fechado*. Obrigado pelo contato!' },
    'status.changed.7': { label: 'Status: Cancelado', title: 'Chamado {{number}} — Cancelado', subject: '[Cancelado] {{number}} - {{title}}', message: 'O chamado {{number}} - "{{title}}" foi *cancelado*.' },
    'ticket.assigned': { label: 'Chamado atribuído', title: 'Chamado {{number}} atribuído', subject: '[Atribuído] {{number}} - {{title}}', message: 'O chamado {{number}} - "{{title}}" foi atribuído ao técnico {{assigned_name}}.' },
    'comment.added': { label: 'Nova mensagem/comentário', title: 'Nova mensagem em {{number}}', subject: '[Mensagem] {{number}} - {{title}}', message: '"{{body}}" \n\n-- {{author_name}} ({{number}})' },
    'approval.requested': { label: 'Aprovação solicitada', title: 'Aprovação solicitada - {{number}}', subject: '[Aprovação] {{number}} - {{title}}', message: 'O chamado {{number}} - "{{title}}" aguarda sua aprovação da solução proposta.\nAcesse o sistema para aprovar ou reprovar.' },
    'approval.responded.approved': { label: 'Solução aprovada', title: 'Solução APROVADA - {{number}}', subject: '[Aprovado] {{number}} - {{title}}', message: '{{responder_name}} aprovou a solução do chamado {{number}} - "{{title}}".' },
    'approval.responded.rejected': { label: 'Solução reprovada', title: 'Solução REPROVADA - {{number}}', subject: '[Reprovado] {{number}} - {{title}}', message: '{{responder_name}} reprovou a solução do chamado {{number}} - "{{title}}".' },
  };
  const tplKeys = Object.keys(DEFAULT_TPL);
  let customTpl = (s['notify.templates'] && typeof s['notify.templates'] === 'object') ? s['notify.templates'] : {};
  // quando vem como string JSON do backend
  if (typeof s['notify.templates'] === 'string') { try { customTpl = JSON.parse(s['notify.templates']); } catch { customTpl = {}; } }

  function renderTplList() {
    const acc = document.getElementById('tpl-accordion');
    acc.innerHTML = tplKeys.map((k, idx) => {
      const cur = customTpl[k] || DEFAULT_TPL[k];
      const isCustom = !!customTpl[k];
      return `<div class="accordion-item">
        <h2 class="accordion-header"><button class="accordion-button ${idx? 'collapsed':''}" type="button" data-bs-toggle="collapse" data-bs-target="#tpl-${idx}">${esc(DEFAULT_TPL[k].label)} <small class="text-muted ms-2">${esc(k)}</small>${isCustom ? ' <span class="badge text-bg-warning ms-2">personalizado</span>' : ''}</button></h2>
        <div id="tpl-${idx}" class="accordion-collapse collapse ${idx===0?'show':''}" data-bs-parent="#tpl-accordion">
          <div class="accordion-body">
            <div class="mb-2"><label class="form-label small">Título (WhatsApp/In-app)</label><input class="form-control form-control-sm" data-k="${esc(k)}" data-f="title" value="${esc(cur.title)}"></div>
            <div class="mb-2"><label class="form-label small">Assunto (e-mail)</label><input class="form-control form-control-sm" data-k="${esc(k)}" data-f="subject" value="${esc(cur.subject)}"></div>
            <div class="mb-2"><label class="form-label small">Mensagem</label><textarea class="form-control form-control-sm" rows="3" data-k="${esc(k)}" data-f="message">${esc(cur.message)}</textarea></div>
          </div>
        </div>
      </div>`;
    }).join('');
  }
  renderTplList();
  document.getElementById('btn-save-tpl').onclick = async () => {
    const out = {};
    document.querySelectorAll('#tpl-accordion [data-k]').forEach((el) => {
      const k = el.dataset.k, f = el.dataset.f;
      if (!out[k]) out[k] = { ...DEFAULT_TPL[k] };
      out[k][f] = el.value;
      delete out[k].label;
    });
    // remove iguais ao padrão para economizar
    for (const k of Object.keys(out)) {
      const d = DEFAULT_TPL[k];
      if (d && out[k].title === d.title && out[k].subject === d.subject && out[k].message === d.message) delete out[k];
    }
    try {
      await API.post('/settings', { 'notify.templates': JSON.stringify(out) });
      customTpl = out;
      document.getElementById('tpl-save-hint').textContent = 'Salvo!';
      setTimeout(()=> document.getElementById('tpl-save-hint').textContent='', 3000);
      toast('Modelos salvos.', 'success');
      renderTplList();
    } catch (e) { showError(e); }
  };
  document.getElementById('btn-tpl-reset').onclick = async () => {
    const ok = await confirmDialog({ title: 'Restaurar padrões', body: 'Apagar todas as personalizações e voltar aos textos originais?', confirmText: 'Restaurar', danger: true });
    if (!ok) return;
    try { await API.post('/settings', { 'notify.templates': JSON.stringify({}) }); customTpl = {}; renderTplList(); toast('Modelos restaurados ao padrão.', 'success'); } catch(e){ showError(e); }
  };

  // ---------------- Backup do banco de dados ----------------
  const backupListEl = document.getElementById('backup-list');
  const renderBackups = (list) => {
    backupListEl.innerHTML = list.length ? `
      <div class="table-responsive"><table class="table table-sm table-hover align-middle mb-0">
        <thead><tr><th>Arquivo</th><th>Data</th><th>Tamanho</th><th class="text-end">Ações</th></tr></thead>
        <tbody>${list.map((b) => `
          <tr>
            <td><code class="small">${esc(b.name)}</code></td>
            <td class="small">${esc(fmt.dateTime(b.created_at))}</td>
            <td class="small text-muted">${esc(fmt.bytes(b.size))}</td>
            <td class="text-end">
              <button class="btn btn-sm btn-outline-primary bk-dl" data-name="${esc(b.name)}" title="Baixar"><i class="bi bi-box-arrow-down"></i></button>
              <button class="btn btn-sm btn-outline-danger bk-del" data-name="${esc(b.name)}" title="Excluir"><i class="bi bi-trash"></i></button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>`
      : emptyState('Nenhum backup ainda', 'Clique em "Gerar backup agora" para criar o primeiro.', 'bi-database-down');
    backupListEl.querySelectorAll('.bk-dl').forEach((b) => b.addEventListener('click', () => downloadBackup(b.dataset.name)));
    backupListEl.querySelectorAll('.bk-del').forEach((b) => b.addEventListener('click', () => removeBackup(b.dataset.name)));
  };

  async function loadBackups() {
    try {
      backupListEl.innerHTML = spinner();
      const list = await API.get('/backup');
      renderBackups(list);
    } catch (e) { backupListEl.innerHTML = ''; showError(e); }
  }

  async function downloadBackup(name) {
    try {
      const res = await fetch('/api/backup/download/' + encodeURIComponent(name), {
        headers: { Authorization: 'Bearer ' + API.token },
      });
      if (!res.ok) {
        let err = {};
        try { err = await res.json(); } catch {}
        throw new Error(err.error || 'Falha ao baixar o backup.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast('Backup baixado.', 'success');
    } catch (e) { showError(e); }
  }

  async function removeBackup(name) {
    const ok = await confirmDialog({ title: 'Excluir backup', body: `Deseja remover o arquivo <code>${esc(name)}</code>?`, confirmText: 'Excluir', danger: true });
    if (!ok) return;
    try {
      await API.del('/backup/' + encodeURIComponent(name));
      toast('Backup removido.', 'warning');
      loadBackups();
    } catch (e) { showError(e); }
  }

  document.getElementById('btn-backup-now').onclick = async () => {
    const btn = document.getElementById('btn-backup-now');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Gerando...';
    try {
      const info = await API.post('/backup/create');
      toast(`Backup criado: ${info.name}`, 'success');
      loadBackups();
    } catch (e) { showError(e); }
    finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-download"></i> Gerar backup agora';
    }
  };
  document.getElementById('btn-refresh-backups').onclick = loadBackups;
  loadBackups();

  // ---------------- WhatsApp (conexao local) ----------------
  async function loadWhatsAppStatus(refreshQr = true) {
    try {
      const st = await API.get('/whatsapp/status');
      const line = document.getElementById('wa-status-line');
      const qrArea = document.getElementById('wa-qr-area');
      const info = document.getElementById('wa-info');
      const btnDisconnect = document.getElementById('btn-wa-disconnect');
      const btnReconnect = document.getElementById('btn-wa-reconnect');
      btnDisconnect.classList.toggle('d-none', !st.ready);
      btnReconnect.classList.toggle('d-none', !(st.state === 'idle' || st.state === 'disconnected'));

      if (st.ready) {
        line.innerHTML = `<span class="badge text-bg-success"><i class="bi bi-check-lg"></i> Conectado ${st.phone ? '· ' + esc(st.phone) : ''}</span>`;
        qrArea.innerHTML = '';
        info.innerHTML = 'As notificações serão enviadas para o WhatsApp dos destinatários com telefone cadastrado.';
      } else if (st.state === 'qr' && st.qr) {
        line.innerHTML = '<span class="badge text-bg-warning text-dark">Aguardando escaneamento</span>';
        qrArea.innerHTML = `<div class="border rounded d-inline-block p-2 bg-white"><img src="${st.qr}" alt="QR" width="220"></div>
          <div class="small text-muted mt-1">Escaneie com o WhatsApp do celular (Configurações ➜ Aparelhos conectados ➜ Conectar um aparelho).</div>`;
        info.innerHTML = 'Enquanto não houver QR válido, o envio fica ativo automaticamente após a conexão.';
      } else if (st.state === 'error' || st.state === 'disconnected') {
        line.innerHTML = `<span class="badge text-bg-danger">Conectando no próximo ciclo${st.error ? ' · ' + esc(st.error) : ''}</span>`;
        qrArea.innerHTML = '';
        info.innerHTML = 'O serviço tenta reconectar sozinho. Mantenha o computador ligado.';
      } else if (st.state === 'idle') {
        line.innerHTML = '<span class="badge text-bg-secondary">Desconectado</span>';
        qrArea.innerHTML = '';
        info.innerHTML = 'Clique em "Conectar WhatsApp" para gerar um novo QR code.';
      } else {
        line.innerHTML = '<span class="badge text-bg-secondary">Conectando…</span>';
        qrArea.innerHTML = '';
        info.innerHTML = 'Aguardando conexão com o WhatsApp Web.';
      }
    } catch { line.innerHTML = '<span class="text-danger small">Não foi possível consultar o status.</span>'; }
  }

  function stopWaPolling() { if (window.__waTimer) { clearInterval(window.__waTimer); window.__waTimer = null; } }
  document.getElementById('btn-wa-refresh').onclick = loadWhatsAppStatus;
  document.getElementById('btn-wa-disconnect').onclick = async () => {
    try { await API.post('/whatsapp/disconnect'); toast('WhatsApp desconectado.', 'warning'); loadWhatsAppStatus(); }
    catch (e) { showError(e); }
  };
  document.getElementById('btn-wa-reconnect').onclick = async () => {
    try { await API.post('/whatsapp/reconnect'); toast('Conectando…', 'info'); loadWhatsAppStatus(); }
    catch (e) { showError(e); }
  };
  loadWhatsAppStatus();
  stopWaPolling();
  window.__waTimer = setInterval(loadWhatsAppStatus, 5000);
};

// ---------------- Perfil ----------------
Views.profile = async function profile(el) {
  try {
    const me = await API.get('/auth/me');
    API.user = me.user;
  } catch {}
  const user = API.user || {};
  el.innerHTML = `
    <div class="row justify-content-center">
      <div class="col-lg-6 col-xl-5">
        <div class="card panel-card mb-3">
          <div class="card-body text-center">
            ${user.entity_logo ? `<img src="${esc(user.entity_logo)}" class="profile-entity-logo" alt="logo ${esc(user.entity_name || '')}">` : ''}
            <div class="avatar avatar-lg mx-auto mb-2">${esc((user.name || '?').trim().charAt(0).toUpperCase())}</div>
            <h5 class="mb-0">${esc(user.name)}</h5>
            <span class="badge text-bg-primary mt-1">${LABELS.role[user.role]}</span>
            ${user.entity_name ? `<div class="text-muted small mt-1"><i class="bi bi-building me-1"></i>${esc(user.entity_name)}</div>` : ''}
            <div class="text-muted small mt-2">@${esc(user.username)} · ${esc(user.email || '')}</div>
          </div>
        </div>
        <div class="card panel-card">
          <div class="card-header"><i class="bi bi-key me-1"></i> Alterar senha</div>
          <div class="card-body">
            <div class="mb-2"><label class="form-label small">Senha atual</label>
              <input type="password" class="form-control" id="p-current"></div>
            <div class="mb-2"><label class="form-label small">Nova senha</label>
              <input type="password" class="form-control" id="p-new"></div>
            <div class="mb-3"><label class="form-label small">Confirmar nova senha</label>
              <input type="password" class="form-control" id="p-confirm"></div>
            <button class="btn btn-primary" id="btn-change-pass"><i class="bi bi-check-lg"></i> Alterar senha</button>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('btn-change-pass').onclick = async () => {
    const cur = document.getElementById('p-current').value;
    const nw = document.getElementById('p-new').value;
    const cf = document.getElementById('p-confirm').value;
    if (nw !== cf) { toast('A confirmação não confere.', 'warning'); return; }
    try {
      await API.post('/auth/password', { current_password: cur, new_password: nw });
      toast('Senha alterada com sucesso.', 'success');
      document.querySelectorAll('#p-current, #p-new, #p-confirm').forEach((i) => (i.value = ''));
    } catch (e) { showError(e); }
  };
};
// ---------------------------------------------------------------
// Perfis e permissoes + Visualizacao de cargos (somente Admin Mestre)
// ---------------------------------------------------------------
Views.adminRoles = async function adminRoles(el) {
  if (!(await guardRole('admin'))) return;
  el.innerHTML = spinner();
  let data;
  try { data = await API.get('/permissions'); } catch (e) { showError(e); return; }
  const ents = (await API.get('/entities').catch(() => [])).filter((e) => e.active);
  const { roles, permissions, master_only: masterOnly, defaults } = data;
  const saved = JSON.parse(JSON.stringify(data.matrix));
  const matrix = JSON.parse(JSON.stringify(data.matrix));
  const groups = [...new Set(permissions.map((p) => p.group))];
  const needsEntity = (key) => ['admin_local', 'manager', 'user'].includes(key);

  const isDirty = () => roles.some((r) => permissions.some((p) => !!matrix[r.key][p.key] !== !!saved[r.key][p.key]));
  const countOn = (rk) => permissions.filter((p) => matrix[rk][p.key]).length;

  el.innerHTML = `
    <div class="roles-page">
      <div class="roles-intro">
        <p>Marque o que cada perfil pode fazer. O <b>Administrador Mestre</b> sempre pode tudo e é o único que mexe nesta tela.
          As mudanças valem para todos os usuários do perfil assim que você salvar (eles veem na próxima página que abrirem).</p>
      </div>

      <div class="card panel-card mb-3 preview-card">
        <div class="card-body">
          <div class="pv-head">
            <i class="bi bi-eye"></i>
            <div>
              <h6 class="mb-1">Visualização de cargos</h6>
              <p class="small text-muted mb-0">Veja a plataforma inteira como outro perfil. Abre uma cópia provisória do sistema:
                pode clicar, abrir e mover chamados à vontade, nada vai para os dados reais e ninguém recebe aviso.</p>
            </div>
          </div>
          <div class="row g-2 align-items-end mt-1">
            <div class="col-sm-4">
              <label class="form-label small mb-1">Ver como</label>
              <select class="form-select form-select-sm" id="pv-role">
                ${roles.map((r) => `<option value="${r.key}">${esc(r.label)}</option>`).join('')}
              </select>
            </div>
            <div class="col-sm-4" id="pv-ent-box">
              <label class="form-label small mb-1">Empresa</label>
              <select class="form-select form-select-sm" id="pv-ent">
                ${ents.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}
              </select>
            </div>
            <div class="col-sm-4" id="pv-loc-box">
              <label class="form-label small mb-1">Localização</label>
              <select class="form-select form-select-sm" id="pv-loc"><option value="">—</option></select>
            </div>
          </div>
          <p class="small text-muted mt-2 mb-2">As permissões usadas na prévia são as que estão <b>salvas</b>. Se mudou alguma caixa, salve antes.</p>
          <button class="btn btn-primary btn-sm" id="pv-start"><i class="bi bi-play-fill"></i> Abrir prévia</button>
        </div>
      </div>

      <div class="card panel-card">
        <div class="card-header d-flex align-items-center justify-content-between gap-2 flex-wrap">
          <span><i class="bi bi-shield-check me-1"></i> O que cada perfil pode fazer</span>
          <div class="d-flex gap-2">
            <button class="btn btn-outline-secondary btn-sm" id="rp-undo" disabled>Descartar mudanças</button>
            <button class="btn btn-primary btn-sm" id="rp-save" disabled><i class="bi bi-check2"></i> Salvar</button>
          </div>
        </div>
        <div class="perm-scroll">
          <table class="perm-table">
            <thead>
              <tr>
                <th class="perm-name">Função</th>
                <th class="perm-col master" title="Sempre pode tudo">Admin Mestre</th>
                ${roles.map((r) => `
                  <th class="perm-col">
                    <div>${esc(r.label)}</div>
                    <div class="perm-col-tools">
                      <span class="perm-count" data-count="${r.key}"></span>
                      <button class="btn btn-link btn-sm p-0 rp-preview" data-role="${r.key}" title="Ver a plataforma como ${esc(r.label)}"><i class="bi bi-eye"></i></button>
                      <button class="btn btn-link btn-sm p-0 rp-reset" data-role="${r.key}" title="Voltar ao padrão deste perfil"><i class="bi bi-arrow-counterclockwise"></i></button>
                    </div>
                  </th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${groups.map((g) => `
                <tr class="perm-group"><td colspan="${roles.length + 2}">${esc(g)}</td></tr>
                ${permissions.filter((p) => p.group === g).map((p) => `
                  <tr>
                    <td class="perm-name">${esc(p.label)}</td>
                    <td class="perm-col master"><input type="checkbox" class="form-check-input" checked disabled aria-label="Admin Mestre: sempre"></td>
                    ${roles.map((r) => `
                      <td class="perm-col"><input type="checkbox" class="form-check-input rp-box" data-role="${r.key}" data-perm="${p.key}"
                        aria-label="${esc(r.label)}: ${esc(p.label)}"></td>`).join('')}
                  </tr>`).join('')}`).join('')}
              <tr class="perm-group"><td colspan="${roles.length + 2}">Somente Administrador Mestre</td></tr>
              ${masterOnly.map((label) => `
                <tr class="perm-locked">
                  <td class="perm-name">${esc(label)}</td>
                  <td class="perm-col master"><input type="checkbox" class="form-check-input" checked disabled></td>
                  ${roles.map(() => '<td class="perm-col"><i class="bi bi-lock text-muted" title="Exclusivo do Administrador Mestre"></i></td>').join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;

  const saveBtn = el.querySelector('#rp-save');
  const undoBtn = el.querySelector('#rp-undo');

  function paint() {
    el.querySelectorAll('.rp-box').forEach((b) => {
      const { role, perm } = b.dataset;
      b.checked = !!matrix[role][perm];
      b.closest('td').classList.toggle('changed', !!matrix[role][perm] !== !!saved[role][perm]);
    });
    roles.forEach((r) => {
      el.querySelector(`[data-count="${r.key}"]`).textContent = `${countOn(r.key)}/${permissions.length}`;
    });
    const dirty = isDirty();
    saveBtn.disabled = !dirty; undoBtn.disabled = !dirty;
  }

  el.querySelectorAll('.rp-box').forEach((b) => b.addEventListener('change', () => {
    matrix[b.dataset.role][b.dataset.perm] = b.checked;
    paint();
  }));
  el.querySelectorAll('.rp-reset').forEach((b) => b.addEventListener('click', () => {
    const rk = b.dataset.role;
    permissions.forEach((p) => { matrix[rk][p.key] = (defaults[rk] || []).includes(p.key); });
    paint();
    toast('Padrão restaurado na tela. Clique em Salvar para aplicar.', 'info');
  }));
  undoBtn.addEventListener('click', () => {
    roles.forEach((r) => { matrix[r.key] = { ...saved[r.key] }; });
    paint();
  });
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      await API.request('PUT', '/permissions', { matrix });
      roles.forEach((r) => { saved[r.key] = { ...matrix[r.key] }; });
      paint();
      toast('Permissões salvas.', 'success');
    } catch (e) { showError(e); paint(); }
  });

  // ---- Visualizacao de cargos ----
  const roleSel = el.querySelector('#pv-role');
  const entSel = el.querySelector('#pv-ent');
  const locSel = el.querySelector('#pv-loc');
  async function loadLocs() {
    locSel.innerHTML = '<option value="">—</option>';
    if (!entSel.value) return;
    const locs = await API.get(`/locations?entity_id=${entSel.value}&active=true`).catch(() => []);
    locSel.innerHTML = locs.length
      ? locs.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')
      : '<option value="">Sem localizações</option>';
  }
  function syncPreviewForm() {
    const need = needsEntity(roleSel.value);
    el.querySelector('#pv-ent-box').style.display = need ? '' : 'none';
    el.querySelector('#pv-loc-box').style.display = need ? '' : 'none';
  }
  roleSel.addEventListener('change', syncPreviewForm);
  entSel.addEventListener('change', loadLocs);
  syncPreviewForm();
  loadLocs();

  async function startPreview(roleKey) {
    if (isDirty()) {
      const go = await confirmDialog({ title: 'Mudanças não salvas', body: 'A prévia usa as permissões salvas. Abrir mesmo assim, sem as mudanças desta tela?', confirmText: 'Abrir prévia' });
      if (!go) return;
    }
    const need = needsEntity(roleKey);
    if (need && !entSel.value) { toast('Cadastre uma empresa antes.', 'warning'); return; }
    const btn = el.querySelector('#pv-start');
    btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Preparando a cópia...';
    try {
      const r = await API.post('/permissions/preview', {
        role_key: roleKey,
        entity_id: need ? entSel.value : null,
        location_id: need ? (locSel.value || null) : null,
      });
      API.startPreview(r.token, r.user);
      location.href = '/app.html#/tickets';
      location.reload();
    } catch (e) {
      showError(e);
      btn.disabled = false; btn.innerHTML = '<i class="bi bi-play-fill"></i> Abrir prévia';
    }
  }
  el.querySelector('#pv-start').addEventListener('click', () => startPreview(roleSel.value));
  el.querySelectorAll('.rp-preview').forEach((b) => b.addEventListener('click', () => {
    roleSel.value = b.dataset.role; syncPreviewForm();
    if (needsEntity(b.dataset.role)) {
      el.querySelector('.preview-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('Escolha a empresa e clique em Abrir prévia.', 'info');
    } else {
      startPreview(b.dataset.role);
    }
  }));

  paint();
};
