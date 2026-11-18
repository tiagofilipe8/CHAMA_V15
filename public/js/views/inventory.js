// ---------------------------------------------------------------
// Views.inventory — Orcim Inventário
// ---------------------------------------------------------------

const INV_TYPES = {
  COMPUTER: 'Computador', NOTEBOOK: 'Notebook', SERVER: 'Servidor',
  PRINTER: 'Impressora', MONITOR: 'Monitor', UPS: 'Nobreak',
  NETWORK_DEVICE: 'Rede', MOBILE_DEVICE: 'Móvel', OTHER: 'Outro'
};
const INV_STATUS = {
  ACTIVE: 'Ativo', INACTIVE: 'Inativo', MAINTENANCE: 'Manutenção',
  STOCK: 'Estoque', DISPOSED: 'Descartado', LOST: 'Extraviado'
};
const INV_STATUS_TONE = { ACTIVE:'success', INACTIVE:'secondary', MAINTENANCE:'warning', STOCK:'info', DISPOSED:'dark', LOST:'danger' };

// <img> nao envia Authorization — usa ?token= na URL
function invPhotoUrl(assetId, photoId) {
  const t = API.token ? `?token=${encodeURIComponent(API.token)}` : '';
  return `/api/inventory/assets/${assetId}/photos/${photoId}/file${t}`;
}

