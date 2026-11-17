// ---------------------------------------------------------------
// Views.newTicket — Abertura de novo chamado (formulario guiado)
//   Todos veem a lista de categorias simples (com icones); o chamado fica
//   gravado na propria categoria escolhida.
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
  const myEntities = [user.entity_id, ...(user.extra_entity_ids || [])].filter(Boolean).map(String);
  // a equipe escolhe a empresa; o gestor escolhe entre as empresas que acompanha
  const chooseEntity = Roles.isStaff(user) || myEntities.length > 1;

  const step = (n, title, hint, body) => `
    <div class="nt-step mb-4">
      <div class="d-flex align-items-baseline gap-2 mb-2">
        <span class="badge rounded-pill text-bg-primary">${n}</span>
        <h6 class="mb-0">${title}</h6>
      </div>
      ${hint ? `<div class="form-text mt-0 mb-2">${hint}</div>` : ''}
      ${body}
    </div>`;

  el.innerHTML = `
    <div class="row justify-content-center">
      <div class="col-lg-8">
        <div class="card panel-card nt-card">
          <div class="card-body">
            <form id="new-ticket-form" onsubmit="return false">
              <div class="nt-local mb-4">
                <div class="d-flex align-items-center gap-2">
                  <i class="bi bi-geo-alt-fill text-primary"></i>
                  <div class="flex-grow-1 small">
                    <div class="text-muted">Local do chamado</div>
                    <b id="nt-where">Carregando...</b>
                  </div>
                  <button type="button" class="btn btn-sm btn-outline-primary" id="nt-where-edit"><i class="bi bi-pencil"></i> Alterar</button>
                </div>
                <div class="row g-2 mt-1" id="nt-where-box" style="display:none">
                  ${chooseEntity ? `
                  <div class="col-md-6"><label class="form-label small mb-0">Empresa</label>
                    <select class="form-select form-select-sm" id="nt-entity"><option value="">Carregando...</option></select></div>` : ''}
                  <div class="${chooseEntity ? 'col-md-6' : 'col-12'}"><label class="form-label small mb-0">Localização</label>
                    <select class="form-select form-select-sm" id="nt-location"><option value="">Carregando...</option></select></div>
                </div>
              </div>

              ${step(1, 'Qual é o seu problema?', 'Escolha o mais parecido.',
                `<div id="nt-cat-box"><div class="text-muted small">Carregando categorias...</div></div>`)}

              ${step(2, '<span id="nt-step2-tit">O que está acontecendo?</span>', '',
                `<div id="nt-mat-box" class="nt-mat mb-2" style="display:none"></div>
                 <textarea class="form-control" id="nt-desc" rows="3"
                           placeholder="Conte com suas palavras: o que aconteceu, desde quando e o que você já tentou."></textarea>
                 <div class="d-flex flex-wrap gap-2 mt-2">
                   <button type="button" class="btn btn-outline-secondary btn-sm" id="nt-pick-photo">
                     <i class="bi bi-camera me-1"></i> Foto
                   </button>
                   <button type="button" class="btn btn-outline-secondary btn-sm" id="nt-pick-files">
                     <i class="bi bi-paperclip me-1"></i> Arquivo
                   </button>
                 </div>
                 <input type="file" id="nt-files" multiple hidden
                        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,video/mp4,audio/mpeg">
                 <input type="file" id="nt-photo" accept="image/*" capture="environment" hidden>
                 <ul class="list-group list-group-flush mt-2" id="nt-file-list" style="display:none"></ul>`)}

              ${step(3, 'Isso está afetando a operação?', '',
                `<div class="row g-2" id="nt-impact-box"><div class="text-muted small">Carregando...</div></div>`)}

              ${step(4, 'Para quando você precisa?', 'Toque no dia. O número mostra quantos chamados já estão marcados nele.',
                `<div id="nt-cal"></div>`)}

              <details class="mb-4" id="nt-more">
                <summary class="small text-primary" style="cursor:pointer">Mais detalhes (opcional): título e equipamento</summary>
                <div class="row g-2 mt-1">
                  <div class="col-12"><label class="form-label small mb-0">Título</label>
                    <input class="form-control" id="nt-title" maxlength="200" placeholder="Se deixar em branco, criamos um automaticamente"></div>
                  <div class="col-12"><label class="form-label small mb-0">Equipamento envolvido</label>
                    <select class="form-select" id="nt-asset"><option value="">— nenhum / não sei —</option></select></div>
                </div>
              </details>

              <button type="button" class="btn btn-primary btn-lg w-100" id="btn-submit">
                <i class="bi bi-send me-1"></i> Enviar chamado
              </button>
              <div class="form-text text-center mt-2">Você recebe o número do chamado e acompanha tudo na página dele.</div>
            </form>
          </div>
        </div>
      </div>
    </div>`;

  const hashParams = new URLSearchParams((location.hash.split('?')[1] || '').split('#')[0]);
  const preEntity = hashParams.get('entity_id');
  const preAsset = hashParams.get('asset_id');

  let catMode = 'complex';
  let pickedSimple = null;
  let pickedImpact = null;
  let catsData = [];

  // ---------- pedido de material ----------
  // Na categoria "Pedido de material" o passo 2 vira a lista de materiais (com quantidade)
  let ehMaterial = false;
  let materiais = null;
  const qtds = {};
  async function modoMaterial(on) {
    ehMaterial = on;
    const boxM = document.getElementById('nt-mat-box');
    const desc = document.getElementById('nt-desc');
    document.getElementById('nt-step2-tit').textContent = on ? 'Quais materiais você precisa?' : 'O que está acontecendo?';
    desc.placeholder = on ? 'Observações (opcional): modelo, cor, para quem é...'
      : 'Conte com suas palavras: o que aconteceu, desde quando e o que você já tentou.';
    boxM.style.display = on ? '' : 'none';
    if (!on) return;
    if (!materiais) {
      boxM.innerHTML = '<div class="text-muted small">Carregando materiais...</div>';
      try { materiais = await API.get('/materials'); } catch (e) { boxM.innerHTML = `<div class="text-danger small">${esc(e.message)}</div>`; return; }
    }
    pintarMateriais();
    // pedido de material normalmente não para a operação: já marca "Requisição" (dá para trocar)
    if (!pickedImpact) document.querySelector('#nt-impact-box .urg-card.u-req')?.click();
  }
  function pintarMateriais() {
    const boxM = document.getElementById('nt-mat-box');
    if (!materiais.length) {
      boxM.innerHTML = '<div class="text-muted small">Nenhum material cadastrado. Peça ao administrador para cadastrar em Administração › Materiais.</div>';
      return;
    }
    boxM.innerHTML = materiais.map((m) => `
      <div class="nt-mat-row ${qtds[m.id] ? 'on' : ''}" data-id="${m.id}">
        <span class="nt-mat-nome">${esc(m.name)}${m.unit ? ` <small class="text-muted">(${esc(m.unit)})</small>` : ''}</span>
        <span class="nt-mat-qtd">
          <button type="button" class="btn btn-sm btn-outline-secondary" data-d="-1" aria-label="Menos ${esc(m.name)}"><i class="bi bi-dash-lg"></i></button>
          <b>${qtds[m.id] || 0}</b>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-d="1" aria-label="Mais ${esc(m.name)}"><i class="bi bi-plus-lg"></i></button>
        </span>
      </div>`).join('');
    boxM.querySelectorAll('.nt-mat-row button').forEach((bt) => bt.addEventListener('click', () => {
      const id = bt.closest('.nt-mat-row').dataset.id;
      qtds[id] = Math.min(999, Math.max(0, (qtds[id] || 0) + Number(bt.dataset.d)));
      pintarMateriais();
    }));
  }

  // ---------- data de necessidade (calendario aberto, obrigatorio) ----------
  const neededCal = CalendarUI.picker(document.getElementById('nt-cal'), {
    loadCounts: (from, to) => API.get(`/tickets/calendar/load?from=${from}&to=${to}`),
  });

  // ---------- urgencia (cada opção na cor da sua urgência) ----------
  const URG_ICON = { 4: 'bi-sign-stop-fill', 3: 'bi-exclamation-triangle-fill', 2: 'bi-hourglass-split', 1: 'bi-clipboard-check' };
  try {
    const levels = await API.get('/impact-levels');
    const box = document.getElementById('nt-impact-box');
    box.innerHTML = levels.slice().sort((a, b) => b.sort_order - a.sort_order).map((l) => `
      <div class="col-6">
        <label class="choice-card urg-card ${URGENCY_TONE[l.priority] || 'u-req'} w-100 h-100 d-block" title="${esc(l.examples ? 'Ex.: ' + l.examples : '')}">
          <input class="visually-hidden" type="radio" name="nt-impact" value="${l.id}">
          <span class="urg-top"><i class="bi ${URG_ICON[l.priority] || 'bi-clipboard-check'} urg-ico"></i>
            <b class="urg-nome">${esc(l.name)}</b><i class="bi bi-check-circle-fill urg-ok"></i></span>
          <div class="small urg-desc">${esc(l.description || '')}</div>
        </label>
      </div>`).join('');
    box.querySelectorAll('input[name="nt-impact"]').forEach((r) => r.addEventListener('change', () => {
      pickedImpact = r.value;
      box.querySelectorAll('.choice-card').forEach((c) => c.classList.toggle('sel', c.contains(r) && r.checked));
    }));
  } catch (e) { showError(e); }

  // ---------- dependentes da empresa ----------
  const currentEntity = () => (chooseEntity ? document.getElementById('nt-entity').value : String(user.entity_id || ''));
  const whereBox = document.getElementById('nt-where-box');
  const showWhere = () => { whereBox.style.display = ''; };
  document.getElementById('nt-where-edit').onclick = () => {
    whereBox.style.display = whereBox.style.display === 'none' ? '' : 'none';
  };
  // resumo "Empresa · Posto" mostrado no topo
  const updateWhere = () => {
    const entSel = document.getElementById('nt-entity');
    const entName = window.EMPRESA_UNICA ? '' : (chooseEntity ? (entSel.value ? entSel.selectedOptions[0].textContent : '') : (user.entity_name || ''));
    const locSel = document.getElementById('nt-location');
    const locName = !locSel.disabled && locSel.value ? locSel.selectedOptions[0].textContent : '';
    const txt = [entName, locName].filter(Boolean).join(' · ');
    document.getElementById('nt-where').textContent = txt || (window.EMPRESA_UNICA ? 'Escolha a localização' : 'Escolha a empresa e a localização');
    if ((!entName && !window.EMPRESA_UNICA) || (!locSel.disabled && !locSel.value)) showWhere();
  };
  document.getElementById('nt-location').addEventListener('change', updateWhere);

  async function loadCategories(entityId) {
    const box = document.getElementById('nt-cat-box');
    pickedSimple = null;
    if (!entityId) { box.innerHTML = '<div class="text-muted small">Escolha a empresa.</div>'; return; }
    try {
      const data = await API.get('/categories/for-entity/' + entityId);
      catMode = data.mode;
      if (data.mode === 'simple') {
        catsData = data.categories;
        box.innerHTML = `<div class="nt-cat-grid">${data.categories.map((c) => `
            <button type="button" class="btn btn-outline-secondary nt-simple ${c.is_material ? 'nt-cat-mat' : ''}" data-id="${c.id}"
              title="${esc(c.examples ? 'Ex.: ' + c.examples.replace(/;\s*/g, ', ') : (c.description || ''))}">
              <span class="nt-cat-ico">${esc(c.icon || '📌')}</span>
              <span class="fw-semibold nt-cat-nome">${esc(c.name)}</span>
            </button>`).join('')}</div>`;
        box.querySelectorAll('.nt-simple').forEach((b) => b.addEventListener('click', () => {
          pickedSimple = b.dataset.id;
          box.querySelectorAll('.nt-simple').forEach((x) => {
            x.classList.toggle('btn-primary', x === b);
            x.classList.toggle('btn-outline-secondary', x !== b);
          });
          modoMaterial(!!(catsData.find((c) => String(c.id) === String(b.dataset.id)) || {}).is_material);
        }));
      } else {
        box.innerHTML = `<select class="form-select" id="nt-cat">
            <option value="">— escolha a categoria —</option>${categoryOptions(data.categories)}
          </select>`;
      }
    } catch (e) {
      box.innerHTML = `<div class="text-danger small">${esc(e.message)}</div>`;
    }
  }

  async function loadLocations(entityId) {
    const sel = document.getElementById('nt-location');
    if (!entityId) { sel.innerHTML = '<option value="">—</option>'; return; }
    try {
      const locs = (await API.get(`/locations?entity_id=${entityId}&active=true`));
      if (!locs.length) {
        sel.innerHTML = '<option value="">Esta empresa não tem localizações cadastradas</option>';
        sel.disabled = true;
        return;
      }
      sel.disabled = false;
      sel.innerHTML = '<option value="">— escolha —</option>' +
        locs.map((l) => `<option value="${l.id}">${esc(l.name)}${l.code ? ` (${esc(l.code)})` : ''}${l.city ? ` — ${esc(l.city)}` : ''}</option>`).join('');
      if (user.location_id && locs.some((l) => String(l.id) === String(user.location_id))) {
        sel.value = String(user.location_id);
      } else if (locs.length === 1) {
        sel.value = String(locs[0].id);
      }
    } catch { sel.innerHTML = '<option value="">—</option>'; }
  }

  async function loadAssets(entityId) {
    const sel = document.getElementById('nt-asset');
    if (!entityId) { sel.innerHTML = '<option value="">— nenhum / não sei —</option>'; return; }
    try {
      const assets = await API.get('/inventory/assets?entity_id=' + entityId);
      sel.innerHTML = '<option value="">— nenhum / não sei —</option>' + assets.map((a) =>
        `<option value="${a.id}">${esc(a.name)} ${a.asset_tag ? `(${esc(a.asset_tag)})` : ''}</option>`).join('');
      if (preAsset) sel.value = String(preAsset);
    } catch { sel.innerHTML = '<option value="">— nenhum / não sei —</option>'; }
  }

  const onEntity = async () => {
    const id = currentEntity();
    await Promise.all([loadCategories(id), loadLocations(id), loadAssets(id)]);
    updateWhere();
  };

  if (chooseEntity) {
    try {
      const ents = await API.get('/entities');
      const list = ents.filter((e) => e.active && (Roles.isStaff(user) || myEntities.includes(String(e.id))));
      const sel = document.getElementById('nt-entity');
      sel.innerHTML = '<option value="">— escolha a empresa —</option>' +
        list.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
      const entToUse = preEntity || String(user.entity_id || '');
      if (entToUse && list.some((e) => String(e.id) === entToUse)) sel.value = entToUse;
      if (list.length === 1) { sel.value = String(list[0].id); sel.closest('.col-md-6').classList.add('multi-empresa'); }
      sel.addEventListener('change', onEntity);
    } catch {}
  }
  await onEntity();

  // ---------- anexos ----------
  const picked = [];
  const fileList = document.getElementById('nt-file-list');
  const renderFiles = () => {
    if (!picked.length) { fileList.style.display = 'none'; fileList.innerHTML = ''; return; }
    fileList.style.display = '';
    fileList.innerHTML = picked.map((f, i) => `
      <li class="list-group-item small d-flex justify-content-between align-items-center py-1">
        <span class="text-truncate" style="max-width:80%"><i class="bi bi-paperclip me-1"></i>${esc(f.name)}</span>
        <span class="d-flex align-items-center gap-2">
          <span class="text-muted">${(f.size / 1024 / 1024).toFixed(1)} MB</span>
          <button type="button" class="btn btn-sm btn-link p-0 text-danger nt-rm-file" data-i="${i}"><i class="bi bi-x-lg"></i></button>
        </span>
      </li>`).join('');
    fileList.querySelectorAll('.nt-rm-file').forEach((b) => b.addEventListener('click', () => {
      picked.splice(parseInt(b.dataset.i, 10), 1);
      renderFiles();
    }));
  };
  const addFiles = (fileListLike) => {
    for (const f of Array.from(fileListLike || [])) {
      if (f.size > 15 * 1024 * 1024) { toast(`${f.name}: maior que 15MB`, 'warning'); continue; }
      if (picked.length >= 10) { toast('Máximo de 10 anexos', 'warning'); break; }
      if (!picked.some((p) => p.name === f.name && p.size === f.size)) picked.push(f);
    }
    renderFiles();
  };
  document.getElementById('nt-pick-files').onclick = () => document.getElementById('nt-files').click();
  document.getElementById('nt-pick-photo').onclick = () => document.getElementById('nt-photo').click();
  document.getElementById('nt-files').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  document.getElementById('nt-photo').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };

  // ---------- envio ----------
  document.getElementById('btn-submit').onclick = async () => {
    const entityId = currentEntity();
    const title = document.getElementById('nt-title').value.trim();
    const desc = document.getElementById('nt-desc').value.trim();
    const needWhere = () => { showWhere(); toast(window.EMPRESA_UNICA ? 'Confira a localização do chamado.' : 'Confira o local do chamado (empresa e localização).', 'warning'); };
    const catSel = document.getElementById('nt-cat');
    const locSel = document.getElementById('nt-location');
    if (chooseEntity && !entityId) { needWhere(); return; }
    if (!locSel.disabled && !locSel.value) { needWhere(); return; }
    if (catMode === 'simple' ? !pickedSimple : !(catSel && catSel.value)) { toast('Escolha o que você precisa (passo 1).', 'warning'); return; }
    const itens = Object.entries(qtds).filter(([, q]) => q > 0).map(([id, q]) => ({ material_id: Number(id), quantity: q }));
    if (ehMaterial && !itens.length) { toast('Escolha pelo menos um material (passo 2).', 'warning'); return; }
    if (!ehMaterial && !desc) { toast('Conte o que está acontecendo (passo 2).', 'warning'); return; }
    if (!pickedImpact) { toast('Diga se isso está afetando a operação (passo 3).', 'warning'); return; }
    if (!neededCal.value) { neededCal.flagInvalid(); toast('Marque no calendário o dia em que você precisa disso (passo 4).', 'warning'); return; }

    const payload = {
      title,
      description: desc,
      impact_id: parseInt(pickedImpact, 10),
      needed_by: neededCal.value,
    };
    if (ehMaterial) payload.materials = itens;
    if (catMode === 'simple') payload.simple_category_id = parseInt(pickedSimple, 10);
    else payload.category_id = parseInt(catSel.value, 10);
    if (chooseEntity) payload.entity_id = parseInt(entityId, 10);
    if (locSel.value) payload.location_id = parseInt(locSel.value, 10);
    const assetSel = document.getElementById('nt-asset');
    if (assetSel && assetSel.value) payload.asset_id = parseInt(assetSel.value, 10);

    const btn = document.getElementById('btn-submit');
    btn.disabled = true;
    try {
      const t = await API.post('/tickets', payload);
      if (picked.length) {
        const fd = new FormData();
        picked.forEach((f) => fd.append('files', f));
        try { await API.post(`/tickets/${t.id}/attachments`, fd, true); }
        catch (e2) { toast('Chamado aberto, mas falhou o anexo: ' + (e2.message || ''), 'warning'); }
      }
      el.innerHTML = `
        <div class="row justify-content-center"><div class="col-lg-7">
          <div class="card panel-card text-center"><div class="card-body py-5">
            <i class="bi bi-check-circle text-success" style="font-size:3rem"></i>
            <h4 class="mt-2">Chamado ${esc(t.number)} aberto!</h4>
            <p class="text-muted mb-1">Status: <b>${esc(LABELS.status[t.status] || '')}</b></p>
            <p class="text-muted">A equipe vai analisar e informar a previsão de atendimento.
              Você recebe um aviso a cada novidade.</p>
            <a class="btn btn-primary" href="#/tickets/${t.id}"><i class="bi bi-eye me-1"></i> Acompanhar chamado</a>
          </div></div>
        </div></div>`;
    } catch (e) {
      showError(e);
      btn.disabled = false;
    }
  };
};
