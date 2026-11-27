// ---------------------------------------------------------------
// Modo jogo (teste): as telas de Equipamentos em estilo videogame. As telas antigas continuam.
//   #/inventario-teste            Inventário (inventarioTeste.js)
//   #/inventario-teste/pedidos    Pedidos: quadro de missões de entrega (uma coluna por etapa)
//   #/inventario-teste/manutencao Manutenção: a oficina (uma coluna por etapa do conserto)
//   #/inventario-teste/relatorio  Relatório: tela de status (placar, barras, categorias)
//   Arrastar um item para outra coluna faz a ação de verdade (as mesmas das telas antigas, com histórico).
// ---------------------------------------------------------------
const Jogo = (() => {
  const u = () => API.user || {};
  const can = (p) => Roles.can(u(), p);
  const TAM = { p: 44, m: 56, g: 70 };

  // abas do modo jogo (cada uma só para quem pode ver a tela antiga correspondente)
  function abas(atual) {
    const preso = Roles.presoAoLocal(u());
    const lista = [
      ['inventario', '#/inventario-teste', 'bi-controller', 'Inventário', can('inventory.view') || can('stock.withdraw')],
      ['pedidos', '#/inventario-teste/pedidos', 'bi-cart3', 'Pedidos', can('inventory.view') && !preso],
      ['manutencao', '#/inventario-teste/manutencao', 'bi-tools', 'Manutenção', can('inventory.view') || can('stock.withdraw')],
      ['relatorio', '#/inventario-teste/relatorio', 'bi-bar-chart-line', 'Relatório', can('stock.report')],
    ].filter((x) => x[4]);
    return `<nav class="ig-modos" aria-label="Telas do modo jogo">${lista.map(([k, href, ic, nome]) => `<a href="${href}" class="${k === atual ? 'on' : ''}"><i class="bi ${ic}"></i> ${nome}</a>`).join('')}</nav>`;
  }

  // ícone pelo nome do item (teclado, cabo, fone, toner...); se não reconhecer, o da categoria
  const ICONE_NOME = [[/MOUSE/, 'bi-mouse2'], [/TECLAD/, 'bi-keyboard'], [/HEADSET|\bFONE\b|FONES/, 'bi-headset'], [/WEBCAM|CAMERA/, 'bi-webcam'],
    [/CABO|PATCH|\bHDMI\b|\bVGA\b|EXTENSAO|ADAPTADOR/, 'bi-plug'], [/PAPEL|\bA4\b|BOBINA|ETIQUETA/, 'bi-file-earmark-text'], [/TONER|CARTUCHO|TINTA|CILINDRO/, 'bi-droplet-half'],
    [/MONITOR|\bTV\b/, 'bi-display'], [/NOTEBOOK/, 'bi-laptop'], [/CELULAR|SMARTPHONE|TABLET/, 'bi-phone'], [/ROTEADOR|SWITCH|ACCESS POINT|MODEM/, 'bi-router'],
    [/NOBREAK|ESTABILIZADOR/, 'bi-battery-charging'], [/IMPRESSORA/, 'bi-printer'], [/LEITOR|SCANNER/, 'bi-upc-scan'], [/\bSSD\b|\bHD\b|PENDRIVE|MEMORIA/, 'bi-device-ssd'],
    [/FONTE|CARREGADOR/, 'bi-lightning-charge'], [/CAIXA DE SOM|SOM\b/, 'bi-speaker'], [/MICROFONE/, 'bi-mic'], [/\bPC\b|COMPUTADOR|DESKTOP|CPU/, 'bi-pc-display']];
  const icone = (a) => {
    const n = String(a.name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const achou = ICONE_NOME.find(([re]) => re.test(n));
    return achou ? achou[1] : INV_ICONES[a.type || a.asset_type] || 'bi-box';
  };

  // um quadradinho: { id, icone, raro, qtd, marcas (html), arrasta, sel, nome, extra (atributos) }
  const slot = (o) => `<div class="ig-slot r-${o.raro || 'cz'} ${o.sel ? 'sel' : ''}" data-id="${esc(String(o.id))}" ${o.arrasta ? 'draggable="true"' : ''} tabindex="0" aria-label="${esc(o.nome || '')}" ${o.extra || ''}>
    <i class="bi ${o.icone} ig-ico"></i>${o.marcas || ''}${o.qtd !== undefined && o.qtd !== null ? `<b class="ig-qtd ${Number(o.qtd) > 0 ? '' : 'zero'}">${o.qtd}</b>` : ''}</div>`;

  // completa as grades com quadrados vazios (cara de inventário de jogo)
  function completar(raiz, minLinhas = 3) {
    raiz.querySelectorAll('.ig-grade').forEach((g) => {
      g.querySelectorAll('.ig-slot.vazio').forEach((s) => s.remove());
      const cols = Math.max(1, getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length);
      const n = g.querySelectorAll('.ig-slot').length;
      const linhas = Math.max(Number(g.dataset.min || minLinhas), Math.ceil(n / cols) + (n % cols === 0 && n ? 1 : 0));
      g.insertAdjacentHTML('beforeend', '<div class="ig-slot vazio"></div>'.repeat(Math.max(0, linhas * cols - n)));
    });
  }
  function aoRedimensionar(raiz, fn) {
    let espera = null;
    const h = () => { if (!document.body.contains(raiz)) { window.removeEventListener('resize', h); return; } clearTimeout(espera); espera = setTimeout(fn, 150); };
    window.addEventListener('resize', h);
  }

  // caixinha de detalhes ao passar o mouse (tooltip de jogo). conteudo(slotEl) -> html ou ''
  function dicas(raiz, conteudo) {
    const tip = document.createElement('div');
    tip.className = 'ig-tip d-none';
    raiz.appendChild(tip);
    raiz.addEventListener('mouseover', (e) => {
      const s = e.target.closest('.ig-slot:not(.vazio)');
      if (!s) return;
      const html = conteudo(s);
      if (!html) return;
      tip.innerHTML = html; tip.classList.remove('d-none');
    });
    raiz.addEventListener('mousemove', (e) => {
      if (tip.classList.contains('d-none')) return;
      const x = Math.min(e.clientX + 16, window.innerWidth - tip.offsetWidth - 8);
      const y = e.clientY + 18 + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 18;
      tip.style.left = `${x}px`; tip.style.top = `${y}px`;
    });
    raiz.addEventListener('mouseout', (e) => { if (e.target.closest('.ig-slot') && !e.relatedTarget?.closest?.('.ig-slot')) tip.classList.add('d-none'); });
    raiz.addEventListener('dragstart', () => tip.classList.add('d-none'));
    return tip;
  }

  // arrastar entre colunas: aceita(origemEl, alvoEl) e soltar(origemEl, alvoEl)
  function arrastar(raiz, { alvos, aceita, soltar }) {
    let de = null;
    raiz.addEventListener('dragstart', (e) => {
      const s = e.target.closest('.ig-slot[draggable="true"]');
      if (!s) return;
      de = s; e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', s.dataset.id); } catch { /* ok */ }
      raiz.classList.add('ig-arrastando'); s.classList.add('ig-pegando');
    });
    raiz.addEventListener('dragend', () => {
      de = null; raiz.classList.remove('ig-arrastando');
      raiz.querySelectorAll('.ig-pegando, .ig-alvo').forEach((x) => x.classList.remove('ig-pegando', 'ig-alvo'));
    });
    raiz.addEventListener('dragover', (e) => {
      const alvo = e.target.closest(alvos);
      if (!de || !alvo || !aceita(de, alvo)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      raiz.querySelectorAll('.ig-alvo').forEach((x) => { if (x !== alvo) x.classList.remove('ig-alvo'); });
      alvo.classList.add('ig-alvo');
    });
    raiz.addEventListener('dragleave', (e) => {
      const alvo = e.target.closest(alvos);
      if (alvo && !alvo.contains(e.relatedTarget)) alvo.classList.remove('ig-alvo');
    });
    raiz.addEventListener('drop', async (e) => {
      const alvo = e.target.closest(alvos);
      if (!de || !alvo || !aceita(de, alvo)) return;
      e.preventDefault(); alvo.classList.remove('ig-alvo');
      const origem = de;
      try { await soltar(origem, alvo); } catch (err) { showError(err); }
    });
  }

  // filtros: tamanho dos quadrados (P/M/G), guardado por tela
  const tamanho = (chave) => { try { return localStorage.getItem(`jogo_tam_${chave}`) || 'm'; } catch { return 'm'; } };
  const botoesTamanho = (atual) => `<span class="ig-tam" role="group" aria-label="Tamanho dos quadrados">${['p', 'm', 'g'].map((t) => `<button type="button" data-tam="${t}" class="${atual === t ? 'on' : ''}">${t.toUpperCase()}</button>`).join('')}</span>`;
  function ligarTamanho(raiz, chave, depois) {
    raiz.querySelectorAll('[data-tam]').forEach((b) => b.addEventListener('click', () => {
      try { localStorage.setItem(`jogo_tam_${chave}`, b.dataset.tam); } catch { /* ok */ }
      raiz.style.setProperty('--slot', `${TAM[b.dataset.tam]}px`);
      raiz.querySelectorAll('[data-tam]').forEach((x) => x.classList.toggle('on', x === b));
      if (depois) depois();
    }));
  }
  const hoje = () => new Date().toLocaleDateString('sv-SE');
  const dia = (d) => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}` : '');

  // lista da esquerda (locais) com contagem; clicar filtra
  const listaLocais = (itens, sel, total) => `<button type="button" class="ig-loc ${!sel ? 'sel' : ''}" data-filtro-loc=""><i class="bi bi-grid-3x3-gap-fill"></i><span class="ig-loc-nome">Todos os locais</span><span class="ig-loc-n"><span>${total}</span></span></button>
    ${itens.map((l) => `<button type="button" class="ig-loc ${String(sel) === String(l.id) ? 'sel' : ''}" data-filtro-loc="${l.id}" title="${esc(l.nome)}"><i class="bi bi-geo-alt-fill"></i><span class="ig-loc-nome">${esc(l.nome)}${l.sub ? `<small>${esc(l.sub)}</small>` : ''}</span>
      <span class="ig-loc-n">${l.fogo ? '<span class="ig-fogo-mini" title="Tem pedido de operação parada"><i class="bi bi-fire"></i></span>' : ''}<span>${l.n}</span></span></button>`).join('')}`;

  return { abas, icone, slot, completar, aoRedimensionar, dicas, arrastar, TAM, tamanho, botoesTamanho, ligarTamanho, hoje, dia, listaLocais };
})();
window.Jogo = Jogo;

// =================================================================
// Pedidos: quadro de missões de entrega
// =================================================================
Views.jogoPedidos = async function jogoPedidos(el) {
  const user = API.user || {};
  const podeMudar = Roles.can(user, 'inventory.manage') || Roles.can(user, 'ticket.work') || Roles.isMaster(user);
  const vePreco = Roles.can(user, 'inventory.secrets');
  const ETAPAS = [
    ['solicitado', 'Pedido', 'bi-hourglass-split', 'sol'], ['comprado', 'Comprado', 'bi-cart-check', 'cmp'], ['chegou', 'Na ORCIM', 'bi-building-check', 'orc'],
    ['rota', 'A caminho', 'bi-signpost-split', 'rot'], ['entregue', 'Entregue', 'bi-check2-circle', 'ok'],
  ];
  const RARO = Object.fromEntries(ETAPAS.map(([k, , , r]) => [k, r]));
  let prefs = { situacao: 'pendentes', q: '', loc: '' };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('jogo_pedidos') || '{}') }; } catch { /* padrão */ }
  const salvar = () => { try { localStorage.setItem('jogo_pedidos', JSON.stringify(prefs)); } catch { /* ok */ } };
  const tam = Jogo.tamanho('pedidos');
  el.innerHTML = `<div class="ig ig-jogo" style="--slot:${Jogo.TAM[tam]}px">
    ${Jogo.abas('pedidos')}
    <section class="ig-painel ig-filtros"><div class="ig-tit"><i class="bi bi-sliders"></i> Filtros</div>
      <div class="ig-filtros-corpo">
        <div class="ig-busca"><i class="bi bi-search"></i><input class="form-control form-control-sm" id="jp-q" placeholder="Buscar material ou chamado" value="${esc(prefs.q)}"></div>
        <span class="ig-tam ig-sit" role="group" aria-label="Quais"><button type="button" data-sit="pendentes">Falta entregar</button><button type="button" data-sit="todos">Todos</button></span>
        ${Jogo.botoesTamanho(tam)}
      </div></section>
    <div class="ig-corpo">
      <aside class="ig-lado"><section class="ig-painel"><div class="ig-tit"><i class="bi bi-geo-alt"></i> Para onde vai</div><div class="ig-lista" id="jp-locais">${spinner()}</div></section></aside>
      <div class="ig-main">
        <div class="ig-cab"><span class="ig-cab-tit">Missões de entrega</span><span class="ig-cab-onde" id="jp-resumo"></span>
          <span class="ig-cab-dica">${podeMudar ? 'Arraste o item para a próxima etapa · clique duplo abre "Atender"' : ''}</span></div>
        <div class="jg-quadro" id="jp-quadro"></div>
        <div class="ig-baixo"><section class="ig-painel ig-det"><div class="ig-tit"><i class="bi bi-hand-index"></i> Item do pedido</div><div id="jp-det" class="ig-det-corpo"><span class="ig-vazio-tx">Clique num item para ver os detalhes.</span></div></section>
          <section class="ig-painel ig-log"><div class="ig-tit"><i class="bi bi-journal-text"></i> Log</div><div id="jp-log" class="ig-log-corpo"><span class="ig-vazio-tx">O que você fizer aqui aparece neste log.</span></div></section></div>
      </div>
    </div></div>`;
  const raiz = el.querySelector('.ig');
  let lista = []; let locais = []; let sel = null; const log = [];
  try { locais = await API.get('/locations?active=true'); } catch { /* sem lista */ }
  // cada item de pedido vira um "quadradinho" (o chamado vem junto)
  const itens = () => lista.flatMap((t) => (t.materiais || []).filter((m) => m.status !== 'cancelado').map((m) => ({ t, m, loc: String(m.location_id || t.location_id || 'sem'), locNome: m.location_name || t.location_name || 'sem local' })));
  const achar = (id) => itens().find((x) => String(x.m.id) === String(id));
  const atrasado = (m) => m.previsao && !['entregue', 'cancelado'].includes(m.status) && String(m.previsao).slice(0, 10) < Jogo.hoje();

  async function carregar() {
    el.querySelectorAll('[data-sit]').forEach((b) => b.classList.toggle('on', b.dataset.sit === prefs.situacao));
    const p = new URLSearchParams({ situacao: prefs.situacao });
    if (prefs.q) p.set('q', prefs.q);
    try { lista = await API.get(`/pedidos?${p}`); } catch (e) { lista = []; showError(e); }
    desenhar();
  }
  function desenhar() {
    const todos = itens();
    // esquerda: postos de destino com quantos itens faltam entregar (e o foguinho da operação parada)
    const porLoc = new Map();
    todos.forEach((x) => {
      if (x.m.status === 'entregue') return;
      if (!porLoc.has(x.loc)) porLoc.set(x.loc, { id: x.loc, nome: x.locNome, n: 0, fogo: false });
      const L = porLoc.get(x.loc); L.n += 1; if (Number(x.t.priority) === 4) L.fogo = true;
    });
    if (prefs.loc && !porLoc.has(prefs.loc) && !todos.some((x) => x.loc === prefs.loc)) prefs.loc = '';
    el.querySelector('#jp-locais').innerHTML = Jogo.listaLocais([...porLoc.values()].sort((a, b) => b.fogo - a.fogo || b.n - a.n), prefs.loc, todos.filter((x) => x.m.status !== 'entregue').length);
    const ver = todos.filter((x) => !prefs.loc || x.loc === prefs.loc);
    el.querySelector('#jp-resumo').innerHTML = `${prefs.loc ? `<i class="bi bi-geo-alt-fill"></i> <b>${esc((porLoc.get(prefs.loc) || {}).nome || '')}</b> · ` : ''}${ver.filter((x) => x.m.status !== 'entregue').length} para entregar`;
    el.querySelector('#jp-quadro').innerHTML = ETAPAS.map(([k, nome, ic, raro]) => {
      const col = ver.filter((x) => x.m.status === k);
      return `<section class="ig-painel jg-col jg-col-${raro}"><div class="ig-tit"><i class="bi ${ic}"></i> ${nome}<span class="ig-tit-n">${col.length}</span></div>
        <div class="ig-grade" data-etapa="${k}" data-min="3">${col.map((x) => Jogo.slot({
          id: x.m.id, nome: x.m.name, icone: Jogo.icone({ name: x.m.name, type: x.m.asset_type }), raro, qtd: Number(x.m.quantity) > 1 ? x.m.quantity : null,
          sel: sel && String(sel) === String(x.m.id), arrasta: podeMudar && !['entregue', 'cancelado'].includes(k),
          marcas: [Number(x.t.priority) === 4 ? '<i class="bi bi-fire ig-m ig-m-fogo" title="Operação parada"></i>' : '',
            atrasado(x.m) ? '<i class="bi bi-alarm ig-m ig-m-man" title="Entrega atrasada"></i>' : '',
            x.m.origem_local ? '<i class="bi bi-house-check ig-m ig-m-pes" title="Saiu do estoque do local"></i>' : x.m.origem_orcim && k !== 'entregue' ? '<i class="bi bi-boxes ig-m ig-m-pes" title="Sai do Estoque da ORCIM"></i>' : ''].join(''),
        })).join('')}</div></section>`;
    }).join('');
    Jogo.completar(raiz);
    detalhe();
  }
  function detalhe() {
    const box = el.querySelector('#jp-det');
    const x = sel && achar(sel);
    if (!x) { box.innerHTML = '<span class="ig-vazio-tx">Clique num item para ver os detalhes.</span>'; return; }
    const { t, m } = x;
    box.innerHTML = `<div class="ig-det-it">${Item.titulo({ name: m.name, type: m.asset_type || 'PERIPHERAL', pedido_status: m.status, pedido_ticket_id: t.id, location_id: x.loc, location_name: x.locNome, entity_id: t.entity_id, asset_id: (m.asset_ids || [])[0] || null }, { estado: false })}</div>
      <div class="ig-det-info">${m.quantity} ${esc(m.unit || 'un')} · chamado <a href="#/tickets/${t.id}">#${t.id}</a> ${esc(t.title)} · pedido por ${esc(t.requester_name || '—')}${m.previsao && m.status !== 'entregue' ? ` · entrega prevista ${Jogo.dia(m.previsao)}` : ''}${vePreco && m.price != null ? ` · ${invMoeda(Number(m.price) * Number(m.quantity || 1))}` : ''}</div>
      <div class="ig-det-bt">${podeMudar && !['entregue', 'cancelado'].includes(m.status) ? '<button type="button" class="btn btn-sm ig-bt" data-atender><i class="bi bi-hand-index-thumb"></i> Atender</button>' : ''}
        <a class="btn btn-sm ig-bt" href="#/tickets/${t.id}"><i class="bi bi-box-arrow-up-right"></i> Abrir o chamado</a></div>`;
    box.querySelector('[data-atender]')?.addEventListener('click', () => atender(x));
  }
  const registrar = (t) => {
    log.unshift(t); if (log.length > 10) log.pop();
    el.querySelector('#jp-log').innerHTML = log.map((l) => `<div class="ig-log-l novo"><span>agora</span><i class="bi bi-stars"></i> ${esc(l)}</div>`).join('');
  };
  const atender = (x) => PedidoUI.atender(x.t, x.m, { vePreco, locais: locais.filter((l) => String(l.entity_id) === String(x.t.entity_id)) }, () => { registrar(`${x.m.name}: atendido`); carregar(); });

  // cliques
  raiz.addEventListener('click', (e) => {
    const loc = e.target.closest('[data-filtro-loc]');
    if (loc) { prefs.loc = loc.dataset.filtroLoc; salvar(); desenhar(); return; }
    const sit = e.target.closest('[data-sit]');
    if (sit) { prefs.situacao = sit.dataset.sit; salvar(); carregar(); return; }
    const s = e.target.closest('.ig-slot:not(.vazio)');
    if (s) { sel = s.dataset.id; raiz.querySelectorAll('.ig-slot.sel').forEach((y) => y.classList.remove('sel')); s.classList.add('sel'); detalhe(); }
  });
  raiz.addEventListener('dblclick', (e) => {
    const s = e.target.closest('.ig-slot:not(.vazio)');
    const x = s && achar(s.dataset.id);
    if (x && podeMudar && x.m.status !== 'entregue') atender(x);
  });
  let espera = null;
  el.querySelector('#jp-q').addEventListener('input', (e) => { clearTimeout(espera); espera = setTimeout(() => { prefs.q = e.target.value.trim(); salvar(); carregar(); }, 350); });
  Jogo.ligarTamanho(raiz, 'pedidos', () => Jogo.completar(raiz));
  Jogo.aoRedimensionar(raiz, () => Jogo.completar(raiz));

  Jogo.dicas(raiz, (s) => {
    const x = achar(s.dataset.id);
    if (!x) return '';
    const { t, m } = x;
    const etapa = (ETAPAS.find(([k]) => k === m.status) || [])[1] || m.status;
    return `<b class="ig-tip-nome r-${RARO[m.status] || 'cz'}">${esc(m.name)}</b>
      <span>${m.quantity} ${esc(m.unit || 'un')} · chamado #${t.id}</span>
      <span class="r-${RARO[m.status] || 'cz'}">${esc(etapa)}${m.origem_local ? ' · do estoque do local' : m.origem_orcim && m.status !== 'entregue' ? ' · sai da ORCIM' : ''}</span>
      <span><i class="bi bi-geo-alt"></i> vai para ${esc(x.locNome)}</span>
      <span><i class="bi bi-person"></i> ${esc(t.requester_name || '—')}</span>
      ${Number(t.priority) === 4 ? '<span class="ig-tip-man"><i class="bi bi-fire"></i> Operação parada</span>' : ''}
      ${m.previsao && m.status !== 'entregue' ? `<span class="${atrasado(m) ? 'ig-tip-man' : ''}">Entrega prevista: ${Jogo.dia(m.previsao)}${atrasado(m) ? ' (atrasada)' : ''}</span>` : ''}
      ${vePreco && m.price != null ? `<span class="ig-tip-preco">${invMoeda(m.price)} / un</span>` : ''}
      <em>${s.getAttribute('draggable') ? 'Arraste para a próxima etapa · ' : ''}clique duplo: Atender</em>`;
  });

  // arrastar para outra etapa: só para a frente; "Pedido" abre a janela Atender (de onde sai o item)
  const ORDEM = ETAPAS.map(([k]) => k);
  const PODE = { comprado: ['chegou'], chegou: ['rota', 'entregue'], rota: ['entregue'] };
  Jogo.arrastar(raiz, {
    alvos: '.ig-grade[data-etapa]',
    aceita: (de, alvo) => {
      const x = achar(de.dataset.id);
      if (!x || alvo.dataset.etapa === x.m.status) return false;
      return x.m.status === 'solicitado' || ORDEM.indexOf(alvo.dataset.etapa) > ORDEM.indexOf(x.m.status);
    },
    soltar: async (de, alvo) => {
      const x = achar(de.dataset.id);
      const para = alvo.dataset.etapa;
      const url = `/tickets/${x.t.id}/materials/${x.m.id}`;
      if (x.m.status === 'solicitado') { atender(x); return; }
      if (!(PODE[x.m.status] || []).includes(para)) { toast('Arraste para a etapa seguinte. Para outras mudanças, use "Atender".', 'warning'); return; }
      const nomePara = (ETAPAS.find(([k]) => k === para) || [])[1];
      if (para === 'entregue') {
        const destino = await PedidoUI.perguntarDestino({ name: x.m.name, location_name: x.locNome });
        if (!destino) return;
        await API.post(`${url}/entregar`, { destino });
      } else {
        if (!await confirmDialog({ title: `${x.m.name}: ${nomePara}`, body: `Passar para <b>${esc(nomePara)}</b>? Quem pediu é avisado.`, confirmText: 'Confirmar' })) return;
        await API.post(`${url}/status`, { status: para, ...(para === 'rota' && !x.m.previsao ? { previsao: Jogo.hoje() } : {}) });
      }
      toast(`${x.m.name}: ${nomePara}.`, 'success');
      registrar(`${x.m.name}: ${(ETAPAS.find(([k]) => k === x.m.status) || [])[1]} → ${nomePara}`);
      carregar();
    },
  });
  carregar();
};

// =================================================================
// Manutenção: a oficina
// =================================================================
Views.jogoManutencao = async function jogoManutencao(el) {
  const user = API.user || {};
  const preso = Roles.presoAoLocal(user);
  const COLS = [
    ['pedida', 'A buscar', 'bi-box-arrow-in-down', 'qbr'], ['retirada', 'Retirado', 'bi-truck', 'cns'], ['em_conserto', 'Na bancada', 'bi-wrench-adjustable', 'cmp'],
    ['pronta', 'Pronto', 'bi-check2-square', 'est'], ['rota', 'Voltando', 'bi-signpost-split', 'rot'], ['fim', 'Terminadas', 'bi-flag-fill', 'ok'],
  ];
  const FINAIS = ['devolvida', 'sem_conserto', 'cancelada'];
  const RARO = { pedida: 'qbr', retirada: 'cns', em_conserto: 'cmp', pronta: 'est', rota: 'rot', devolvida: 'ok', sem_conserto: 'cz', cancelada: 'cz' };
  let prefs = { situacao: 'abertas', loc: '', q: '' };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('jogo_manut') || '{}') }; } catch { /* padrão */ }
  const salvar = () => { try { localStorage.setItem('jogo_manut', JSON.stringify(prefs)); } catch { /* ok */ } };
  const tam = Jogo.tamanho('manut');
  el.innerHTML = `<div class="ig ig-jogo" style="--slot:${Jogo.TAM[tam]}px">
    ${Jogo.abas('manutencao')}
    <section class="ig-painel ig-filtros"><div class="ig-tit"><i class="bi bi-sliders"></i> Filtros</div>
      <div class="ig-filtros-corpo">
        <div class="ig-busca"><i class="bi bi-search"></i><input class="form-control form-control-sm" id="jm-q" placeholder="Buscar item, etiqueta ou problema" value="${esc(prefs.q)}"></div>
        <span class="ig-tam ig-sit" role="group" aria-label="Quais"><button type="button" data-sit="abertas">Em andamento</button><button type="button" data-sit="todas">Todas</button></span>
        ${Jogo.botoesTamanho(tam)}
        <button type="button" class="btn btn-sm ig-bt" id="jm-pedir"><i class="bi bi-tools"></i> Pedir manutenção</button>
      </div></section>
    <div class="ig-corpo">
      <aside class="ig-lado"><section class="ig-painel"><div class="ig-tit"><i class="bi bi-geo-alt"></i> ${preso ? 'Seu local' : 'Locais'}</div><div class="ig-lista" id="jm-locais">${spinner()}</div></section></aside>
      <div class="ig-main">
        <div class="ig-cab"><span class="ig-cab-tit">Oficina</span><span class="ig-cab-onde" id="jm-resumo"></span><span class="ig-cab-dica" id="jm-dica"></span></div>
        <div class="jg-quadro jg-quadro-6" id="jm-quadro"></div>
        <div class="ig-baixo"><section class="ig-painel ig-det"><div class="ig-tit"><i class="bi bi-hand-index"></i> Item</div><div id="jm-det" class="ig-det-corpo"><span class="ig-vazio-tx">Clique num item para ver os detalhes.</span></div></section>
          <section class="ig-painel ig-log"><div class="ig-tit"><i class="bi bi-journal-text"></i> Log</div><div id="jm-log" class="ig-log-corpo"><span class="ig-vazio-tx">O que você fizer aqui aparece neste log.</span></div></section></div>
      </div>
    </div></div>`;
  const raiz = el.querySelector('.ig');
  let d = { itens: [], pode_atender: false }; let sel = null; const log = [];
  const achar = (id) => d.itens.find((m) => String(m.id) === String(id));
  const coluna = (st) => (FINAIS.includes(st) ? 'fim' : st);
  const atrasado = (m) => m.previsao && !FINAIS.includes(m.status) && String(m.previsao).slice(0, 10) < Jogo.hoje();

  async function carregar() {
    el.querySelectorAll('[data-sit]').forEach((b) => b.classList.toggle('on', b.dataset.sit === prefs.situacao));
    try { d = await API.get(`/manutencoes?situacao=${prefs.situacao}`); } catch (e) { d = { itens: [] }; showError(e); }
    el.querySelector('#jm-dica').textContent = d.pode_atender ? 'Arraste o item para a etapa do conserto · tudo fica no histórico' : '';
    desenhar();
  }
  function desenhar() {
    const q = prefs.q.toLowerCase();
    const todos = d.itens.filter((m) => !q || `${m.name} ${m.asset_tag || ''} ${m.problema || ''} ${m.location_name || ''}`.toLowerCase().includes(q));
    const porLoc = new Map();
    todos.forEach((m) => { const k = String(m.location_id || 'sem'); if (!porLoc.has(k)) porLoc.set(k, { id: k, nome: m.location_name || 'sem local', sub: m.entity_name || '', n: 0 }); if (!FINAIS.includes(m.status)) porLoc.get(k).n += 1; });
    if (prefs.loc && !porLoc.has(prefs.loc)) prefs.loc = '';
    el.querySelector('#jm-locais').innerHTML = Jogo.listaLocais([...porLoc.values()].sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome)), prefs.loc, todos.filter((m) => !FINAIS.includes(m.status)).length);
    const ver = todos.filter((m) => !prefs.loc || String(m.location_id || 'sem') === prefs.loc);
    el.querySelector('#jm-resumo').innerHTML = `${ver.filter((m) => !FINAIS.includes(m.status)).length} em andamento`;
    const cols = prefs.situacao === 'todas' ? COLS : COLS.filter(([k]) => k !== 'fim');
    el.querySelector('#jm-quadro').classList.toggle('jg-quadro-6', cols.length === 6);
    el.querySelector('#jm-quadro').innerHTML = cols.map(([k, nome, ic, raro]) => {
      const col = ver.filter((m) => coluna(m.status) === k);
      return `<section class="ig-painel jg-col jg-col-${raro}"><div class="ig-tit"><i class="bi ${ic}"></i> ${nome}<span class="ig-tit-n">${col.length}</span></div>
        <div class="ig-grade" data-etapa="${k}" data-min="3">${col.map((m) => Jogo.slot({
          id: m.id, nome: m.name, icone: Jogo.icone(m), raro: RARO[m.status], sel: sel && String(sel) === String(m.id), arrasta: d.pode_atender && !FINAIS.includes(m.status),
          marcas: [atrasado(m) ? '<i class="bi bi-alarm ig-m ig-m-man" title="Volta atrasada"></i>' : '',
            m.status === 'sem_conserto' ? '<i class="bi bi-x-octagon ig-m ig-m-fogo" title="Sem conserto"></i>' : m.status === 'cancelada' ? '<i class="bi bi-x-circle ig-m ig-m-ped" title="Cancelada"></i>' : ''].join(''),
        })).join('')}</div></section>`;
    }).join('');
    // "Terminadas" (quando aparece) aceita soltar: pergunta como terminou
    Jogo.completar(raiz);
    detalhe();
  }
  function detalhe() {
    const box = el.querySelector('#jm-det');
    const m = sel && achar(sel);
    if (!m) { box.innerHTML = '<span class="ig-vazio-tx">Clique num item para ver os detalhes.</span>'; return; }
    const item = { asset_id: m.asset_id, name: m.name, asset_tag: m.asset_tag, type: m.type, status: m.asset_status, controle: m.controle, quantity: m.quantity,
      location_id: m.location_id, location_name: m.location_name, entity_id: m.entity_id, entity_name: m.entity_name };
    box.innerHTML = `<div class="ig-det-it">${Item.titulo(item, { manut: false, estado: false })} ${manutTag(m.status)}</div>
      <div class="ig-det-info"><i class="bi bi-chat-left-text"></i> ${esc(m.problema)} · pedido por ${esc(m.pedido_por_name || '—')}${m.ticket_id ? ` · <a href="#/tickets/${m.ticket_id}">chamado #${m.ticket_id}</a>` : ''}${m.previsao && !FINAIS.includes(m.status) ? ` · volta prevista ${Jogo.dia(m.previsao)}` : ''}${m.solucao ? `<br><i class="bi bi-wrench-adjustable"></i> ${esc(m.solucao)}` : ''}</div>
      <div class="ig-det-bt"><a class="btn btn-sm ig-bt" href="#/inventory/${m.asset_id}"><i class="bi bi-box-arrow-up-right"></i> Ficha do item</a>
        ${d.pode_atender && !FINAIS.includes(m.status) ? `<label class="ig-det-prev">Volta prevista <input type="date" class="form-control form-control-sm" data-prev value="${m.previsao ? String(m.previsao).slice(0, 10) : ''}"></label>` : ''}</div>`;
    box.querySelector('[data-prev]')?.addEventListener('change', async (e) => {
      try { await API.request('PATCH', `/manutencoes/${m.id}`, { previsao: e.target.value || null }); toast('Salvo.', 'success'); registrar(`${m.name}: volta prevista ${Jogo.dia(e.target.value) || 'sem data'}`); carregar(); } catch (err) { showError(err); }
    });
  }
  const registrar = (t) => {
    log.unshift(t); if (log.length > 10) log.pop();
    el.querySelector('#jm-log').innerHTML = log.map((l) => `<div class="ig-log-l novo"><span>agora</span><i class="bi bi-stars"></i> ${esc(l)}</div>`).join('');
  };
  // como terminou (vai para o histórico de manutenções do item)
  function terminar(m) {
    return new Promise((resolve) => {
      const md = document.createElement('div');
      md.className = 'modal fade';
      md.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content">
        <div class="modal-header"><h6 class="mb-0"><i class="bi bi-flag-fill me-1"></i> ${esc(m.name)}: como terminou?</h6><button class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body"><div class="es-razoes">
          <label class="es-razao on"><input type="radio" name="jm-fim" value="devolvida" checked><span><b><i class="bi bi-check2-circle"></i> Devolvido ao local</b><small>Consertado: volta a funcionar no local.</small></span></label>
          <label class="es-razao"><input type="radio" name="jm-fim" value="sem_conserto"><span><b><i class="bi bi-x-octagon"></i> Sem conserto</b><small>O item fica como Estragado.</small></span></label>
          <label class="es-razao"><input type="radio" name="jm-fim" value="cancelada"><span><b><i class="bi bi-x-circle"></i> Cancelar</b><small>A manutenção não vai acontecer.</small></span></label></div>
          <label class="form-label small fw-semibold mt-2">O que foi feito? (fica no histórico do item)</label><textarea class="form-control form-control-sm" rows="2" data-sol></textarea></div>
        <div class="modal-footer"><button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Voltar</button><button class="btn btn-primary btn-sm" data-ok>Confirmar</button></div></div></div>`;
      document.body.appendChild(md);
      const bm = new bootstrap.Modal(md);
      let r = null;
      md.querySelectorAll('[name="jm-fim"]').forEach((x) => x.addEventListener('change', () => md.querySelectorAll('.es-razao').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked))));
      md.querySelector('[data-ok]').addEventListener('click', () => { r = { status: md.querySelector('[name="jm-fim"]:checked').value, solucao: md.querySelector('[data-sol]').value.trim() }; bm.hide(); });
      md.addEventListener('hidden.bs.modal', () => { md.remove(); resolve(r); });
      bm.show();
    });
  }

  raiz.addEventListener('click', (e) => {
    const loc = e.target.closest('[data-filtro-loc]');
    if (loc) { prefs.loc = loc.dataset.filtroLoc; salvar(); desenhar(); return; }
    const sit = e.target.closest('[data-sit]');
    if (sit) { prefs.situacao = sit.dataset.sit; salvar(); carregar(); return; }
    const s = e.target.closest('.ig-slot:not(.vazio)');
    if (s) { sel = s.dataset.id; raiz.querySelectorAll('.ig-slot.sel').forEach((y) => y.classList.remove('sel')); s.classList.add('sel'); detalhe(); }
  });
  raiz.addEventListener('dblclick', (e) => { const s = e.target.closest('.ig-slot:not(.vazio)'); const m = s && achar(s.dataset.id); if (m) location.hash = `#/inventory/${m.asset_id}`; });
  let espera = null;
  el.querySelector('#jm-q').addEventListener('input', (e) => { clearTimeout(espera); espera = setTimeout(() => { prefs.q = e.target.value.trim(); salvar(); desenhar(); }, 250); });
  el.querySelector('#jm-pedir').addEventListener('click', () => manutEscolherItem());
  Jogo.ligarTamanho(raiz, 'manut', () => Jogo.completar(raiz));
  Jogo.aoRedimensionar(raiz, () => Jogo.completar(raiz));
  Jogo.dicas(raiz, (s) => {
    const m = achar(s.dataset.id);
    if (!m) return '';
    return `<b class="ig-tip-nome r-${RARO[m.status] || 'cz'}">${esc(m.name)}</b>
      <span>${esc(INV_TYPES[m.type] || m.type || '')}${m.asset_tag ? ` · ${esc(m.asset_tag)}` : ''}</span>
      <span class="r-${RARO[m.status] || 'cz'}">${esc((MANUT_ETAPAS[m.status] || [m.status])[0])}</span>
      <span><i class="bi bi-geo-alt"></i> ${esc(m.location_name || 'sem local')}</span>
      <span class="ig-tip-ped"><i class="bi bi-chat-left-text"></i> ${esc(String(m.problema || '').slice(0, 120))}</span>
      ${m.previsao && !FINAIS.includes(m.status) ? `<span class="${atrasado(m) ? 'ig-tip-man' : ''}">Volta prevista: ${Jogo.dia(m.previsao)}${atrasado(m) ? ' (atrasada)' : ''}</span>` : ''}
      ${m.solucao ? `<span class="ig-tip-preco">${esc(String(m.solucao).slice(0, 120))}</span>` : ''}
      <em>${s.getAttribute('draggable') ? 'Arraste para outra etapa · ' : ''}clique duplo abre a ficha</em>`;
  });
  Jogo.arrastar(raiz, {
    alvos: '.ig-grade[data-etapa]',
    aceita: (de, alvo) => { const m = achar(de.dataset.id); return !!m && d.pode_atender && !FINAIS.includes(m.status) && alvo.dataset.etapa !== m.status; },
    soltar: async (de, alvo) => {
      const m = achar(de.dataset.id);
      let corpo;
      if (alvo.dataset.etapa === 'fim') { const r = await terminar(m); if (!r) return; corpo = { status: r.status, solucao: r.solucao }; } else corpo = { status: alvo.dataset.etapa };
      await API.request('PATCH', `/manutencoes/${m.id}`, corpo);
      const nome = (MANUT_ETAPAS[corpo.status] || [corpo.status])[0];
      toast(`${m.name}: ${nome}.`, 'success');
      registrar(`${m.name}: ${(MANUT_ETAPAS[m.status] || [m.status])[0]} → ${nome}`);
      carregar();
    },
  });
  carregar();
};

