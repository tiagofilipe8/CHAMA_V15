// ---------------------------------------------------------------
// Views.orcim — Estoque da ORCIM
//   A ORCIM registra os itens no próprio estoque (ainda sem empresa) e depois
//   transfere para uma empresa e posto: Estoque de T.I. do posto ou já em uso.
//   Itens por quantidade (mouse, teclado, cabo) podem ir em parte.
// ---------------------------------------------------------------
Views.orcim = async function orcim(el) {
  const user = API.user || {};
  const vePreco = Roles.can(user, 'inventory.secrets');
  const ESTADOS = { STOCK: 'Em estoque', ORDERED: 'A caminho (comprado)', REPAIR: 'Em conserto', BROKEN: 'Estragado' };
  let busca = '';
  let dados = { itens: [], enviados: [], totais: {} };
  let empresas = [];
  try { empresas = (await API.get('/entities')).filter((e) => e.active); } catch { /* sem lista */ }

  el.innerHTML = `
    <div class="card panel-card mb-3 oc-topo">
      <div class="oc-marca"><span class="oc-logo"><i class="bi bi-boxes"></i></span>
        <div><b>Estoque da ORCIM</b><small>Itens da ORCIM que ainda não foram para nenhuma empresa. Registre aqui e transfira quando for entregar.</small></div></div>
      <div class="oc-kpis" id="oc-kpis"></div>
      <div class="oc-acoes">
        <div class="iv-busca"><i class="bi bi-search"></i><input class="form-control form-control-sm" id="oc-q" placeholder="Buscar item, etiqueta, modelo"></div>
        <button class="btn btn-primary btn-sm" id="oc-novo"><i class="bi bi-plus-lg"></i> Registrar item</button>
      </div>
    </div>
    <div id="oc-corpo">${spinner()}</div>`;

  const qtdDe = (a) => (a.controle === 'quantidade' ? Number(a.quantity || 0) : 1);

  function desenhar() {
    const t = dados.totais || {};
    el.querySelector('#oc-kpis').innerHTML = `
      <span class="oc-kpi"><b>${t.itens || 0}</b><small>item(ns) no estoque</small></span>
      ${vePreco ? `<span class="oc-kpi"><b>${invMoeda(t.valor || 0)}</b><small>valor</small></span>` : ''}
      <span class="oc-kpi"><b>${dados.enviados.length}</b><small>transferência(s) recentes</small></span>`;
    const q = busca.toLowerCase();
    const itens = dados.itens.filter((a) => !q || [a.name, a.asset_tag, a.model, a.manufacturer, a.serial_number].some((v) => String(v || '').toLowerCase().includes(q)));
    const porTipo = new Map();
    itens.forEach((a) => { if (!porTipo.has(a.type)) porTipo.set(a.type, []); porTipo.get(a.type).push(a); });
    const corpo = el.querySelector('#oc-corpo');
    corpo.innerHTML = `
      ${itens.length ? [...porTipo.entries()].sort((x, y) => (INV_TYPES[x[0]] || '').localeCompare(INV_TYPES[y[0]] || '')).map(([tp, lista]) => `
        <div class="card panel-card mb-2 oc-grupo">
          <div class="iv-tipo-cab"><i class="bi ${INV_ICONES[tp] || 'bi-box'}"></i>${esc(INV_TYPES[tp] || tp)} <span>${lista.reduce((s, a) => s + qtdDe(a), 0)}</span></div>
          ${lista.map((a) => `<div class="oc-item">
            <span class="iv-tx">${Item.titulo(a, { link: false, local: false, semEtiqueta: true,
              depois: `<small>${esc([[a.manufacturer, a.model].filter(Boolean).join(' '), a.serial_number ? `S/N ${a.serial_number}` : '', a.criado_por ? `registrado por ${a.criado_por}` : ''].filter(Boolean).join(' · ') || '—')}</small>` })}</span>
            ${vePreco ? `<span class="iv-preco">${a.price != null ? (a.controle === 'quantidade' ? `${invMoeda(Number(a.price) * qtdDe(a))}<small class="d-block text-muted">${invMoeda(a.price)}/un</small>` : invMoeda(a.price)) : ''}</span>` : ''}
            <span class="oc-btns">
              <button class="btn btn-sm btn-outline-secondary" data-editar="${a.id}" title="Editar"><i class="bi bi-pencil"></i></button>
              <button class="btn btn-sm btn-outline-danger" data-tirar="${a.id}" title="Tirar do estoque (cadastrado por engano ou descartado)"><i class="bi bi-trash3"></i></button>
              ${['STOCK', 'ORDERED'].includes(a.status) && qtdDe(a) > 0 ? `<button class="btn btn-sm btn-success" data-transf="${a.id}"><i class="bi bi-send"></i> Transferir</button>` : ''}
            </span>
          </div>`).join('')}
        </div>`).join('') : emptyState(dados.itens.length ? 'Nada encontrado' : 'Estoque da ORCIM vazio', dados.itens.length ? 'Mude a busca.' : 'Registre os itens que a ORCIM comprou ou tem guardados. Depois é só transferir para a empresa.', 'bi-boxes')}
      <div class="card panel-card mt-3">
        <div class="dp-bloco-cab"><span><i class="bi bi-send-check"></i> Últimas transferências para as empresas</span></div>
        ${dados.enviados.length ? `<div class="oc-enviados">${dados.enviados.map((m) => `<a class="oc-env" href="#/inventory/${m.asset_id}">
          <span class="oc-env-ico"><i class="bi bi-arrow-right-circle"></i></span>
          <span class="oc-env-tx">${Item.titulo({ asset_name: `${m.quantity > 1 ? `${m.quantity}× ` : ''}${m.name}`, asset_tag: m.asset_tag, type: m.type }, { link: false, estado: false, local: false })}<br>
            <small>${esc(m.empresa || '')} · ${esc(m.posto || '')} · por ${esc(m.quem || '—')}</small></span>
          <small class="text-muted text-nowrap">${fmt.timeAgo(m.created_at)}${m.price != null && vePreco ? `<br><b>${invMoeda(m.price)}</b>` : ''}</small></a>`).join('')}</div>`
    : '<div class="dp-vazio">Nenhuma transferência ainda.</div>'}
      </div>`;
    const achar = (id) => dados.itens.find((a) => String(a.id) === String(id));
    corpo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => abrirItem(achar(b.dataset.editar))));
    corpo.querySelectorAll('[data-transf]').forEach((b) => b.addEventListener('click', () => transferir(achar(b.dataset.transf))));
    corpo.querySelectorAll('[data-tirar]').forEach((b) => b.addEventListener('click', async () => {
      const a = achar(b.dataset.tirar);
      const ok = await confirmDialog({ title: 'Tirar do Estoque da ORCIM', body: `"${a.name}" fica marcado como Descartado e sai da lista. O histórico continua guardado.`, confirmText: 'Tirar do estoque', danger: true });
      if (!ok) return;
      try { await API.del(`/orcim/${a.id}`); toast('Item tirado do estoque.', 'success'); carregar(); } catch (e) { showError(e); }
    }));
  }

  // ---------- registrar / editar ----------
  function abrirItem(a) {
    const m = document.createElement('div');
    m.className = 'modal fade';
    m.innerHTML = `<div class="modal-dialog modal-lg"><div class="modal-content">
      <div class="modal-header"><h6><i class="bi bi-boxes me-1"></i> ${a ? 'Editar item da ORCIM' : 'Registrar item no Estoque da ORCIM'}</h6><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div class="row">
          <div class="col-md-6 mb-2"><label class="form-label small">Nome *</label><input class="form-control inv-upper" id="o-name" value="${esc(a?.name || '')}" placeholder="Ex.: MONITOR 24&quot; DELL"></div>
          <div class="col-md-3 mb-2"><label class="form-label small">Categoria *</label><select class="form-select" id="o-type">${Object.entries(INV_TYPES).map(([k, v]) => `<option value="${k}" ${(a?.type || 'COMPUTER') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="col-md-3 mb-2"><label class="form-label small">Estado</label><select class="form-select" id="o-status">${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${(a?.status || 'STOCK') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        </div>
        <div class="row">
          <div class="col-md-8 mb-2"><label class="form-label small">Como é contado</label>
            <select class="form-select" id="o-controle">
              <option value="unidade" ${(a?.controle || 'unidade') === 'unidade' ? 'selected' : ''}>Por unidade — tem etiqueta (monitor, PC, impressora)</option>
              <option value="quantidade" ${a?.controle === 'quantidade' ? 'selected' : ''}>Por quantidade — sem etiqueta (mouse, teclado, cabo)</option>
            </select></div>
          <div class="col-md-4 mb-2 ${a?.controle === 'quantidade' ? '' : 'd-none'}" id="o-qtd-box"><label class="form-label small">Quantidade</label><input class="form-control" id="o-qtd" type="number" min="0" value="${a?.quantity ?? 1}"></div>
          <div class="col-md-4 mb-2 ${a?.controle === 'quantidade' ? 'd-none' : ''}" id="o-tag-box"><label class="form-label small">Etiqueta Orcim</label><input class="form-control inv-upper" id="o-tag" value="${esc(a?.asset_tag || '')}"></div>
        </div>
        <div class="row">
          <div class="col-md-4 mb-2"><label class="form-label small">Fabricante</label><input class="form-control inv-upper" id="o-man" value="${esc(a?.manufacturer || '')}"></div>
          <div class="col-md-4 mb-2"><label class="form-label small">Modelo</label><input class="form-control inv-upper" id="o-model" value="${esc(a?.model || '')}"></div>
          <div class="col-md-4 mb-2"><label class="form-label small">Nº de série</label><input class="form-control inv-upper" id="o-serial" value="${esc(a?.serial_number || '')}"></div>
        </div>
        <div class="row">
          ${vePreco ? `<div class="col-md-4 mb-2"><label class="form-label small">Preço (R$) <span class="text-muted" id="o-un">${a?.controle === 'quantidade' ? 'por unidade' : ''}</span></label><input class="form-control" id="o-price" type="number" min="0" step="0.01" value="${a?.price ?? ''}" placeholder="0,00"></div>` : ''}
          <div class="col mb-2"><label class="form-label small">Observações</label><input class="form-control" id="o-notes" value="${esc(a?.notes || '')}" placeholder="Ex.: comprado na Kabum, nota 1234"></div>
        </div>
      </div>
      <div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-primary" id="o-save">${a ? 'Salvar' : 'Registrar'}</button></div>
    </div></div>`;
    document.body.appendChild(m);
    const modal = new bootstrap.Modal(m);
    m.addEventListener('hidden.bs.modal', () => m.remove());
    const ctl = m.querySelector('#o-controle');
    const trocar = () => {
      const q = ctl.value === 'quantidade';
      m.querySelector('#o-qtd-box').classList.toggle('d-none', !q);
      m.querySelector('#o-tag-box').classList.toggle('d-none', q);
      const un = m.querySelector('#o-un'); if (un) un.textContent = q ? 'por unidade' : '';
    };
    ctl.addEventListener('change', trocar);
    m.querySelector('#o-type').addEventListener('change', (e) => { if (!a && e.target.value === 'PERIPHERAL') { ctl.value = 'quantidade'; trocar(); } });
    m.querySelector('#o-save').onclick = async () => {
      const v = (s) => m.querySelector(s).value.trim();
      const b = { name: v('#o-name'), type: v('#o-type'), status: v('#o-status'), controle: ctl.value, manufacturer: v('#o-man'), model: v('#o-model'), serial_number: v('#o-serial'), notes: v('#o-notes') };
      if (ctl.value === 'quantidade') b.quantity = parseInt(v('#o-qtd'), 10); else b.asset_tag = v('#o-tag');
      if (vePreco) b.price = v('#o-price');
      if (!b.name) { toast('Informe o nome do item.', 'warning'); return; }
      try {
        if (a) await API.patch(`/orcim/${a.id}`, b); else await API.post('/orcim', b);
        modal.hide(); toast(a ? 'Item atualizado.' : 'Item registrado no Estoque da ORCIM.', 'success'); carregar();
      } catch (e) { showError(e); }
    };
    modal.show();
  }

  // ---------- transferir para uma empresa ----------
  function transferir(a) {
    const porQtd = a.controle === 'quantidade';
    const m = document.createElement('div');
    m.className = 'modal fade';
    m.innerHTML = `<div class="modal-dialog"><div class="modal-content">
      <div class="modal-header"><h6><i class="bi bi-send me-1"></i> Transferir para uma empresa</h6><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div class="es-item-cab">${Item.titulo(a, { link: false, local: false })}</div>
        <div class="oc-rota"><span><i class="bi bi-boxes"></i> Estoque da ORCIM</span><i class="bi bi-arrow-right"></i><span id="oc-para"><i class="bi bi-building"></i> escolha a empresa</span></div>
        <label class="form-label small fw-semibold mt-2 mb-1">Empresa *</label>
        <select class="form-select form-select-sm" id="oc-ent"><option value="">— escolha —</option>${empresas.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>
        <label class="form-label small fw-semibold mt-3 mb-1">Posto *</label>
        <select class="form-select form-select-sm" id="oc-loc" disabled><option value="">— escolha a empresa primeiro —</option></select>
        <label class="form-label small fw-semibold mt-3 mb-1">Vai para</label>
        <div class="oc-destinos">
          <label class="es-razao on"><input type="radio" name="oc-dest" value="estoque" checked><span><b><i class="bi bi-box-seam"></i> Estoque de T.I. do posto</b><small>Fica guardado no posto para quando precisarem.</small></span></label>
          <label class="es-razao"><input type="radio" name="oc-dest" value="uso"><span><b><i class="bi bi-pc-display"></i> Já em uso no posto</b><small>Vai direto para o inventário como Operando.</small></span></label>
        </div>
        ${porQtd ? `<label class="form-label small fw-semibold mt-3 mb-1">Quantos vão?</label>
          <div class="d-flex align-items-center gap-2"><input type="number" class="form-control form-control-sm" id="oc-qtd" min="1" max="${a.quantity}" value="${a.quantity}" style="max-width:6rem"><small class="text-muted">de ${a.quantity} · o resto continua na ORCIM</small></div>` : ''}
        <label class="form-label small fw-semibold mt-3 mb-1">Observação</label>
        <input class="form-control form-control-sm" id="oc-obs" maxlength="500" placeholder="Ex.: levado na rota de terça">
        ${vePreco && a.price != null ? `<div class="es-custo mt-3"><i class="bi bi-cash-coin"></i> Valor que entra na empresa: <b id="oc-valor">${invMoeda(Number(a.price) * (porQtd ? a.quantity : 1))}</b></div>` : ''}
      </div>
      <div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-success" id="oc-ok"><i class="bi bi-send"></i> Transferir</button></div>
    </div></div>`;
    document.body.appendChild(m);
    const modal = new bootstrap.Modal(m);
    m.addEventListener('hidden.bs.modal', () => m.remove());
    const selEnt = m.querySelector('#oc-ent'); const selLoc = m.querySelector('#oc-loc');
    const para = () => {
      const e = selEnt.selectedOptions[0]; const l = selLoc.selectedOptions[0];
      m.querySelector('#oc-para').innerHTML = selEnt.value ? `<i class="bi bi-building"></i> ${esc(e.textContent)}${selLoc.value ? ` · ${esc(l.textContent)}` : ''}` : '<i class="bi bi-building"></i> escolha a empresa';
    };
    selEnt.addEventListener('change', async () => {
      selLoc.disabled = true; selLoc.innerHTML = '<option value="">carregando…</option>';
      let locs = [];
      if (selEnt.value) { try { locs = await API.get(`/locations?entity_id=${selEnt.value}&active=true`); } catch { locs = []; } }
      selLoc.innerHTML = `<option value="">— escolha o posto —</option>${locs.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}`;
      selLoc.disabled = !selEnt.value;
      para();
    });
    selLoc.addEventListener('change', para);
    if (empresas.length === 1) { selEnt.value = empresas[0].id; selEnt.dispatchEvent(new Event('change')); }
    m.querySelectorAll('[name="oc-dest"]').forEach((r) => r.addEventListener('change', () => m.querySelectorAll('.oc-destinos .es-razao').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked))));
    const qtdEl = m.querySelector('#oc-qtd');
    if (qtdEl && m.querySelector('#oc-valor')) qtdEl.addEventListener('input', () => { m.querySelector('#oc-valor').textContent = invMoeda(Number(a.price) * (parseInt(qtdEl.value, 10) || 0)); });
    m.querySelector('#oc-ok').onclick = async () => {
      if (!selEnt.value || !selLoc.value) { toast('Escolha a empresa e o posto.', 'warning'); return; }
      const corpo = { entity_id: selEnt.value, location_id: selLoc.value, destino: m.querySelector('[name="oc-dest"]:checked').value, note: m.querySelector('#oc-obs').value.trim() };
      if (porQtd) {
        corpo.quantidade = parseInt(qtdEl.value, 10);
        if (!(corpo.quantidade >= 1 && corpo.quantidade <= a.quantity)) { toast(`Escolha de 1 a ${a.quantity}.`, 'warning'); return; }
      }
      try {
        await API.post(`/orcim/${a.id}/transferir`, corpo);
        modal.hide(); toast(`Transferido para ${selEnt.selectedOptions[0].textContent} · ${selLoc.selectedOptions[0].textContent}.`, 'success'); carregar();
      } catch (e) { showError(e); }
    };
    modal.show();
  }

  async function carregar() {
    try { dados = await API.get('/orcim'); } catch (e) { el.querySelector('#oc-corpo').innerHTML = emptyState('Não foi possível carregar', e.message, 'bi-exclamation-triangle'); return; }
    desenhar();
  }
  let espera = null;
  el.querySelector('#oc-q').addEventListener('input', (e) => { clearTimeout(espera); espera = setTimeout(() => { busca = e.target.value.trim(); desenhar(); }, 200); });
  el.querySelector('#oc-novo').addEventListener('click', () => abrirItem(null));
  carregar();
};
