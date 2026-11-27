// ---------------------------------------------------------------
// Views.manutencao — Itens em manutenção (Equipamentos)
//   Quem vê o inventário do local pede a manutenção de um item (abre um chamado com o item já escolhido).
//   A TI acompanha em etapas: pedida -> retirado pela TI -> em conserto -> pronto, na ORCIM -> a caminho do local -> devolvido.
//   Usuário vê só o seu local; gestor, as empresas dele; a equipe da TI, tudo. API: /api/manutencoes
// ---------------------------------------------------------------
Views.manutencao = async function manutencao(el) {
  const u = API.user || {};
  const preso = Roles.presoAoLocal(u);
  let situacao = 'abertas';
  try { situacao = sessionStorage.getItem('manut_situacao') || 'abertas'; } catch { /* padrão */ }
  const ORDEM = ['pedida', 'retirada', 'em_conserto', 'pronta', 'rota', 'devolvida'];
  const GRUPOS = [
    ['buscar', 'Precisa buscar no local', 'bi-box-arrow-in-down', ['pedida']],
    ['conserto', 'Em conserto', 'bi-wrench-adjustable', ['retirada', 'em_conserto']],
    ['voltar', 'Pronto para voltar ao local', 'bi-signpost-split', ['pronta', 'rota']],
    ['fim', 'Terminadas', 'bi-check2-circle', ['devolvida', 'sem_conserto', 'cancelada']],
  ];
  const quando = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');
  el.innerHTML = `
    ${preso ? `<div class="es-meu-local mb-2"><i class="bi bi-geo-alt-fill"></i><span>${u.location_name ? `Itens em manutenção de <b>${esc(u.location_name)}</b>.` : 'Seu usuário não está ligado a um local. Peça ao gestor para escolher o local no seu cadastro.'}</span></div>` : ''}
    <div class="ro-barra">
      <div class="seg" role="group" aria-label="Quais"><button type="button" data-sit="abertas">Em andamento</button><button type="button" data-sit="todas">Todas</button></div>
      <button type="button" class="btn btn-warning btn-sm ms-auto" id="mt-pedir"><i class="bi bi-tools"></i> Pedir manutenção</button>
    </div>
    <div id="mt-corpo">${spinner()}</div>`;
  const corpo = el.querySelector('#mt-corpo');
  const marcar = () => el.querySelectorAll('[data-sit]').forEach((b) => b.classList.toggle('active', b.dataset.sit === situacao));
  el.querySelectorAll('[data-sit]').forEach((b) => b.addEventListener('click', () => {
    situacao = b.dataset.sit; try { sessionStorage.setItem('manut_situacao', situacao); } catch { /* ok */ }
    marcar(); carregar();
  }));
  marcar();
  el.querySelector('#mt-pedir').addEventListener('click', manutEscolherItem);

  // linha do tempo: as etapas que já aconteceram, com o dia
  const linhaTempo = (m) => {
    const et = m.etapas || {};
    const passos = (['sem_conserto', 'cancelada'].includes(m.status) ? [...ORDEM.filter((s) => et[s]), m.status] : ORDEM);
    return `<div class="mt-tempo">${passos.map((s) => {
      const feito = !!et[s] || s === m.status;
      const [nome, ic] = MANUT_ETAPAS[s] || [s, 'bi-dot'];
      return `<span class="mt-passo ${feito ? 'feito' : ''} ${s === m.status ? 'atual' : ''}"><i class="bi ${ic}"></i><b>${esc(nome)}</b><small>${et[s] ? quando(et[s]) : ''}</small></span>`;
    }).join('<i class="bi bi-chevron-right mt-seta"></i>')}</div>`;
  };

  function cartao(m, podeAtender) {
    const item = { asset_id: m.asset_id, name: m.name, asset_tag: m.asset_tag, type: m.type, status: m.asset_status, controle: m.controle,
      quantity: m.quantity, location_id: m.location_id, location_name: m.location_name, entity_id: m.entity_id, entity_name: m.entity_name };
    const fim = ['devolvida', 'sem_conserto', 'cancelada'].includes(m.status);
    const podeCancelar = !podeAtender && m.status === 'pedida' && String(m.pedido_por) === String(u.id);
    return `<div class="card panel-card mt-card mt-card-${esc(m.status)}" data-id="${m.id}">
      <div class="mt-card-cab">${Item.titulo(item, { manut: false, estado: false })}${manutTag(m.status)}</div>
      <div class="mt-problema"><i class="bi bi-chat-left-text"></i> ${esc(m.problema)}</div>
      <div class="mt-meta">pedido por ${esc(m.pedido_por_name || '—')} em ${quando(m.created_at)}
        ${m.ticket_id ? ` · <a href="#/tickets/${m.ticket_id}">chamado #${m.ticket_id}</a>` : ''}
        ${m.previsao && !fim ? ` · <b>volta prevista: ${quando(`${String(m.previsao).slice(0, 10)}T12:00:00`)}</b>` : ''}</div>
      ${m.solucao ? `<div class="mt-solucao"><i class="bi bi-wrench-adjustable"></i> ${esc(m.solucao)}</div>` : ''}
      ${linhaTempo(m)}
      ${podeAtender && !fim ? `<div class="mt-acoes">
          <label>Etapa<select class="form-select form-select-sm" data-etapa>${Object.entries(MANUT_ETAPAS).map(([k, [n]]) => `<option value="${k}" ${k === m.status ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>Volta prevista<input type="date" class="form-control form-control-sm" data-prev value="${m.previsao ? String(m.previsao).slice(0, 10) : ''}"></label>
        </div>` : ''}
      ${podeCancelar ? '<div class="mt-acoes"><button type="button" class="btn btn-sm btn-outline-danger" data-cancelar>Cancelar o pedido</button></div>' : ''}
    </div>`;
  }

  async function carregar() {
    corpo.innerHTML = spinner();
    let d;
    try { d = await API.get(`/manutencoes?situacao=${situacao}`); } catch (e) { corpo.innerHTML = emptyState('Não foi possível carregar', e.message, 'bi-exclamation-triangle'); return; }
    if (!d.itens.length) {
      corpo.innerHTML = emptyState(situacao === 'abertas' ? 'Nenhum item em manutenção' : 'Nenhuma manutenção ainda',
        'Para pedir o conserto de um item, clique em "Pedir manutenção" ou abra a ficha do item no inventário.', 'bi-tools');
      return;
    }
    corpo.innerHTML = GRUPOS.map(([k, tit, ic, sts]) => {
      const lista = d.itens.filter((m) => sts.includes(m.status));
      if (!lista.length) return '';
      return `<section class="ro-sec"><h6 class="ro-sec-tit"><i class="bi ${ic}"></i> ${tit} <small>${lista.length}</small></h6>
        <div class="mt-grade">${lista.map((m) => cartao(m, d.pode_atender)).join('')}</div></section>`;
    }).join('');
    const salvar = async (id, corpoReq) => {
      try { await API.request('PATCH', `/manutencoes/${id}`, corpoReq); toast('Salvo.', 'success'); } catch (e) { showError(e); }
      carregar();
    };
    corpo.querySelectorAll('[data-etapa]').forEach((s) => s.addEventListener('change', async () => {
      const id = s.closest('[data-id]').dataset.id;
      const st = s.value;
      if (['devolvida', 'sem_conserto', 'cancelada'].includes(st)) {
        const sol = await pedirSolucao(st);
        if (sol === null) { carregar(); return; }
        salvar(id, { status: st, solucao: sol });
      } else salvar(id, { status: st });
    }));
    corpo.querySelectorAll('[data-prev]').forEach((i) => i.addEventListener('change', () => salvar(i.closest('[data-id]').dataset.id, { previsao: i.value || null })));
    corpo.querySelectorAll('[data-cancelar]').forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Cancelar o pedido de manutenção', body: 'A TI não vai mais buscar este item.', confirmText: 'Cancelar o pedido', danger: true })) return;
      salvar(b.closest('[data-id]').dataset.id, { status: 'cancelada' });
    }));
  }

  // ao terminar: o que foi feito (fica no histórico de manutenções do item)
  function pedirSolucao(st) {
    return new Promise((resolve) => {
      const m = document.createElement('div');
      m.className = 'modal fade';
      const tit = { devolvida: 'Item devolvido ao local', sem_conserto: 'Item sem conserto', cancelada: 'Cancelar a manutenção' }[st];
      m.innerHTML = `<div class="modal-dialog"><div class="modal-content">
        <div class="modal-header"><h6 class="mb-0"><i class="bi bi-tools me-1"></i> ${tit}</h6><button class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body"><label class="form-label small fw-semibold">${st === 'cancelada' ? 'Por que cancelou? (opcional)' : 'O que foi feito? (fica no histórico do item)'}</label>
          <textarea class="form-control" rows="3" id="mt-sol" placeholder="${st === 'devolvida' ? 'Troquei a fonte e limpei o cooler' : st === 'sem_conserto' ? 'Placa-mãe queimada, não compensa consertar' : ''}"></textarea></div>
        <div class="modal-footer"><button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Voltar</button>
          <button class="btn ${st === 'devolvida' ? 'btn-success' : 'btn-danger'} btn-sm" data-ok>Confirmar</button></div></div></div>`;
      document.body.appendChild(m);
      const bm = new bootstrap.Modal(m);
      let resposta = null;
      m.querySelector('[data-ok]').addEventListener('click', () => { resposta = m.querySelector('#mt-sol').value.trim(); bm.hide(); });
      m.addEventListener('hidden.bs.modal', () => { m.remove(); resolve(resposta); });
      bm.show();
    });
  }

  carregar();
};

