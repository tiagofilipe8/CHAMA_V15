// ---------------------------------------------------------------
// Views.ticketDetail — Detalhe do chamado com timeline e acoes
// ---------------------------------------------------------------

Views.ticketDetail = function ticketDetail(id) {
  return async function renderDetail(el, opts = {}) {
    const user = API.user || {};
    let t;
    try {
      t = await API.get('/tickets/' + id);
    } catch (e) {
      el.innerHTML = emptyState(e.message || 'Chamado não encontrado', '', 'bi-journal-x');
      return;
    }

    const isRequester = t.requester_id === user.id;
    const isManager = user.role === 'client' && (user.client_level || 1) === 2 && t.entity_id === user.entity_id;
    const canClientApprove = t.approval_status === 'pending' && user.role === 'client';
    const techCanEdit = user.role === 'technician' && t.assigned_user_id === user.id;
    const isMyAssigned = user.role === 'technician' && t.assigned_user_id === user.id;
    const isUnassignedTech = user.role === 'technician' && !t.assigned_user_id;

    // ---------------- Barra de acoes ----------------
    const actions = [];
    if (user.role !== 'client') {
      if (!t.assigned_user_id && user.role === 'technician') {
        actions.push(`<button class="btn btn-outline-success btn-sm" id="act-take"><i class="bi bi-person-check"></i> Assumir chamado</button>`);
      }
      if (user.role === 'admin' || isMyAssigned) {
        actions.push(`<button class="btn btn-outline-primary btn-sm" data-bs-toggle="modal" data-bs-target="#modal-status"><i class="bi bi-arrow-repeat"></i> Alterar status</button>`);
        actions.push(`<button class="btn btn-outline-primary btn-sm" data-bs-toggle="modal" data-bs-target="#modal-approval"><i class="bi bi-check2-square"></i> Solicitar aprovação</button>`);
      }
      if (user.role === 'admin') {
        actions.push(`<button class="btn btn-outline-secondary btn-sm" data-bs-toggle="modal" data-bs-target="#modal-assign"><i class="bi bi-person-plus"></i> Atribuir técnico</button>`);
      }
      if (user.role === 'admin' || isMyAssigned) {
        actions.push(`<button class="btn btn-outline-secondary btn-sm" data-bs-toggle="modal" data-bs-target="#modal-edit"><i class="bi bi-pencil"></i> Editar</button>`);
      }
    } else {
      if (canClientApprove) {
        actions.push(`<button class="btn btn-success btn-sm" id="act-approve"><i class="bi bi-check-circle"></i> Aprovar solução</button>`);
        actions.push(`<button class="btn btn-outline-danger btn-sm" id="act-reject"><i class="bi bi-x-circle"></i> Reprovar</button>`);
      }
      if ((isRequester || isManager) && [1, 2, 3, 4].includes(t.status)) {
        actions.push(`<button class="btn btn-outline-danger btn-sm" id="act-cancel"><i class="bi bi-slash-circle"></i> Cancelar chamado</button>`);
      }
      if ((isRequester || isManager) && [5, 6].includes(t.status)) {
        actions.push(`<button class="btn btn-outline-primary btn-sm" id="act-reopen"><i class="bi bi-arrow-counterclockwise"></i> Reabrir</button>`);
      }
      if (isRequester && t.status === 1) {
        actions.push(`<button class="btn btn-outline-secondary btn-sm" data-bs-toggle="modal" data-bs-target="#modal-edit"><i class="bi bi-pencil"></i> Editar</button>`);
      }
      if (isManager) {
        actions.push(`<button class="btn btn-outline-warning btn-sm" id="act-note-focus"><i class="bi bi-chat-square-quote"></i> Instrução</button>`);
      }
    }

    const actionBar = actions.length
      ? `<div class="d-flex flex-wrap gap-2 mb-3">${actions.join('')}</div>` : '';

    // ---------------- Aprovacao pendente (box para o cliente) ----------------
    const approvalBox = user.role === 'client' && canClientApprove ? `
      <div class="alert alert-warning d-flex flex-column gap-2 pending-box">
        <div><i class="bi bi-hourglass-split me-1"></i><b>Solução proposta aguardando sua aprovação</b></div>
        <div class="small text-muted">${esc(t.approval_comment || '')}</div>
        <textarea class="form-control form-control-sm" id="approval-note" rows="2" placeholder="Complemento opcional (observação/instrução)..."></textarea>
        <div class="d-flex gap-2">
          <button class="btn btn-success btn-sm" id="act-approve"><i class="bi bi-check-circle"></i> Aprovar e fechar</button>
          <button class="btn btn-outline-danger btn-sm" id="act-reject"><i class="bi bi-x-circle"></i> Reprovar</button>
        </div>
      </div>` : '';

    // ---------------- Timeline ----------------
    const timeline = (t.messages || []).map((m) => {
      if (m.kind === 'system') {
        return `<li class="timeline-item system">
          <div class="tl-badge"><i class="bi bi-gear"></i></div>
          <div class="tl-body">
            <div class="tl-content text-muted">${esc(m.content)}</div>
            <small class="text-muted">${m.author_name} · ${fmt.dateTime(m.created_at)}</small>
          </div>
        </li>`;
      }
      const icon = m.kind === 'note' ? 'bi-chat-square-quote' : m.kind === 'approval'
        ? 'bi-check2-square' : 'bi-chat-dots';
      const tone = m.kind === 'note' ? 'tl-warning' : m.kind === 'approval' ? 'tl-primary' : 'tl-info';
      const badgeCls = { 'tl-warning': 'text-bg-warning', 'tl-primary': 'text-bg-primary', 'tl-info': 'text-bg-info' }[tone] || 'text-bg-secondary';
      return `<li class="timeline-item ${m.kind === 'system' ? 'system' : ''}">
        <div class="tl-badge ${tone}"><i class="bi ${icon}"></i></div>
        <div class="tl-body">
          <div class="tl-head">
            <strong>${esc(m.author_name)}</strong>
            <span class="badge ${badgeCls} ms-1">${m.kind === 'note' ? 'Instrução' : m.kind === 'approval' ? 'Aprovação' : 'Comentário'}</span>
            <span class="text-muted small ms-auto">${fmt.dateTime(m.created_at)}</span>
          </div>
          <div class="tl-content">${esc(m.content).replace(/\n/g, '<br>')}</div>
        </div>
      </li>`;
    }).join('');

    el.innerHTML = `
      <div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3">
        <div>
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <h4 class="mb-0 text-primary">${esc(t.number)}</h4>
            ${badgeStatus(t.status)}
            ${badgePriority(t.priority)}
            ${t.approval_status !== 'none' ? `<span class="badge bd-approval-${t.approval_status}">${LABELS.approval[t.approval_status]}</span>` : ''}
          </div>
          <h5 class="mt-1 mb-0">${esc(t.title)}</h5>
          <small class="text-muted">${esc(t.entity_name || '')} · ${esc(t.category_name || '')}</small>
        </div>
        <a class="btn btn-sm btn-outline-secondary" href="#/tickets"><i class="bi bi-arrow-left"></i> Voltar</a>
      </div>

      ${actionBar}
      ${approvalBox}

      <div class="row g-3">
        <div class="col-lg-8">
          <div class="card panel-card mb-3">
            <div class="card-header"><i class="bi bi-card-text me-1"></i> Descrição</div>
            <div class="card-body">
              <p class="mb-0 ticket-desc">${esc(t.description).replace(/\n/g, '<br>')}</p>
            </div>
          </div>

          <div class="card panel-card mb-3">
            <div class="card-header d-flex justify-content-between align-items-center">
              <span><i class="bi bi-paperclip me-1"></i> Anexos <span class="badge text-bg-secondary">${(t.attachments||[]).length}</span></span>
              <button class="btn btn-sm btn-outline-primary" id="td-add-att"><i class="bi bi-plus-lg"></i> Adicionar</button>
            </div>
            <div class="list-group list-group-flush" id="td-att-list">${(t.attachments||[]).map(f => {
              const isImg = /^image\//.test(f.mime_type || '');
              const url = `/api/tickets/${t.id}/attachments/${f.id}/file?token=${encodeURIComponent(API.token || '')}`;
              return `<div class="list-group-item d-flex align-items-center gap-2 small" data-att="${f.id}">
                <i class="bi ${isImg ? 'bi-image text-info' : 'bi-file-earmark text-secondary'}"></i>
                <div class="flex-grow-1 text-truncate">
                  <a href="${url}" target="_blank" class="text-decoration-none">${esc(f.file_name)}</a>
                  <div class="text-muted" style="font-size:.75rem">${f.file_size ? (f.file_size/1024/1024).toFixed(1)+' MB · ' : ''}${esc(f.uploaded_by_name||'—')} · ${fmt.dateTime(f.created_at)}</div>
                </div>
                ${isImg ? `<a href="${url}&inline=1" target="_blank" class="btn btn-sm btn-outline-secondary"><i class="bi bi-eye"></i></a>` : ''}
                <a href="${url}" class="btn btn-sm btn-outline-secondary"><i class="bi bi-download"></i></a>
                <button class="btn btn-sm btn-outline-danger td-del-att" data-att="${f.id}" title="Remover"><i class="bi bi-trash"></i></button>
              </div>`;
            }).join('') || '<div class="p-3 text-muted small">Nenhum anexo</div>'}</div>
            <input type="file" id="td-att-input" multiple hidden
                   accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,video/mp4,audio/mpeg">
          </div>

          <div class="card panel-card">
            <div class="card-header"><i class="bi bi-clock-history me-1"></i> Timeline</div>
            <div class="card-body">
              <ul class="timeline mb-0">${timeline}</ul>
              <div class="d-flex gap-2 mt-3">
                <input class="form-control" id="msg-content" placeholder="${isManager ? 'Escreva uma instrução para a equipe...' : 'Escreva uma mensagem...'}" maxlength="2000">
                <button class="btn btn-primary ${isManager ? 'btn-warning text-dark' : ''}" id="btn-send-msg">
                  <i class="bi bi-send"></i> ${isManager ? 'Instrução' : 'Enviar'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="col-lg-4">
          <div class="card panel-card mb-3">
            <div class="card-header"><i class="bi bi-info-circle me-1"></i> Informações</div>
            <div class="card-body p-0">
              <table class="table table-sm mb-0 info-table">
                <tbody>
                  <tr><th>Requerente</th><td>${esc(t.requester_name || '—')}<br><small class="text-muted">${esc(t.requester_email || '')}</small></td></tr>
                  <tr><th>Técnico</th><td>${t.assigned_name ? esc(t.assigned_name) : '<span class="text-danger">Não atribuído</span>'}</td></tr>
                  <tr><th>Entidade</th><td>${esc(t.entity_name || '—')}</td></tr>
                  <tr><th>Ativo</th><td>${t.asset_id ? `<a href="#/inventory/${t.asset_id}">${esc(t.asset_name||'Ativo')} ${t.asset_tag?`(${esc(t.asset_tag)})`:''}</a>` : '<span class="text-muted">—</span>'}</td></tr>
                  <tr><th>Categoria</th><td>${esc(t.category_name || '—')}</td></tr>
                  <tr><th>Prioridade</th><td>${esc(LABELS.priority[t.priority] || '—')}</td></tr>
                  <tr><th>Abertura</th><td>${fmt.dateTime(t.created_at)}</td></tr>
                  <tr><th>Últ. atualização</th><td>${fmt.dateTime(t.updated_at)}</td></tr>
                  ${t.due_at ? `<tr><th>Prazo</th><td>${fmt.dateTime(t.due_at)}</td></tr>` : ''}
                  <tr><th>Aprovação</th><td>${esc(LABELS.approval[t.approval_status] || '—')}</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          ${t.approval_status === 'pending' && user.role !== 'client' ? `
          <div class="alert alert-secondary small"><i class="bi bi-hourglass-split me-1"></i>
            Solução proposta aguardando aprovação do cliente.</div>` : ''}
        </div>
      </div>

      ${modals()}`;

    wireActions();
    wireModals();

    // ---------------- acoes ----------------
    function afterReload() { renderDetail(el, { silent: true }); }

    function wireActions() {
      const attInput = el.querySelector('#td-att-input');
      el.querySelector('#td-add-att')?.addEventListener('click', () => attInput?.click());
      attInput?.addEventListener('change', async () => {
        const files = Array.from(attInput.files || []);
        if (!files.length) return;
        const fd = new FormData();
        files.forEach(f => fd.append('files', f));
        try {
          await API.post(`/tickets/${t.id}/attachments`, fd, true);
          toast(files.length === 1 ? 'Anexo enviado.' : `${files.length} anexos enviados.`, 'success');
          afterReload();
        } catch (e) { showError(e); }
        attInput.value = '';
      });
      el.querySelectorAll('.td-del-att').forEach((b) => b.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Remover anexo', body: 'Excluir este anexo do chamado?', confirmText: 'Remover', danger: true });
        if (!ok) return;
        try { await API.del(`/tickets/${t.id}/attachments/${b.dataset.att}`); toast('Anexo removido.', 'warning'); afterReload(); }
        catch (e) { showError(e); }
      }));

      el.querySelector('#act-take')?.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Assumir chamado', body: `Deseja assumir o chamado ${t.number}?`, confirmText: 'Assumir' });
        if (!ok) return;
        try { await API.post(`/tickets/${t.id}/assign`, {}); toast('Chamado assumido.', 'success'); afterReload(); }
        catch (e) { showError(e); }
      });

      el.querySelectorAll('#act-approve').forEach((b) => b.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Aprovar solução',
          body: `Confirma a aprovação da solução do chamado ${t.number}?<br>O chamado será <b>fechado</b>.`,
          confirmText: 'Aprovar e fechar',
        });
        if (!ok) return;
        const note = el.querySelector('#approval-note')?.value || '';
        try {
          await API.post(`/tickets/${t.id}/approval/respond`, { decision: 'approved', comment: note });
          toast('Solução aprovada. Chamado fechado.', 'success'); afterReload();
        } catch (e) { showError(e); }
      }));

      el.querySelectorAll('#act-reject').forEach((b) => b.addEventListener('click', async () => {
        const note = el.querySelector('#approval-note')?.value || '';
        const ok = await confirmDialog({
          title: 'Reprovar solução',
          body: `Você está reprovando a solução do chamado ${t.number}. O chamado voltará para "Em andamento".`,
          confirmText: 'Reprovar', danger: true,
        });
        if (!ok) return;
        try {
          await API.post(`/tickets/${t.id}/approval/respond`, { decision: 'rejected', comment: note });
          toast('Solução reprovada.', 'warning'); afterReload();
        } catch (e) { showError(e); }
      }));

      el.querySelector('#act-cancel')?.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Cancelar chamado', body: `Cancelar o chamado ${t.number}?`, confirmText: 'Cancelar', danger: true });
        if (!ok) return;
        try { await API.post(`/tickets/${t.id}/status`, { status: 7 }); toast('Chamado cancelado.', 'warning'); afterReload(); }
        catch (e) { showError(e); }
      });

      el.querySelector('#act-reopen')?.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Reabrir chamado', body: `Reabrir o chamado ${t.number}?`, confirmText: 'Reabrir' });
        if (!ok) return;
        try { await API.post(`/tickets/${t.id}/status`, { status: 3 }); toast('Chamado reaberto.', 'success'); afterReload(); }
        catch (e) { showError(e); }
      });

      el.querySelector('#act-note-focus')?.addEventListener('click', () => el.querySelector('#msg-content').focus());

      const sendBtn = el.querySelector('#btn-send-msg');
      const content = el.querySelector('#msg-content');
      const sendMsg = async () => {
        const text = content.value.trim();
        if (!text) return;
        const kind = isManager ? 'note' : 'comment';
        try {
          await API.post(`/tickets/${t.id}/messages`, { content: text, kind });
          content.value = '';
          toast(isManager ? 'Instrução registrada e notificada.' : 'Comentário enviado.', 'success');
          afterReload();
        } catch (e) { showError(e); }
      };
      sendBtn.addEventListener('click', sendMsg);
      content.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendMsg(); });
    }

    // ---------------- modais ----------------
    function modals() {
      return `
        ${statusModal()}
        ${approvalModal()}
        ${editModal()}
        ${assignModal()}`;
    }

    function statusModal() {
      return `<div class="modal fade" id="modal-status" tabindex="-1">
        <div class="modal-dialog"><div class="modal-content">
          <div class="modal-header"><h6>Alterar status · ${esc(t.number)}</h6>
            <button class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <select class="form-select mb-2" id="s-status">
              ${[2, 3, 4, 5, 6, 7].filter((s) => s !== t.status).map((s) =>
                `<option value="${s}">${LABELS.status[s]}</option>`).join('')}
            </select>
            <textarea class="form-control" id="s-comment" rows="3" placeholder="Comentário (obrigatório para marcar como resolvido/fechado)..."></textarea>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
            <button class="btn btn-primary" id="btn-save-status">Salvar</button>
          </div>
        </div></div></div>`;
    }

    function approvalModal() {
      return `<div class="modal fade" id="modal-approval" tabindex="-1">
        <div class="modal-dialog"><div class="modal-content">
          <div class="modal-header"><h6>Solicitar aprovação · ${esc(t.number)}</h6>
            <button class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <p class="small text-muted mb-2">Descreva a solução aplicada. O cliente (gestor) será notificado por e-mail/WhatsApp para aprovar ou reprovar.</p>
            <textarea class="form-control" id="ap-comment" rows="4" placeholder="Descrição da solução..."></textarea>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
            <button class="btn btn-primary" id="btn-send-approval">Enviar</button>
          </div>
        </div></div></div>`;
    }

    function editModal() {
      return `<div class="modal fade" id="modal-edit" tabindex="-1">
        <div class="modal-dialog modal-lg"><div class="modal-content">
          <div class="modal-header"><h6>Editar chamado · ${esc(t.number)}</h6>
            <button class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <div class="mb-2"><label class="form-label small">Título</label>
              <input class="form-control" id="e-title" value="${esc(t.title)}"></div>
            <div class="mb-2"><label class="form-label small">Descrição</label>
              <textarea class="form-control" id="e-desc" rows="4">${esc(t.description)}</textarea></div>
            <div class="row">
              <div class="col-md-6 mb-2"><label class="form-label small">Categoria</label>
                <select class="form-select" id="e-cat"></select></div>
              <div class="col-md-3 mb-2"><label class="form-label small">Prioridade</label>
                <select class="form-select" id="e-prio">
                  <option value="1">Baixa</option><option value="2">Média</option>
                  <option value="3">Alta</option><option value="4">Urgente</option>
                </select></div>
              <div class="col-md-3 mb-2"><label class="form-label small">Prazo</label>
                <input class="form-control" type="datetime-local" id="e-due"></div>
            </div>
            <div class="mb-2"><label class="form-label small">Ativo (inventário)</label>
              <select class="form-select" id="e-asset"><option value="">— sem ativo —</option></select>
              <div class="form-text">Equipamento vinculado a esta OS (filtrado pela entidade)</div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
            <button class="btn btn-primary" id="btn-save-edit">Salvar</button>
          </div>
        </div></div></div>`;
    }

    function assignModal() {
      return `<div class="modal fade" id="modal-assign" tabindex="-1">
        <div class="modal-dialog"><div class="modal-content">
          <div class="modal-header"><h6>Atribuir técnico · ${esc(t.number)}</h6>
            <button class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <select class="form-select" id="a-tech"><option value="">— Nenhum (desatribuir) —</option></select>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
            <button class="btn btn-primary" id="btn-save-assign">Salvar</button>
          </div>
        </div></div></div>`;
    }

    function wireModals() {
      const hideModal = (id) => { const el0 = document.getElementById(id); if (el0) bootstrap.Modal.getInstance(el0)?.hide(); };

      // status
      el.querySelector('#btn-save-status')?.addEventListener('click', async () => {
        try {
          await API.post(`/tickets/${t.id}/status`, {
            status: parseInt(el.querySelector('#s-status').value, 10),
            comment: el.querySelector('#s-comment').value.trim(),
          });
          hideModal('modal-status');
          toast('Status atualizado.', 'success'); afterReload();
        } catch (e) {
          if (e.data?.request_approval) {
            hideModal('modal-status');
            const mEl = document.getElementById('modal-approval');
            if (mEl) new bootstrap.Modal(mEl).show();
            toast('Para resolver, solicite a aprovação do cliente.', 'warning');
          } else showError(e);
        }
      });

      el.querySelector('#btn-send-approval')?.addEventListener('click', async () => {
        const comment = el.querySelector('#ap-comment').value.trim();
        if (!comment) { toast('Descreva a solução.', 'warning'); return; }
        try {
          await API.post(`/tickets/${t.id}/approval`, { comment });
          hideModal('modal-approval');
          toast('Solicitação de aprovação enviada.', 'success'); afterReload();
        } catch (e) { showError(e); }
      });

      el.querySelector('#btn-save-assign')?.addEventListener('click', async () => {
        const techId = el.querySelector('#a-tech').value;
        try {
          await API.post(`/tickets/${t.id}/assign`, { user_id: techId || null });
          hideModal('modal-assign');
          toast('Atribuição atualizada.', 'success'); afterReload();
        } catch (e) { showError(e); }
      });

      el.querySelector('#btn-save-edit')?.addEventListener('click', async () => {
        const due = el.querySelector('#e-due').value;
        const assetVal = el.querySelector('#e-asset')?.value;
        try {
          await API.patch(`/tickets/${t.id}`, {
            title: el.querySelector('#e-title').value.trim(),
            description: el.querySelector('#e-desc').value.trim(),
            category_id: parseInt(el.querySelector('#e-cat').value, 10) || null,
            priority: parseInt(el.querySelector('#e-prio').value, 10),
            due_at: due ? new Date(due).toISOString() : null,
            asset_id: assetVal ? parseInt(assetVal,10) : null,
          });
          hideModal('modal-edit');
          toast('Chamado atualizado.', 'success'); afterReload();
        } catch (e) { showError(e); }
      });

      // cargas de modais
      const editCat = el.querySelector('#e-cat');
      if (editCat) {
        API.get('/categories').then((cats) => {
          editCat.innerHTML = `<option value="">— sem categoria —</option>` +
            cats.filter((c) => c.active).map((c) => `<option value="${c.id}" ${c.id === t.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
        }).catch(() => {});
      }
      const ePrio = el.querySelector('#e-prio');
      if (ePrio) ePrio.value = String(t.priority || 2);
      const eDue = el.querySelector('#e-due');
      if (eDue && t.due_at) eDue.value = new Date(t.due_at).toISOString().slice(0, 16);
      const eAsset = el.querySelector('#e-asset');
      if (eAsset) {
        API.get('/inventory/assets?entity_id=' + t.entity_id).then((assets) => {
          eAsset.innerHTML = `<option value="">— sem ativo —</option>` +
            assets.map((a) => `<option value="${a.id}" ${String(a.id)===String(t.asset_id)?'selected':''}>${esc(a.name)} ${a.asset_tag?`(${esc(a.asset_tag)})`:''}</option>`).join('');
        }).catch(() => {});
      }

      const aTech = el.querySelector('#a-tech');
      if (aTech) {
        API.get('/users?role=technician&active=true').then((users) => {
          aTech.innerHTML = `<option value="">— Nenhum (desatribuir) —</option>` +
            users.map((u) => `<option value="${u.id}" ${u.id === t.assigned_user_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
        }).catch(() => {});
      }
    }
  };
};