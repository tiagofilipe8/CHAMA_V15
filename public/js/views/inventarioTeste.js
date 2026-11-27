// ---------------------------------------------------------------
// Inventário teste (#/inventario-teste): o inventário em estilo videogame (desenho do Lucas, 27/11/2026).
//   Não substitui as telas antigas (Inventário da Empresa, Estoque de T.I., Estoque da ORCIM): usa os
//   mesmos dados e as mesmas ações, só que num formato de "inventário de jogo".
//   - Esquerda: EMPRESAS (cada empresa com os seus locais) e PESSOAS (com quem os itens ficam).
//   - Centro: INVENTÁRIO do local escolhido, em dois painéis de quadradinhos:
//       ATIVO (em uso: operando, em conserto, estragado) e ESTOQUE (Estoque de T.I. do local; ORCIM na aba própria).
//       Abas de cima = categoria; abas de baixo = o tipo pelo nome (mouse, teclado, toner...).
//   - Clicar e arrastar um item faz a ação de verdade e fica no log/histórico do item:
//       Estoque -> Ativo: dar baixa (motivo) · Ativo -> Estoque: devolver ao estoque
//       item -> outro local (na lista): transferir · item em uso -> pessoa: fica com ela (sai do local)
//       ORCIM -> Ativo/Estoque/local: transferir do Estoque da ORCIM
// ---------------------------------------------------------------
Views.inventarioTeste = async function inventarioTeste(el) {
  const user = API.user || {};
  const can = (p) => Roles.can(user, p);
  const podeMexer = can('inventory.manage');
  const podeRetirar = can('stock.withdraw');
  const doLocal = Roles.presoAoLocal(user);
  const veOrcim = podeMexer && (Roles.isMaster(user) || can('ticket.view_all'));
  const ATIVO = ['OPERATING', 'REPAIR', 'BROKEN'];
  const ESTOQUE = ['STOCK', 'READY', 'ORDERED'];
  const FORA = ['DISPOSED', 'LOST'];
  const CAT = { COMPUTER: 'PCs', NOTEBOOK: 'Notebooks', SERVER: 'Servidores', PRINTER: 'Impressoras', MONITOR: 'Monitores', UPS: 'Nobreaks',
    NETWORK_DEVICE: 'Rede', MOBILE_DEVICE: 'Celulares', PERIPHERAL: 'Periféricos', OTHER: 'Outros' };
  const RARO = { OPERATING: 'ok', STOCK: 'est', READY: 'orc', ORDERED: 'cmp', REPAIR: 'cns', BROKEN: 'qbr', DISPOSED: 'cz', LOST: 'cz' };
  const TAM = { p: 44, m: 56, g: 70 };
  const un = (a) => (a.controle === 'quantidade' ? Number(a.quantity || 0) : 1);

  let prefs = { sel: null, q: '', ent: '', estado: '', tam: 'm', aba: { ativo: 'todos', estoque: 'todos' }, sub: { ativo: '', estoque: '' }, fonte: 'local', fechadas: {} };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('invgame_prefs') || '{}') }; } catch { /* padrão */ }
  if (!veOrcim) prefs.fonte = 'local';
  const salvar = () => { try { localStorage.setItem('invgame_prefs', JSON.stringify(prefs)); } catch { /* sem armazenamento */ } };

  el.innerHTML = `<div class="ig" style="--slot:${TAM[prefs.tam] || 56}px">
    ${Jogo.abas('inventario')}
    <section class="ig-painel ig-filtros">
      <div class="ig-tit"><i class="bi bi-sliders"></i> Filtros</div>
      <div class="ig-filtros-corpo">
        <div class="ig-busca"><i class="bi bi-search"></i><input class="form-control form-control-sm" id="ig-q" placeholder="Buscar item, etiqueta ou série em todos os locais" value="${esc(prefs.q)}"></div>
        <select class="form-select form-select-sm" id="ig-ent"><option value="">Todas as empresas</option></select>
        <select class="form-select form-select-sm" id="ig-estado"><option value="">Todos os estados</option>${Object.entries(INV_STATUS).map(([k, v]) => `<option value="${k}" ${prefs.estado === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
        <span class="ig-tam" role="group" aria-label="Tamanho dos quadrados">${['p', 'm', 'g'].map((t) => `<button type="button" data-tam="${t}" class="${prefs.tam === t ? 'on' : ''}">${t.toUpperCase()}</button>`).join('')}</span>
      </div>
    </section>
    <div class="ig-corpo">
      <aside class="ig-lado">
        <section class="ig-painel"><div class="ig-tit"><i class="bi bi-buildings"></i> Empresas</div><div class="ig-lista" id="ig-locais">${spinner()}</div></section>
        ${doLocal ? '' : `<section class="ig-painel"><div class="ig-tit"><i class="bi bi-people"></i> Pessoas</div>
          <div class="ig-lista-busca"><input class="form-control form-control-sm" id="ig-pq" placeholder="Procurar pessoa"></div>
          <div class="ig-lista" id="ig-pessoas"></div></section>`}
      </aside>
      <div class="ig-main">
        <div class="ig-cab"><span class="ig-cab-tit">Inventário</span><span class="ig-cab-onde" id="ig-onde"></span><span class="ig-cab-dica">${podeMexer ? 'Arraste os itens para mover: tudo fica no histórico' : podeRetirar ? 'Arraste do Estoque para o Ativo para dar baixa' : ''}</span></div>
        <div class="ig-dois">
          <section class="ig-painel ig-inv" id="ig-ativo"></section>
          <section class="ig-painel ig-inv" id="ig-estoque"></section>
        </div>
        <div class="ig-baixo">
          <section class="ig-painel ig-det"><div class="ig-tit"><i class="bi bi-hand-index"></i> Item</div><div id="ig-det" class="ig-det-corpo"><span class="ig-vazio-tx">Clique num item para ver os detalhes.</span></div></section>
          <section class="ig-painel ig-log"><div class="ig-tit"><i class="bi bi-journal-text"></i> Log</div><div id="ig-log" class="ig-log-corpo"></div></section>
        </div>
      </div>
    </div>
    <div class="ig-tip d-none" id="ig-tip"></div>
  </div>`;
  const raiz = el.querySelector('.ig');
  const tip = el.querySelector('#ig-tip');
  const selEnt = el.querySelector('#ig-ent');

  // ---------- dados ----------
  let ents = []; let locs = []; let cont = { locais: [], pessoas: [] }; let pessoas = []; let pessoasEnt = null;
  let itens = []; let orcim = []; let movs = []; let selecionado = null;
  const logSessao = [];
  try {
    [ents, locs] = await Promise.all([API.get('/entities').catch(() => []), API.get('/locations?active=true').catch(() => [])]);
  } catch { /* sem listas */ }
  ents = ents.filter((e) => e.active);
  selEnt.innerHTML = '<option value="">Todas as empresas</option>' + ents.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  if (user.role === 'client') { prefs.ent = String(user.entity_id || ''); selEnt.disabled = true; }
  selEnt.value = prefs.ent || '';
  if (doLocal) locs = locs.filter((l) => String(l.id) === String(user.location_id));
  const locPorId = new Map(locs.map((l) => [String(l.id), l]));
  const entNome = (id) => (ents.find((e) => String(e.id) === String(id)) || {}).name || '';
  const principal = (n) => (/beija/i.test(n || '') ? 0 : 1);

  // escolha inicial: o local do Usuário, o que estava escolhido ou o primeiro local com itens
  const escolherInicial = () => {
    if (doLocal) { prefs.sel = { tipo: 'local', id: String(user.location_id || '') }; return; }
    if (prefs.sel && (prefs.sel.tipo === 'pessoa' || locPorId.has(String(prefs.sel.id)))) return;
    const comItens = cont.locais.filter((c) => c.location_id && (c.ativo || c.estoque) && locPorId.has(String(c.location_id)))
      .sort((a, b) => principal(entNome(a.entity_id)) - principal(entNome(b.entity_id)) || (b.ativo + b.estoque) - (a.ativo + a.estoque));
    prefs.sel = comItens.length ? { tipo: 'local', id: String(comItens[0].location_id) } : (locs[0] ? { tipo: 'local', id: String(locs[0].id) } : null);
  };
  // empresa em foco (para a lista de pessoas): a do filtro ou a do local escolhido
  const entFoco = () => prefs.ent || (prefs.sel && prefs.sel.tipo === 'local' ? String((locPorId.get(String(prefs.sel.id)) || {}).entity_id || '') : prefs.sel?.ent || '') || String(user.entity_id || '');

  async function carregarContagem() {
    try { cont = await API.get('/inventory/contagem'); } catch { cont = { locais: [], pessoas: [] }; }
  }
  async function carregarPessoas() {
    if (doLocal) return;
    const ent = entFoco();
    if (!ent || ent === pessoasEnt) return;
    try { pessoas = await API.get(`/inventory/pessoas?entity_id=${ent}`); pessoasEnt = ent; } catch { pessoas = []; }
  }
  async function carregarItens() {
    const p = new URLSearchParams({ limit: '500' });
    if (prefs.q) { p.set('q', prefs.q); if (prefs.ent) p.set('entity_id', prefs.ent); } else if (!prefs.sel) { itens = []; return; } else if (prefs.sel.tipo === 'local') p.set('location_id', prefs.sel.id);
    else if (prefs.sel.uid) p.set('responsible_user_id', prefs.sel.uid);
    else p.set('dono_nome', prefs.sel.nome);
    try { itens = await API.get(`/inventory/assets?${p}`); } catch (e) { itens = []; showError(e); }
    if (veOrcim && prefs.fonte === 'orcim') { try { orcim = (await API.get('/orcim')).itens || []; } catch { orcim = []; } }
  }
  async function carregarLog() {
    try { movs = await API.get('/stock/movements'); } catch { movs = []; }
  }

  // ---------- esquerda: empresas e locais, pessoas ----------
  function desenharLocais() {
    const box = el.querySelector('#ig-locais');
    const porLoc = new Map(cont.locais.map((c) => [String(c.location_id), c]));
    const grupos = new Map();
    locs.filter((l) => !prefs.ent || String(l.entity_id) === String(prefs.ent)).forEach((l) => {
      const k = String(l.entity_id);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(l);
    });
    const lista = [...grupos.entries()].sort((a, b) => principal(entNome(a[0])) - principal(entNome(b[0])) || entNome(a[0]).localeCompare(entNome(b[0])));
    if (!lista.length) { box.innerHTML = '<div class="ig-vazio-tx">Nenhum local.</div>'; return; }
    box.innerHTML = lista.map(([eid, ls]) => {
      const fechada = !!prefs.fechadas[eid];
      const tot = ls.reduce((s, l) => { const c = porLoc.get(String(l.id)); return s + (c ? c.ativo + c.estoque : 0); }, 0);
      return `<div class="ig-emp ${fechada ? 'fechada' : ''}" data-emp="${eid}">
        <button type="button" class="ig-emp-cab" data-abre-emp="${eid}"><i class="bi bi-caret-down-fill"></i><b>${esc(entNome(eid) || 'Empresa')}</b><span>${tot}</span></button>
        <div class="ig-emp-locais">${ls.sort((a, b) => a.name.localeCompare(b.name)).map((l) => {
          const c = porLoc.get(String(l.id)) || { ativo: 0, estoque: 0 };
          const sel = prefs.sel && prefs.sel.tipo === 'local' && String(prefs.sel.id) === String(l.id) && !prefs.q;
          return `<button type="button" class="ig-loc ${sel ? 'sel' : ''}" data-loc="${l.id}" data-ent="${l.entity_id}" title="${esc(l.name)}${l.city ? ` · ${esc(l.city)}` : ''}">
            <i class="bi bi-geo-alt-fill"></i><span class="ig-loc-nome">${esc(l.name)}</span>
            <span class="ig-loc-n">${c.ativo ? `<span title="Em uso"><i class="bi bi-pc-display"></i>${c.ativo}</span>` : ''}${c.estoque ? `<span title="No Estoque de T.I."><i class="bi bi-box-seam"></i>${c.estoque}</span>` : ''}</span></button>`;
        }).join('')}</div></div>`;
    }).join('');
  }
  function desenharPessoas() {
    const box = el.querySelector('#ig-pessoas');
    if (!box) return;
    const ent = entFoco();
    const contagem = cont.pessoas.filter((p) => String(p.entity_id) === String(ent));
    const n = (uid, nome) => contagem.filter((p) => (uid ? String(p.responsible_user_id) === String(uid) : !p.responsible_user_id && p.dono_nome === nome)).reduce((s, p) => s + p.n, 0);
    const filtro = (el.querySelector('#ig-pq')?.value || '').trim().toLowerCase();
    const lista = [
      ...pessoas.map((p) => ({ uid: String(p.id), nome: p.name, sub: p.location_name || '', n: n(p.id) })),
      // quem não tem cadastro (o nome foi escrito no item)
      ...[...new Set(contagem.filter((p) => !p.responsible_user_id && p.dono_nome).map((p) => p.dono_nome))].map((nome) => ({ uid: '', nome, sub: 'sem cadastro', n: n(null, nome) })),
    ].filter((p) => !filtro || p.nome.toLowerCase().includes(filtro))
      .sort((a, b) => (b.n > 0) - (a.n > 0) || a.nome.localeCompare(b.nome));
    if (!lista.length) { box.innerHTML = `<div class="ig-vazio-tx">${ent ? 'Ninguém encontrado.' : 'Escolha uma empresa.'}</div>`; return; }
    box.innerHTML = lista.slice(0, 200).map((p) => {
      const sel = prefs.sel && prefs.sel.tipo === 'pessoa' && !prefs.q && (p.uid ? String(prefs.sel.uid) === p.uid : !prefs.sel.uid && prefs.sel.nome === p.nome);
      return `<button type="button" class="ig-pessoa ${sel ? 'sel' : ''} ${p.n ? '' : 'sem'}" ${p.uid ? `data-uid="${p.uid}"` : `data-nome="${esc(p.nome)}"`} data-ent="${ent}">
        <i class="bi ${p.uid ? 'bi-person-fill' : 'bi-person'}"></i><span class="ig-loc-nome">${esc(p.nome)}<small>${esc(p.sub)}</small></span>
        ${p.n ? `<span class="ig-loc-n"><span title="Itens com essa pessoa"><i class="bi bi-backpack"></i>${p.n}</span></span>` : ''}</button>`;
    }).join('');
  }

  // ---------- centro: painéis Ativo e Estoque ----------
  const palavra = (nome) => {
    const w = String(nome || '').toUpperCase().replace(/[^A-ZÀ-Ú0-9 ]/g, ' ').split(/\s+/).find((x) => x.length > 2 && !/^(DE|DA|DO|COM|PARA|SEM)$/.test(x));
    return w || 'OUTROS';
  };
  const titulo = (s) => s.charAt(0) + s.slice(1).toLowerCase();
  // ícone pelo nome do item (teclado, cabo, fone, toner...); se não reconhecer, o da categoria
  const ICONE_NOME = [[/MOUSE/, 'bi-mouse2'], [/TECLAD/, 'bi-keyboard'], [/HEADSET|\bFONE\b|FONES/, 'bi-headset'], [/WEBCAM|CAMERA/, 'bi-webcam'],
    [/CABO|PATCH|\bHDMI\b|\bVGA\b|EXTENSAO|ADAPTADOR/, 'bi-plug'], [/PAPEL|\bA4\b|BOBINA|ETIQUETA/, 'bi-file-earmark-text'], [/TONER|CARTUCHO|TINTA|CILINDRO/, 'bi-droplet-half'],
    [/MONITOR|\bTV\b/, 'bi-display'], [/NOTEBOOK/, 'bi-laptop'], [/CELULAR|SMARTPHONE|TABLET/, 'bi-phone'], [/ROTEADOR|SWITCH|ACCESS POINT|MODEM/, 'bi-router'],
    [/NOBREAK|ESTABILIZADOR/, 'bi-battery-charging'], [/IMPRESSORA/, 'bi-printer'], [/LEITOR|SCANNER/, 'bi-upc-scan'], [/\bSSD\b|\bHD\b|PENDRIVE|MEMORIA/, 'bi-device-ssd'],
    [/FONTE|CARREGADOR/, 'bi-lightning-charge'], [/CAIXA DE SOM|SOM\b/, 'bi-speaker'], [/MICROFONE/, 'bi-mic']];
  const icone = (a) => {
    const n = String(a.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const achou = ICONE_NOME.find(([re]) => re.test(n));
    return achou ? achou[1] : INV_ICONES[a.type] || 'bi-box';
  };
  function slot(a, origem) {
    const arrasta = origem === 'orcim' ? podeMexer : (podeMexer || (podeRetirar && origem === 'estoque'));
    const marcas = [
      a.pedido_status && !['entregue', 'cancelado'].includes(a.pedido_status) ? '<i class="bi bi-cart3 ig-m ig-m-ped" title="Pedido"></i>' : '',
      a.manut_status ? '<i class="bi bi-wrench-adjustable ig-m ig-m-man" title="Manutenção"></i>' : '',
      !a.location_id && a.responsible_name ? '<i class="bi bi-person-fill ig-m ig-m-pes" title="Com uma pessoa"></i>' : '',
    ].join('');
    return `<div class="ig-slot r-${RARO[a.status] || 'cz'} ${selecionado && String(selecionado.id) === String(a.id) && selecionado.origem === origem ? 'sel' : ''}" data-id="${a.id}" data-origem="${origem}"
      ${arrasta ? 'draggable="true"' : ''} tabindex="0" aria-label="${esc(a.name)}">
      <i class="bi ${icone(a)} ig-ico"></i>${marcas}
      ${a.controle === 'quantidade' ? `<b class="ig-qtd ${Number(a.quantity) > 0 ? '' : 'zero'}">${Number(a.quantity) || 0}</b>` : ''}
    </div>`;
  }
  function painel(lado) {
    const box = el.querySelector(`#ig-${lado}`);
    const daOrcim = lado === 'estoque' && prefs.fonte === 'orcim';
    let base;
    if (daOrcim) base = orcim.map((a) => ({ ...a, entity_id: null, location_id: null }));
    else if (lado === 'ativo') base = itens.filter((a) => ATIVO.includes(a.status) || (prefs.estado && FORA.includes(a.status)));
    else base = itens.filter((a) => ESTOQUE.includes(a.status));
    if (prefs.estado) base = base.filter((a) => a.status === prefs.estado);
    // abas de cima: categorias que existem aqui; abas de baixo: o tipo pelo nome
    const cats = [...new Set(base.map((a) => a.type))].sort((x, y) => (CAT[x] || x).localeCompare(CAT[y] || y));
    let aba = prefs.aba[lado]; if (aba !== 'todos' && !cats.includes(aba)) aba = 'todos';
    const daAba = base.filter((a) => aba === 'todos' || a.type === aba);
    const conta = {}; daAba.forEach((a) => { const w = palavra(a.name); conta[w] = (conta[w] || 0) + un(a); });
    const subs = Object.entries(conta).sort((x, y) => y[1] - x[1]).map(([w]) => w);
    let sub = prefs.sub[lado]; if (sub && !subs.includes(sub)) sub = '';
    const mostrar = daAba.filter((a) => !sub || palavra(a.name) === sub).sort((x, y) => (CAT[x.type] || '').localeCompare(CAT[y.type] || '') || String(x.name).localeCompare(String(y.name)));
    const total = mostrar.reduce((s, a) => s + un(a), 0);
    const tit = lado === 'ativo' ? '<i class="bi bi-pc-display"></i> Ativo' : daOrcim ? '<i class="bi bi-boxes"></i> Estoque da ORCIM' : '<i class="bi bi-box-seam"></i> Estoque';
    const podeSoltar = lado === 'ativo' ? (podeMexer || podeRetirar) : podeMexer;
    box.innerHTML = `<div class="ig-tit">${tit}<span class="ig-tit-n">${total} ${total === 1 ? 'item' : 'itens'}</span></div>
      <div class="ig-abas">
        <div class="ig-abas-l1"><button type="button" data-aba="todos" class="${aba === 'todos' ? 'on' : ''}">Todos</button>${cats.map((c) => `<button type="button" data-aba="${c}" class="${aba === c ? 'on' : ''}"><i class="bi ${INV_ICONES[c] || 'bi-box'}"></i> ${esc(CAT[c] || c)}</button>`).join('')}</div>
        <div class="ig-abas-l2">${subs.slice(0, 8).map((w) => `<button type="button" data-sub="${esc(w)}" class="${sub === w ? 'on' : ''}">${esc(titulo(w))} <small>${conta[w]}</small></button>`).join('')}${subs.length > 8 ? `<span class="ig-mais">+${subs.length - 8}</span>` : ''}
          ${lado === 'estoque' && veOrcim ? `<button type="button" class="ig-orcim ${daOrcim ? 'on' : ''}" data-fonte="${daOrcim ? 'local' : 'orcim'}" title="${daOrcim ? 'Voltar para o Estoque de T.I. do local' : 'Ver o Estoque da ORCIM'}"><i class="bi bi-boxes"></i> ORCIM</button>` : ''}</div>
      </div>
      <div class="ig-grade" data-drop="${lado}" ${podeSoltar ? '' : 'data-nao-solta="1"'}>${mostrar.map((a) => slot(a, daOrcim ? 'orcim' : lado)).join('')}</div>`;
    box._itens = mostrar;
  }
  // completa a grade com quadrados vazios (fica com cara de inventário de jogo)
  function completar() {
    el.querySelectorAll('.ig-grade').forEach((g) => {
      g.querySelectorAll('.ig-slot.vazio').forEach((s) => s.remove());
      const cols = Math.max(1, getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length);
      const n = g.querySelectorAll('.ig-slot').length;
      const linhas = Math.max(4, Math.ceil(n / cols) + (n % cols === 0 ? 1 : 0));
      g.insertAdjacentHTML('beforeend', '<div class="ig-slot vazio"></div>'.repeat(Math.max(0, linhas * cols - n)));
    });
  }
  function desenharCentro() {
    const onde = el.querySelector('#ig-onde');
    if (prefs.q) onde.innerHTML = `<i class="bi bi-search"></i> Busca: <b>${esc(prefs.q)}</b> <small>${itens.length} resultado(s) em todos os locais</small>`;
    else if (!prefs.sel) onde.innerHTML = 'Escolha um local';
    else if (prefs.sel.tipo === 'local') { const l = locPorId.get(String(prefs.sel.id)); onde.innerHTML = `<i class="bi bi-geo-alt-fill"></i> <b>${esc(l ? l.name : 'Local')}</b> <small>${esc(entNome(l && l.entity_id))}</small>`; }
    else onde.innerHTML = `<i class="bi bi-person-fill"></i> Com <b>${esc(prefs.sel.nome || '')}</b>`;
    painel('ativo'); painel('estoque');
    completar();
  }

  // ---------- item escolhido e log ----------
  const achar = (id, origem) => {
    const lista = origem === 'orcim' ? orcim.map((a) => ({ ...a, entity_id: null, location_id: null })) : itens;
    return lista.find((a) => String(a.id) === String(id));
  };
  function desenharDetalhe() {
    const box = el.querySelector('#ig-det');
    const a = selecionado && achar(selecionado.id, selecionado.origem);
    if (!a) { box.innerHTML = '<span class="ig-vazio-tx">Clique num item para ver os detalhes.</span>'; return; }
    const noEstoque = ESTOQUE.includes(a.status) && selecionado.origem !== 'orcim';
    box.innerHTML = `<div class="ig-det-it">${Item.titulo(a, { link: selecionado.origem !== 'orcim' })}</div>
      <div class="ig-det-info">${[a.manufacturer, a.model].filter(Boolean).map(esc).join(' ')}${a.serial_number ? ` · S/N ${esc(a.serial_number)}` : ''}${a.responsible_name ? ` · <i class="bi bi-person-fill"></i> ${esc(a.responsible_name)}` : ''}${a.price != null && invVeSegredos() ? ` · ${invMoeda(Number(a.price) * (a.controle === 'quantidade' ? Number(a.quantity || 0) : 1))}` : ''}</div>
      <div class="ig-det-bt">
        ${selecionado.origem === 'orcim' ? '<a class="btn btn-sm ig-bt" href="#/orcim"><i class="bi bi-boxes"></i> Abrir o Estoque da ORCIM</a>' : `<a class="btn btn-sm ig-bt" href="#/inventory/${a.id}"><i class="bi bi-box-arrow-up-right"></i> Abrir a ficha</a>`}
        ${noEstoque && podeRetirar && ['STOCK', 'READY'].includes(a.status) ? '<button type="button" class="btn btn-sm ig-bt" data-acao="baixa"><i class="bi bi-box-arrow-up"></i> Tirar do estoque</button>' : ''}
        ${!noEstoque && selecionado.origem !== 'orcim' && podeMexer && a.entity_id ? '<button type="button" class="btn btn-sm ig-bt" data-acao="devolver"><i class="bi bi-box-arrow-in-down"></i> Devolver ao estoque</button>' : ''}
        ${selecionado.origem !== 'orcim' && podeMexer && a.entity_id ? '<button type="button" class="btn btn-sm ig-bt" data-acao="transferir"><i class="bi bi-arrow-left-right"></i> Transferir</button>' : ''}
      </div>`;
    box.querySelectorAll('[data-acao]').forEach((b) => b.addEventListener('click', () => {
      const fim = () => depois(`${{ baixa: 'Baixa', devolver: 'Devolvido ao estoque', transferir: 'Transferido' }[b.dataset.acao]}: ${a.name}`);
      if (b.dataset.acao === 'baixa') Estoque.darBaixa(a, fim);
      else if (b.dataset.acao === 'devolver') Estoque.devolver(a, fim);
      else Estoque.transferir(a, fim);
    }));
  }
  const TIPO_MOV = { withdraw: ['bi-box-arrow-up', 'saiu do estoque'], return: ['bi-box-arrow-in-down', 'voltou ao estoque'], transfer: ['bi-arrow-left-right', 'transferido'], entry: ['bi-box-seam', 'entrou no estoque'] };
  function desenharLog() {
    const box = el.querySelector('#ig-log');
    const ids = new Set(itens.map((a) => String(a.id)));
    const daqui = movs.filter((m) => (prefs.sel && prefs.sel.tipo === 'local' && !prefs.q
      ? [String(m.from_location_id), String(m.to_location_id)].includes(String(prefs.sel.id)) : ids.has(String(m.asset_id)))).slice(0, 12);
    const hora = (d) => { const x = new Date(d); return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')} ${x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`; };
    const linhas = [
      ...logSessao.map((t) => `<div class="ig-log-l novo"><span>agora</span><i class="bi bi-stars"></i> ${esc(t)}</div>`),
      ...daqui.map((m) => { const [ic, txt] = TIPO_MOV[m.kind] || ['bi-dot', m.kind];
        const rota = m.kind === 'transfer' ? ` · ${esc(m.from_location_name || 'ORCIM')} → ${esc(m.to_location_name || '?')}` : m.reason_name ? ` · ${esc(m.reason_name)}` : '';
        return `<div class="ig-log-l"><span>${hora(m.created_at)}</span><i class="bi ${ic}"></i> <b>${esc(m.asset_name)}</b>${m.quantity > 1 ? ` ×${m.quantity}` : ''} ${txt}${rota}${m.user_name ? ` <em>(${esc(m.user_name)})</em>` : ''}</div>`; }),
    ];
    box.innerHTML = linhas.length ? linhas.join('') : '<span class="ig-vazio-tx">Nenhuma movimentação ainda.</span>';
  }

  async function recarregar({ contagem = true, log = true } = {}) {
    if (contagem) await carregarContagem();
    escolherInicial();
    await Promise.all([carregarPessoas(), carregarItens(), log ? carregarLog() : null]);
    desenharLocais(); desenharPessoas(); desenharCentro(); desenharDetalhe(); desenharLog();
  }
  // depois de uma ação: registra no log da tela e recarrega
  const depois = (texto) => { if (texto) logSessao.unshift(texto); if (logSessao.length > 6) logSessao.pop(); recarregar(); };

  // ---------- cliques ----------
  raiz.addEventListener('click', (e) => {
    const t = e.target;
    const emp = t.closest('[data-abre-emp]');
    if (emp) { const k = emp.dataset.abreEmp; prefs.fechadas[k] = !prefs.fechadas[k]; salvar(); emp.closest('.ig-emp').classList.toggle('fechada', !!prefs.fechadas[k]); return; }
    const loc = t.closest('.ig-loc');
    if (loc) { prefs.sel = { tipo: 'local', id: loc.dataset.loc }; prefs.q = ''; el.querySelector('#ig-q').value = ''; selecionado = null; salvar(); recarregar({ contagem: false, log: false }); return; }
    const pes = t.closest('.ig-pessoa');
    if (pes) { prefs.sel = { tipo: 'pessoa', uid: pes.dataset.uid || '', nome: pes.dataset.nome || pes.querySelector('.ig-loc-nome').childNodes[0].textContent.trim(), ent: pes.dataset.ent }; prefs.q = ''; el.querySelector('#ig-q').value = ''; selecionado = null; salvar(); recarregar({ contagem: false, log: false }); return; }
    const aba = t.closest('[data-aba]');
    if (aba) { const lado = aba.closest('.ig-inv').id.replace('ig-', ''); prefs.aba[lado] = aba.dataset.aba; prefs.sub[lado] = ''; salvar(); painel(lado); completar(); return; }
    const sub = t.closest('[data-sub]');
    if (sub) { const lado = sub.closest('.ig-inv').id.replace('ig-', ''); prefs.sub[lado] = prefs.sub[lado] === sub.dataset.sub ? '' : sub.dataset.sub; salvar(); painel(lado); completar(); return; }
    const fonte = t.closest('[data-fonte]');
    if (fonte) { prefs.fonte = fonte.dataset.fonte; prefs.aba.estoque = 'todos'; prefs.sub.estoque = ''; salvar(); carregarItens().then(() => { painel('estoque'); completar(); }); return; }
    const tam = t.closest('[data-tam]');
    if (tam) { prefs.tam = tam.dataset.tam; salvar(); raiz.style.setProperty('--slot', `${TAM[prefs.tam]}px`); el.querySelectorAll('[data-tam]').forEach((b) => b.classList.toggle('on', b === tam)); completar(); return; }
    const s = t.closest('.ig-slot:not(.vazio)');
    if (s) {
      selecionado = { id: s.dataset.id, origem: s.dataset.origem };
      el.querySelectorAll('.ig-slot.sel').forEach((x) => x.classList.remove('sel'));
      s.classList.add('sel');
      desenharDetalhe();
    }
  });
  raiz.addEventListener('dblclick', (e) => {
    const s = e.target.closest('.ig-slot:not(.vazio)');
    if (s && s.dataset.origem !== 'orcim') location.hash = `#/inventory/${s.dataset.id}`;
  });
  raiz.addEventListener('keydown', (e) => {
    const s = e.target.closest('.ig-slot:not(.vazio)');
    if (s && e.key === 'Enter') s.click();
  });
  el.querySelector('#ig-pq')?.addEventListener('input', desenharPessoas);
  selEnt.addEventListener('change', () => { prefs.ent = selEnt.value; salvar(); desenharLocais(); carregarPessoas().then(desenharPessoas); if (prefs.q) recarregar({ contagem: false, log: false }); });
  el.querySelector('#ig-estado').addEventListener('change', (e) => { prefs.estado = e.target.value; salvar(); desenharCentro(); });
  let esperaQ = null;
  el.querySelector('#ig-q').addEventListener('input', (e) => {
    clearTimeout(esperaQ);
    esperaQ = setTimeout(() => { prefs.q = e.target.value.trim(); salvar(); selecionado = null; recarregar({ contagem: false, log: false }); }, 350);
  });

  // ---------- dica (tooltip de jogo) ----------
  raiz.addEventListener('mouseover', (e) => {
    const s = e.target.closest('.ig-slot:not(.vazio)');
    if (!s) return;
    const a = achar(s.dataset.id, s.dataset.origem);
    if (!a) return;
    const onde = s.dataset.origem === 'orcim' ? 'Estoque da ORCIM' : a.location_name || (a.responsible_name ? `com ${a.responsible_name}` : 'sem local');
    const ped = a.pedido_status && PEDIDO_STATUS[a.pedido_status] && !['entregue', 'cancelado'].includes(a.pedido_status) ? `Pedido: ${PEDIDO_STATUS[a.pedido_status][0]}${a.pedido_ticket_id ? ` (#${a.pedido_ticket_id})` : ''}` : '';
    const man = a.manut_status && MANUT_ETAPAS[a.manut_status] ? `Manutenção: ${MANUT_ETAPAS[a.manut_status][0]}` : '';
    tip.innerHTML = `<b class="ig-tip-nome r-${RARO[a.status] || 'cz'}">${esc(a.name)}</b>
      <span>${esc(INV_TYPES[a.type] || a.type)}${a.asset_tag ? ` · ${esc(a.asset_tag)}` : a.controle === 'quantidade' ? ` · ×${Number(a.quantity) || 0}` : ''}</span>
      <span class="r-${RARO[a.status] || 'cz'}">${esc(INV_STATUS[a.status] || a.status)}</span>
      <span><i class="bi bi-geo-alt"></i> ${esc(onde)}</span>
      ${a.responsible_name && a.location_id ? `<span><i class="bi bi-person"></i> ${esc(a.responsible_name)}</span>` : ''}
      ${ped ? `<span class="ig-tip-ped">${esc(ped)}</span>` : ''}${man ? `<span class="ig-tip-man">${esc(man)}</span>` : ''}
      ${a.price != null && invVeSegredos() ? `<span class="ig-tip-preco">${invMoeda(a.price)}${a.controle === 'quantidade' ? ' / un' : ''}</span>` : ''}
      <em>${s.getAttribute('draggable') ? 'Arraste para mover · ' : ''}clique duplo abre a ficha</em>`;
    tip.classList.remove('d-none');
  });
  raiz.addEventListener('mousemove', (e) => {
    if (tip.classList.contains('d-none')) return;
    const x = Math.min(e.clientX + 16, window.innerWidth - tip.offsetWidth - 8);
    const y = e.clientY + 18 + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 18;
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  });
  raiz.addEventListener('mouseout', (e) => { if (e.target.closest('.ig-slot') && !e.relatedTarget?.closest?.('.ig-slot')) tip.classList.add('d-none'); });

  // ---------- arrastar e soltar ----------
  let arrastando = null;
  raiz.addEventListener('dragstart', (e) => {
    const s = e.target.closest('.ig-slot[draggable="true"]');
    if (!s) return;
    const a = achar(s.dataset.id, s.dataset.origem);
    if (!a) { e.preventDefault(); return; }
    arrastando = { a, origem: s.dataset.origem };
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(a.id)); } catch { /* ok */ }
    tip.classList.add('d-none');
    raiz.classList.add('ig-arrastando');
    s.classList.add('ig-pegando');
  });
  raiz.addEventListener('dragend', () => {
    arrastando = null; raiz.classList.remove('ig-arrastando');
    el.querySelectorAll('.ig-pegando, .ig-alvo').forEach((x) => x.classList.remove('ig-pegando', 'ig-alvo'));
  });
  // onde dá para soltar o que está sendo arrastado
  const alvoDe = (t) => t.closest('.ig-grade[data-drop]:not([data-nao-solta]), .ig-loc, .ig-pessoa');
  const aceita = (alvo) => {
    if (!arrastando || !alvo) return false;
    const { a, origem } = arrastando;
    if (alvo.classList.contains('ig-grade')) {
      const lado = alvo.dataset.drop;
      if (origem === 'orcim') return lado === 'ativo' && prefs.sel?.tipo === 'local' && !prefs.q;
      if (lado === origem) return false;
      if (lado === 'estoque' && prefs.fonte === 'orcim') return false;
      if (lado === 'ativo') return ESTOQUE.includes(a.status) && prefs.sel?.tipo !== 'pessoa';
      return podeMexer && !ESTOQUE.includes(a.status);
    }
    if (!podeMexer) return false;
    if (alvo.classList.contains('ig-loc')) return String(alvo.dataset.loc) !== String(a.location_id || '');
    return origem !== 'orcim' && !ESTOQUE.includes(a.status); // pessoa: só item em uso
  };
  raiz.addEventListener('dragover', (e) => {
    const alvo = alvoDe(e.target);
    if (!aceita(alvo)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    el.querySelectorAll('.ig-alvo').forEach((x) => { if (x !== alvo) x.classList.remove('ig-alvo'); });
    alvo.classList.add('ig-alvo');
  });
  raiz.addEventListener('dragleave', (e) => {
    const alvo = alvoDe(e.target);
    if (alvo && !alvo.contains(e.relatedTarget)) alvo.classList.remove('ig-alvo');
  });
  raiz.addEventListener('drop', async (e) => {
    const alvo = alvoDe(e.target);
    if (!aceita(alvo)) return;
    e.preventDefault();
    alvo.classList.remove('ig-alvo');
    const { a, origem } = arrastando || {};
    if (!a) return;
    try { await soltar(a, origem, alvo); } catch (err) { showError(err); }
  });

  // pergunta antes de mover (com quantidade, para itens contados juntos da ORCIM)
  function confirmar(titulo, corpo, botao, qtdMax) {
    return new Promise((resolve) => {
      const m = document.createElement('div');
      m.className = 'modal fade ig-modal';
      m.innerHTML = `<div class="modal-dialog modal-dialog-centered modal-sm"><div class="modal-content">
        <div class="modal-header"><h6 class="mb-0">${titulo}</h6><button class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">${corpo}
          ${qtdMax ? `<label class="form-label small mt-2 mb-1">Quantos?</label><input type="number" class="form-control form-control-sm" data-qtd min="1" max="${qtdMax}" value="${qtdMax}">
            <small class="text-muted">de ${qtdMax}</small>` : ''}
          <label class="form-label small mt-2 mb-1">Observação (vai para o histórico)</label><input class="form-control form-control-sm" data-nota maxlength="300" placeholder="opcional"></div>
        <div class="modal-footer"><button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-primary btn-sm" data-ok>${botao}</button></div></div></div>`;
      document.body.appendChild(m);
      const bm = new bootstrap.Modal(m);
      let r = null;
      m.querySelector('[data-ok]').addEventListener('click', () => {
        const q = m.querySelector('[data-qtd]');
        const n = q ? parseInt(q.value, 10) : 1;
        if (q && !(n >= 1 && n <= qtdMax)) { toast(`Escolha de 1 a ${qtdMax}.`, 'warning'); return; }
        r = { qtd: n, nota: m.querySelector('[data-nota]').value.trim() };
        bm.hide();
      });
      m.addEventListener('hidden.bs.modal', () => { m.remove(); resolve(r); });
      bm.show();
    });
  }
  const nomeLoc = (id) => (locPorId.get(String(id)) || {}).name || 'local';
  const cabItem = (a) => `<div class="ig-modal-it">${Item.titulo(a, { link: false })}</div>`;

  async function soltar(a, origem, alvo) {
    const fim = (t) => depois(t);
    // 1) do Estoque da ORCIM para o local (em uso ou no Estoque de T.I.)
    if (origem === 'orcim') {
      const locId = alvo.classList.contains('ig-loc') ? alvo.dataset.loc : prefs.sel.id;
      const L = locPorId.get(String(locId));
      if (!L) return;
      const uso = alvo.classList.contains('ig-grade') && alvo.dataset.drop === 'ativo';
      const r = await confirmar('Transferir da ORCIM', `${cabItem(a)}<div class="small mt-2">Vai para <b>${esc(L.name)}</b> (${esc(entNome(L.entity_id))}) — ${uso ? '<b>em uso</b> (Operando)' : '<b>Estoque de T.I.</b> do local'}.</div>`,
        'Transferir', a.controle === 'quantidade' ? Number(a.quantity) : 0);
      if (!r) return;
      await API.post(`/orcim/${a.id}/transferir`, { entity_id: L.entity_id, location_id: L.id, destino: uso ? 'uso' : 'estoque', quantidade: r.qtd, note: r.nota || undefined });
      toast('Transferido do Estoque da ORCIM.', 'success');
      fim(`${a.name}${a.controle === 'quantidade' ? ` ×${r.qtd}` : ''}: ORCIM → ${L.name}`);
      return;
    }
    // 2) entre os painéis do mesmo local: dar baixa (Estoque -> Ativo) ou devolver (Ativo -> Estoque)
    if (alvo.classList.contains('ig-grade')) {
      if (alvo.dataset.drop === 'ativo') {
        if (a.status === 'ORDERED') { toast('Esse item ainda não chegou: está "a caminho da ORCIM".', 'warning'); return; }
        Estoque.darBaixa(a, () => fim(`${a.name}: saiu do estoque (baixa)`));
      } else Estoque.devolver(a, () => fim(`${a.name}: voltou ao estoque`));
      return;
    }
    // 3) para outro local da lista: transferir (item com pessoa e sem local: volta para um local e deixa de ter dono)
    if (alvo.classList.contains('ig-loc')) {
      const L = locPorId.get(String(alvo.dataset.loc));
      if (!L) return;
      const r = await confirmar('Transferir', `${cabItem(a)}<div class="small mt-2">De <b>${esc(a.location_name || (a.responsible_name ? `com ${a.responsible_name}` : 'sem local'))}</b> para <b>${esc(L.name)}</b>${String(L.entity_id) !== String(a.entity_id) ? ` <span class="text-warning-emphasis">(outra empresa: ${esc(entNome(L.entity_id))})</span>` : ''}.</div>`, 'Transferir');
      if (!r) return;
      if (!a.location_id && String(L.entity_id) === String(a.entity_id)) {
        await API.patch(`/inventory/assets/${a.id}`, { location_id: L.id, responsible_user_id: null, dono_nome: null });
      } else {
        await API.post(`/stock/${a.id}/transfer`, { location_id: L.id, note: r.nota || undefined });
      }
      toast(`Transferido para ${L.name}.`, 'success');
      fim(`${a.name}: ${a.location_name || 'sem local'} → ${L.name}`);
      return;
    }
    // 4) para uma pessoa: o item fica com ela (sai do local)
    if (alvo.classList.contains('ig-pessoa')) {
      const nome = alvo.querySelector('.ig-loc-nome').childNodes[0].textContent.trim();
      if (String(alvo.dataset.ent) !== String(a.entity_id)) { toast('Essa pessoa é de outra empresa. Transfira o item para um local da empresa dela primeiro.', 'warning'); return; }
      const r = await confirmar('Deixar com uma pessoa', `${cabItem(a)}<div class="small mt-2">O item fica com <b>${esc(nome)}</b> e sai de <b>${esc(a.location_name || 'onde está')}</b>.</div>`, 'Confirmar');
      if (!r) return;
      await API.patch(`/inventory/assets/${a.id}`, alvo.dataset.uid
        ? { responsible_user_id: Number(alvo.dataset.uid), dono_nome: null, location_id: null }
        : { dono_nome: alvo.dataset.nome, responsible_user_id: null, location_id: null });
      toast(`Agora está com ${nome}.`, 'success');
      fim(`${a.name}: ${a.location_name || 'sem local'} → com ${nome}`);
    }
  }

  // a grade se ajusta quando a janela muda de tamanho
  let esperaR = null;
  const aoRedimensionar = () => { if (!document.body.contains(raiz)) { window.removeEventListener('resize', aoRedimensionar); return; } clearTimeout(esperaR); esperaR = setTimeout(completar, 150); };
  window.addEventListener('resize', aoRedimensionar);

  await recarregar();
};
