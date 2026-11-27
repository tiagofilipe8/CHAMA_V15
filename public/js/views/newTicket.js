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
    <div class="nt-step mb-4" id="nt-step-${n}">
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
                   <button type="button" class="btn btn-outline-secondary btn-sm btn-anexo" id="nt-pick-files">
                     <i class="bi bi-paperclip me-1"></i> Anexar arquivo
                   </button>
                   <button type="button" class="btn btn-outline-secondary btn-sm btn-anexo" id="nt-pick-photo">
                     <i class="bi bi-camera me-1"></i> Tirar foto
                   </button>
                 </div>
                 <div class="form-text">Fotos, PDF, Word ou Excel, até 15 MB cada.</div>
                 <input type="file" id="nt-files" multiple hidden accept="${ANEXO_ACCEPT}">
                 <input type="file" id="nt-photo" accept="image/*" capture="environment" hidden>
                 <ul class="list-group list-group-flush mt-2" id="nt-file-list" style="display:none"></ul>`)}

              ${step(3, 'Isso está afetando a operação?', '',
                `<div class="row g-2" id="nt-impact-box"><div class="text-muted small">Carregando...</div></div>`)}

              ${step(4, 'Para quando você precisa? <span class="text-muted fw-normal small">(opcional)</span>', '',
                `<div class="d-flex flex-wrap gap-2 nt-prazo" role="group" aria-label="Para quando você precisa">
                   <button type="button" class="btn btn-outline-primary btn-sm" data-prazo="hoje">Hoje</button>
                   <button type="button" class="btn btn-outline-primary btn-sm" data-prazo="amanha">Amanhã</button>
                   <button type="button" class="btn btn-outline-primary btn-sm" data-prazo="semana">Até sexta</button>
                   <button type="button" class="btn btn-outline-primary btn-sm" data-prazo="sem">Sem pressa</button>
                   <button type="button" class="btn btn-outline-secondary btn-sm" data-prazo="dia"><i class="bi bi-calendar3 me-1"></i>Escolher o dia</button>
                 </div>
                 <div class="small mt-2" id="nt-prazo-txt" aria-live="polite"></div>
                 <div id="nt-cal" class="mt-2" hidden></div>`)}

              <div class="mb-4 nt-equip d-none" id="nt-equip-box">
                <label class="form-label fw-semibold mb-1" for="nt-equip"><i class="bi bi-upc-scan me-1"></i>Qual equipamento? <span class="text-danger">*</span></label>
                <select class="form-select" id="nt-equip"></select>
                <div class="form-text">Procure a etiqueta da Orcim colada no equipamento (ex.: ORC-0101). Item sem etiqueta, como mouse, use "Não se aplica".</div>
              </div>

              <details class="mb-4" id="nt-more">
                <summary class="small text-primary" style="cursor:pointer">Mais detalhes (opcional): título e equipamento</summary>
                <div class="row g-2 mt-1">
                  <div class="col-12"><label class="form-label small mb-0">Título</label>
                    <input class="form-control" id="nt-title" maxlength="200" placeholder="Se deixar em branco, criamos um automaticamente"></div>
                  <div class="col-12"><label class="form-label small mb-0">Equipamento envolvido</label>
                    <select class="form-select" id="nt-asset"><option value="">— nenhum / não sei —</option></select></div>
                </div>
              </details>

              <div id="nt-erro-envio"></div>
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
  // veio de "Pedir manutenção" (ficha do item ou Itens em manutenção): o chamado também abre a manutenção do item
  const pedeManutencao = hashParams.get('manutencao') === '1' && !!preAsset;
  if (pedeManutencao) {
    el.insertAdjacentHTML('afterbegin', `<div class="es-meu-local mb-3"><i class="bi bi-tools"></i><span><b>Pedido de manutenção.</b> Escolha o problema e conte o que está acontecendo com o item. A TI busca o item no local, conserta e devolve; você acompanha em <b>Itens em manutenção</b>.</span></div>`);
  }

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
    // pedido de material normalmente não para a operação: já marca "Requisição" (dá para trocar).
    // Marca sem "clicar" no cartão: o clique levava o foco (e a rolagem) para o passo 3,
    // e a pessoa ainda precisa escolher os materiais na lista que acabou de abrir.
    if (!pickedImpact) {
      const req = document.querySelector('#nt-impact-box .urg-card.u-req input[name="nt-impact"]');
      if (req) { req.checked = true; req.dispatchEvent(new Event('change', { bubbles: true })); }
    }
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
  // ---------- data de necessidade (opcional, escolha rápida) ----------
  // O calendário só abre (e só busca dados) se a pessoa quiser escolher um dia.
  // A contagem de chamados por dia só aparece para a equipe.
  const dIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const prazoTxt = document.getElementById('nt-prazo-txt');
  const calBox = document.getElementById('nt-cal');
  let calendario = null;
  let prazo = null; // 'AAAA-MM-DD' ou null (sem pressa / não informado)
  const mostrarPrazo = (escolha) => {
    document.querySelectorAll('[data-prazo]').forEach((b) => {
      const on = b.dataset.prazo === escolha;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
    prazoTxt.innerHTML = prazo
      ? `<i class="bi bi-calendar-check text-success me-1"></i>Precisa até <b>${esc(new Date(prazo + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))}</b>`
      : (escolha === 'sem' ? '<i class="bi bi-check2 me-1"></i>Sem data: a equipe atende pela urgência.' : '');
  };
  document.querySelectorAll('[data-prazo]').forEach((b) => b.addEventListener('click', () => {
    const d = new Date();
    const tipo = b.dataset.prazo;
    if (tipo === 'dia') {
      calBox.hidden = false;
      if (!calendario) {
        calendario = CalendarUI.picker(calBox, {
          atalhos: false,
          loadCounts: Roles.isStaff(user) ? (from, to) => API.get(`/tickets/calendar/load?from=${from}&to=${to}`) : undefined,
          onChange: (k) => { prazo = k; mostrarPrazo('dia'); },
        });
      }
      prazo = calendario.value || null;
      mostrarPrazo('dia');
      return;
    }
    calBox.hidden = true;
    if (tipo === 'hoje') prazo = dIso(d);
    else if (tipo === 'amanha') { d.setDate(d.getDate() + 1); prazo = dIso(d); }
    else if (tipo === 'semana') { d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7)); prazo = dIso(d); }
    else prazo = null;
    mostrarPrazo(tipo);
  }));
  const neededCal = { get value() { return prazo; } };

  // ---------- urgencia (cada opção na cor da sua urgência) ----------
  const URG_ICON = { 4: 'bi-sign-stop-fill', 3: 'bi-exclamation-triangle-fill', 2: 'bi-hourglass-split', 1: 'bi-clipboard-check' };
  // as urgências vêm do perfil de opções da empresa: recarrega quando a empresa muda
  async function loadImpacts(entityId) {
  try {
    pickedImpact = null;
    const levels = await API.get('/impact-levels' + (entityId ? `?entity_id=${encodeURIComponent(entityId)}` : ''));
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
  }

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
  document.getElementById('nt-location').addEventListener('change', (e) => gravarUltimoPosto(currentEntity(), e.target.value));

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
          atualizarEquip();
        }));
      } else {
        catsData = data.categories;
        box.innerHTML = `<select class="form-select" id="nt-cat">
            <option value="">— escolha a categoria —</option>${categoryOptions(data.categories)}
          </select>`;
        box.querySelector('#nt-cat').addEventListener('change', atualizarEquip);
      }
      atualizarEquip();
    } catch (e) {
      box.innerHTML = `<div class="text-danger small">${esc(e.message)}</div>`;
    }
  }

  // Último posto escolhido (fica guardado neste navegador, por usuário): vem marcado no próximo chamado
  const CHAVE_POSTO = `ultimo_posto_${user.id}`;
  const lerUltimoPosto = () => { try { return JSON.parse(localStorage.getItem(CHAVE_POSTO) || 'null') || {}; } catch { return {}; } };
  const gravarUltimoPosto = (entityId, locationId) => {
    try { if (locationId) localStorage.setItem(CHAVE_POSTO, JSON.stringify({ entity_id: String(entityId || ''), location_id: String(locationId) })); } catch { /* sem armazenamento */ }
  };

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
        locs.map((l) => `<option value="${l.id}">${esc(l.name)}${l.city ? ` — ${esc(l.city)}` : ''}</option>`).join('');
      const ultimo = lerUltimoPosto();
      if (ultimo.location_id && locs.some((l) => String(l.id) === ultimo.location_id)) {
        sel.value = ultimo.location_id; // o último posto que a pessoa escolheu
      } else if (user.location_id && locs.some((l) => String(l.id) === String(user.location_id))) {
        sel.value = String(user.location_id);
      } else if (locs.length === 1) {
        sel.value = String(locs[0].id);
      }
    } catch { sel.innerHTML = '<option value="">—</option>'; }
  }

  // Categoria de manutenção: pede qual equipamento (com "Não se aplica" e "Não encontrei a etiqueta")
  let ativosCache = [];
  function categoriaPedeEquipamento() {
    const id = catMode === 'simple' ? pickedSimple : document.getElementById('nt-cat')?.value;
    return !!((catsData || []).find((c) => String(c.id) === String(id)) || {}).requires_asset;
  }
  function atualizarEquip() {
    const box = document.getElementById('nt-equip-box');
    const pede = categoriaPedeEquipamento();
    box.classList.toggle('d-none', !pede);
    document.getElementById('nt-asset').closest('.col-12').classList.toggle('d-none', pede);
    if (!pede) return;
    const sel = document.getElementById('nt-equip');
    const atual = sel.value;
    const loc = document.getElementById('nt-location').value;
    const opt = (a) => `<option value="${a.id}">${esc(a.asset_tag ? `${a.asset_tag} · ` : '')}${esc(a.name)}${a.location_name && !loc ? ` (${esc(a.location_name)})` : ''}</option>`;
    const aqui = ativosCache.filter((a) => loc && String(a.location_id) === String(loc));
    const outros = ativosCache.filter((a) => !(loc && String(a.location_id) === String(loc)));
    sel.innerHTML = '<option value="">— escolha o equipamento —</option>'
      + (aqui.length ? `<optgroup label="Neste local">${aqui.map(opt).join('')}</optgroup>` : '')
      + (outros.length ? `<optgroup label="${loc ? 'Outros locais' : 'Equipamentos'}">${outros.map(opt).join('')}</optgroup>` : '')
      + '<optgroup label="Sem etiqueta"><option value="nao_aplica">Não se aplica (item sem etiqueta, ex.: mouse, teclado)</option>'
      + '<option value="nao_encontrei">Não encontrei a etiqueta (a TI marca depois)</option></optgroup>';
    // mantém o que a pessoa já escolheu; se ainda não escolheu, vem o item que abriu esta tela (ficha do item / Pedir manutenção)
    if (atual && [...sel.options].some((o) => o.value === atual)) sel.value = atual;
    else if (preAsset && [...sel.options].some((o) => o.value === String(preAsset))) sel.value = String(preAsset);
  }
  document.getElementById('nt-location').addEventListener('change', atualizarEquip);

  async function loadAssets(entityId) {
    const sel = document.getElementById('nt-asset');
    if (!entityId) { sel.innerHTML = '<option value="">— nenhum / não sei —</option>'; ativosCache = []; return; }
    try {
      const assets = await API.get('/inventory/assets?entity_id=' + entityId);
      ativosCache = assets.filter((a) => !['DISPOSED', 'LOST'].includes(a.status));
      atualizarEquip();
      sel.innerHTML = '<option value="">— nenhum / não sei —</option>' + assets.map((a) =>
        `<option value="${a.id}">${esc(a.name)} ${a.asset_tag ? `(${esc(a.asset_tag)})` : ''}</option>`).join('');
      if (preAsset) sel.value = String(preAsset);
    } catch { sel.innerHTML = '<option value="">— nenhum / não sei —</option>'; }
  }

  const onEntity = async () => {
    const id = currentEntity();
    await Promise.all([loadCategories(id), loadImpacts(id), loadLocations(id), loadAssets(id)]);
    updateWhere();
  };

  if (chooseEntity) {
    try {
      const ents = await API.get('/entities');
      const list = ents.filter((e) => e.active && (Roles.isStaff(user) || myEntities.includes(String(e.id))));
      const sel = document.getElementById('nt-entity');
      sel.innerHTML = '<option value="">— escolha a empresa —</option>' +
        list.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
      // empresa: a do link; senão a do último posto escolhido; senão a da pessoa
      const entToUse = preEntity || lerUltimoPosto().entity_id || String(user.entity_id || '');
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
    for (const f of filtrarAnexos(fileListLike)) {
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
    // Erros ficam escritos em vermelho no próprio passo (não somem sozinhos)
    const limparErros = () => {
      document.querySelectorAll('.nt-erro').forEach((x) => x.remove());
      document.querySelectorAll('.nt-tem-erro').forEach((x) => x.classList.remove('nt-tem-erro'));
    };
    const erroNo = (box, msg) => {
      limparErros();
      if (!box) { toast(msg, 'danger'); return; }
      box.classList.add('nt-tem-erro');
      const aviso = document.createElement('div');
      aviso.className = 'nt-erro';
      aviso.setAttribute('role', 'alert');
      aviso.innerHTML = `<i class="bi bi-exclamation-circle-fill me-1"></i>${esc(msg)}`;
      box.appendChild(aviso);
      const sair = () => { aviso.remove(); box.classList.remove('nt-tem-erro'); };
      ['input', 'change', 'click'].forEach((ev) => box.addEventListener(ev, (e) => { if (!aviso.contains(e.target)) sair(); }, { once: true }));
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const foco = box.querySelector('textarea, select:not([disabled]), input:not([type="hidden"]):not([hidden]):not(.visually-hidden), button');
      foco?.focus({ preventScroll: true });
    };
    limparErros();
    document.getElementById('nt-erro-envio').innerHTML = '';
    const localBox = document.querySelector('.nt-local');
    const needWhere = () => { showWhere(); erroNo(localBox, window.EMPRESA_UNICA ? 'Escolha a localização do chamado.' : 'Escolha a empresa e a localização do chamado.'); };
    const catSel = document.getElementById('nt-cat');
    const locSel = document.getElementById('nt-location');
    if (chooseEntity && !entityId) { needWhere(); return; }
    if (!locSel.disabled && !locSel.value) { needWhere(); return; }
    if (catMode === 'simple' ? !pickedSimple : !(catSel && catSel.value)) { erroNo(document.getElementById('nt-step-1'), 'Escolha o que você precisa.'); return; }
    const itens = Object.entries(qtds).filter(([, q]) => q > 0).map(([id, q]) => ({ material_id: Number(id), quantity: q }));
    if (ehMaterial && !itens.length) { erroNo(document.getElementById('nt-step-2'), 'Escolha pelo menos um material.'); return; }
    if (!ehMaterial && !desc) { erroNo(document.getElementById('nt-step-2'), 'Conte o que está acontecendo.'); return; }
    if (!pickedImpact) { erroNo(document.getElementById('nt-step-3'), 'Diga se isso está afetando a operação.'); return; }
    const pedeEquip = categoriaPedeEquipamento();
    const equipSel = document.getElementById('nt-equip');
    if (pedeEquip && !equipSel.value) { erroNo(document.getElementById('nt-equip-box'), 'Escolha qual é o equipamento (ou "Não se aplica" / "Não encontrei a etiqueta").'); return; }

    const payload = {
      title,
      description: desc,
      impact_id: parseInt(pickedImpact, 10),
    };
    if (neededCal.value) payload.needed_by = neededCal.value;
    if (ehMaterial) payload.materials = itens;
    if (catMode === 'simple') payload.simple_category_id = parseInt(pickedSimple, 10);
    else payload.category_id = parseInt(catSel.value, 10);
    if (chooseEntity) payload.entity_id = parseInt(entityId, 10);
    if (locSel.value) payload.location_id = parseInt(locSel.value, 10);
    const assetSel = document.getElementById('nt-asset');
    if (pedeEquip) {
      if (['nao_aplica', 'nao_encontrei'].includes(equipSel.value)) payload.asset_escolha = equipSel.value;
      else payload.asset_id = parseInt(equipSel.value, 10);
    } else if (assetSel && assetSel.value) payload.asset_id = parseInt(assetSel.value, 10);

    const btn = document.getElementById('btn-submit');
    btn.disabled = true;
    try {
      const t = await API.post('/tickets', payload);
      gravarUltimoPosto(entityId, locSel.value);
      if (picked.length) {
        const fd = new FormData();
        picked.forEach((f) => fd.append('files', f));
        try { await API.post(`/tickets/${t.id}/attachments`, fd, true); }
        catch (e2) { toast('Chamado aberto, mas falhou o anexo: ' + (e2.message || ''), 'warning'); }
      }
      let manutOk = false;
      if (pedeManutencao && payload.asset_id) {
        try {
          await API.post('/manutencoes', { asset_id: payload.asset_id, ticket_id: t.id, problema: document.getElementById('nt-desc')?.value.trim() || payload.description || payload.title || 'Manutenção pedida pelo chamado' });
          manutOk = true;
        } catch (e3) { toast('Chamado aberto, mas não foi possível registrar a manutenção: ' + (e3.message || ''), 'warning'); }
      }
      el.innerHTML = `
        <div class="row justify-content-center"><div class="col-lg-7">
          <div class="card panel-card text-center"><div class="card-body py-5">
            <i class="bi bi-check-circle text-success" style="font-size:3rem"></i>
            <h4 class="mt-2">Chamado ${esc(t.number)} aberto!</h4>
            <p class="text-muted mb-1">Status: <b>${esc(LABELS.status[t.status] || '')}</b></p>
            <p class="text-muted">A equipe vai analisar e informar a previsão de atendimento.
              Você recebe um aviso a cada novidade.</p>
            ${manutOk ? '<p class="mb-3"><span class="mt-tag mt-pedida"><i class="bi bi-tools"></i>Manutenção pedida</span> Acompanhe o conserto do item em <a href="#/manutencao">Itens em manutenção</a>.</p>' : ''}
            <div class="d-flex flex-wrap gap-2 justify-content-center">
              <a class="btn btn-primary" href="#/tickets/${t.id}"><i class="bi bi-eye me-1"></i> Acompanhar chamado</a>
              <button type="button" class="btn btn-outline-primary" id="nt-outro"><i class="bi bi-plus-lg me-1"></i> Abrir outro chamado</button>
            </div>
          </div></div>
        </div></div>`;
      document.getElementById('nt-outro').onclick = () => Views.newTicket(el);
    } catch (e) {
      // erro do servidor: fica escrito acima do botão de enviar
      const caixa = document.getElementById('nt-erro-envio');
      caixa.innerHTML = `<div class="nt-erro mb-2" role="alert"><i class="bi bi-exclamation-circle-fill me-1"></i>${esc(e.message || 'Não foi possível enviar o chamado.')}</div>`;
      caixa.scrollIntoView({ behavior: 'smooth', block: 'center' });
      btn.disabled = false;
    }
  };
};
