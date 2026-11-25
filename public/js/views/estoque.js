// ---------------------------------------------------------------
// Estoque de T.I. (itens do inventário guardados no estoque de cada posto)
//   - quem pega um item dá baixa aqui, dizendo o motivo (Categorias e opções > Razões de retirada)
//   - quem cadastra equipamentos devolve ao estoque e transfere de unidade
//   - Movimentações: o log de tudo; Relatório: motivos e custos (gestores e admin mestre)
// ---------------------------------------------------------------
const Estoque = (() => {
  const NO_ESTOQUE = { STOCK: 'Em estoque', READY: 'Pronto para entregar', ORDERED: 'Comprado - aguardando chegar' };
  const PODE_PEGAR = ['STOCK', 'READY'];
  const TIPO_MOV = {
    withdraw: ['Baixa (retirada)', 'mv-saida', 'bi-box-arrow-up'],
    return: ['Devolução ao estoque', 'mv-volta', 'bi-box-arrow-in-down'],
    transfer: ['Transferência', 'mv-transf', 'bi-arrow-left-right'],
    entry: ['Entrada no estoque', 'mv-entrada', 'bi-box-seam'],
  };
  const u = () => API.user || {};
  const can = (p) => Roles.can(u(), p);
  const dataCurta = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '');
  const tipoNome = (t) => (typeof INV_TYPES !== 'undefined' && INV_TYPES[t]) || t;

  function modal(titulo, corpo, botao, perigo = false) {
    const m = document.createElement('div');
    m.className = 'modal fade';
    m.innerHTML = `<div class="modal-dialog modal-dialog-scrollable"><div class="modal-content">
      <div class="modal-header"><h6 class="mb-0">${titulo}</h6><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">${corpo}</div>
      <div class="modal-footer"><button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
        <button class="btn ${perigo ? 'btn-danger' : 'btn-primary'} btn-sm" data-ok>${botao}</button></div></div></div>`;
    document.body.appendChild(m);
    const bm = new bootstrap.Modal(m);
    m.addEventListener('hidden.bs.modal', () => m.remove());
    bm.show();
    return { m, fechar: () => bm.hide() };
  }
  const cabecalhoItem = (it) => `<div class="es-item-cab"><i class="bi bi-hdd"></i><div><b>${esc(it.name)}</b>
    <small>${esc([it.asset_tag, tipoNome(it.type), it.location_name].filter(Boolean).join(' · '))}</small></div>${invEstado(it.status)}</div>`;
  async function opcoesPostos(entityId, atual) {
    let locs = [];
    try { locs = await API.get(`/locations?entity_id=${entityId}&active=true`); } catch { /* sem lista */ }
    return locs.map((l) => `<option value="${l.id}" ${String(l.id) === String(atual) ? 'selected' : ''}>${esc(l.name)}${l.city ? ` (${esc(l.city)})` : ''}</option>`).join('');
  }

  // ---------- Dar baixa ----------
  async function darBaixa(it, depois) {
    let razoes = [];
    try { razoes = await API.get(`/stock/reasons?entity_id=${it.entity_id}`); } catch (e) { showError(e); return; }
    const postos = await opcoesPostos(it.entity_id, it.location_id);
    const { m, fechar } = modal('Dar baixa: peguei este item', `
      ${cabecalhoItem(it)}
      <label class="form-label small fw-semibold mt-3 mb-1">Por que você está pegando este item? *</label>
      <div class="es-razoes">${razoes.map((r) => `<label class="es-razao"><input type="radio" name="es-razao" value="${r.id}" data-nome="${esc(r.name)}">
        <span><b>${esc(r.name)}</b>${r.description ? `<small>${esc(r.description)}</small>` : ''}</span></label>`).join('')}</div>
      <label class="form-label small fw-semibold mt-3 mb-1">Para onde ele vai?</label>
      <select class="form-select form-select-sm" id="es-destino"><option value="">— fica em ${esc(it.location_name || 'mesmo local')} —</option>${postos}</select>
      <label class="form-label small fw-semibold mt-3 mb-1">Observação <span class="text-muted fw-normal" id="es-obs-dica">(opcional)</span></label>
      <textarea class="form-control form-control-sm" id="es-obs" rows="2" maxlength="1000" placeholder="Ex.: o mouse do caixa 2 parou de funcionar"></textarea>
      <div class="form-text">Fica registrado no histórico do item quem pegou, quando, por quê e para onde foi.</div>`, '<i class="bi bi-box-arrow-up"></i> Dar baixa');
    m.querySelectorAll('[name="es-razao"]').forEach((r) => r.addEventListener('change', () => {
      m.querySelectorAll('.es-razao').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
      const outro = /^outro$/i.test(r.dataset.nome);
      m.querySelector('#es-obs-dica').textContent = outro ? '(obrigatória: explique o motivo)' : '(opcional)';
    }));
    m.querySelector('[data-ok]').addEventListener('click', async () => {
      const r = m.querySelector('[name="es-razao"]:checked');
      if (!r) { toast('Escolha o motivo da retirada.', 'warning'); return; }
      const note = m.querySelector('#es-obs').value.trim();
      if (/^outro$/i.test(r.dataset.nome) && !note) { toast('Explique o motivo na observação.', 'warning'); return; }
      try {
        await API.post(`/stock/${it.id}/withdraw`, { reason_id: r.value, note, location_id: m.querySelector('#es-destino').value || null });
        fechar(); toast(`Baixa registrada: ${it.name}.`, 'success'); if (depois) depois();
      } catch (e) { showError(e); }
    });
  }

  // ---------- Devolver ao estoque ----------
  async function devolver(it, depois) {
    const postos = await opcoesPostos(it.entity_id, it.location_id);
    const { m, fechar } = modal('Devolver ao estoque', `${cabecalhoItem(it)}
      <label class="form-label small fw-semibold mt-3 mb-1">Estoque de qual posto?</label>
      <select class="form-select form-select-sm" id="es-destino"><option value="">— ${esc(it.location_name || 'sem local')} —</option>${postos}</select>
      <label class="form-label small fw-semibold mt-3 mb-1">Observação</label>
      <textarea class="form-control form-control-sm" id="es-obs" rows="2" maxlength="1000" placeholder="Ex.: voltou do conserto, testado"></textarea>`,
    '<i class="bi bi-box-arrow-in-down"></i> Devolver');
    m.querySelector('[data-ok]').addEventListener('click', async () => {
      try {
        await API.post(`/stock/${it.id}/return`, { location_id: m.querySelector('#es-destino').value || null, note: m.querySelector('#es-obs').value.trim() });
        fechar(); toast('Item devolvido ao estoque.', 'success'); if (depois) depois();
      } catch (e) { showError(e); }
    });
  }

  // ---------- Transferir de unidade ----------
  async function transferir(it, depois) {
    let ents = [];
    try { ents = (await API.get('/entities')).filter((e) => e.active); } catch { /* só a própria */ }
    const { m, fechar } = modal('Transferir para outra unidade', `${cabecalhoItem(it)}
      <div class="row g-2 mt-2">
        <div class="col-sm-6 multi-empresa"><label class="form-label small fw-semibold mb-1">Empresa</label>
          <select class="form-select form-select-sm" id="es-ent">${ents.map((e) => `<option value="${e.id}" ${String(e.id) === String(it.entity_id) ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></div>
        <div class="col-sm-6"><label class="form-label small fw-semibold mb-1">Unidade (posto) *</label>
          <select class="form-select form-select-sm" id="es-loc"></select></div>
      </div>
      <label class="form-label small fw-semibold mt-3 mb-1">Observação</label>
      <textarea class="form-control form-control-sm" id="es-obs" rows="2" maxlength="1000" placeholder="Ex.: mandado pelo motorista na terça"></textarea>`,
    '<i class="bi bi-arrow-left-right"></i> Transferir');
    const sel = m.querySelector('#es-loc');
    const carregar = async () => {
      const ent = m.querySelector('#es-ent')?.value || it.entity_id;
      sel.innerHTML = `<option value="">— escolha —</option>${await opcoesPostos(ent, null)}`;
    };
    m.querySelector('#es-ent')?.addEventListener('change', carregar);
    carregar();
    m.querySelector('[data-ok]').addEventListener('click', async () => {
      if (!sel.value) { toast('Escolha a unidade de destino.', 'warning'); return; }
      try {
        await API.post(`/stock/${it.id}/transfer`, { location_id: sel.value, note: m.querySelector('#es-obs').value.trim() });
        fechar(); toast('Item transferido.', 'success'); if (depois) depois();
      } catch (e) { showError(e); }
    });
  }

  // ---------- Página do estoque ----------
  async function pagina(el) {
    let aba = 'itens';
    try { aba = sessionStorage.getItem('estoque_aba') || 'itens'; } catch { /* padrão */ }
    let ents = [];
    try { ents = (await API.get('/entities')).filter((e) => e.active); } catch { /* sem filtro */ }
    el.innerHTML = `
      <div class="card panel-card mb-3"><div class="card-body py-2 es-filtros">
        <select class="form-select form-select-sm multi-empresa" id="es-f-ent"><option value="">Todas as empresas</option>${ents.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>
        <select class="form-select form-select-sm" id="es-f-loc"><option value="">Todos os postos</option></select>
        <select class="form-select form-select-sm" id="es-f-st"><option value="">Todos os estados</option>${Object.entries(NO_ESTOQUE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <input class="form-control form-control-sm" id="es-f-q" placeholder="Buscar item, etiqueta, modelo">
        ${can('inventory.manage') ? '<a class="btn btn-sm btn-primary ms-auto" href="#/inventory" title="Cadastre o item no inventário com o estado Em estoque"><i class="bi bi-plus-lg"></i> Colocar item no estoque</a>' : ''}
      </div></div>
      <ul class="nav nav-tabs mb-3" id="es-abas">
        <li class="nav-item"><a class="nav-link" href="#" data-aba="itens"><i class="bi bi-box-seam"></i> Itens no estoque</a></li>
        <li class="nav-item"><a class="nav-link" href="#" data-aba="log"><i class="bi bi-clock-history"></i> Movimentações (log)</a></li>
      </ul>
      <div id="es-corpo">${spinner()}</div>`;
    const fEnt = el.querySelector('#es-f-ent'); const fLoc = el.querySelector('#es-f-loc');
    const carregarPostos = async () => {
      const qs = fEnt.value ? `entity_id=${fEnt.value}&active=true` : 'active=true';
      let locs = [];
      try { locs = await API.get(`/locations?${qs}`); } catch { /* sem postos */ }
      fLoc.innerHTML = '<option value="">Todos os postos</option>' + locs.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
    };
    const corpo = el.querySelector('#es-corpo');

    async function itens() {
      corpo.innerHTML = spinner();
      const p = new URLSearchParams();
      if (fEnt.value) p.set('entity_id', fEnt.value);
      if (fLoc.value) p.set('location_id', fLoc.value);
      const st = el.querySelector('#es-f-st').value; if (st) p.set('status', st);
      const q = el.querySelector('#es-f-q').value.trim(); if (q) p.set('q', q);
      let lista;
      try { lista = await API.get(`/stock?${p}`); } catch (e) { corpo.innerHTML = emptyState('Não foi possível carregar', e.message, 'bi-exclamation-triangle'); return; }
      if (!lista.length) {
        corpo.innerHTML = emptyState('Nada no estoque', can('inventory.manage')
          ? 'Para colocar um item aqui, cadastre-o no Inventário com o estado "Em estoque" e o posto.' : 'Nenhum item guardado no estoque dos seus postos.', 'bi-box-seam');
        return;
      }
      const grupos = new Map();
      lista.forEach((it) => {
        const k = `${it.entity_id}:${it.location_id || ''}`;
        if (!grupos.has(k)) grupos.set(k, { posto: it.location_name || 'Sem posto definido', empresa: it.entity_name, itens: [] });
        grupos.get(k).itens.push(it);
      });
      const vePreco = lista.some((it) => it.price !== undefined);
      corpo.innerHTML = [...grupos.values()].map((g) => `
        <div class="card panel-card mb-3">
          <div class="dp-bloco-cab"><span><i class="bi bi-geo-alt"></i> ${esc(g.posto)} <small class="text-muted fw-normal multi-empresa">· ${esc(g.empresa)}</small></span>
            <small class="text-muted">${g.itens.length} item(ns)${vePreco ? ` · ${invMoeda(g.itens.reduce((s, i) => s + Number(i.price || 0), 0))}` : ''}</small></div>
          <div class="es-grade">${g.itens.map((it) => `
            <div class="es-card">
              <div class="es-card-cab">${invEstado(it.status)}<span class="es-tipo">${esc(tipoNome(it.type))}</span></div>
              <b class="es-nome">${can('inventory.view') ? `<a href="#/inventory/${it.id}">${esc(it.name)}</a>` : esc(it.name)}</b>
              <small class="text-muted">${esc([it.asset_tag, [it.manufacturer, it.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || '—')}</small>
              ${it.notes ? `<small class="es-obs">${esc(it.notes)}</small>` : ''}
              <div class="es-card-rodape">
                <small class="text-muted">${it.desde ? `no estoque desde ${dataCurta(it.desde)}` : ''}${it.price !== undefined && it.price !== null ? ` · <b>${invMoeda(it.price)}</b>` : ''}</small>
                <span class="d-flex gap-1">
                  ${can('inventory.manage') ? `<button class="btn btn-sm btn-outline-secondary" data-transf="${it.id}" title="Transferir para outra unidade"><i class="bi bi-arrow-left-right"></i></button>` : ''}
                  ${can('stock.withdraw') && PODE_PEGAR.includes(it.status) ? `<button class="btn btn-sm btn-primary" data-baixa="${it.id}"><i class="bi bi-box-arrow-up"></i> Dar baixa</button>` : ''}
                </span>
              </div>
            </div>`).join('')}</div>
        </div>`).join('');
      const achar = (id) => lista.find((x) => String(x.id) === String(id));
      corpo.querySelectorAll('[data-baixa]').forEach((b) => b.addEventListener('click', () => darBaixa(achar(b.dataset.baixa), itens)));
      corpo.querySelectorAll('[data-transf]').forEach((b) => b.addEventListener('click', () => transferir(achar(b.dataset.transf), itens)));
    }

    async function log() {
      corpo.innerHTML = spinner();
      const p = new URLSearchParams();
      if (fEnt.value) p.set('entity_id', fEnt.value);
      let movs;
      try { movs = await API.get(`/stock/movements?${p}`); } catch (e) { corpo.innerHTML = emptyState('Não foi possível carregar', e.message, 'bi-exclamation-triangle'); return; }
      const q = el.querySelector('#es-f-q').value.trim().toLowerCase();
      if (q) movs = movs.filter((m) => `${m.asset_name} ${m.asset_tag || ''} ${m.user_name || ''} ${m.reason_name || ''}`.toLowerCase().includes(q));
      if (fLoc.value) movs = movs.filter((m) => String(m.to_location_id) === fLoc.value || String(m.from_location_id) === fLoc.value);
      const vePreco = movs.some((m) => m.price !== undefined);
      corpo.innerHTML = movs.length ? `<div class="card panel-card"><div class="table-responsive"><table class="table table-sm table-hover align-middle mb-0 es-log">
        <thead><tr><th>Quando</th><th>O que</th><th>Item</th><th>Motivo / observação</th><th>De → para</th><th>Quem</th>${vePreco ? '<th class="text-end">Valor</th>' : ''}</tr></thead>
        <tbody>${movs.map((m) => {
    const [nome, cls, ic] = TIPO_MOV[m.kind] || [m.kind, '', 'bi-dot'];
    return `<tr>
          <td class="small text-nowrap">${fmt.dateTime(m.created_at)}</td>
          <td><span class="mv ${cls}"><i class="bi ${ic}"></i> ${nome}</span></td>
          <td class="small">${can('inventory.view') ? `<a href="#/inventory/${m.asset_id}">${esc(m.asset_name)}</a>` : esc(m.asset_name)}<br><span class="text-muted">${esc(m.asset_tag || '')}</span></td>
          <td class="small">${m.reason_name ? `<b>${esc(m.reason_name)}</b>` : ''}${m.note ? `<br><span class="text-muted">${esc(m.note)}</span>` : ''}</td>
          <td class="small">${esc(m.from_location_name || m.from_entity_name || '—')} → ${esc(m.to_location_name || m.to_entity_name || '—')}</td>
          <td class="small">${esc(m.user_name || '—')}</td>
          ${vePreco ? `<td class="small text-end text-nowrap">${invMoeda(m.price)}</td>` : ''}
        </tr>`;
  }).join('')}</tbody></table></div></div>` : emptyState('Nenhuma movimentação', 'As baixas, devoluções e transferências aparecem aqui.', 'bi-clock-history');
    }

    const render = () => {
      el.querySelectorAll('#es-abas a').forEach((a) => a.classList.toggle('active', a.dataset.aba === aba));
      el.querySelector('#es-f-st').classList.toggle('d-none', aba === 'log');
      return aba === 'log' ? log() : itens();
    };
    el.querySelectorAll('#es-abas a').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault(); aba = a.dataset.aba;
      try { sessionStorage.setItem('estoque_aba', aba); } catch { /* ok */ }
      render();
    }));
    fEnt.addEventListener('change', async () => { await carregarPostos(); render(); });
    fLoc.addEventListener('change', render);
    el.querySelector('#es-f-st').addEventListener('change', render);
    let t = null;
    el.querySelector('#es-f-q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 300); });
    await carregarPostos();
    render();
  }

  // ---------- Relatório ----------
  async function relatorio(el) {
    let dias = 90; let ent = ''; let escopo = 'tudo'; let loc = '';
    let ents = [];
    try { ents = (await API.get('/entities')).filter((e) => e.active); } catch { /* sem filtro */ }
    el.innerHTML = `
      <div class="card panel-card mb-3"><div class="card-body py-2 es-filtros">
        <select class="form-select form-select-sm" id="er-dias">
          <option value="30">Últimos 30 dias</option><option value="90" selected>Últimos 90 dias</option>
          <option value="365">Último ano</option><option value="3650">Tudo</option></select>
        <select class="form-select form-select-sm multi-empresa" id="er-ent"><option value="">Todas as empresas</option>${ents.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>
        <div class="seg" role="group" aria-label="O que entra no relatório">
          <button type="button" data-escopo="tudo" class="active">Todo o inventário</button>
          <button type="button" data-escopo="estoque">Só o estoque de T.I.</button>
        </div>
        <select class="form-select form-select-sm" id="er-loc"><option value="">Todas as localidades</option></select>
      </div></div>
      <div id="er-corpo">${spinner()}</div>`;
    const barra = (v, max) => `<span class="ur-barra er-barra"><i style="--w:${max ? Math.max(3, Math.round((v / max) * 100)) : 0}%"></i></span>`;
    // "?" no canto do card: explica o número ao passar o mouse (ou ao tocar, no celular)
    const ajuda = (texto) => `<span class="er-ajuda" tabindex="0" aria-label="${esc(texto)}"><i class="bi bi-question-circle"></i><span class="er-ajuda-tx" role="tooltip">${esc(texto)}</span></span>`;
    async function carregar() {
      const corpo = el.querySelector('#er-corpo');
      corpo.innerHTML = spinner();
      let r;
      try { r = await API.get(`/stock/report?dias=${dias}${ent ? `&entity_id=${ent}` : ''}&escopo=${escopo}${loc ? `&location_id=${loc}` : ''}`); } catch (e) { corpo.innerHTML = emptyState('Não foi possível carregar', e.message, 'bi-exclamation-triangle'); return; }
      const v = r.ve_valores;
      const maxMot = Math.max(0, ...r.por_motivo.map((x) => (v ? x.custo : x.n)));
      const maxMes = Math.max(0, ...r.por_mes.map((x) => x.n));
      const maxCat = Math.max(0, ...r.por_categoria.map((x) => (v ? x.valor : x.n)));
      const periodo = dias >= 3650 ? 'desde o início' : `nos últimos ${dias} dias`;
      corpo.innerHTML = `
        <div class="er-kpis">
          ${v ? `<div class="er-kpi"><span class="er-ico verde" aria-hidden="true"><i class="bi ${r.escopo === 'estoque' ? 'bi-box-seam' : 'bi-cash-coin'}"></i></span>${ajuda(r.escopo === 'estoque'
    ? 'Soma do preço dos itens guardados no estoque de T.I. (em estoque, prontos para entregar e comprados que ainda não chegaram). Itens sem preço cadastrado não entram na soma.'
    : 'Soma do preço de todos os equipamentos cadastrados, menos os descartados e extraviados. Itens sem preço cadastrado não entram na soma: o texto embaixo mostra quantos têm preço.')}<small>${r.escopo === 'estoque' ? 'Valor do estoque de T.I.' : 'Valor do inventário'}</small><b>${invMoeda(r.inventario.valor)}</b><span>${r.inventario.com_preco} de ${r.inventario.itens} itens com preço</span></div>` : ''}
          <div class="er-kpi"><span class="er-ico azul" aria-hidden="true"><i class="bi ${r.escopo === 'estoque' ? 'bi-boxes' : 'bi-pc-display-horizontal'}"></i></span>${ajuda(r.escopo === 'estoque'
    ? 'Quantos itens estão no estoque de T.I. agora: em estoque, prontos para entregar e comprados que ainda não chegaram.'
    : 'Quantos equipamentos estão cadastrados agora, de todas as categorias e estados, menos os descartados e extraviados.')}<small>${r.escopo === 'estoque' ? 'Itens no estoque de T.I.' : 'Equipamentos no inventário'}</small><b>${r.inventario.itens}</b><span>${r.escopo === 'estoque' ? 'em estoque, prontos ou a caminho' : 'sem os descartados e extraviados'}</span></div>
          <div class="er-kpi"><span class="er-ico ambar" aria-hidden="true"><i class="bi bi-box-arrow-up"></i></span>${ajuda('Quantas vezes alguém deu baixa (pegou um item) no estoque de T.I. no período escolhido. Cada baixa tem um motivo, que aparece em "Retiradas por motivo".')}<small>Retiradas do estoque</small><b>${r.totais.retiradas}</b><span>${periodo}</span></div>
          ${v ? `<div class="er-kpi destaque"><span class="er-ico vermelho" aria-hidden="true"><i class="bi bi-receipt-cutoff"></i></span>${ajuda('Soma do preço dos itens que saíram do estoque no período: é quanto em equipamento foi usado para substituir, repor ou atender pedidos. Veja em "Retiradas por motivo" e "por posto" para onde esse dinheiro está indo.')}<small>Custo das retiradas</small><b>${invMoeda(r.totais.custo_retiradas)}</b><span>${periodo}</span></div>` : ''}
          <div class="er-kpi"><span class="er-ico violeta" aria-hidden="true"><i class="bi bi-arrow-left-right"></i></span>${ajuda('Transferências: itens mandados de uma unidade para outra. Entradas: itens que entraram no estoque (cadastrados como "Em estoque" ou devolvidos depois de usados).')}<small>Transferências / entradas</small><b>${r.totais.transferencias} / ${r.totais.entradas}</b><span>${periodo}</span></div>
        </div>
        <div class="er-grade">
          <div class="card panel-card"><div class="dp-bloco-cab"><span><i class="bi bi-signpost-2"></i> Retiradas por motivo ${ajuda('Por que as pessoas pegaram itens do estoque: o motivo escolhido ao dar baixa. A barra mostra o peso de cada motivo (pelo custo, quando há preço). Muitas retiradas por "estragou" ou "mau uso" num posto indicam equipamento velho ou falta de treinamento.')}</span><small class="text-muted">${periodo}</small></div>
            ${r.por_motivo.length ? `<table class="table table-sm align-middle mb-0 er-tab"><thead><tr><th>Motivo</th><th></th><th class="text-end">Retiradas</th>${v ? '<th class="text-end">Custo</th>' : ''}</tr></thead><tbody>
            ${r.por_motivo.map((x) => `<tr><td>${esc(x.motivo)}</td><td class="w-25">${barra(v ? x.custo : x.n, maxMot)}</td><td class="text-end">${x.n}</td>${v ? `<td class="text-end text-nowrap">${invMoeda(x.custo)}</td>` : ''}</tr>`).join('')}
            </tbody></table>` : '<div class="dp-vazio">Nenhuma retirada no período.</div>'}</div>
          <div class="card panel-card"><div class="dp-bloco-cab"><span><i class="bi bi-calendar3"></i> Retiradas por mês ${ajuda('Quantas retiradas houve em cada mês do período. Passe o mouse na coluna para ver o custo daquele mês.')}</span></div>
            ${r.por_mes.length ? `<div class="er-meses">${r.por_mes.map((x) => `<div class="er-mes" title="${x.n} retirada(s)${v ? ` · ${invMoeda(x.custo)}` : ''}">
              <span class="er-col"><i style="--h:${maxMes ? Math.max(4, Math.round((x.n / maxMes) * 100)) : 0}%"></i></span>
              <b>${x.n}</b><small>${x.mes.slice(5)}/${x.mes.slice(2, 4)}</small></div>`).join('')}</div>` : '<div class="dp-vazio">Nenhuma retirada no período.</div>'}</div>
          <div class="card panel-card"><div class="dp-bloco-cab"><span><i class="bi bi-diagram-3"></i> Equipamentos por categoria ${ajuda('Situação de hoje: quantos equipamentos há de cada categoria, quantos estão guardados no estoque e quanto valem somados.')}</span><small class="text-muted">hoje</small></div>
            ${r.por_categoria.length ? `<table class="table table-sm align-middle mb-0 er-tab"><thead><tr><th>Categoria</th><th></th><th class="text-end">Itens</th><th class="text-end">No estoque</th>${v ? '<th class="text-end">Valor</th>' : ''}</tr></thead><tbody>
            ${r.por_categoria.map((x) => `<tr><td>${esc(tipoNome(x.type))}</td><td class="w-25">${barra(v ? x.valor : x.n, maxCat)}</td><td class="text-end">${x.n}</td><td class="text-end">${x.em_estoque}</td>${v ? `<td class="text-end text-nowrap">${invMoeda(x.valor)}</td>` : ''}</tr>`).join('')}
            </tbody></table>` : '<div class="dp-vazio">Nenhum equipamento cadastrado.</div>'}</div>
          <div class="card panel-card"><div class="dp-bloco-cab"><span><i class="bi bi-geo-alt"></i> Retiradas por posto ${ajuda('Para qual localidade foram os itens retirados e quanto custaram. Um posto com muitas retiradas pode ter equipamento velho, mau uso ou precisar de treinamento.')}</span><small class="text-muted">${periodo}</small></div>
            ${r.por_posto.length ? `<table class="table table-sm align-middle mb-0 er-tab"><thead><tr><th>Posto</th><th class="text-end">Retiradas</th>${v ? '<th class="text-end">Custo</th>' : ''}</tr></thead><tbody>
            ${r.por_posto.map((x) => `<tr><td>${esc(x.posto)}<small class="text-muted multi-empresa"> · ${esc(x.empresa || '')}</small></td><td class="text-end">${x.n}</td>${v ? `<td class="text-end text-nowrap">${invMoeda(x.custo)}</td>` : ''}</tr>`).join('')}
            </tbody></table>` : '<div class="dp-vazio">Nenhuma retirada no período.</div>'}</div>
        </div>
        <div class="card panel-card mt-3"><div class="dp-bloco-cab"><span><i class="bi bi-palette"></i> Equipamentos por estado ${ajuda('Quantos equipamentos estão em cada estado agora (operando, em conserto, estragado, comprado, pronto para entregar, em estoque...) e quanto valem.')}</span><small class="text-muted">hoje</small></div>
          <div class="er-estados">${r.por_status.map((x) => `<span>${invEstado(x.status)} <b>${x.n}</b>${v ? ` <small class="text-muted">${invMoeda(x.valor)}</small>` : ''}</span>`).join('') || '<div class="dp-vazio">—</div>'}</div></div>
        <div class="card panel-card mt-3"><div class="dp-bloco-cab"><span><i class="bi bi-clock-history"></i> Últimas movimentações ${ajuda('As últimas baixas, devoluções, transferências e entradas do período, com quem fez e para onde foi. O log completo fica em Estoque de T.I. > Movimentações.')}</span><a href="#/estoque" onclick="try{sessionStorage.setItem('estoque_aba','log')}catch(e){}">ver todas</a></div>
          ${r.recentes.length ? `<div class="er-recentes">${r.recentes.map((m) => {
    const [nome, cls, ic] = TIPO_MOV[m.kind] || [m.kind, '', 'bi-dot'];
    return `<div><span class="mv ${cls}"><i class="bi ${ic}"></i> ${nome}</span>
            <span class="er-rec-tx"><b>${esc(m.asset_name)}</b> <small class="text-muted">${esc(m.asset_tag || '')}</small><br>
            <small>${esc(m.user_name || '—')} · ${esc(m.to_location_name || m.from_location_name || '')}${m.reason_name ? ` · ${esc(m.reason_name)}` : ''}</small></span>
            <small class="text-muted text-nowrap">${fmt.timeAgo(m.created_at)}${m.price !== undefined && m.price !== null ? `<br><b>${invMoeda(m.price)}</b>` : ''}</small></div>`;
  }).join('')}</div>` : '<div class="dp-vazio">Nenhuma movimentação no período.</div>'}</div>`;
    }
    el.querySelector('#er-dias').addEventListener('change', (e) => { dias = Number(e.target.value); carregar(); });
    // localidades (postos) da empresa escolhida
    const selLoc = el.querySelector('#er-loc');
    const carregarLocais = async () => {
      let locs = [];
      try { locs = await API.get(`/locations?active=true${ent ? `&entity_id=${ent}` : ''}`); } catch { /* sem lista */ }
      selLoc.innerHTML = '<option value="">Todas as localidades</option>' + locs.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
      loc = '';
    };
    el.querySelector('#er-ent').addEventListener('change', async (e) => { ent = e.target.value; await carregarLocais(); carregar(); });
    selLoc.addEventListener('change', () => { loc = selLoc.value; carregar(); });
    el.querySelectorAll('[data-escopo]').forEach((b) => b.addEventListener('click', () => {
      escopo = b.dataset.escopo;
      el.querySelectorAll('[data-escopo]').forEach((x) => x.classList.toggle('active', x === b));
      carregar();
    }));
    await carregarLocais();
    carregar();
  }

  return { pagina, relatorio, darBaixa, devolver, transferir };
})();

Views.estoque = (el) => Estoque.pagina(el);
Views.estoqueRelatorio = (el) => Estoque.relatorio(el);
window.Estoque = Estoque;