async function openAssetModal(asset, cb) {
  const user = API.user || {};
  const ents = await API.get('/entities').catch(()=>[]);
  const isEdit = asset != null && asset !== '';
  let a = null;
  if (isEdit) {
    const id = (asset && typeof asset === 'object') ? asset.id : asset;
    try { a = await API.get('/inventory/assets/' + id); } catch {}
    if (!a && asset && typeof asset === 'object') a = asset;
    if (!a) { toast('Não foi possível carregar o ativo', 'danger'); return; }
  }
  const m = document.createElement('div'); m.className='modal fade';
  const up = (v) => (v==null?'':String(v));
  m.innerHTML = `<div class="modal-dialog modal-lg"><div class="modal-content">
    <div class="modal-header"><h6>${isEdit?'Editar ativo':'Novo ativo'}</h6><button class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">
      <div class="row">
        <div class="col-md-6 mb-2"><label class="form-label small">Nome *</label><input class="form-control inv-upper" id="a-name" value="${esc(up(a?.name).toUpperCase())}"></div>
        <div class="col-md-3 mb-2"><label class="form-label small">ID ORCIM</label><input class="form-control inv-upper" id="a-tag" value="${esc(up(a?.asset_tag).toUpperCase())}"></div>
        <div class="col-md-3 mb-2"><label class="form-label small">Tipo *</label><select class="form-select" id="a-type">${Object.entries(INV_TYPES).map(([k,v])=>`<option value="${k}" ${a?.type===k?'selected':''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="row">
        <div class="col-md-4 mb-2"><label class="form-label small">Fabricante</label><input class="form-control inv-upper" id="a-man" value="${esc(up(a?.manufacturer).toUpperCase())}"></div>
        <div class="col-md-4 mb-2"><label class="form-label small">Modelo</label><input class="form-control inv-upper" id="a-model" value="${esc(up(a?.model).toUpperCase())}"></div>
        <div class="col-md-4 mb-2"><label class="form-label small">N° Série / TAG</label><input class="form-control inv-upper" id="a-serial" value="${esc(up(a?.serial_number).toUpperCase())}"></div>
      </div>
      <div class="row">
        <div class="col-md-4 mb-2"><label class="form-label small">Status</label><select class="form-select" id="a-status">${Object.entries(INV_STATUS).map(([k,v])=>`<option value="${k}" ${a?.status===k?'selected':''}>${v}</option>`).join('')}</select></div>
        <div class="col-md-4 mb-2"><label class="form-label small">Entidade *</label><select class="form-select" id="a-entity">${ents.filter(e=>e.active).map(e=>`<option value="${e.id}" ${String(a?.entity_id)===String(e.id)?'selected':''}>${esc(e.name)}</option>`).join('')}</select></div>
        <div class="col-md-4 mb-2"><label class="form-label small">Localização</label><input class="form-control inv-upper" id="a-location" value="${esc(up(a?.location).toUpperCase())}"></div>
      </div>
      <div class="row">
        <div class="col-md-4 mb-2"><label class="form-label small">Setor</label><input class="form-control inv-upper" id="a-dept" value="${esc(up(a?.department).toUpperCase())}"></div>
        <div class="col-md-4 mb-2"><label class="form-label small">Usuário / Posse</label><input class="form-control" id="a-resp" placeholder="ID usuário" value="${esc(a?.responsible_user_id||'')}"></div>
        <div class="col-md-4 mb-2"><label class="form-label small">Garantia até</label><input class="form-control" id="a-warranty" type="date" value="${a?.warranty_expiration ? a.warranty_expiration.slice(0,10):''}"></div>
      </div>
      <div class="row">
        <div class="col-md-4 mb-2"><label class="form-label small">Data de compra</label><input class="form-control" id="a-purchase" type="date" value="${a?.purchase_date ? a.purchase_date.slice(0,10):''}"></div>
        <div class="col-md-8 mb-2"><label class="form-label small">Descrição</label><input class="form-control inv-upper" id="a-desc" value="${esc(up(a?.description).toUpperCase())}"></div>
      </div>
      <div class="row">
        <div class="col-md-4 mb-2"><label class="form-label small">IP</label><input class="form-control inv-upper" id="a-ip" value="${esc(up(a?.ip_address).toUpperCase())}"></div>
        <div class="col-md-4 mb-2"><label class="form-label small">MAC</label><input class="form-control inv-upper" id="a-mac" value="${esc(up(a?.mac_address).toUpperCase())}"></div>
        <div class="col-md-4 mb-2"><label class="form-label small">Memória</label><input class="form-control inv-upper" id="a-mem" value="${esc(up(a?.memory_info).toUpperCase())}"></div>
      </div>
      <div class="row">
        <div class="col-md-4 mb-2"><label class="form-label small">HD</label><input class="form-control inv-upper" id="a-hd" value="${esc(up(a?.hd_info).toUpperCase())}"></div>
        <div class="col-md-4 mb-2"><label class="form-label small">CPU</label><input class="form-control inv-upper" id="a-cpu" value="${esc(up(a?.cpu_info).toUpperCase())}"></div>
        <div class="col-md-4 mb-2"><label class="form-label small">S.O</label><input class="form-control inv-upper" id="a-os" value="${esc(up(a?.os_info).toUpperCase())}"></div>
      </div>
      <div class="row">
        <div class="col-md-4 mb-2"><label class="form-label small">Licenciamento</label><input class="form-control inv-upper" id="a-lic" value="${esc(up(a?.license_info).toUpperCase())}"></div>
        <div class="col-md-4 mb-2"><label class="form-label small">Toner</label><input class="form-control inv-upper" id="a-toner" value="${esc(up(a?.toner).toUpperCase())}"></div>
        <div class="col-md-4 mb-2"><label class="form-label small">Cilindro</label><input class="form-control inv-upper" id="a-cilindro" value="${esc(up(a?.cilindro).toUpperCase())}"></div>
      </div>
      <div class="row">
        <div class="col-md-4 mb-2"><label class="form-label small">Webcam</label>
          <div class="d-flex gap-4 pt-1">
            <div class="form-check">
              <input class="form-check-input" type="radio" name="a-webcam" id="a-webcam-yes" value="1" ${a?.webcam===true?'checked':''}>
              <label class="form-check-label" for="a-webcam-yes">Sim</label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="radio" name="a-webcam" id="a-webcam-no" value="0" ${a?.webcam===false?'checked':''}>
              <label class="form-check-label" for="a-webcam-no">Não</label>
            </div>
          </div>
        </div>
        <div class="col-md-4 mb-2"><label class="form-label small">Porta Ethernet</label>
          <div class="d-flex gap-4 pt-1">
            <div class="form-check">
              <input class="form-check-input" type="radio" name="a-eth" id="a-eth-yes" value="1" ${a?.eth_port===true?'checked':''}>
              <label class="form-check-label" for="a-eth-yes">Sim</label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="radio" name="a-eth" id="a-eth-no" value="0" ${a?.eth_port===false?'checked':''}>
              <label class="form-check-label" for="a-eth-no">Não</label>
            </div>
          </div>
        </div>
      </div>
      <div class="mb-2"><label class="form-label small">Observações</label><textarea class="form-control inv-upper" id="a-notes" rows="2">${esc(up(a?.notes).toUpperCase())}</textarea></div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-primary" id="a-save">Salvar</button></div>
  </div></div>`;
  document.body.appendChild(m);
  m.querySelectorAll('.inv-upper').forEach(el => {
    el.style.textTransform = 'uppercase';
    el.addEventListener('input', () => {
      const pos = el.selectionStart;
      el.value = el.value.toUpperCase();
      try { el.setSelectionRange(pos, pos); } catch {}
    });
  });
  const modal = new bootstrap.Modal(m);
  if (user.role==='client') { m.querySelector('#a-entity').value = String(user.entity_id); m.querySelector('#a-entity').disabled = true; }
  m.querySelector('#a-save').onclick = async ()=>{
    const val = (sel) => m.querySelector(sel).value.trim().toUpperCase() || null;
    const body = {
      name: val('#a-name'),
      asset_tag: val('#a-tag'),
      type: m.querySelector('#a-type').value,
      status: m.querySelector('#a-status').value,
      manufacturer: val('#a-man'),
      model: val('#a-model'),
      serial_number: val('#a-serial'),
      entity_id: parseInt(m.querySelector('#a-entity').value,10)||null,
      location: val('#a-location'),
      department: val('#a-dept'),
      responsible_user_id: parseInt(m.querySelector('#a-resp').value,10)||null,
      warranty_expiration: m.querySelector('#a-warranty').value||null,
      purchase_date: m.querySelector('#a-purchase').value||null,
      description: val('#a-desc'),
      notes: val('#a-notes'),
      ip_address: val('#a-ip'),
      mac_address: val('#a-mac'),
      memory_info: val('#a-mem'),
      hd_info: val('#a-hd'),
      cpu_info: val('#a-cpu'),
      os_info: val('#a-os'),
      license_info: val('#a-lic'),
      toner: val('#a-toner'),
      cilindro: val('#a-cilindro'),
      webcam: (() => { const el = m.querySelector('input[name="a-webcam"]:checked'); return el ? el.value === '1' : null; })(),
      eth_port: (() => { const el = m.querySelector('input[name="a-eth"]:checked'); return el ? el.value === '1' : null; })(),
    };
    if (!body.name || !body.entity_id) { toast('Nome e entidade são obrigatórios','warning'); return; }
    try {
      if (isEdit) await API.patch('/inventory/assets/' + a.id, body);
      else await API.post('/inventory/assets', body);
      modal.hide(); m.addEventListener('hidden.bs.modal', ()=>m.remove());
      toast('Ativo salvo','success'); if(cb) cb();
    } catch(e){ showError(e); }
  };
  modal.show();
}

Views.inventory = async function inventory(el) {
  const user = API.user || {};
  el.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h4 class="mb-0"><i class="bi bi-hdd-stack me-2"></i> Orcim Inventário</h4>
      <div class="d-flex gap-2">
        <button class="btn btn-outline-secondary btn-sm" id="btn-agents"><i class="bi bi-cpu"></i> Agentes</button>
        <button class="btn btn-primary btn-sm" id="btn-new-asset"><i class="bi bi-plus-lg"></i> Novo ativo</button>
      </div>
    </div>
    <div class="card panel-card mb-3">
      <div class="card-body py-2 d-flex flex-wrap gap-2 align-items-center">
        <input class="form-control form-control-sm" id="inv-q" style="max-width:220px" placeholder="Buscar ID ORCIM, nome, serial...">
        <select class="form-select form-select-sm" id="inv-type" style="max-width:160px">
          <option value="">Todos os tipos</option>
          ${Object.entries(INV_TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}
        </select>
        <select class="form-select form-select-sm" id="inv-status" style="max-width:150px">
          <option value="">Todos status</option>
          ${Object.entries(INV_STATUS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}
        </select>
        <select class="form-select form-select-sm" id="inv-entity" style="max-width:200px"><option value="">Todas entidades</option></select>
        <button class="btn btn-sm btn-outline-secondary" id="btn-inv-filter"><i class="bi bi-search"></i></button>
      </div>
    </div>
    <div class="card panel-card">
      <div class="table-responsive">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>Foto</th>
              <th>Status</th>
              <th>Entidade</th>
              <th>Localização</th>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Marca</th>
              <th>N° Série</th>
              <th>CPU</th>
              <th>Memória</th>
              <th>HD</th>
            </tr>
          </thead>
          <tbody id="inv-grid">${spinner()}</tbody>
        </table>
      </div>
    </div>`;

  const loadEntities = async () => {
    try {
      const ents = await API.get('/entities');
      const sel = document.getElementById('inv-entity');
      sel.innerHTML = `<option value="">Todas entidades</option>` + ents.filter(e=>e.active).map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('');
      if (user.role==='client') { sel.value = String(user.entity_id||''); sel.disabled = true; }
    } catch {}
  };
  await loadEntities();

  const load = async () => {
    const p = new URLSearchParams();
    const q = document.getElementById('inv-q').value.trim();
    const t = document.getElementById('inv-type').value;
    const s = document.getElementById('inv-status').value;
    const e = document.getElementById('inv-entity').value;
    if (q) p.set('q', q);
    if (t) p.set('type', t);
    if (s) p.set('status', s);
    if (e) p.set('entity_id', e);
    try {
      const assets = await API.get('/inventory/assets?' + p);
      const grid = document.getElementById('inv-grid');
      if (!assets.length) {
        grid.innerHTML = emptyState('Nenhum ativo', 'Cadastre o primeiro equipamento.', 'bi-hdd');
        return;
      }
      grid.innerHTML = assets.map(a=>`
        <tr class="asset-row" data-id="${a.id}" style="cursor:pointer">
          <td style="width:40px" class="text-center">
            ${a.display_photo_id || a.photos_count
              ? `<i class="bi bi-camera text-muted" title="Possui fotos"></i>`
              : ''}
          </td>
          <td><span class="badge text-bg-${INV_STATUS_TONE[a.status]||'secondary'}">${INV_STATUS[a.status]||a.status}</span>${a.next_maintenance_date && String(a.next_maintenance_date).slice(0,10) <= new Date().toISOString().slice(0,10) && a.status !== 'DISPOSED' && a.status !== 'LOST' ? ` <i class="bi bi-tools text-danger" title="Manutenção vencida"></i>` : ''}</td>
          <td class="small">${esc(a.entity_name||'')}</td>
          <td class="small">${esc(a.location||'—')}</td>
          <td>
            <div class="fw-semibold">${esc(a.name)}</div>
            <div class="small text-muted">${esc(a.asset_tag||'')}</div>
          </td>
          <td><span class="badge text-bg-light border">${INV_TYPES[a.type]||a.type}</span></td>
          <td class="small">${esc(a.manufacturer||'')} ${esc(a.model||'')}</td>
          <td class="small text-muted">${esc(a.serial_number||'—')}</td>
          <td class="small">${esc(a.cpu_info||'—')}</td>
          <td class="small">${esc(a.memory_info||'—')}</td>
          <td class="small">${esc(a.hd_info||'—')}</td>
        </tr>`).join('');
      grid.querySelectorAll('.asset-row').forEach(c=> c.addEventListener('click', ()=> location.hash=`#/inventory/${c.dataset.id}`));
    } catch(e){ showError(e); }
  };

  document.getElementById('btn-inv-filter').onclick = load;
  document.getElementById('inv-q').addEventListener('keydown', e=>{ if(e.key==='Enter') load(); });
  document.getElementById('btn-new-asset').onclick = ()=> openAssetModal(null, load);
  document.getElementById('btn-agents').onclick = ()=> location.hash='#/inventory/agents';
  await load();
};
Views.inventory.openAssetModal = openAssetModal;

Views.assetDetail = async function assetDetail(id, el) {
  const user = API.user || {};
  const a = await API.get('/inventory/assets/' + id).catch(e=>{ el.innerHTML=emptyState('Erro', e.message,'bi-exclamation'); return null; });
  if (!a) return;
  el.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h4 class="mb-0"><i class="bi bi-hdd me-2"></i>${esc(a.name)} <small class="text-muted">${esc(a.asset_tag||'')}</small></h4>
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-outline-secondary" id="btn-edit-asset"><i class="bi bi-pencil"></i> Editar</button>
        <button class="btn btn-sm btn-outline-primary" id="btn-provision"><i class="bi bi-cpu"></i> Gerar token Agent</button>
        <button class="btn btn-sm btn-outline-danger" id="btn-del-asset"><i class="bi bi-trash"></i></button>
      </div>
    </div>
    <div class="row g-3">
      <div class="col-lg-8">
        <div class="card panel-card mb-3"><div class="card-header">Identificação</div><div class="card-body small">
          <div class="row"><div class="col-6"><b>Nome:</b> ${esc(a.name||'—')}</div><div class="col-6"><b>ID ORCIM:</b> ${esc(a.asset_tag||'—')}</div></div>
          <div class="row"><div class="col-6"><b>Tipo:</b> ${INV_TYPES[a.type]||a.type}</div><div class="col-6"><b>Status:</b> <span class="badge text-bg-${INV_STATUS_TONE[a.status]}">${INV_STATUS[a.status]}</span></div></div>
          <div class="row"><div class="col-6"><b>Fabricante:</b> ${esc(a.manufacturer||'—')}</div><div class="col-6"><b>Modelo:</b> ${esc(a.model||'—')}</div></div>
          <div class="row"><div class="col-6"><b>N° Série / TAG:</b> ${esc(a.serial_number||'—')}</div><div class="col-6"><b>Cliente:</b> ${esc(a.entity_name||'—')}</div></div>
          <div class="row"><div class="col-6"><b>Local:</b> ${esc(a.location||'—')}</div><div class="col-6"><b>Setor:</b> ${esc(a.department||'—')}</div></div>
          <div class="row"><div class="col-6"><b>Usuário / Posse:</b> ${esc(a.responsible_name||a.responsible_user_id||'—')}</div><div class="col-6"><b>Data de compra:</b> ${a.purchase_date ? String(a.purchase_date).slice(0,10) : '—'}</div></div>
          <div class="row"><div class="col-6"><b>Garantia até:</b> ${a.warranty_expiration ? String(a.warranty_expiration).slice(0,10) : '—'}</div><div class="col-6"><b>IP:</b> ${esc(a.ip_address||'—')}</div></div>
          <div class="row"><div class="col-6"><b>MAC:</b> ${esc(a.mac_address||'—')}</div><div class="col-6"><b>Memória:</b> ${esc(a.memory_info||'—')}</div></div>
          <div class="row"><div class="col-6"><b>HD:</b> ${esc(a.hd_info||'—')}</div><div class="col-6"><b>CPU:</b> ${esc(a.cpu_info||'—')}</div></div>
          <div class="row"><div class="col-6"><b>S.O:</b> ${esc(a.os_info||'—')}</div><div class="col-6"><b>Licenciamento:</b> ${esc(a.license_info||'—')}</div></div>
          <div class="row"><div class="col-6"><b>Webcam:</b> ${a.webcam===true?'SIM':a.webcam===false?'NÃO':'—'}</div><div class="col-6"><b>Porta Ethernet:</b> ${a.eth_port===true?'SIM':a.eth_port===false?'NÃO':'—'}</div></div>
          <div class="row"><div class="col-6"><b>Toner:</b> ${esc(a.toner||'—')}</div><div class="col-6"><b>Cilindro:</b> ${esc(a.cilindro||'—')}</div></div>
          <div class="mt-2"><b>Descrição:</b> ${esc(a.description||'—')}</div>
          <div class="mt-2"><b>Observações:</b> ${esc(a.notes||'—')}</div>
          <div class="mt-2"><b>Agente:</b> ${a.agent ? `<span class="badge text-bg-${a.agent.status==='ONLINE'?'success':'secondary'}">${a.agent.status}</span> ${a.agent.version||''} último: ${a.agent.last_seen_at ? fmt.timeAgo(a.agent.last_seen_at):'nunca'}` : 'sem agente'}</div>
        </div></div>

        <div class="card panel-card mb-3"><div class="card-header d-flex justify-content-between align-items-center"><span><i class="bi bi-images me-1"></i> Fotos</span><button class="btn btn-sm btn-primary" id="btn-add-photo"><i class="bi bi-camera"></i> Adicionar</button></div>
          <div class="card-body">
            <div class="row g-2" id="photo-grid">${(a.photos||[]).map(p=>`
              <div class="col-4">
                <div class="border rounded p-1 text-center ${p.is_primary?'border-primary':''}">
                  <img src="${invPhotoUrl(a.id, p.id)}" style="width:100%;height:120px;object-fit:cover;border-radius:6px;cursor:pointer" class="photo-item" data-id="${p.id}">
                  <div class="small text-truncate mt-1">${esc(p.caption||p.file_name)} ${p.is_primary?'<span class="badge text-bg-primary">principal</span>':''}</div>
                  <div class="d-flex gap-1 justify-content-center mt-1">
                    <button class="btn btn-sm btn-outline-primary btn-photo-primary" data-id="${p.id}" title="Definir principal"><i class="bi bi-star"></i></button>
                    <button class="btn btn-sm btn-outline-danger btn-photo-del" data-id="${p.id}" title="Excluir"><i class="bi bi-trash"></i></button>
                  </div>
                </div>
              </div>`).join('') || '<div class="text-muted small">Nenhuma foto</div>'}
            </div>
            <input type="file" id="photo-input" accept="image/jpeg,image/png,image/webp" hidden>
          </div>
        </div>

        <div class="card panel-card mb-3">
          <div class="card-header d-flex justify-content-between align-items-center">
            <span><i class="bi bi-wrench me-1"></i> Manutenções</span>
            <button class="btn btn-sm btn-primary" id="btn-add-maint"><i class="bi bi-plus-lg"></i> Registrar</button>
          </div>
          <div class="card-body small border-bottom" id="maint-plan">
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <div class="fw-semibold">Próxima manutenção</div>
                <div class="mt-1"><b>Data:</b> ${a.next_maintenance_date ? (() => { const d = String(a.next_maintenance_date).slice(0,10); const over = d <= new Date().toISOString().slice(0,10); return over ? `<span class="badge text-bg-danger">VENCIDA ${d}</span>` : d; })() : '<span class="text-muted">—</span>'}</div>
                ${a.next_maintenance_notes ? `<div class="mt-1"><b>O que será feito:</b> ${esc(a.next_maintenance_notes)}</div>` : ''}
              </div>
              <div class="d-flex gap-1">
                ${a.next_maintenance_date ? `<button class="btn btn-sm btn-success" id="btn-complete-plan" title="Concluir manutenção"><i class="bi bi-check-lg"></i> Concluir</button>` : ''}
                <button class="btn btn-sm btn-outline-secondary" id="btn-edit-plan" title="Editar plano"><i class="bi bi-pencil"></i></button>
              </div>
            </div>
            <div id="plan-edit" class="mt-2" style="display:none">
              <div class="row g-2">
                <div class="col-md-3"><label class="form-label small">Data</label><input type="date" class="form-control" id="p-date" value="${a.next_maintenance_date ? String(a.next_maintenance_date).slice(0,10) : ''}"></div>
                <div class="col-md-9"><label class="form-label small">O que será feito *</label><textarea class="form-control" id="p-notes" rows="2">${esc(a.next_maintenance_notes||'')}</textarea></div>
              </div>
              <div class="d-flex gap-2 mt-2">
                <button class="btn btn-sm btn-primary" id="p-save">Salvar plano</button>
                <button class="btn btn-sm btn-outline-secondary" id="p-cancel">Cancelar</button>
              </div>
            </div>
            <div id="plan-complete" class="mt-2" style="display:none">
              ${a.next_maintenance_notes ? `<div class="mb-2 p-2 border rounded bg-body-secondary small"><b>Agendado:</b> ${esc(a.next_maintenance_notes)}</div>` : ''}
              <div class="row g-2">
                <div class="col-md-3"><label class="form-label small">Data da execução *</label><input type="date" class="form-control" id="pc-date" value="${new Date().toISOString().slice(0,10)}"></div>
                <div class="col-md-9"><label class="form-label small">Manutenção executada *</label><textarea class="form-control" id="pc-desc" rows="2" placeholder="Documente o que foi feito..."></textarea></div>
              </div>
              <div class="d-flex gap-2 mt-2">
                <button class="btn btn-sm btn-success" id="pc-save">Concluir e registrar</button>
                <button class="btn btn-sm btn-outline-secondary" id="pc-cancel">Cancelar</button>
              </div>
            </div>
          </div>
          <div id="maint-form" class="card-body border-bottom" style="display:none">
            <div class="row g-2">
              <div class="col-md-3"><label class="form-label small">Data *</label><input type="date" class="form-control" id="m-date" value="${new Date().toISOString().slice(0,10)}"></div>
              <div class="col-md-9"><label class="form-label small">O que foi feito *</label><textarea class="form-control" id="m-desc" rows="2" placeholder="Ex.: limpeza, troca de pasta térmica, atualização..."></textarea></div>
            </div>
            <div class="d-flex gap-2 mt-2">
              <button class="btn btn-sm btn-primary" id="m-save">Salvar manutenção</button>
              <button class="btn btn-sm btn-outline-secondary" id="m-cancel">Cancelar</button>
            </div>
          </div>
          <div class="list-group list-group-flush" id="maint-list">${(a.maintenances||[]).map(m => {
            const canEdit = user.role === 'admin' || String(user.id) === String(m.created_by);
            const d = String(m.performed_at).slice(0,10);
            const raw = String(m.description||'');
            const mAg = raw.match(/^Agendado:\s*([\s\S]*?)\n\nExecutado:\s*([\s\S]*)$/);
            let bodyHtml;
            if (mAg) {
              bodyHtml = `<div class="mt-1"><span class="badge text-bg-info me-1">Agendado</span><span class="maint-desc" style="white-space:pre-wrap">${esc(mAg[1].trim())}</span></div>
                <div class="mt-1"><span class="badge text-bg-success me-1">Executado</span><span class="maint-desc" style="white-space:pre-wrap">${esc(mAg[2].trim())}</span></div>`;
            } else {
              bodyHtml = `<div class="mt-1 maint-desc" style="white-space:pre-wrap">${esc(raw)}</div>`;
            }
            return `<div class="list-group-item small" data-mid="${m.id}">
              <div class="d-flex justify-content-between align-items-start">
                <div>
                  <span class="badge text-bg-secondary me-1">${d}</span>
                  <span class="text-muted">${fmt.timeAgo(m.created_at)} · ${esc(m.created_by_name||'—')}</span>
                </div>
                ${canEdit ? `<button class="btn btn-sm btn-link p-0 text-decoration-none btn-edit-maint" data-mid="${m.id}" title="Alterar"><i class="bi bi-pencil"></i></button>` : ''}
              </div>
              ${bodyHtml}
              <div class="mt-2 maint-edit-box" data-mid="${m.id}" style="display:none">
                <input type="date" class="form-control form-control-sm mb-1" value="${d}">
                <textarea class="form-control form-control-sm mb-1" rows="3">${esc(raw)}</textarea>
                <div class="d-flex gap-2">
                  <button class="btn btn-sm btn-primary btn-save-maint" data-mid="${m.id}">Salvar</button>
                  <button class="btn btn-sm btn-outline-secondary btn-cancel-maint" data-mid="${m.id}">Cancelar</button>
                </div>
              </div>
            </div>`;
          }).join('') || '<div class="p-3 text-muted small">Nenhuma manutenção registrada</div>'}
          </div>
        </div>

        <div class="card panel-card mb-3"><div class="card-header">Hardware / Sistema</div><div class="card-body small">
          ${a.computer ? `
            <div><b>SO:</b> ${esc(a.computer.os_name||'')} ${esc(a.computer.os_version||'')} (${esc(a.computer.os_arch||'')})</div>
            <div><b>CPU:</b> ${esc(a.computer.cpu_manufacturer||'')} ${esc(a.computer.cpu_model||'')} ${a.computer.cpu_cores?`· ${a.computer.cpu_cores} cores`:''}</div>
            <div><b>Placa-mãe:</b> ${esc(a.computer.motherboard_manufacturer||'')} ${esc(a.computer.motherboard_model||'')}</div>
            <div><b>Memória:</b> ${(a.memory||[]).map(m=>`${m.capacity_gb}GB ${m.type||''} ${m.slot||''}`).join(', ')||'—'}</div>
            <div><b>Armazenamento:</b> ${(a.storage||[]).map(s=>`${s.model||''} ${s.capacity_gb}GB ${s.type||''}`).join(', ')||'—'}</div>
            <div><b>Rede:</b> ${(a.network||[]).map(n=>`${n.name||''} ${n.ip||''} ${n.mac||''}`).join('<br>')||'—'}</div>
            <div class="mt-2"><b>Software (${(a.software||[]).length}):</b> ${(a.software||[]).slice(0,10).map(s=>`${esc(s.name)} ${esc(s.version||'')}`).join(', ')||'—'} ${(a.software||[]).length>10?`+${(a.software||[]).length-10} mais`:''}</div>
          ` : '<span class="text-muted">Sem coleta de hardware (aguardando Agent)</span>'}
        </div></div>
      </div>
      <div class="col-lg-4">
        <div class="card panel-card mb-3"><div class="card-header">Ordens de Serviço</div><div class="list-group list-group-flush" id="asset-tickets">${(a.tickets||[]).map(t=>`<a href="#/tickets/${t.id}" class="list-group-item list-group-item-action small"><b>${esc(t.number)}</b> ${esc(t.title)}<br><span class="badge text-bg-secondary">${t.status}</span></a>`).join('') || '<div class="p-3 text-muted small">Nenhuma OS vinculada</div>'}</div>
          <div class="card-body"><button class="btn btn-sm btn-outline-primary w-100" id="btn-new-os-asset"><i class="bi bi-plus"></i> Nova OS para este ativo</button></div>
        </div>
        <div class="card panel-card"><div class="card-header">Histórico</div><div class="list-group list-group-flush" style="max-height:400px;overflow:auto">${(a.history||[]).map(h=>`<div class="list-group-item small"><div class="fw-bold">${esc(h.action)} ${h.field?`· ${esc(h.field)}`:''}</div><div>${esc(h.old_value||'')}${h.new_value?` → ${esc(h.new_value)}`:''}</div><div class="text-muted">${fmt.dateTime(h.created_at)} · ${esc(h.user_name||'Agent')}</div></div>`).join('') || '<div class="p-3 text-muted small">Sem histórico</div>'}</div></div>
      </div>
    </div>
    <div id="provision-area" class="mt-2"></div>`;

  document.getElementById('btn-edit-asset').onclick = ()=> Views.inventory.openAssetModal(a.id, ()=> location.reload());
  document.getElementById('btn-del-asset').onclick = async ()=>{
    if (!await confirmDialog({title:'Excluir ativo', body:'Excluir permanentemente este ativo? Fotos e histórico serão removidos.', confirmText:'Excluir', danger:true})) return;
    try{ await API.del('/inventory/assets/' + a.id); toast('Ativo excluído','warning'); location.hash='#/inventory'; }catch(e){ showError(e); }
  };
  document.getElementById('btn-provision').onclick = async ()=>{
    try{
      const r = await API.post('/inventory/agents/provision', { entity_id: a.entity_id });
      document.getElementById('provision-area').innerHTML = `<div class="alert alert-success"><b>Token de instalação:</b> <code>${esc(r.token)}</code> <button class="btn btn-sm btn-outline-secondary ms-2" onclick="navigator.clipboard.writeText('${esc(r.token)}');toast('Copiado','success')"><i class="bi bi-clipboard"></i></button><br><small>Validade 24h · Entidade: ${esc(a.entity_name)}</small></div>`;
    }catch(e){ showError(e); }
  };
  document.getElementById('btn-new-os-asset').onclick = ()=> { location.hash = `#/new?entity_id=${a.entity_id}&asset_id=${a.id}`; };

  // manutencoes
  const maintForm = document.getElementById('maint-form');
  document.getElementById('btn-add-maint').onclick = () => {
    const show = maintForm.style.display === 'none';
    maintForm.style.display = show ? '' : 'none';
    if (show) document.getElementById('m-desc').focus();
  };
  document.getElementById('m-cancel').onclick = () => { maintForm.style.display = 'none'; };
  document.getElementById('m-save').onclick = async () => {
    const body = {
      performed_at: document.getElementById('m-date').value || null,
      description: document.getElementById('m-desc').value.trim(),
    };
    if (!body.performed_at || !body.description) { toast('Data e descrição são obrigatórias','warning'); return; }
    try {
      await API.post(`/inventory/assets/${a.id}/maintenances`, body);
      toast('Manutenção registrada','success');
      Views.assetDetail(a.id, el);
    } catch(e){ showError(e); }
  };

  // plano da proxima manutencao
  const planEdit = document.getElementById('plan-edit');
  const planComplete = document.getElementById('plan-complete');
  document.getElementById('btn-edit-plan').onclick = () => {
    planComplete.style.display = 'none';
    const show = planEdit.style.display === 'none';
    planEdit.style.display = show ? '' : 'none';
    if (show) document.getElementById('p-date').focus();
  };
  document.getElementById('p-cancel').onclick = () => { planEdit.style.display = 'none'; };
  document.getElementById('p-save').onclick = async () => {
    const date = document.getElementById('p-date').value || null;
    const notes = document.getElementById('p-notes').value.trim() || null;
    if (date && !notes) { toast('Descreva o que será feito na próxima manutenção','warning'); return; }
    try {
      await API.patch(`/inventory/assets/${a.id}`, { next_maintenance_date: date, next_maintenance_notes: notes });
      toast('Plano de manutenção salvo','success');
      Views.assetDetail(a.id, el);
    } catch(e){ showError(e); }
  };

  const btnCompletePlan = document.getElementById('btn-complete-plan');
  if (btnCompletePlan) {
    btnCompletePlan.onclick = () => {
      planEdit.style.display = 'none';
      const show = planComplete.style.display === 'none';
      planComplete.style.display = show ? '' : 'none';
      if (show) document.getElementById('pc-desc').focus();
    };
    document.getElementById('pc-cancel').onclick = () => { planComplete.style.display = 'none'; };
    document.getElementById('pc-save').onclick = async () => {
      const performedAt = document.getElementById('pc-date').value || null;
      const description = document.getElementById('pc-desc').value.trim();
      if (!performedAt || !description) { toast('Data e descrição da execução são obrigatórias','warning'); return; }
      try {
        const plano = (a.next_maintenance_notes || '').trim();
        const full = plano
          ? `Agendado: ${plano}\n\nExecutado: ${description}`
          : `Executado: ${description}`;
        await API.post(`/inventory/assets/${a.id}/maintenances`, {
          performed_at: performedAt,
          description: full,
        });
        await API.patch(`/inventory/assets/${a.id}`, { next_maintenance_date: null, next_maintenance_notes: null });
        toast('Manutenção concluída e registrada no histórico','success');
        Views.assetDetail(a.id, el);
      } catch(e){ showError(e); }
    };
  }

  el.querySelectorAll('.btn-edit-maint').forEach(b => b.addEventListener('click', () => {
    const box = el.querySelector(`.maint-edit-box[data-mid="${b.dataset.mid}"]`);
    if (box) box.style.display = box.style.display === 'none' ? '' : 'none';
  }));
  el.querySelectorAll('.btn-cancel-maint').forEach(b => b.addEventListener('click', () => {
    const box = el.querySelector(`.maint-edit-box[data-mid="${b.dataset.mid}"]`);
    if (box) box.style.display = 'none';
  }));
  el.querySelectorAll('.btn-save-maint').forEach(b => b.addEventListener('click', async () => {
    const box = el.querySelector(`.maint-edit-box[data-mid="${b.dataset.mid}"]`);
    const body = {
      performed_at: box.querySelector('input[type="date"]').value || null,
      description: box.querySelector('textarea').value.trim(),
    };
    if (!body.performed_at || !body.description) { toast('Data e descrição são obrigatórias','warning'); return; }
    try {
      await API.patch(`/inventory/assets/${a.id}/maintenances/${b.dataset.mid}`, body);
      toast('Manutenção atualizada','success');
      Views.assetDetail(a.id, el);
    } catch(e){ showError(e); }
  }));

  // fotos
  const photoInput = document.getElementById('photo-input');
  document.getElementById('btn-add-photo').onclick = ()=> photoInput.click();
  photoInput.onchange = async ()=>{
    const file = photoInput.files[0]; if(!file) return;
    const caption = prompt('Legenda da foto (opcional):') || '';
    const fd = new FormData(); fd.append('photo', file); fd.append('caption', caption);
    try{ await API.post(`/inventory/assets/${a.id}/photos`, fd, true); toast('Foto enviada','success'); Views.assetDetail(a.id, el); }catch(e){ showError(e); }
  };
  el.querySelectorAll('.btn-photo-primary').forEach(b=> b.addEventListener('click', async()=>{ try{ await API.post(`/inventory/assets/${a.id}/photos/${b.dataset.id}/primary`); toast('Foto principal definida','success'); Views.assetDetail(a.id, el); }catch(e){ showError(e); }}));
  el.querySelectorAll('.btn-photo-del').forEach(b=> b.addEventListener('click', async()=>{ if(!await confirmDialog({title:'Excluir foto', confirmText:'Excluir', danger:true})) return; try{ await API.del(`/inventory/assets/${a.id}/photos/${b.dataset.id}`); toast('Foto excluída','warning'); Views.assetDetail(a.id, el); }catch(e){ showError(e); }}));
  el.querySelectorAll('.photo-item').forEach(img=> img.addEventListener('click', ()=> window.open(img.src, '_blank')));
};

Views.agents = async function agents(el){
  el.innerHTML = `<h4 class="mb-3"><i class="bi bi-cpu me-2"></i> Agentes Orcim</h4><div class="card panel-card"><div class="table-responsive"><table class="table table-hover mb-0"><thead><tr><th>Agent ID</th><th>Ativo</th><th>Entidade</th><th>Versão</th><th>Status</th><th>Último contato</th></tr></thead><tbody id="agents-body">${spinner()}</tbody></table></div></div>`;
  try{
    const agents = await API.get('/inventory/agents');
    document.getElementById('agents-body').innerHTML = agents.length ? agents.map(a=>`
      <tr>
        <td><code class="small">${esc(a.agent_id.slice(0,16))}…</code></td>
        <td>${a.asset_name ? `<a href="#/inventory/${a.asset_id}">${esc(a.asset_name)}</a>` : '—'}</td>
        <td>${esc(a.entity_name||'')}</td>
        <td>${esc(a.version||'—')}</td>
        <td><span class="badge text-bg-${a.status==='ONLINE'?'success':a.status==='OFFLINE'?'warning':'secondary'}">${a.status}</span></td>
        <td class="small text-muted">${a.last_seen_at ? fmt.timeAgo(a.last_seen_at) : 'nunca'}</td>
      </tr>`).join('') : `<tr><td colspan="6" class="text-center py-4 text-muted">Nenhum agente registrado</td></tr>`;
  }catch(e){ showError(e); }
};