// Pedir manutenção: escolhe o item (do inventário que a pessoa vê) e vai para Abrir chamado já com ele
//   (usada também pela Manutenção do modo jogo)
async function manutEscolherItem() {
  let itens = [];
  try { itens = await API.get('/inventory/assets?limit=500'); } catch (e) { showError(e); return; }
  itens = itens.filter((a) => a.entity_id !== null && !['DISPOSED', 'LOST', 'ORDERED'].includes(a.status));
  const m = document.createElement('div');
  m.className = 'modal fade';
  m.innerHTML = `<div class="modal-dialog modal-lg modal-dialog-scrollable"><div class="modal-content">
    <div class="modal-header"><h6 class="mb-0"><i class="bi bi-tools me-1"></i> Qual item precisa de manutenção?</h6><button class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">
      <input class="form-control form-control-sm mb-2" id="mt-busca" placeholder="Buscar pelo nome, etiqueta ou local">
      <div class="mt-escolha" id="mt-lista"></div>
    </div></div></div>`;
  document.body.appendChild(m);
  const bm = new bootstrap.Modal(m);
  m.addEventListener('hidden.bs.modal', () => m.remove());
  const pintar = () => {
    const q = m.querySelector('#mt-busca').value.trim().toLowerCase();
    const lista = itens.filter((a) => !q || `${a.name} ${a.asset_tag || ''} ${a.location_name || ''}`.toLowerCase().includes(q)).slice(0, 200);
    m.querySelector('#mt-lista').innerHTML = lista.length ? lista.map((a) => `<button type="button" class="mt-escolha-it" data-id="${a.id}" data-ent="${a.entity_id}" ${a.manut_status ? 'disabled' : ''}>
        ${Item.titulo(a, { link: false })}${a.manut_status ? '<small class="text-muted">já está em manutenção</small>' : '<i class="bi bi-chevron-right"></i>'}</button>`).join('')
      : '<div class="dp-vazio">Nenhum item encontrado.</div>';
    m.querySelectorAll('.mt-escolha-it:not([disabled])').forEach((b) => b.addEventListener('click', () => {
      bm.hide();
      location.hash = `#/new?entity_id=${b.dataset.ent}&asset_id=${b.dataset.id}&manutencao=1`;
    }));
  };
  m.querySelector('#mt-busca').addEventListener('input', pintar);
  pintar();
  bm.show();
}
window.manutEscolherItem = manutEscolherItem;
