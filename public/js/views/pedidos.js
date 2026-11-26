// ---------------------------------------------------------------
// Equipamentos > Pedidos: chamados com pedido de material, ligados ao inventário
//   Em cada item: preço unitário, posto para onde vai, tipo do equipamento e a situação.
//   Comprado -> cada unidade já entra no inventário ("Comprado - aguardando chegar") com o preço e o posto;
//   Chegou -> "Pronto para entregar"; Entregue -> Estoque de T.I. do posto ou Inventário (operando).
//   Quem abriu o chamado é avisado a cada mudança.
// ---------------------------------------------------------------
const PedidoUI = (() => {
  // pergunta para onde vai quando é entregue
  function perguntarDestino(item) {
    return new Promise((resolve) => {
      const m = document.createElement('div');
      m.className = 'modal fade';
      m.innerHTML = `<div class="modal-dialog modal-sm modal-dialog-centered"><div class="modal-content">
        <div class="modal-header"><h6 class="mb-0"><i class="bi bi-box-arrow-in-down me-1"></i> Entregar: ${esc(item.name)}</h6><button class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="small text-muted mb-2">Para onde vai no ${esc(item.location_name || 'posto')}?</div>
          <div class="es-razoes">
            <label class="es-razao on"><input type="radio" name="pd-dest" value="inventario" checked><span><b><i class="bi bi-hdd-stack"></i> Inventário (em uso)</b><small>Fica "Operando" no posto.</small></span></label>
            <label class="es-razao"><input type="radio" name="pd-dest" value="estoque"><span><b><i class="bi bi-box-seam"></i> Estoque de T.I.</b><small>Fica guardado no estoque do posto.</small></span></label>
            <label class="es-razao"><input type="radio" name="pd-dest" value="nenhum"><span><b><i class="bi bi-recycle"></i> Consumível</b><small>Só marca entregue, sem controlar no inventário (ex.: papel, bobina).</small></span></label>
          </div>
        </div>
        <div class="modal-footer"><button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-success btn-sm" data-ok>Entregar</button></div>
      </div></div>`;
      document.body.appendChild(m);
      const bm = new bootstrap.Modal(m);
      let valor = null;
      m.querySelectorAll('[name="pd-dest"]').forEach((r) => r.addEventListener('change', () => m.querySelectorAll('.es-razao').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked))));
      m.querySelector('[data-ok]').addEventListener('click', () => { valor = m.querySelector('[name="pd-dest"]:checked').value; bm.hide(); });
      m.addEventListener('hidden.bs.modal', () => { m.remove(); resolve(valor); });
      bm.show();
    });
  }

  // linha de um item (Pedidos e chamado). locais = postos da empresa do chamado
  function linhaItem(t, m, { podeMudar, vePreco, locais }) {
    const st = m.status || 'solicitado';
    const total = m.price !== undefined && m.price !== null ? Number(m.price) * Number(m.quantity || 1) : null;
    const localSel = m.location_id || t.location_id || '';
    const ativos = (m.asset_ids || []).filter(Boolean);
    const noInventario = ativos.length ? `<a class="pd-inv" href="#/inventory/${ativos[0]}" title="Ver no inventário"><i class="bi ${st === 'entregue' && m.destino === 'estoque' ? 'bi-box-seam' : 'bi-hdd-stack'}"></i> ${ativos.length} no ${st === 'entregue' && m.destino === 'estoque' ? 'estoque' : 'inventário'}</a>` : '';
    if (!podeMudar) {
      return `<div class="pd-item"><span class="pd-qtd">${m.quantity} ${esc(m.unit || 'un')}</span><span class="pd-nome">${esc(m.name)}
        <small>${m.location_name ? `vai para ${esc(m.location_name)}` : ''}</small></span>${pedidoTag(st)}</div>`;
    }
    const bloqueado = ['entregue', 'cancelado'].includes(st);
    return `<div class="pd-item pd-editavel" data-t="${t.id}" data-mat="${m.id}">
      <span class="pd-qtd">${m.quantity} ${esc(m.unit || 'un')}</span>
      <span class="pd-nome">${esc(m.name)}${noInventario}</span>
      ${vePreco ? `<label class="pd-campo" title="Preço de cada unidade"><span>R$/un</span><input type="number" min="0" step="0.01" class="form-control form-control-sm pd-preco" value="${m.price ?? ''}" placeholder="0,00" ${bloqueado ? 'disabled' : ''}>
        ${total !== null ? `<small class="pd-total">= ${invMoeda(total)}</small>` : ''}</label>` : ''}
      <label class="pd-campo" title="Posto para onde o item vai"><span><i class="bi bi-geo-alt"></i></span><select class="form-select form-select-sm pd-local" ${bloqueado ? 'disabled' : ''}>
        ${(locais || []).map((l) => `<option value="${l.id}" ${String(l.id) === String(localSel) ? 'selected' : ''}>${esc(l.name)}</option>`).join('') || `<option value="">${esc(t.location_name || '—')}</option>`}</select></label>
      <label class="pd-campo" title="Tipo do equipamento no inventário"><span><i class="bi bi-tag"></i></span><select class="form-select form-select-sm pd-tipo" ${bloqueado ? 'disabled' : ''}>
        ${Object.entries(INV_TYPES).map(([k, v]) => `<option value="${k}" ${k === (m.asset_type || 'PERIPHERAL') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <select class="form-select form-select-sm pd-sel pd-${esc(st)}" title="Situação">${Object.entries(PEDIDO_STATUS).map(([k, v]) => `<option value="${k}" ${k === st ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>
    </div>`;
  }

  // liga os campos de uma lista de itens (salva sozinho ao mudar)
  function ligar(raiz, depois) {
    raiz.querySelectorAll('.pd-editavel').forEach((row) => {
      const url = `/tickets/${row.dataset.t}/materials/${row.dataset.mat}`;
      const salvarCampos = async (campos) => {
        try { await API.request('PATCH', url, campos); toast('Salvo.', 'success'); if (depois) depois(); } catch (e) { showError(e); if (depois) depois(); }
      };
      row.querySelector('.pd-preco')?.addEventListener('change', (e) => salvarCampos({ price: e.target.value === '' ? null : e.target.value }));
      row.querySelector('.pd-local')?.addEventListener('change', (e) => salvarCampos({ location_id: e.target.value || null }));
      row.querySelector('.pd-tipo')?.addEventListener('change', (e) => salvarCampos({ asset_type: e.target.value }));
      row.querySelector('.pd-sel')?.addEventListener('change', async (e) => {
        const status = e.target.value;
        const corpo = { status };
        if (status === 'entregue') {
          const destino = await perguntarDestino({ name: row.querySelector('.pd-nome').childNodes[0].textContent.trim(), location_name: row.querySelector('.pd-local')?.selectedOptions[0]?.textContent });
          if (!destino) { if (depois) depois(); return; }
          corpo.destino = destino;
        }
        const preco = row.querySelector('.pd-preco');
        if (preco && preco.value !== '') corpo.price = preco.value;
        const local = row.querySelector('.pd-local');
        if (local && local.value) corpo.location_id = local.value;
        const tipo = row.querySelector('.pd-tipo');
        if (tipo) corpo.asset_type = tipo.value;
        try {
          await API.post(`${url}/status`, corpo);
          toast(status === 'comprado' ? 'Comprado: já está no inventário como "aguardando chegar".' : status === 'chegou' ? 'Chegou: no inventário como "pronto para entregar".'
            : status === 'entregue' ? 'Entregue.' : 'Situação atualizada.', 'success');
        } catch (err) { showError(err); }
        if (depois) depois();
      });
    });
  }
  return { linhaItem, ligar };
})();
window.PedidoUI = PedidoUI;

Views.pedidos = async function pedidos(el) {
  const user = API.user || {};
  const podeMudar = Roles.can(user, 'inventory.manage') || Roles.can(user, 'ticket.work') || Roles.isMaster(user);
  const vePreco = Roles.can(user, 'inventory.secrets');
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
    ${podeMudar ? `<div class="pd-dica small text-muted mb-2"><i class="bi bi-info-circle"></i> Informe o preço e o posto de cada item. Ao marcar <b>Comprado</b>, ele já entra no inventário
      (aguardando chegar) com o preço; <b>Chegou</b> deixa pronto para entregar; <b>Entregue</b> manda para o inventário ou o Estoque de T.I. do posto. Quem pediu é avisado.</div>` : ''}
    <div class="pd-resumo mb-2" id="pd-resumo"></div>
    <div id="pd-lista">${spinner()}</div>`;
  const selPosto = el.querySelector('#pd-posto');
  let locais = [];
  try {
    locais = await API.get('/locations?active=true');
    selPosto.innerHTML = '<option value="">Todos os locais</option>' + locais.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
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
    const conta = {}; let valor = 0;
    lista.forEach((t) => (t.materiais || []).forEach((m) => {
      conta[m.status] = (conta[m.status] || 0) + 1;
      if (m.price !== undefined && m.price !== null && m.status !== 'cancelado') valor += Number(m.price) * Number(m.quantity || 1);
    }));
    el.querySelector('#pd-resumo').innerHTML = Object.keys(PEDIDO_STATUS).filter((k) => conta[k]).map((k) => `${pedidoTag(k)} <b>${conta[k]}</b>`).join('<span class="mx-1"></span>')
      + (vePreco && valor ? `<span class="ms-auto small">Total dos pedidos: <b>${invMoeda(valor)}</b></span>` : '');
    if (!lista.length) {
      box.innerHTML = emptyState(prefs.situacao === 'pendentes' ? 'Nada para entregar' : 'Nenhum pedido', 'Os pedidos de material abertos nos chamados aparecem aqui.', 'bi-cart-check');
      return;
    }
    box.innerHTML = lista.map((t) => {
      const locaisDaEmpresa = locais.filter((l) => String(l.entity_id) === String(t.entity_id));
      return `
      <div class="card panel-card mb-2 pd-card">
        <div class="pd-cab">
          <a class="pd-num" href="#/tickets/${t.id}">${esc(t.number)}</a>
          <div class="pd-cab-tx"><a href="#/tickets/${t.id}"><b>${esc(t.title)}</b></a>
            <small><span class="pd-posto" title="Posto que pediu (é o destino padrão)"><i class="bi bi-geo-alt-fill"></i> ${esc(t.location_name || 'sem local')}</span> · ${esc(t.requester_name || '—')} · ${esc(fmt.timeAgo(t.created_at))}
              ${t.needed_by ? ` · <span class="text-danger-emphasis">precisa até ${esc(String(t.needed_by).slice(0, 10).split('-').reverse().join('/'))}</span>` : ''}</small></div>
          ${badgeStatus(t.status)}
        </div>
        <div class="pd-itens">${(t.materiais || []).map((m) => PedidoUI.linhaItem(t, m, { podeMudar, vePreco, locais: locaisDaEmpresa })).join('')}</div>
      </div>`;
    }).join('');
    PedidoUI.ligar(box, carregar);
  }
  el.querySelectorAll('[data-sit]').forEach((b) => b.addEventListener('click', () => { prefs.situacao = b.dataset.sit; salvar(); carregar(); }));
  selPosto.addEventListener('change', () => { prefs.posto = selPosto.value; salvar(); carregar(); });
  let espera = null;
  el.querySelector('#pd-q').addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(carregar, 300); });
  carregar();
};

// ---------------------------------------------------------------
// Views.meusPedidos — Meus pedidos: os materiais que eu pedi e onde cada um está
//   Pedido -> A caminho (comprado) -> Chegou -> Entregue (ou Cancelado)
//   O sininho marca os pedidos que mudaram desde a última vez que vi.
// ---------------------------------------------------------------
Views.meusPedidos = async function meusPedidos(el) {
  const ETAPAS = [
    ['solicitado', 'Pedido', 'bi-hourglass-split'],
    ['comprado', 'A caminho', 'bi-truck'],
    ['chegou', 'Chegou', 'bi-box-seam'],
    ['entregue', 'Entregue', 'bi-check2-circle'],
  ];
  const FRASE = {
    solicitado: 'Pedido recebido pela TI. Aguardando compra.',
    comprado: 'Comprado: está a caminho.',
    chegou: 'Chegou na TI. Logo vai ser entregue.',
    entregue: 'Entregue.',
    cancelado: 'Este item foi cancelado.',
  };
  let filtro = 'andamento';
  try { filtro = localStorage.getItem('meus_pedidos_filtro') || 'andamento'; } catch { /* padrão */ }
  el.innerHTML = `
    <div class="mp-topo">
      <div class="seg" role="group" aria-label="Mostrar">
        <button type="button" data-f="andamento">Em andamento</button>
        <button type="button" data-f="todos">Todos</button>
      </div>
      <button type="button" class="btn btn-sm btn-outline-secondary d-none" id="mp-vistos"><i class="bi bi-check2-all"></i> Marcar tudo como visto</button>
      <a class="btn btn-sm btn-primary ms-auto" href="#/new"><i class="bi bi-plus-lg"></i> Pedir material</a>
    </div>
    <div id="mp-corpo">${spinner()}</div>`;

  const linhaTempo = (m) => {
    if (m.status === 'cancelado') return `<div class="mp-cancel"><i class="bi bi-x-circle"></i> Cancelado</div>`;
    const atual = Math.max(0, ETAPAS.findIndex(([k]) => k === (m.status || 'solicitado')));
    return `<ol class="mp-tempo" style="--p:${(atual / (ETAPAS.length - 1)) * 100}%">${ETAPAS.map(([k, nome, ic], i) => `
      <li class="${i < atual ? 'feito' : i === atual ? 'agora' : ''}"><span class="mp-bola"><i class="bi ${ic}"></i></span><small>${nome}</small></li>`).join('')}</ol>`;
  };

  let lista = [];
  function desenhar() {
    el.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('active', b.dataset.f === filtro));
    const corpo = el.querySelector('#mp-corpo');
    const andamento = (p) => (p.materiais || []).some((m) => !['entregue', 'cancelado'].includes(m.status || 'solicitado'));
    const ver = lista.filter((p) => filtro === 'todos' || andamento(p) || window.pedidoTemNovidade?.(p.id));
    el.querySelector('#mp-vistos').classList.toggle('d-none', !lista.some((p) => window.pedidoTemNovidade?.(p.id)));
    if (!ver.length) {
      corpo.innerHTML = emptyState(lista.length ? 'Nenhum pedido em andamento' : 'Você ainda não pediu material',
        lista.length ? 'Todos os seus pedidos já foram entregues. Veja em "Todos".' : 'Abra um chamado de pedido de material para pedir mouse, teclado, cabo, toner...', 'bi-bag');
      return;
    }
    corpo.innerHTML = ver.map((p) => {
      const ms = p.materiais || [];
      const entregues = ms.filter((m) => m.status === 'entregue').length;
      const ativos = ms.filter((m) => m.status !== 'cancelado').length;
      return `<div class="card panel-card mp-card ${window.pedidoTemNovidade?.(p.id) ? 'novo' : ''}" data-id="${p.id}">
        <div class="mp-cab">
          <span class="knovo ${window.pedidoTemNovidade?.(p.id) ? '' : 'd-none'}" data-pd-novidade="${p.id}" title="Mudou desde a última vez que você viu"><i class="bi bi-bell-fill"></i></span>
          <a class="mp-tit" href="#/tickets/${p.id}"><b>${esc(p.number)}</b> ${esc(p.title)}</a>
          <span class="mp-meta">${p.location_name ? `<i class="bi bi-geo-alt"></i> ${esc(p.location_name)} · ` : ''}pedido em ${fmt.date(p.created_at)}${p.assigned_name ? ` · com ${esc(p.assigned_name)}` : ''}</span>
          <span class="mp-conta ${ativos && entregues === ativos ? 'ok' : ''}">${entregues}/${ativos} entregue(s)</span>
        </div>
        <div class="mp-itens">${ms.map((m) => `
          <div class="mp-item">
            <div class="mp-item-tx"><b>${esc(m.name)}</b> <span class="tg tg-teal">${m.quantity} ${esc(m.unit || 'un')}</span>
              <small class="text-muted d-block">${esc(FRASE[m.status || 'solicitado'] || '')}${m.status_at && m.status && m.status !== 'solicitado' ? ` · ${fmt.timeAgo(m.status_at)}` : ''}${m.location_name && m.status !== 'cancelado' ? ` · vai para ${esc(m.location_name)}` : ''}</small></div>
            ${linhaTempo(m)}
          </div>`).join('')}</div>
      </div>`;
    }).join('');
  }

  async function carregar() {
    try { lista = await API.get('/pedidos/meus'); } catch (e) { el.querySelector('#mp-corpo').innerHTML = emptyState('Não foi possível carregar', e.message, 'bi-exclamation-triangle'); return; }
    desenhar();
  }
  el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
    filtro = b.dataset.f; try { localStorage.setItem('meus_pedidos_filtro', filtro); } catch { /* sem armazenamento */ }
    desenhar();
  }));
  // abrir o chamado do pedido marca a novidade como vista
  el.querySelector('#mp-corpo').addEventListener('click', (e) => {
    const a = e.target.closest('.mp-tit');
    if (a) API.post('/notifications/read', { pedidos: true, ticket_id: a.closest('.mp-card').dataset.id }).then(() => window.recarregarSino && window.recarregarSino()).catch(() => {});
  });
  el.querySelector('#mp-vistos').addEventListener('click', async () => {
    try { await API.post('/notifications/read', { pedidos: true }); if (window.recarregarSino) await window.recarregarSino(); desenhar(); } catch (e) { showError(e); }
  });
  // chegou aviso novo: atualiza a lista
  const aoMudar = () => { if (!document.body.contains(el.querySelector('#mp-corpo'))) { document.removeEventListener('novidades-pedidos', aoMudar); return; } carregar(); };
  document.addEventListener('novidades-pedidos', aoMudar);
  carregar();
};
