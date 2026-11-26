// ---------------------------------------------------------------
// Equipamentos > Pedidos: chamados com pedido de material e a situação de cada item
//   pedido -> comprado -> chegou -> entregue (ou cancelado). Quem atende muda aqui mesmo.
// ---------------------------------------------------------------
Views.pedidos = async function pedidos(el) {
  const user = API.user || {};
  const podeMudar = Roles.can(user, 'inventory.manage') || Roles.can(user, 'ticket.work') || Roles.isMaster(user);
  let prefs = { situacao: 'pendentes', posto: '' };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('pedidos_prefs') || '{}') }; } catch { /* padrão */ }
  const salvar = () => { try { localStorage.setItem('pedidos_prefs', JSON.stringify(prefs)); } catch { /* sem armazenamento */ } };
  el.innerHTML = `
    <div class="card panel-card mb-3"><div class="card-body py-2 iv-filtros">
      <div class="seg" role="group">
        <button type="button" data-sit="pendentes">Falta entregar</button>
        <button type="button" data-sit="todos">Todos</button>
      </div>
      <select class="form-select form-select-sm" id="pd-posto"><option value="">Todos os locais</option></select>
      <div class="iv-busca"><i class="bi bi-search"></i><input class="form-control form-control-sm" id="pd-q" placeholder="Buscar material ou chamado"></div>
    </div></div>
    <div class="pd-resumo mb-2" id="pd-resumo"></div>
    <div id="pd-lista">${spinner()}</div>`;
  const selPosto = el.querySelector('#pd-posto');
  try {
    const locs = await API.get('/locations?active=true');
    selPosto.innerHTML = '<option value="">Todos os locais</option>' + locs.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
    selPosto.value = prefs.posto;
  } catch { /* sem filtro */ }

  async function carregar() {
    el.querySelectorAll('[data-sit]').forEach((b) => b.classList.toggle('active', b.dataset.sit === prefs.situacao));
    const p = new URLSearchParams({ situacao: prefs.situacao });
    if (prefs.posto) p.set('location_id', prefs.posto);
    const q = el.querySelector('#pd-q').value.trim(); if (q) p.set('q', q);
    const box = el.querySelector('#pd-lista');
    let lista;
    try { lista = await API.get(`/pedidos?${p}`); } catch (e) { box.innerHTML = emptyState('Não foi possível carregar', e.message, 'bi-exclamation-triangle'); return; }
    const conta = {};
    lista.forEach((t) => (t.materiais || []).forEach((m) => { conta[m.status] = (conta[m.status] || 0) + 1; }));
    el.querySelector('#pd-resumo').innerHTML = Object.keys(PEDIDO_STATUS).filter((k) => conta[k]).map((k) => `${pedidoTag(k)} <b>${conta[k]}</b>`).join('<span class="mx-1"></span>');
    if (!lista.length) {
      box.innerHTML = emptyState(prefs.situacao === 'pendentes' ? 'Nada para entregar' : 'Nenhum pedido', 'Os pedidos de material abertos nos chamados aparecem aqui.', 'bi-cart-check');
      return;
    }
    box.innerHTML = lista.map((t) => `
      <div class="card panel-card mb-2 pd-card">
        <div class="pd-cab">
          <a class="pd-num" href="#/tickets/${t.id}">${esc(t.number)}</a>
          <div class="pd-cab-tx"><a href="#/tickets/${t.id}"><b>${esc(t.title)}</b></a>
            <small><i class="bi bi-geo-alt"></i> ${esc(t.location_name || 'sem local')} · ${esc(t.requester_name || '—')} · ${esc(fmt.timeAgo(t.created_at))}
              ${t.needed_by ? ` · <span class="text-danger-emphasis">precisa até ${esc(String(t.needed_by).slice(0, 10).split('-').reverse().join('/'))}</span>` : ''}</small></div>
          ${badgeStatus(t.status)}
        </div>
        <div class="pd-itens">${(t.materiais || []).map((m) => `
          <div class="pd-item">
            <span class="pd-qtd">${m.quantity} ${esc(m.unit || 'un')}</span>
            <span class="pd-nome">${esc(m.name)}</span>
            ${m.destino ? `<span class="tg tg-gray" title="Para onde foi"><i class="bi ${m.destino === 'estoque' ? 'bi-box-seam' : 'bi-hdd-stack'}"></i> ${m.destino === 'estoque' ? 'Estoque de T.I.' : 'Inventário'}</span>` : ''}
            ${podeMudar
    ? `<select class="form-select form-select-sm pd-sel pd-${esc(m.status)}" data-t="${t.id}" data-mat="${m.id}">${Object.entries(PEDIDO_STATUS).map(([k, v]) => `<option value="${k}" ${k === m.status ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>`
    : pedidoTag(m.status)}
          </div>`).join('')}</div>
      </div>`).join('');
    box.querySelectorAll('.pd-sel').forEach((s) => s.addEventListener('change', async () => {
      try { await API.post(`/tickets/${s.dataset.t}/materials/${s.dataset.mat}/status`, { status: s.value }); toast('Situação atualizada.', 'success'); carregar(); }
      catch (e) { showError(e); carregar(); }
    }));
  }
  el.querySelectorAll('[data-sit]').forEach((b) => b.addEventListener('click', () => { prefs.situacao = b.dataset.sit; salvar(); carregar(); }));
  selPosto.addEventListener('change', () => { prefs.posto = selPosto.value; salvar(); carregar(); });
  let espera = null;
  el.querySelector('#pd-q').addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(carregar, 300); });
  carregar();
};
