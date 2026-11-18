// ---------------------------------------------------------------
// Views.newTicket — Abertura de novo chamado
// ---------------------------------------------------------------

function categoryOptions(cats) {
  const byParent = {};
  cats.forEach((c) => { (byParent[c.parent_id || 0] = byParent[c.parent_id || 0] || []).push(c); });
  let opts = '';
  const walk = (parent, prefix) => {
    (byParent[parent] || []).forEach((c) => {
      opts += `<option value="${c.id}">${prefix}${esc(c.name)}</option>`;
      walk(c.id, prefix + '— ');
    });
  };
  walk(0, '');
  return opts;
}

Views.newTicket = async function newTicket(el) {
  const user = API.user || {};
  const isClient = user.role === 'client';

  el.innerHTML = `
    <div class="row justify-content-center">
      <div class="col-lg-9">
        <div class="card panel-card">
          <div class="card-header"><i class="bi bi-plus-circle me-1"></i> Abrir novo chamado</div>
          <div class="card-body">
            <form id="new-ticket-form">
              <div class="mb-3">
                <label class="form-label">Título <span class="text-danger">*</span></label>
                <input class="form-control" id="nt-title" maxlength="200" required
                       placeholder="Resumo curto do problema ou solicitação">
              </div>
              <div class="mb-3">
                <label class="form-label">Descrição <span class="text-danger">*</span></label>
                <div class="form-text mt-0 mb-1">Prezado, informe abaixo seu NOME, Telefone de contato e a descrição da solicitação.</div>
                <textarea class="form-control" id="nt-desc" rows="6" required
                          placeholder="Nome:&#10;Telefone:&#10;Descrição:"></textarea>
              </div>
              <div class="mb-3">
                <label class="form-label">Anexos</label>
                <div class="d-flex flex-wrap gap-2">
                  <button type="button" class="btn btn-outline-secondary btn-sm" id="nt-pick-files">
                    <i class="bi bi-paperclip me-1"></i> Escolher arquivos
                  </button>
                  <button type="button" class="btn btn-outline-secondary btn-sm" id="nt-pick-photo">
                    <i class="bi bi-camera me-1"></i> Tirar / anexar foto
                  </button>
                </div>
                <input type="file" id="nt-files" multiple hidden
                       accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,video/mp4,audio/mpeg">
                <input type="file" id="nt-photo" accept="image/*" capture="environment" hidden>
                <div class="form-text">Até 10 arquivos, 15MB cada. No celular use "Foto" para câmera direta.</div>
                <ul class="list-group list-group-flush mt-2" id="nt-file-list" style="display:none"></ul>
              </div>
              <div class="row">
                <div class="col-md-6 mb-3">
                  <label class="form-label">Categoria</label>
                  <select class="form-select" id="nt-cat"></select>
                </div>
                <div class="col-md-3 mb-3">
                  <label class="form-label">Prioridade</label>
                  <select class="form-select" id="nt-prio">
                    <option value="1">Baixa</option>
                    <option value="2" selected>Média</option>
                    <option value="3">Alta</option>
                    <option value="4">Urgente</option>
                  </select>
                </div>
                <div class="col-md-3 mb-3">
                  <label class="form-label">Prazo desejado</label>
                  <input type="datetime-local" class="form-control" id="nt-due">
                </div>
              </div>
              ${isClient ? `
                <div class="alert alert-light border small mb-3">
                  <i class="bi bi-building me-1"></i> Entidade: <b>${esc(user.entity_name || '—')}</b>
                </div>` : `
                <div class="row">
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Entidade <span class="text-danger">*</span></label>
                    <select class="form-select" id="nt-entity"><option value="">Carregando...</option></select>
                  </div>
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Ativo (opcional)</label>
                    <select class="form-select" id="nt-asset"><option value="">— sem ativo —</option></select>
                    <div class="form-text">Vincular a um equipamento do inventário</div>
                  </div>
                </div>`}
              ${isClient ? `
                <div class="row">
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Ativo (opcional)</label>
                    <select class="form-select" id="nt-asset"><option value="">— sem ativo —</option></select>
                    <div class="form-text">Vincular a um equipamento do inventário</div>
                  </div>
                </div>` : ''}
              <button class="btn btn-primary btn-lg" id="btn-submit">
                <i class="bi bi-send me-1"></i> Abrir chamado
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>`;

  // dados auxiliares
  const hashParams = new URLSearchParams((location.hash.split('?')[1]||'').split('#')[0]);
  const preEntity = hashParams.get('entity_id');
  const preAsset = hashParams.get('asset_id');
  try {
    const cats = await API.get('/categories');
    document.getElementById('nt-cat').innerHTML =
      `<option value="">— sem categoria —</option>` + categoryOptions(cats.filter((c) => c.active));
  } catch {}
  // carrega ativos para o select
  const loadAssets = async (entityId) => {
    const sel = document.getElementById('nt-asset');
    if (!sel) return;
    if (!entityId) { sel.innerHTML = '<option value="">— sem ativo —</option>'; return; }
    try {
      const assets = await API.get('/inventory/assets?entity_id=' + entityId);
      sel.innerHTML = '<option value="">— sem ativo —</option>' + assets.map(a=>`<option value="${a.id}">${esc(a.name)} ${a.asset_tag?`(${esc(a.asset_tag)})`:''}</option>`).join('');
      if (preAsset) sel.value = String(preAsset);
    } catch { sel.innerHTML = '<option value="">— sem ativo —</option>'; }
  };
  if (!isClient) {
    try {
      const ents = await API.get('/entities');
      document.getElementById('nt-entity').innerHTML =
        ents.filter((e) => e.active).map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
      const entToUse = preEntity || String(user.entity_id||'');
      if (entToUse) document.getElementById('nt-entity').value = entToUse;
      const curEnt = document.getElementById('nt-entity').value;
      if (curEnt) await loadAssets(curEnt);
      document.getElementById('nt-entity').addEventListener('change', (e)=> loadAssets(e.target.value));
    } catch {}
  } else {
    if (user.entity_id) await loadAssets(user.entity_id);
  }
  if (preAsset && isClient) {
    // já carregado acima
  }

  // anexos
  const picked = [];
  const fileList = document.getElementById('nt-file-list');
  const renderFiles = () => {
    if (!picked.length) { fileList.style.display = 'none'; fileList.innerHTML = ''; return; }
    fileList.style.display = '';
    fileList.innerHTML = picked.map((f, i) => `
      <li class="list-group-item small d-flex justify-content-between align-items-center py-1">
        <span class="text-truncate" style="max-width:80%"><i class="bi bi-paperclip me-1"></i>${esc(f.name)}</span>
        <span class="d-flex align-items-center gap-2">
          <span class="text-muted">${(f.size/1024/1024).toFixed(1)} MB</span>
          <button type="button" class="btn btn-sm btn-link p-0 text-danger nt-rm-file" data-i="${i}"><i class="bi bi-x-lg"></i></button>
        </span>
      </li>`).join('');
    fileList.querySelectorAll('.nt-rm-file').forEach(b => b.addEventListener('click', () => {
      picked.splice(parseInt(b.dataset.i, 10), 1);
      renderFiles();
    }));
  };
  const addFiles = (fileListLike) => {
    for (const f of Array.from(fileListLike || [])) {
      if (f.size > 15 * 1024 * 1024) { toast(`${f.name}: maior que 15MB`, 'warning'); continue; }
      if (picked.length >= 10) { toast('Máximo de 10 anexos', 'warning'); break; }
      if (!picked.some(p => p.name === f.name && p.size === f.size)) picked.push(f);
    }
    renderFiles();
  };
  document.getElementById('nt-pick-files').onclick = () => document.getElementById('nt-files').click();
  document.getElementById('nt-pick-photo').onclick = () => document.getElementById('nt-photo').click();
  document.getElementById('nt-files').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  document.getElementById('nt-photo').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };

  document.getElementById('btn-submit').onclick = async () => {
    const title = document.getElementById('nt-title').value.trim();
    const desc = document.getElementById('nt-desc').value.trim();
    if (!title || !desc) { toast('Preencha título e descrição.', 'warning'); return; }
    const due = document.getElementById('nt-due').value;
    const payload = {
      title,
      description: desc,
      category_id: parseInt(document.getElementById('nt-cat').value, 10) || null,
      priority: parseInt(document.getElementById('nt-prio').value, 10),
      due_at: due ? new Date(due).toISOString() : null,
    };
    if (!isClient) {
      const entId = document.getElementById('nt-entity').value;
      if (!entId) { toast('Selecione a entidade.', 'warning'); return; }
      payload.entity_id = parseInt(entId, 10);
    }
    const assetSel = document.getElementById('nt-asset');
    if (assetSel && assetSel.value) payload.asset_id = parseInt(assetSel.value, 10);
    const btn = document.getElementById('btn-submit');
    btn.disabled = true;
    try {
      const t = await API.post('/tickets', payload);
      if (picked.length) {
        const fd = new FormData();
        picked.forEach(f => fd.append('files', f));
        try { await API.post(`/tickets/${t.id}/attachments`, fd, true); }
        catch (e2) { toast('Chamado aberto, mas falhou o anexo: ' + (e2.message || ''), 'warning'); }
      }
      toast(`Chamado ${t.number} aberto com sucesso.`, 'success');
      location.hash = `#/tickets/${t.id}`;
    } catch (e) {
      showError(e);
      btn.disabled = false;
    }
  };
};