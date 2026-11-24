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

    const isRequester = String(t.requester_id) === String(user.id);
    // O que este usuario pode fazer neste chamado (calculado no servidor
    // a partir das permissoes do perfil)
    const can = t.can || {};
    const triage = !!can.triage;
    // "Instrucao de gestor": quem tem a permissao e nao faz parte da equipe
    const isManager = !!can.manager_note && !can.internal_notes && !Roles.isMaster(user);
    const canClientApprove = t.approval_status === 'pending' && !!can.approve;
    const support = !!can.estimate; // pode alterar previsao/prazo
    const canEdit = !!can.edit;
    // Chamado do WhatsApp ainda na empresa padrao: o tecnico que vai resolver
    // tambem precisa atribuir empresa (obrigatorio antes de resolver).
    const empresaWaPadrao = !!t.via_whatsapp
      && String(t.entity_name || '').trim() === 'WhatsApp - não identificado';
    const podeAtribuirEmpresa = triage || (empresaWaPadrao && !!can.resolve);

    // ---------------- Barra de acoes ----------------
    // Só as ações principais. Empresa, técnico, situação e moderador ficam no card "Responsáveis",
    // cada um com a sua ação ao lado (Trocar, Assumir, Alterar).
    const actions = [];
    if (can.resolve && ![5, 6, 7].includes(t.status)) {
      actions.push(`<button class="btn btn-success btn-sm" id="act-resolve"><i class="bi bi-check2-circle"></i> Resolver chamado</button>`);
    }
    if (canEdit) {
      actions.push(`<button class="btn btn-outline-secondary btn-sm" data-bs-toggle="modal" data-bs-target="#modal-edit"><i class="bi bi-pencil"></i> ${triage ? 'Triagem / editar' : 'Editar'}</button>`);
    }
    if (can.cancel && !can.status && [1, 2, 3, 4].includes(t.status)) {
      actions.push(`<button class="btn btn-outline-danger btn-sm" id="act-cancel"><i class="bi bi-slash-circle"></i> Cancelar chamado</button>`);
    }
    if (can.cancel && !can.status && [5, 6].includes(t.status)) {
      actions.push(`<button class="btn btn-outline-primary btn-sm" id="act-reopen"><i class="bi bi-arrow-counterclockwise"></i> Reabrir</button>`);
    }
    if (isManager) {
      actions.push(`<button class="btn btn-outline-warning btn-sm" id="act-note-focus"><i class="bi bi-chat-square-quote"></i> Instrução</button>`);
    }
    const actionBar = actions.length
      ? `<div class="d-flex flex-wrap gap-2 mb-3">${actions.join('')}</div>` : '';

    // ---------------- Responsáveis (empresa, técnico, situação, moderador) ----------------
    const comigo = String(t.assigned_user_id || '') === String(user.id) && ![5, 6, 7].includes(t.status);
    const tecAcoes = [];
    if (comigo && window.Atendimento && Atendimento.pode(user)) {
      tecAcoes.push(String(Atendimento.atualId || '') === String(t.id)
        ? `<button class="btn btn-sm btn-atendendo" id="act-parar" title="Você está atendendo este chamado. Clique para pausar."><i class="dp-pulso"></i> Atendendo · pausar</button>`
        : `<button class="btn btn-sm btn-outline-success" id="act-atender" title="Marca este como o chamado que você está atendendo agora"><i class="bi bi-play-fill"></i> Atender agora</button>`);
    }
    if (can.take) tecAcoes.push(`<button class="btn btn-sm btn-success" id="act-take" title="Fica com você"><i class="bi bi-person-check"></i> Assumir</button>`);
    if (can.assign) tecAcoes.push(`<button class="btn btn-sm btn-outline-secondary" id="act-assign"><i class="bi bi-person-gear"></i> ${t.assigned_user_id ? 'Trocar' : 'Escolher'}</button>`);
    const respItem = (icone, rotulo, valor, acoes = '', extra = '') => `
      <div class="resp-item ${extra}">
        <i class="bi ${icone} resp-ico"></i>
        <div class="resp-tx"><span class="resp-rot">${rotulo}</span><span class="resp-val">${valor}</span></div>
        ${acoes ? `<div class="resp-acoes">${acoes}</div>` : ''}
      </div>`;
    const respCard = `
      <div class="card panel-card mb-3 resp-card">
        <div class="card-header"><i class="bi bi-people me-1"></i> Responsáveis</div>
        <div class="resp-lista">
          ${respItem('bi-building', 'Empresa',
            empresaWaPadrao ? '<span class="text-warning-emphasis fw-semibold"><i class="bi bi-exclamation-triangle"></i> Não atribuída</span>' : esc(t.entity_name || '—'),
            podeAtribuirEmpresa ? `<button class="btn btn-sm ${empresaWaPadrao ? 'btn-warning' : 'btn-outline-secondary'}" data-bs-toggle="modal" data-bs-target="#modal-entity" title="Atribuir este chamado a uma empresa${empresaWaPadrao ? ' (obrigatório antes de resolver)' : ''}"><i class="bi bi-building-add"></i> ${empresaWaPadrao ? 'Atribuir' : 'Trocar'}</button>` : '',
            empresaWaPadrao ? 'resp-alerta' : 'multi-empresa')}
          ${respItem('bi-person-badge', 'Técnico',
            t.assigned_name ? `${esc(t.assigned_name)}${comigo ? ' <span class="tg tg-teal">você</span>' : ''}${t.assigned_at ? `<small>desde ${esc(fmt.timeAgo(t.assigned_at))}</small>` : ''}` : '<span class="tg tg-amber">Não atribuído</span>',
            tecAcoes.join(''), t.assigned_name ? '' : 'resp-alerta')}
          ${respItem('bi-flag', 'Situação', badgeStatus(t.status),
            can.status ? '<button class="btn btn-sm btn-outline-secondary" data-bs-toggle="modal" data-bs-target="#modal-status"><i class="bi bi-arrow-repeat"></i> Alterar</button>' : '')}
          ${respItem('bi-shield-check', 'Moderador', t.moderator_name ? esc(t.moderator_name) : '<span class="text-muted">—</span>')}
        </div>
      </div>`;

    // ---------------- Aprovacao pendente (box para o cliente) ----------------
    const approvalBox = canClientApprove ? `
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
            <div class="tl-content text-muted">${Mencoes.formatar(esc(m.content))}</div>
            <small class="text-muted">${m.author_name} · ${fmt.dateTime(m.created_at)}</small>
          </div>
        </li>`;
      }
      const icon = m.kind === 'note' ? 'bi-chat-square-quote' : m.kind === 'approval'
        ? 'bi-check2-square' : m.kind === 'internal' ? 'bi-lock' : 'bi-chat-dots';
      const tone = m.kind === 'note' ? 'tl-warning' : m.kind === 'approval' ? 'tl-primary'
        : m.kind === 'internal' ? 'tl-secondary' : 'tl-info';
      const badgeCls = { 'tl-warning': 'text-bg-warning', 'tl-primary': 'text-bg-primary', 'tl-info': 'text-bg-info' }[tone] || 'text-bg-secondary';
      const kindLabel = { note: 'Instrução', approval: 'Aprovação', internal: 'Nota interna (só equipe)' }[m.kind] || 'Mensagem';
      return `<li class="timeline-item ${m.kind === 'internal' ? 'tl-internal' : ''}">
        <div class="tl-badge ${tone}"><i class="bi ${icon}"></i></div>
        <div class="tl-body">
          <div class="tl-head">
            <strong>${esc(m.author_name)}</strong>
            <span class="badge ${badgeCls} ms-1">${kindLabel}</span>
            <span class="text-muted small ms-auto">${fmt.dateTime(m.created_at)}</span>
          </div>
          <div class="tl-content">${Mencoes.formatar(esc(m.content)).replace(/\n/g, '<br>')}</div>
        </div>
      </li>`;
    }).join('');

    el.innerHTML = `
      <div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3">
        <div>
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <h4 class="mb-0 text-primary">${esc(t.number)}</h4>
            ${badgeStatus(t.status)}
            ${badgeImpact(t)}
            ${t.approval_status !== 'none' ? `<span class="badge bd-approval-${t.approval_status}">${LABELS.approval[t.approval_status]}</span>` : ''}
          </div>
          <h5 class="mt-1 mb-0">${esc(t.title)}</h5>
          <small class="text-muted"><span class="multi-empresa">${esc(t.entity_name || '')} · </span>${t.location_name ? esc(t.location_name) + ' · ' : ''}${esc(t.display_category || '')}</small>
          ${empresaWaPadrao ? `<div class="mt-1"><span class="badge text-bg-warning"><i class="bi bi-exclamation-triangle me-1"></i>Empresa não atribuída — obrigatório antes de resolver</span></div>` : ''}
        </div>
        <div class="d-flex gap-2">
          <a class="btn btn-sm btn-outline-secondary" href="#/tickets"><i class="bi bi-arrow-left"></i> Voltar</a>
        </div>
      </div>

      ${actionBar}
      ${approvalBox}

      <div class="row g-3">
        <div class="col-lg-8">
          <div class="card panel-card mb-3">
            <div class="card-header"><i class="bi bi-card-text me-1"></i> Descrição</div>
            <div class="card-body">
              <p class="mb-0 ticket-desc">${Mencoes.formatar(esc(t.description)).replace(/\n/g, '<br>')}</p>
            </div>
          </div>
          ${(t.materials || []).length ? `
          <div class="card panel-card mb-3">
            <div class="card-header"><i class="bi bi-box-seam me-1"></i> Materiais pedidos</div>
            <div class="table-responsive"><table class="table table-sm align-middle mb-0">
              <thead><tr><th>Material</th><th class="text-end">Quantidade</th></tr></thead>
              <tbody>${t.materials.map((m) => `<tr><td>${esc(m.name)}</td>
                <td class="text-end"><span class="tg tg-teal">${m.quantity} ${esc(m.unit || 'un')}</span></td></tr>`).join('')}</tbody>
            </table></div>
          </div>` : ''}

          <div class="card panel-card mb-3">
            <div class="card-header d-flex flex-wrap gap-2 justify-content-between align-items-center">
              <span class="text-nowrap"><i class="bi bi-paperclip me-1"></i> Anexos <span class="badge text-bg-secondary">${(t.attachments||[]).length}</span></span>
              <span class="d-flex gap-2">
                <button class="btn btn-sm btn-outline-primary btn-anexo" id="td-add-att"><i class="bi bi-paperclip me-1"></i>Anexar arquivo</button>
                <button class="btn btn-sm btn-outline-primary btn-anexo" id="td-add-photo"><i class="bi bi-camera me-1"></i>Tirar foto</button>
              </span>
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
            <input type="file" id="td-att-input" multiple hidden accept="${ANEXO_ACCEPT}">
            <input type="file" id="td-photo-input" accept="image/*" capture="environment" hidden>
          </div>

          <div class="card panel-card">
            <div class="card-header"><i class="bi bi-chat-dots me-1"></i> Conversa</div>
            <div class="card-body">
              <ul class="timeline mb-0">${timeline}</ul>
              <div class="d-flex gap-2 mt-3">
                <input class="form-control" id="msg-content" placeholder="${isManager ? 'Escreva uma instrução para a equipe...' : 'Escreva uma mensagem... (@ cita uma pessoa, # cita um chamado)'}" maxlength="2000" autocomplete="off">
                <button class="btn btn-primary ${isManager ? 'btn-warning text-dark' : ''}" id="btn-send-msg">
                  <i class="bi bi-send"></i> ${isManager ? 'Instrução' : 'Enviar'}
                </button>
              </div>
              ${can.internal_notes ? `
              <div class="form-check mt-2">
                <input class="form-check-input" type="checkbox" id="msg-internal">
                <label class="form-check-label small" for="msg-internal"><i class="bi bi-lock me-1"></i>Nota interna (só a equipe vê; o cliente não vê)</label>
              </div>` : ''}
            </div>
          </div>
        </div>

        <div class="col-lg-4">
          ${respCard}
          <div class="card panel-card mb-3">
            <div class="card-header"><i class="bi bi-info-circle me-1"></i> Informações</div>
            <div class="card-body p-0">
              <table class="table table-sm mb-0 info-table">
                <tbody>
                  <tr><th>Solicitante</th><td>${esc(t.requester_name || '—')}<br><small class="text-muted">${esc(t.requester_email || '')}</small>
                    ${t.requester_rating_summary && t.requester_rating_summary.count ? `<br><small title="Média das notas dadas pela equipe">${starsHtml(t.requester_rating_summary.avg)} ${String(t.requester_rating_summary.avg).replace('.', ',')} em ${t.requester_rating_summary.count} chamado(s)</small>` : ''}</td></tr>
                  <tr><th>Localização</th><td>${t.location_name ? esc(t.location_name) + (t.location_code ? ` <small class="text-muted">(${esc(t.location_code)})</small>` : '') : '<span class="text-muted">—</span>'}</td></tr>
                  <tr><th>Categoria</th><td>${esc(t.display_category || '—')}${triage && t.simple_category_name ? `<br><small class="text-muted">Na lista simples: ${esc(t.simple_category_icon || '')} ${esc(t.simple_category_name)}</small>` : ''}</td></tr>
                  <tr><th>Urgência</th><td>${esc(t.impact_name || LABELS.priority[t.priority] || '—')}</td></tr>
                  <tr><th>Precisa até</th><td>${t.needed_by ? fmt.date(String(t.needed_by).slice(0, 10) + 'T12:00:00') : '<span class="text-muted">não informado</span>'}</td></tr>
                  <tr><th>Previsão</th><td>${t.estimated_at ? `<b>${fmt.dateTime(t.estimated_at)}</b>` : '<span class="text-muted">ainda não definida</span>'}</td></tr>
                  ${t.due_at ? `<tr><th>Prazo (SLA)</th><td>${fmt.dateTime(t.due_at)}</td></tr>` : ''}
                  <tr><th>Equipamento</th><td>${t.asset_id ? `<a href="#/inventory/${t.asset_id}">${esc(t.asset_name || 'Ativo')} ${t.asset_tag ? `(${esc(t.asset_tag)})` : ''}</a>` : '<span class="text-muted">—</span>'}</td></tr>
                  <tr><th>Abertura</th><td>${fmt.dateTime(t.created_at)}</td></tr>
                  <tr><th>Tempo decorrido</th><td>${fmtDuration(t.created_at, t.closed_at || t.resolved_at)}</td></tr>
                  <tr><th>Atribuído em</th><td>${t.assigned_at ? fmt.dateTime(t.assigned_at) : '—'}</td></tr>
                  ${t.assigned_at ? `<tr><th>Desde a atribuição</th><td>${fmtDuration(t.assigned_at, t.resolved_at || t.closed_at)}</td></tr>` : ''}
                  ${t.resolved_at ? `<tr><th>Resolvido em</th><td>${fmt.dateTime(t.resolved_at)}</td></tr>` : ''}
                  ${t.closed_at ? `<tr><th>Fechado em</th><td>${fmt.dateTime(t.closed_at)}</td></tr>` : ''}
                  <tr><th>Aprovação</th><td>${esc(LABELS.approval[t.approval_status] || '—')}</td></tr>
                  ${t.resolution_notes ? `<tr class="table-success"><th>O que foi feito</th><td>${esc(t.resolution_notes).replace(/\n/g, '<br>')}${t.resolved_by_name ? `<br><small class="text-muted">por ${esc(t.resolved_by_name)}</small>` : ''}</td></tr>` : ''}
                  ${t.equipment_action_label ? `<tr><th>Com o equipamento</th><td>${esc(t.equipment_action_label)}</td></tr>` : ''}
                  ${t.resolution_cause_name ? `<tr><th>Causa <i class="bi bi-lock" title="Só a equipe vê"></i></th><td>${esc(t.resolution_cause_name)}</td></tr>` : ''}
                  ${t.requester_rating !== undefined && t.requester_rating !== null ? `<tr><th>Nota do usuário <i class="bi bi-lock" title="Só a equipe vê"></i></th><td>${starsHtml(t.requester_rating)} ${t.requester_rating}/5${t.requester_rating_comment ? `<br><small class="text-muted">${esc(t.requester_rating_comment)}</small>` : ''}</td></tr>` : ''}
                </tbody>
              </table>
            </div>
          </div>

          <div class="card panel-card mb-3">
            <div class="card-header"><i class="bi bi-list-check me-1"></i> Histórico</div>
            <ul class="list-group list-group-flush small" style="max-height:360px;overflow:auto">
              ${(t.history || []).slice().reverse().map((h) => `
                <li class="list-group-item">
                  <div><b>${esc(LABELS.history[h.action] || h.action)}</b>${
                    h.action === 'description' || h.action === 'solution' ? ''
                    : (h.old_value || h.new_value) ? `: ${h.old_value ? `<span class="text-muted text-decoration-line-through">${esc(fmtHistValue(h.action, h.old_value))}</span> → ` : ''}${esc(fmtHistValue(h.action, h.new_value) || '—')}` : ''}</div>
                  <small class="text-muted">${esc(h.user_name || 'Sistema')} · ${fmt.dateTime(h.created_at)}</small>
                </li>`).join('') || '<li class="list-group-item text-muted">Sem registros.</li>'}
            </ul>
          </div>

          ${t.approval_status === 'pending' && !canClientApprove ? `
          <div class="alert alert-secondary small"><i class="bi bi-hourglass-split me-1"></i>
            Solução proposta aguardando aprovação do cliente.</div>` : ''}
        </div>
      </div>

      ${modals()}`;

    wireActions();
    wireModals();

    // links antigos (?resolve=1 / ?assign=1): abre a janela certa
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    if ((q.get('resolve') || q.get('assign')) && !opts.silent) {
      history.replaceState(null, '', `#/tickets/${t.id}`);
      if (q.get('resolve') && can.resolve) TicketModals.resolve(t, { onDone: () => afterReload() });
      else if (q.get('assign') && can.assign) TicketModals.assign(t, { onDone: () => afterReload() });
    }
    el.querySelector('#act-resolve')?.addEventListener('click', () => TicketModals.resolve(t, { onDone: () => afterReload() }));
    el.querySelector('#act-assign')?.addEventListener('click', () => TicketModals.assign(t, { onDone: () => afterReload() }));

    // ---------------- acoes ----------------
    function afterReload() { renderDetail(el, { silent: true }); }

    function wireActions() {
      const attInput = el.querySelector('#td-att-input');
      const photoInput = el.querySelector('#td-photo-input');
      el.querySelector('#td-add-att')?.addEventListener('click', () => attInput?.click());
      el.querySelector('#td-add-photo')?.addEventListener('click', () => photoInput?.click());
      const enviarAnexos = async (input) => {
        const files = filtrarAnexos(input.files);
        input.value = '';
        if (!files.length) return;
        const grandes = files.filter((f) => f.size > 15 * 1024 * 1024);
        if (grandes.length) { toast(`${grandes[0].name}: maior que 15 MB`, 'warning'); return; }
        const fd = new FormData();
        files.forEach(f => fd.append('files', f));
        try {
          await API.post(`/tickets/${t.id}/attachments`, fd, true);
          toast(files.length === 1 ? 'Anexo enviado.' : `${files.length} anexos enviados.`, 'success');
          afterReload();
        } catch (e) { showError(e); }
      };
      attInput?.addEventListener('change', () => enviarAnexos(attInput));
      photoInput?.addEventListener('change', () => enviarAnexos(photoInput));
      el.querySelectorAll('.td-del-att').forEach((b) => b.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Remover anexo', body: 'Excluir este anexo do chamado?', confirmText: 'Remover', danger: true });
        if (!ok) return;
        try { await API.del(`/tickets/${t.id}/attachments/${b.dataset.att}`); toast('Anexo removido.', 'warning'); afterReload(); }
        catch (e) { showError(e); }
      }));

      el.querySelector('#act-atender')?.addEventListener('click', async () => {
        try { await Atendimento.atender(t.id); toast('Agora você está atendendo este chamado.', 'success'); afterReload(); }
        catch (e) { showError(e); }
      });
      el.querySelector('#act-parar')?.addEventListener('click', async () => {
        try { await Atendimento.parar(); toast('Atendimento pausado.', 'info'); afterReload(); }
        catch (e) { showError(e); }
      });

      el.querySelector('#act-take')?.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Assumir chamado', body: `Deseja assumir o chamado ${t.number}?`, confirmText: 'Assumir' });
        if (!ok) return;
        try { await API.post(`/tickets/${t.id}/assign`, { assumir: true }); toast('Agora o chamado está com você.', 'success'); afterReload(); }
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
      const citacoes = Mencoes.ligar(content, t.id);
      const sendMsg = async () => {
        const text = citacoes.preparar(content.value.trim());
        if (!text) return;
        const internal = el.querySelector('#msg-internal')?.checked;
        const kind = internal ? 'internal' : isManager ? 'note' : 'comment';
        try {
          await API.post(`/tickets/${t.id}/messages`, { content: text, kind });
          content.value = '';
          citacoes.limpar();
          toast(kind === 'internal' ? 'Nota interna registrada.' : isManager ? 'Instrução registrada e notificada.' : 'Mensagem enviada.', 'success');
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
        ${editModal()}
        ${podeAtribuirEmpresa ? entityModal() : ''}
`;
    }

    function entityModal() {
      return `<div class="modal fade" id="modal-entity" tabindex="-1">
        <div class="modal-dialog"><div class="modal-content">
          <div class="modal-header"><h6>Atribuir empresa · ${esc(t.number)}</h6>
            <button class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <label class="form-label small">Empresa existente${empresaWaPadrao ? ' <span class="text-danger">*</span> <span class="text-muted">(obrigatória antes de resolver)</span>' : ''}</label>
            <select class="form-select" id="ent-select"><option value="">Carregando...</option></select>
            <div class="form-text">O chamado passa a pertencer à empresa escolhida. Localização e equipamento
              só permanecem quando também pertencerem a ela.</div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
            <button class="btn btn-primary" id="btn-save-entity">Atribuir</button>
          </div>
        </div></div></div>`;
    }

    function statusModal() {
      return `<div class="modal fade" id="modal-status" tabindex="-1">
        <div class="modal-dialog"><div class="modal-content">
          <div class="modal-header"><h6>Alterar status · ${esc(t.number)}</h6>
            <button class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <select class="form-select mb-2" id="s-status">
              ${[2, 3, 4, 6, 7].filter((s) => s !== t.status).map((s) =>
                `<option value="${s}">${LABELS.status[s]}</option>`).join('')}
            </select>
            <textarea class="form-control" id="s-comment" rows="3" placeholder="Comentário (opcional)..."></textarea>
            <div class="form-text">Para <b>Resolver</b> ou <b>Fechar</b>, o sistema abre o formulário de encerramento (a causa é obrigatória).</div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
            <button class="btn btn-primary" id="btn-save-status">Salvar</button>
          </div>
        </div></div></div>`;
    }

    function editModal() {
      const toLocalInput = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      };
      return `<div class="modal fade" id="modal-edit" tabindex="-1">
        <div class="modal-dialog modal-lg"><div class="modal-content">
          <div class="modal-header"><h6>${triage ? 'Triagem / editar' : 'Editar'} · ${esc(t.number)}</h6>
            <button class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <div class="mb-2"><label class="form-label small">Título</label>
              <input class="form-control" id="e-title" value="${esc(t.title)}"></div>
            <div class="mb-2"><label class="form-label small">Descrição</label>
              <textarea class="form-control" id="e-desc" rows="4">${esc(t.description)}</textarea></div>
            <div class="row">
              <div class="col-md-6 mb-2"><label class="form-label small">Categoria</label>
                <select class="form-select" id="e-cat"><option value="">Carregando...</option></select>
                ${triage && t.simple_category_name ? `<div class="form-text">Na lista simples: "${esc(t.simple_category_name)}". Aqui você pode detalhar (ex.: Rede › Problemas de conexão › DNS).</div>` : ''}</div>
              <div class="col-md-6 mb-2"><label class="form-label small">Urgência</label>
                <select class="form-select" id="e-impact"><option value="">Carregando...</option></select></div>
            </div>
            <div class="row">
              <div class="col-md-6 mb-2"><label class="form-label small">Localização</label>
                <select class="form-select" id="e-location"><option value="">Carregando...</option></select></div>
              <div class="col-md-6 mb-2"><label class="form-label small">Precisa até (data de necessidade)</label>
                <input class="form-control" type="date" id="e-needed" value="${t.needed_by ? String(t.needed_by).slice(0, 10) : ''}"></div>
            </div>
            ${support ? `
            <div class="row">
              <div class="col-md-6 mb-2"><label class="form-label small">Previsão de atendimento</label>
                <input class="form-control" type="datetime-local" id="e-estimated" value="${toLocalInput(t.estimated_at)}">
                <div class="form-text">O solicitante é avisado.</div></div>
              <div class="col-md-6 mb-2"><label class="form-label small">Prazo (SLA)</label>
                <input class="form-control" type="datetime-local" id="e-due" value="${toLocalInput(t.due_at)}"></div>
            </div>` : ''}
            <div class="mb-2"><label class="form-label small">Equipamento (inventário)</label>
              <select class="form-select" id="e-asset"><option value="">— sem equipamento —</option></select>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
            <button class="btn btn-primary" id="btn-save-edit">Salvar</button>
          </div>
        </div></div></div>`;
    }

    function wireModals() {
      const hideModal = (id) => { const el0 = document.getElementById(id); if (el0) bootstrap.Modal.getInstance(el0)?.hide(); };

      // status
      el.querySelector('#btn-save-status')?.addEventListener('click', async () => {
        const novo = parseInt(el.querySelector('#s-status').value, 10);
        // Fechar sem ter resolvido antes: passa pelo formulário de encerramento
        if (novo === 6 && t.status !== 5) {
          hideModal('modal-status');
          TicketModals.resolve(t, { toStatus: 6, onDone: () => afterReload() });
          return;
        }
        try {
          await API.post(`/tickets/${t.id}/status`, {
            status: novo,
            comment: el.querySelector('#s-comment').value.trim(),
          });
          hideModal('modal-status');
          toast('Status atualizado.', 'success'); afterReload();
        } catch (e) {
          if (e.data?.resolution_form || e.data?.request_approval) {
            hideModal('modal-status');
            TicketModals.resolve(t, { toStatus: novo, onDone: () => afterReload() });
            return;
          }
          showError(e);
        }
      });

      // empresa (triagem, ou tecnico que vai resolver chamado do WhatsApp sem empresa)
      const entSel = el.querySelector('#ent-select');
      if (entSel) {
        API.get('/entities').then((ents) => {
          const ativas = ents.filter((e) => e.active !== false
            && !(empresaWaPadrao && String(e.name || '').trim() === 'WhatsApp - não identificado'));
          entSel.innerHTML = ativas.map((e) =>
            `<option value="${e.id}" ${String(e.id) === String(t.entity_id) ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
        }).catch(() => { entSel.innerHTML = '<option value="">Erro ao carregar as empresas</option>'; });
      }
      el.querySelector('#btn-save-entity')?.addEventListener('click', async () => {
        const novo = entSel?.value ? parseInt(entSel.value, 10) : null;
        if (!novo) return;
        if (String(novo) === String(t.entity_id)) {
          hideModal('modal-entity');
          toast('O chamado já está nesta empresa.', 'info');
          return;
        }
        try {
          await API.patch(`/tickets/${t.id}`, { entity_id: novo });
          hideModal('modal-entity');
          toast('Empresa do chamado atualizada.', 'success'); afterReload();
        } catch (e) {
          showError(e);
        }
      });

      let editSimpleMode = false;
      el.querySelector('#btn-save-edit')?.addEventListener('click', async () => {
        const body = {
          title: el.querySelector('#e-title').value.trim(),
          description: el.querySelector('#e-desc').value.trim(),
          needed_by: el.querySelector('#e-needed').value || null,
        };
        const catVal = el.querySelector('#e-cat').value;
        if (catVal) body[editSimpleMode ? 'simple_category_id' : 'category_id'] = parseInt(catVal, 10);
        const imp = el.querySelector('#e-impact').value;
        if (imp) body.impact_id = parseInt(imp, 10);
        const locSel = el.querySelector('#e-location');
        if (!locSel.disabled) body.location_id = locSel.value ? parseInt(locSel.value, 10) : null;
        const est = el.querySelector('#e-estimated');
        if (est) body.estimated_at = est.value ? new Date(est.value).toISOString() : null;
        const due = el.querySelector('#e-due');
        if (due) body.due_at = due.value ? new Date(due.value).toISOString() : null;
        const assetVal = el.querySelector('#e-asset')?.value;
        body.asset_id = assetVal ? parseInt(assetVal, 10) : null;
        try {
          await API.patch(`/tickets/${t.id}`, body);
          hideModal('modal-edit');
          toast('Chamado atualizado.', 'success'); afterReload();
        } catch (e) {
          if (e.status === 422 && /Nenhuma alteração/.test(e.message)) { hideModal('modal-edit'); return; }
          showError(e);
        }
      });

      // cargas de modais
      const editCat = el.querySelector('#e-cat');
      if (editCat) {
        API.get('/categories/for-entity/' + t.entity_id).then((data) => {
          editSimpleMode = data.mode === 'simple';
          if (editSimpleMode) {
            editCat.innerHTML = data.categories.map((c) =>
              `<option value="${c.id}" ${String(c.id) === String(t.display_simple_id) ? 'selected' : ''}>${esc(c.icon || '')} ${esc(c.name)}</option>`).join('');
          } else {
            editCat.innerHTML = categoryOptions(data.categories);
            editCat.value = String(t.category_id || '');
          }
        }).catch(() => {});
      }
      const eImpact = el.querySelector('#e-impact');
      if (eImpact) {
        API.get(`/impact-levels?entity_id=${encodeURIComponent(t.entity_id || '')}`).then((levels) => {
          eImpact.innerHTML = levels.map((l) => `<option value="${l.id}" ${String(l.id) === String(t.impact_id) ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
        }).catch(() => {});
      }
      const eLoc = el.querySelector('#e-location');
      if (eLoc) {
        API.get(`/locations?entity_id=${t.entity_id}&active=true`).then((locs) => {
          if (!locs.length) { eLoc.innerHTML = '<option value="">Nenhuma localização cadastrada</option>'; eLoc.disabled = true; return; }
          eLoc.innerHTML = '<option value="">— nenhuma —</option>' + locs.map((l) =>
            `<option value="${l.id}" ${String(l.id) === String(t.location_id) ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
        }).catch(() => {});
      }
      const eAsset = el.querySelector('#e-asset');
      if (eAsset) {
        API.get('/inventory/assets?entity_id=' + t.entity_id).then((assets) => {
          eAsset.innerHTML = `<option value="">— sem equipamento —</option>` +
            assets.map((a) => `<option value="${a.id}" ${String(a.id) === String(t.asset_id) ? 'selected' : ''}>${esc(a.name)} ${a.asset_tag ? `(${esc(a.asset_tag)})` : ''}</option>`).join('');
        }).catch(() => {});
      }

    }
  };
};