// =================================================================
// Relatório: tela de status (placar, barras de vida, categorias em quadradinhos)
// =================================================================
Views.jogoRelatorio = async function jogoRelatorio(el) {
  let prefs = { dias: 90, ent: '', escopo: 'inventario', loc: '' };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('jogo_rel') || '{}') }; } catch { /* padrão */ }
  const salvar = () => { try { localStorage.setItem('jogo_rel', JSON.stringify(prefs)); } catch { /* ok */ } };
  let ents = [];
  try { ents = (await API.get('/entities')).filter((e) => e.active); } catch { /* sem filtro */ }
  el.innerHTML = `<div class="ig ig-jogo" style="--slot:64px">
    ${Jogo.abas('relatorio')}
    <section class="ig-painel ig-filtros"><div class="ig-tit"><i class="bi bi-sliders"></i> Filtros</div>
      <div class="ig-filtros-corpo">
        <span class="ig-tam ig-sit" role="group" aria-label="Período">${[[30, '30 dias'], [90, '90 dias'], [365, '1 ano']].map(([n, t]) => `<button type="button" data-dias="${n}">${t}</button>`).join('')}</span>
        <span class="ig-tam ig-sit" role="group" aria-label="O que somar"><button type="button" data-escopo="inventario">Inventário todo</button><button type="button" data-escopo="estoque">Só o estoque</button></span>
        <select class="form-select form-select-sm" id="jr-ent"><option value="">Todas as empresas</option>${ents.map((e) => `<option value="${e.id}" ${String(e.id) === String(prefs.ent) ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
      </div></section>
    <div id="jr-corpo">${spinner()}</div></div>`;
  const raiz = el.querySelector('.ig');
  const corpo = el.querySelector('#jr-corpo');
  const n0 = (x) => Number(x || 0).toLocaleString('pt-BR');
  // barra em gomos (como a barra de vida dos jogos)
  const gomos = (v, max, cor) => { const n = max ? Math.max(v > 0 ? 1 : 0, Math.round((v / max) * 20)) : 0; return `<span class="jg-gomos" style="--c:${cor}">${'<i class="on"></i>'.repeat(n)}${'<i></i>'.repeat(20 - n)}</span>`; };
  const MEDALHA = ['#f5c84c', '#c9d1d9', '#d18b47'];

  async function carregar() {
    el.querySelectorAll('[data-dias]').forEach((b) => b.classList.toggle('on', Number(b.dataset.dias) === Number(prefs.dias)));
    el.querySelectorAll('[data-escopo]').forEach((b) => b.classList.toggle('on', b.dataset.escopo === prefs.escopo));
    corpo.innerHTML = spinner();
    let r;
    try { r = await API.get(`/stock/report?dias=${prefs.dias}${prefs.ent ? `&entity_id=${prefs.ent}` : ''}&escopo=${prefs.escopo}${prefs.loc ? `&location_id=${prefs.loc}` : ''}`); } catch (e) { corpo.innerHTML = emptyState('Não foi possível carregar', e.message, 'bi-exclamation-triangle'); return; }
    const v = r.ve_valores;
    const periodo = prefs.dias === 365 ? 'no último ano' : `nos últimos ${prefs.dias} dias`;
    const hud = [
      v ? ['bi-coin', 'ouro', r.escopo === 'estoque' ? 'Valor do estoque' : 'Valor do inventário', invMoeda(r.inventario.valor), `${r.inventario.com_preco} de ${r.inventario.itens} com preço`] : null,
      ['bi-backpack2', 'azul', r.escopo === 'estoque' ? 'Itens no estoque' : 'Itens no inventário', n0(r.inventario.itens), 'sem descartados e extraviados'],
      ['bi-box-arrow-up', 'ambar', 'Retiradas', n0(r.totais.retiradas), periodo],
      v ? ['bi-receipt-cutoff', 'vermelho', 'Custo das retiradas', invMoeda(r.totais.custo_retiradas), periodo] : null,
      v ? ['bi-heartbreak', 'vermelho', 'Prejuízo', invMoeda(r.totais.prejuizo), `${r.totais.perdidos} perdido(s) ou estragado(s)`] : null,
      ['bi-arrow-left-right', 'roxo', 'Transferências / entradas', `${n0(r.totais.transferencias)} / ${n0(r.totais.entradas)}`, periodo],
    ].filter(Boolean);
    const maxMot = Math.max(0, ...r.por_motivo.map((x) => (v ? x.custo : x.n)));
    const maxMes = Math.max(0, ...r.por_mes.map((x) => x.n));
    const ranking = r.valor_por_posto.slice().sort((a, b) => (v ? b.valor - a.valor : b.n - a.n)).slice(0, 10);
    const maxRank = Math.max(0, ...ranking.map((x) => (v ? x.valor : x.n)));
    corpo.innerHTML = `
      <div class="jg-hud">${hud.map(([ic, cor, tit, val, sub]) => `<div class="ig-painel jg-stat jg-${cor}"><i class="bi ${ic}"></i><span><small>${esc(tit)}</small><b>${val}</b><em>${esc(sub)}</em></span></div>`).join('')}</div>
      <div class="jg-rel">
        <section class="ig-painel"><div class="ig-tit"><i class="bi bi-trophy"></i> Placar dos postos <span class="ig-tit-n">${v ? 'quanto vale o que cada um tem' : 'itens em cada um'}</span></div>
          <div class="jg-rank">${ranking.length ? ranking.map((x, i) => `<button type="button" class="jg-rank-l ${prefs.loc && String(x.location_id || '') === String(prefs.loc) ? 'sel' : ''}" ${x.location_id ? `data-loc="${x.location_id}" title="Ver os itens de ${esc(x.posto || '')}"` : 'disabled title="Itens sem posto"'}>
            <span class="jg-pos" style="${i < 3 ? `--m:${MEDALHA[i]}` : ''}">${i < 3 ? '<i class="bi bi-trophy-fill"></i>' : `${i + 1}º`}</span>
            <span class="jg-rank-nome">${esc(x.posto || 'Sem local')}<small>${esc(x.empresa || '')}</small></span>
            ${gomos(v ? x.valor : x.n, maxRank, '#7ee787')}
            <b>${v ? invMoeda(x.valor) : x.n}</b>${v && x.perdido ? `<em title="Perdido ou estragado">-${invMoeda(x.perdido)}</em>` : ''}</button>`).join('') : '<div class="ig-vazio-tx p-2">Nenhum equipamento.</div>'}</div></section>
        <section class="ig-painel"><div class="ig-tit"><i class="bi bi-heart-pulse"></i> Retiradas por motivo <span class="ig-tit-n">${periodo}</span></div>
          <div class="jg-barras">${r.por_motivo.length ? r.por_motivo.map((x) => `<div class="jg-barra-l"><span>${esc(x.motivo)}</span>${gomos(v ? x.custo : x.n, maxMot, '#ff7b72')}<b>${x.n}${v ? ` · ${invMoeda(x.custo)}` : ''}</b></div>`).join('') : '<div class="ig-vazio-tx">Nenhuma retirada no período.</div>'}</div>
          <div class="ig-tit jg-sub"><i class="bi bi-bar-chart-steps"></i> Retiradas por mês</div>
          ${r.por_mes.length ? `<div class="jg-meses">${r.por_mes.map((x) => `<div class="jg-mes" title="${x.n} retirada(s)${v ? ` · ${invMoeda(x.custo)}` : ''}"><span class="jg-col-mes"><i style="--h:${maxMes ? Math.max(6, Math.round((x.n / maxMes) * 100)) : 0}%"></i></span><b>${x.n}</b><small>${x.mes.slice(5)}/${x.mes.slice(2, 4)}</small></div>`).join('')}</div>` : '<div class="jg-barras"><div class="ig-vazio-tx">Nenhuma retirada no período.</div></div>'}</section>
      </div>
      <section class="ig-painel mt-3"><div class="ig-tit"><i class="bi bi-grid-3x3-gap"></i> Coleção por categoria <span class="ig-tit-n">hoje · número = itens · embaixo: no estoque${v ? ' e valor' : ''}</span></div>
        <div class="jg-cats">${r.por_categoria.map((x) => `<div class="jg-cat">${Jogo.slot({ id: x.type, nome: INV_TYPES[x.type] || x.type, icone: INV_ICONES[x.type] || 'bi-box', raro: 'est', qtd: x.n })}
          <span><b>${esc(INV_TYPES[x.type] || x.type)}</b><small>${x.em_estoque} no estoque${v ? ` · ${invMoeda(x.valor)}` : ''}</small></span></div>`).join('') || '<div class="ig-vazio-tx">Nenhum equipamento.</div>'}</div></section>
      ${prefs.loc ? `<section class="ig-painel mt-3"><div class="ig-tit"><i class="bi bi-geo-alt-fill"></i> Itens de ${esc((r.valor_por_posto.find((x) => String(x.location_id) === String(prefs.loc)) || {}).posto || 'posto')} <button type="button" class="ig-tit-x" data-loc="" title="Fechar">×</button></div>
        <div class="ig-grade jg-itens-posto">${(r.itens_posto || []).map((a) => Jogo.slot({ id: a.id, nome: a.name, icone: Jogo.icone(a), raro: { OPERATING: 'ok', STOCK: 'est', READY: 'orc', ORDERED: 'cmp', REPAIR: 'cns', BROKEN: 'qbr' }[a.status] || 'cz', qtd: a.controle === 'quantidade' ? a.quantity : null, extra: `data-ficha="${a.id}" title="${esc(a.name)}${v && a.total != null ? ` · ${invMoeda(a.total)}` : ''}"` })).join('')}</div></section>` : ''}`;
    Jogo.completar(raiz, 1);
  }
  raiz.addEventListener('click', (e) => {
    const dd = e.target.closest('[data-dias]'); if (dd) { prefs.dias = Number(dd.dataset.dias); salvar(); carregar(); return; }
    const es = e.target.closest('[data-escopo]'); if (es) { prefs.escopo = es.dataset.escopo; salvar(); carregar(); return; }
    const lc = e.target.closest('[data-loc]'); if (lc) { prefs.loc = prefs.loc === lc.dataset.loc ? '' : lc.dataset.loc; salvar(); carregar(); return; }
    const fi = e.target.closest('[data-ficha]'); if (fi) location.hash = `#/inventory/${fi.dataset.ficha}`;
  });
  el.querySelector('#jr-ent').addEventListener('change', (e) => { prefs.ent = e.target.value; prefs.loc = ''; salvar(); carregar(); });
  carregar();
};
