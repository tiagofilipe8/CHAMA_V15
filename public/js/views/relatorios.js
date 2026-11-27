// ---------------------------------------------------------------
// Views.relatorios — Relatórios em PDF
//   Escolhe o período, a empresa/posto e os relatórios; mostra a prévia em folhas A4
//   e o botão "Baixar PDF" abre o imprimir do navegador já com o nome do arquivo
//   (escolher "Salvar como PDF"). Gráficos em SVG/HTML puro, sem biblioteca.
//   Dados: GET /api/relatorios (server/routes/relatorios.js)
// ---------------------------------------------------------------

const REL_GRUPOS = [
  { id: 'ch', titulo: 'Chamados', icon: 'bi-ticket-detailed', secoes: [
    ['abertos', 'Chamados abertos agora'],
    ['fechados', 'Chamados fechados no período'],
    ['razoes', 'Razões dos chamados'],
    ['atraso', 'Dias e horas de atraso'],
    ['paradas', 'Operações paradas resolvidas'],
  ] },
  { id: 'pd', titulo: 'Pedidos de material', icon: 'bi-cart3', secoes: [
    ['req_posto', 'Itens pedidos por posto'],
    ['comprados', 'Itens comprados'],
    ['entregues', 'Itens entregues'],
    ['pendentes', 'Itens ainda não entregues'],
  ] },
  { id: 'po', titulo: 'Postos', icon: 'bi-geo-alt', secoes: [
    ['estrelas', 'Estrelas dos postos (sobe ou desce?)', 'notas'],
    ['problemas', 'Maiores problemas de cada posto'],
    ['custos', 'Custo de T.I. e prejuízo por posto', 'valores'],
  ] },
  { id: 'iv', titulo: 'Inventário e Estoque de T.I.', icon: 'bi-hdd-stack', req: 'inventario', secoes: [
    ['inv_ativo', 'Inventário ativo da empresa'],
    ['inv_periodo', 'Custo do inventário no período'],
    ['estoque', 'Estoque de T.I. e o custo dele'],
  ] },
];

// Fogo em pixel art (2 quadros que se alternam na tela; no PDF fica parado no primeiro)
const REL_FOGO = (() => {
  const cores = { 1: '#b91c1c', 2: '#f97316', 3: '#facc15', 4: '#fef3c7' };
  const base = ['..1122321211', '.11223332211', '112233433221', '122334443321', '122344444321',
    '122344444321', '.1223444321.', '..12233221..', '...111111...'];
  const q1 = ['......1.....', '.....11.....', '.....121..1.', '....1221..1.', '..1.12221.1.', ...base];
  const q2 = ['....1.......', '....11....1.', '...121....1.', '...1221..11.', '.1.122211121', ...base];
  const desenha = (linhas) => linhas.map((l, y) => [...l].map((c, x) => (cores[c]
    ? `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${cores[c]}"/>` : '')).join('')).join('');
  return (tam = 40) => `<svg class="rl-fogo" width="${tam}" height="${Math.round(tam * 14 / 12)}" viewBox="0 0 12 14" shape-rendering="crispEdges" aria-hidden="true">
    <g class="rl-fogo-a">${desenha(q1)}</g><g class="rl-fogo-b">${desenha(q2)}</g></svg>`;
})();

Views.relatorios = async function relatorios(el) {
  const user = API.user || {};
  if (!Roles.canSeeDashboard(user)) {
    location.hash = '#/tickets';
    toast('Seu perfil não vê os relatórios.', 'warning');
    return;
  }
  const can = (p) => Roles.can(user, p);
  const pode = { notas: can('ticket.rating'), valores: can('inventory.secrets'), inventario: can('stock.report') };
  const disponivel = (g, s) => (!g.req || pode[g.req]) && (!s[2] || pode[s[2]]);

  const hoje = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const PRESETS = {
    mes: () => [iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), iso(hoje)],
    mes_passado: () => [iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)), iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0))],
    tri: () => [iso(new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1)), iso(hoje)],
    ano: () => [`${hoje.getFullYear()}-01-01`, iso(hoje)],
    ano_passado: () => [`${hoje.getFullYear() - 1}-01-01`, `${hoje.getFullYear() - 1}-12-31`],
  };
  const NOMES_PRESET = [['mes', 'Este mês'], ['mes_passado', 'Mês passado'], ['tri', 'Últimos 3 meses'], ['ano', 'Este ano'], ['ano_passado', 'Ano passado']];

  let prefs = { preset: 'mes', de: '', ate: '', agrupar: '', entity: '', posto: '', secoes: null };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('rel_prefs') || '{}') }; } catch { /* padrão */ }
  if (prefs.preset && PRESETS[prefs.preset]) [prefs.de, prefs.ate] = PRESETS[prefs.preset]();
  if (!prefs.de || !prefs.ate) [prefs.de, prefs.ate] = PRESETS.mes();
  const todas = REL_GRUPOS.flatMap((g) => g.secoes.filter((s) => disponivel(g, s)).map((s) => s[0]));
  let marcadas = new Set(Array.isArray(prefs.secoes) ? prefs.secoes.filter((s) => todas.includes(s)) : todas);
  const salvar = () => { try { localStorage.setItem('rel_prefs', JSON.stringify({ ...prefs, secoes: [...marcadas] })); } catch { /* sem armazenamento */ } };

  el.innerHTML = `
    <div class="rl-tela">
      <div class="card panel-card rl-filtros mb-3">
        <div class="rl-linha">
          <span class="cz-flabel"><i class="bi bi-calendar3"></i> Período</span>
          <div class="seg rl-presets" role="group" aria-label="Período">${NOMES_PRESET.map(([k, r]) => `<button type="button" data-preset="${k}">${r}</button>`).join('')}</div>
          <span class="cz-ou">ou de</span>
          <input type="date" class="form-control form-control-sm rl-data" id="rl-de">
          <span class="cz-ou">até</span>
          <input type="date" class="form-control form-control-sm rl-data" id="rl-ate">
        </div>
        <div class="rl-linha">
          <span class="cz-flabel"><i class="bi bi-bar-chart"></i> Gráficos por</span>
          <div class="seg" role="group" aria-label="Agrupar gráficos" id="rl-agrupar">
            <button type="button" data-ag="">Automático</button><button type="button" data-ag="semana">Semana</button>
            <button type="button" data-ag="mes">Mês</button><button type="button" data-ag="ano">Ano</button>
          </div>
          <span class="cz-flabel ms-md-3" id="rl-ent-rot" style="display:none"><i class="bi bi-building"></i> Empresa</span>
          <select class="form-select form-select-sm cz-sel" id="rl-ent" style="display:none"></select>
          <span class="cz-flabel"><i class="bi bi-geo-alt"></i> Posto</span>
          <select class="form-select form-select-sm cz-sel" id="rl-posto"><option value="">Todos os postos</option></select>
        </div>
      </div>

      <div class="card panel-card mb-3">
        <div class="card-body">
          <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
            <h6 class="m-0 me-auto"><i class="bi bi-list-check"></i> O que vai no PDF</h6>
            <button type="button" class="btn btn-sm btn-link" id="rl-todos">Marcar tudo</button>
            <button type="button" class="btn btn-sm btn-link" id="rl-nenhum">Desmarcar tudo</button>
          </div>
          <div class="rl-grupos">
            ${REL_GRUPOS.map((g) => {
              const secs = g.secoes.filter((s) => disponivel(g, s));
              if (!secs.length) return '';
              return `<div class="rl-grupo">
                <label class="rl-grupo-tit"><input type="checkbox" class="form-check-input" data-grupo="${g.id}"> <i class="bi ${g.icon}"></i> ${esc(g.titulo)}</label>
                ${secs.map((s) => `<label class="rl-op"><input type="checkbox" class="form-check-input" data-secao="${s[0]}" data-g="${g.id}"> ${esc(s[1])}</label>`).join('')}
              </div>`;
            }).join('')}
          </div>
          ${!pode.valores ? '<div class="small text-muted mt-2"><i class="bi bi-lock"></i> Seu perfil não vê preços: os valores em dinheiro ficam fora do relatório.</div>' : ''}
          <div class="d-flex flex-wrap gap-2 mt-3">
            <button type="button" class="btn btn-outline-secondary" id="rl-ver"><i class="bi bi-eye"></i> Ver prévia</button>
            <button type="button" class="btn btn-primary" id="rl-pdf"><i class="bi bi-file-earmark-pdf"></i> Baixar PDF</button>
            <span class="small text-muted align-self-center" id="rl-dica">No "Baixar PDF", escolha <b>Salvar como PDF</b> no destino da impressão.</span>
          </div>
        </div>
      </div>
      <div id="rl-previa"></div>
    </div>`;

  const $ = (s) => el.querySelector(s);
  const deEl = $('#rl-de'); const ateEl = $('#rl-ate');
  const marcarBotoes = () => {
    el.querySelectorAll('.rl-presets button').forEach((b) => b.classList.toggle('active', b.dataset.preset === prefs.preset));
    el.querySelectorAll('#rl-agrupar button').forEach((b) => b.classList.toggle('active', b.dataset.ag === (prefs.agrupar || '')));
    deEl.value = prefs.de; ateEl.value = prefs.ate;
  };
  const marcarCaixas = () => {
    el.querySelectorAll('[data-secao]').forEach((c) => { c.checked = marcadas.has(c.dataset.secao); });
    el.querySelectorAll('[data-grupo]').forEach((c) => {
      const filhos = [...el.querySelectorAll(`[data-g="${c.dataset.grupo}"]`)];
      const n = filhos.filter((f) => f.checked).length;
      c.checked = n === filhos.length; c.indeterminate = n > 0 && n < filhos.length;
    });
  };
  marcarBotoes(); marcarCaixas();

  el.querySelectorAll('.rl-presets button').forEach((b) => b.addEventListener('click', () => {
    prefs.preset = b.dataset.preset; [prefs.de, prefs.ate] = PRESETS[prefs.preset](); salvar(); marcarBotoes();
  }));
  [deEl, ateEl].forEach((i) => i.addEventListener('change', () => {
    prefs.preset = ''; prefs.de = deEl.value || prefs.de; prefs.ate = ateEl.value || prefs.ate;
    if (prefs.de > prefs.ate) [prefs.de, prefs.ate] = [prefs.ate, prefs.de];
    salvar(); marcarBotoes();
  }));
  el.querySelectorAll('#rl-agrupar button').forEach((b) => b.addEventListener('click', () => { prefs.agrupar = b.dataset.ag; salvar(); marcarBotoes(); }));
  el.querySelectorAll('[data-secao]').forEach((c) => c.addEventListener('change', () => {
    if (c.checked) marcadas.add(c.dataset.secao); else marcadas.delete(c.dataset.secao); salvar(); marcarCaixas();
  }));
  el.querySelectorAll('[data-grupo]').forEach((c) => c.addEventListener('change', () => {
    el.querySelectorAll(`[data-g="${c.dataset.grupo}"]`).forEach((f) => { if (c.checked) marcadas.add(f.dataset.secao); else marcadas.delete(f.dataset.secao); });
    salvar(); marcarCaixas();
  }));
  $('#rl-todos').addEventListener('click', () => { marcadas = new Set(todas); salvar(); marcarCaixas(); });
  $('#rl-nenhum').addEventListener('click', () => { marcadas = new Set(); salvar(); marcarCaixas(); });

  // empresas e postos
  const entSel = $('#rl-ent'); const postoSel = $('#rl-posto');
  let locais = [];
  const montarPostos = () => {
    const lista = locais.filter((l) => !prefs.entity || String(l.entity_id) === String(prefs.entity));
    postoSel.innerHTML = '<option value="">Todos os postos</option>' + lista.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
    if (!lista.some((l) => String(l.id) === String(prefs.posto))) prefs.posto = '';
    postoSel.value = prefs.posto;
  };
  Promise.all([API.get('/entities').catch(() => []), API.get('/locations').catch(() => [])]).then(([ents, locs]) => {
    const ativas = (ents || []).filter((e) => e.active);
    locais = (locs || []).filter((l) => l.active !== false);
    if (ativas.length > 1) {
      entSel.innerHTML = '<option value="">Todas as empresas</option>' + ativas.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
      entSel.value = ativas.some((e) => String(e.id) === String(prefs.entity)) ? prefs.entity : '';
      entSel.style.display = ''; $('#rl-ent-rot').style.display = '';
    } else prefs.entity = '';
    montarPostos();
  });
  entSel.addEventListener('change', () => { prefs.entity = entSel.value; salvar(); montarPostos(); });
  postoSel.addEventListener('change', () => { prefs.posto = postoSel.value; salvar(); });

  let identidade = null;
  const carregarIdentidade = async () => {
    if (identidade) return identidade;
    try { identidade = await (await fetch('/api/settings/public')).json(); } catch { identidade = {}; }
    return identidade;
  };

  const gerar = async () => {
    if (!marcadas.size) { toast('Marque pelo menos um relatório.', 'warning'); return null; }
    const previa = $('#rl-previa');
    previa.innerHTML = spinner();
    const qs = new URLSearchParams({ de: prefs.de, ate: prefs.ate, secoes: [...marcadas].join(',') });
    if (prefs.agrupar) qs.set('agrupar', prefs.agrupar);
    if (prefs.entity) qs.set('entity_id', prefs.entity);
    if (prefs.posto) qs.set('location_id', prefs.posto);
    try {
      const [r, id] = await Promise.all([API.get('/relatorios?' + qs.toString()), carregarIdentidade()]);
      const ordem = REL_GRUPOS.flatMap((g) => g.secoes.map((s) => s[0])).filter((s) => marcadas.has(s));
      previa.innerHTML = `<div class="rl-doc sem-sigla" id="rl-doc">${RelDoc.montar(r, ordem, id)}</div>`;
      return r;
    } catch (e) {
      previa.innerHTML = ''; showError(e); return null;
    }
  };
  $('#rl-ver').addEventListener('click', async () => {
    if (await gerar()) $('#rl-previa').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#rl-pdf').addEventListener('click', async () => {
    const r = await gerar();
    if (r) RelDoc.imprimir(r);
  });
};

// ---------------------------------------------------------------
// RelDoc — monta o documento (folhas A4) a partir dos dados da API
// ---------------------------------------------------------------
const RelDoc = (() => {
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const num = (v) => Number(v || 0).toLocaleString('pt-BR');
  const dataBR = (s) => { if (!s) return '—'; const d = new Date(String(s).length === 10 ? `${s}T12:00:00` : s); return d.toLocaleDateString('pt-BR'); };
  const dataHoraBR = (s) => (s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const horas = (h) => {
    h = Math.max(0, Math.round(Number(h) || 0));
    if (h < 1) return 'menos de 1 h';
    const d = Math.floor(h / 24); const r = h % 24;
    return d ? `${d} d${r ? ` ${r} h` : ''}` : `${r} h`;
  };
  const minutos = (m) => { m = Math.max(0, Math.round(Number(m) || 0)); return m < 60 ? `${m} min` : horas(m / 60); };
  const nota = (n) => (n === null || n === undefined ? '—' : Number(n).toFixed(1).replace('.', ','));
  const estrelas = (n) => {
    if (n === null || n === undefined) return '<span class="rl-mut">sem nota</span>';
    const cheias = Math.round(Number(n));
    return `<span class="rl-est">${'★'.repeat(cheias)}<span class="rl-est-v">${'★'.repeat(5 - cheias)}</span></span> ${nota(n)}`;
  };
  const STATUS = { 1: 'Novo', 2: 'Atribuído', 3: 'Em andamento', 4: 'Em pausa', 5: 'Resolvido', 6: 'Fechado', 7: 'Cancelado' };
  const ETAPA = { solicitado: 'Pedido', comprado: 'Comprado', chegou: 'Na ORCIM', rota: 'A caminho do local', entregue: 'Entregue', cancelado: 'Cancelado' };
  // INV_TYPES vem de inventory.js, que carrega depois deste arquivo: procurar só na hora de usar
  const tipoNome = (t) => (typeof INV_TYPES !== 'undefined' && INV_TYPES[t]) || t;
  const EST = { STOCK: 'Em estoque', READY: 'Na ORCIM (aguardando entrega)', ORDERED: 'Comprado (aguardando chegar)' };

  // ---- baldes do período (semana começa na segunda, como o date_trunc do Postgres) ----
  function baldes(per) {
    const lista = [];
    const d = new Date(`${per.de}T12:00:00`);
    const fim = new Date(`${per.ate}T12:00:00`);
    if (per.agrupar === 'semana') { const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); }
    else if (per.agrupar === 'mes') d.setDate(1);
    else { d.setMonth(0, 1); }
    const k = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    while (d <= fim && lista.length < 400) {
      const rot = per.agrupar === 'semana' ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
        : per.agrupar === 'mes' ? `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}` : String(d.getFullYear());
      lista.push({ chave: k(d), rot });
      if (per.agrupar === 'semana') d.setDate(d.getDate() + 7);
      else if (per.agrupar === 'mes') d.setMonth(d.getMonth() + 1);
      else d.setFullYear(d.getFullYear() + 1);
    }
    return lista;
  }
  const nomeBalde = (per) => ({ semana: 'semana', mes: 'mês', ano: 'ano' }[per.agrupar]);

  // ---- gráficos ----
  // barras horizontais: [{ rot, v, extra }]
  function barras(itens, { fmt = num, cor = 'var(--rl-c1)', max = 12 } = {}) {
    const lista = itens.slice(0, max);
    if (!lista.length) return '<p class="rl-vazio">Nada no período.</p>';
    const topo = Math.max(...lista.map((i) => Number(i.v) || 0), 1);
    return `<div class="rl-barras">${lista.map((i) => `
      <div class="rl-barra"><span class="rl-barra-rot" title="${esc(i.rot)}">${esc(i.rot)}${i.extra ? ` <small>(${i.extra})</small>` : ""}</span>
        <span class="rl-barra-trilho"><i style="width:${Math.max(1.5, (Number(i.v) || 0) / topo * 100)}%;background:${i.cor || cor}"></i></span>
        <b>${fmt(i.v)}</b></div>`).join('')}</div>`;
  }
  // colunas no tempo: series = [{ nome, cor, valores: {chave: v} }]; linha = { nome, cor, valores } (eixo próprio)
  // eixo: número curto (R$ 2,6 mil) para caber na margem
  const curto = (v) => Number(v || 0).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
  const moedaCurta = (v) => `R$ ${curto(v)}`;
  function colunas(bs, series, { fmt = num, linha = null, fmtLinha = fmt, altura = 190 } = {}) {
    const eixo = fmt === moeda ? moedaCurta : fmt === num ? curto : fmt;
    const eixoL = fmtLinha === moeda ? moedaCurta : fmtLinha === num ? curto : fmtLinha;
    if (!bs.length) return '';
    const W = 680; const H = altura; const pe = 58; const pd = linha ? 66 : 12; const pt = 14; const pb = 30;
    const larg = (W - pe - pd) / bs.length;
    const maxV = Math.max(1, ...series.flatMap((s) => bs.map((b) => Number(s.valores[b.chave]) || 0)));
    const maxL = linha ? Math.max(1, ...bs.map((b) => Number(linha.valores[b.chave]) || 0)) : 1;
    const y = (v, m) => pt + (H - pt - pb) * (1 - v / m);
    const grade = [0, 0.5, 1].map((f) => `<line x1="${pe}" x2="${W - pd}" y1="${y(maxV * f, maxV)}" y2="${y(maxV * f, maxV)}" class="rl-grade"/>
      <text x="${pe - 6}" y="${y(maxV * f, maxV) + 4}" text-anchor="end" class="rl-eixo">${esc(eixo(maxV * f))}</text>`).join('');
    const passo = Math.ceil(bs.length / 14);
    const cols = bs.map((b, i) => {
      const lc = larg * 0.78 / series.length;
      const x0 = pe + i * larg + larg * 0.11;
      const rects = series.map((s, j) => {
        const v = Number(s.valores[b.chave]) || 0;
        return `<rect x="${x0 + j * lc}" y="${y(v, maxV)}" width="${Math.max(1, lc - 1)}" height="${Math.max(0, H - pb - y(v, maxV))}" rx="2" fill="${s.cor}"><title>${esc(b.rot)} · ${esc(s.nome)}: ${esc(fmt(v))}</title></rect>
          ${bs.length <= 16 && v ? `<text x="${x0 + j * lc + lc / 2}" y="${y(v, maxV) - 3}" text-anchor="middle" class="rl-val">${esc(fmt(v))}</text>` : ''}`;
      }).join('');
      const rot = i % passo === 0 ? `<text x="${pe + i * larg + larg / 2}" y="${H - pb + 16}" text-anchor="middle" class="rl-eixo">${esc(b.rot)}</text>` : '';
      return rects + rot;
    }).join('');
    let lin = '';
    if (linha) {
      const pts = bs.map((b, i) => `${pe + i * larg + larg / 2},${y(Number(linha.valores[b.chave]) || 0, maxL)}`);
      lin = `<polyline points="${pts.join(' ')}" fill="none" stroke="${linha.cor}" stroke-width="2.5"/>
        ${pts.map((p) => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3" fill="${linha.cor}"/>`).join('')}
        <text x="${W - pd + 6}" y="${y(maxL, maxL) + 4}" class="rl-eixo" fill="${linha.cor}">${esc(eixoL(maxL))}</text>
        <text x="${W - pd + 6}" y="${y(0, maxL) + 4}" class="rl-eixo">${esc(eixoL(0))}</text>`;
    }
    const legenda = [...series, ...(linha ? [{ ...linha, linha: true }] : [])]
      .map((s) => `<span><i class="${s.linha ? 'rl-leg-l' : ''}" style="background:${s.cor}"></i>${esc(s.nome)}</span>`).join('');
    return `<div class="rl-graf"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${grade}${cols}${lin}</svg>
      <div class="rl-leg">${legenda}</div></div>`;
  }
  // mini linha (estrelas de 0 a 5 por balde)
  function mini(bs, valores) {
    const pts = bs.map((b, i) => (valores[b.chave] === undefined ? null : [i, valores[b.chave]])).filter(Boolean);
    if (pts.length < 2) return '<span class="rl-mut">—</span>';
    const W = 120; const H = 28; const px = (i) => 3 + (W - 6) * (bs.length > 1 ? i / (bs.length - 1) : 0.5); const py = (v) => H - 3 - (H - 6) * (v / 5);
    return `<svg class="rl-mini" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><line x1="0" x2="${W}" y1="${py(2.5)}" y2="${py(2.5)}" class="rl-grade"/>
      <polyline points="${pts.map(([i, v]) => `${px(i)},${py(v)}`).join(' ')}" fill="none" stroke="var(--rl-c1)" stroke-width="2"/>
      ${pts.map(([i, v]) => `<circle cx="${px(i)}" cy="${py(v)}" r="2.2" fill="var(--rl-c1)"/>`).join('')}</svg>`;
  }
  const kpis = (lista) => `<div class="rl-kpis">${lista.filter(Boolean).map(([v, r, tom]) => `<div class="rl-kpi ${tom ? `rl-${tom}` : ''}"><b>${v}</b><span>${r}</span></div>`).join('')}</div>`;
  const tabela = (cab, linhas, { vazio = 'Nada no período.', classe = '' } = {}) => (!linhas.length ? `<p class="rl-vazio">${vazio}</p>`
    : `<table class="rl-tab ${classe}"><thead><tr>${cab.map((c) => `<th class="${c[1] || ''}">${c[0]}</th>`).join('')}</tr></thead>
      <tbody>${linhas.map((l) => `<tr>${l.map((c, i) => `<td class="${cab[i][1] || ''}">${c ?? '—'}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
  const porChave = (rows, k = 'balde', v = 'n') => Object.fromEntries((rows || []).map((r) => [String(r[k]).slice(0, 10), Number(r[v]) || 0]));
  const somar = (rows, k) => (rows || []).reduce((s, r) => s + (Number(r[k]) || 0), 0);
  let variasEmpresas = true; // com uma empresa só, o nome dela não se repete em cada linha
  const ondeTxt = (r) => esc(r.posto) + (variasEmpresas && r.empresa ? `<small class="rl-mut d-block">${esc(r.empresa)}</small>` : '');
  const sec = (id, icon, titulo, sub, corpo, extra = '') => `<section class="rl-sec" data-sec="${id}">
      <h2><i class="bi ${icon}"></i> ${titulo}${extra}</h2>${sub ? `<p class="rl-sub">${sub}</p>` : ''}${corpo}</section>`;

  // ---- seções ----
  const S = {};
  S.abertos = (d) => {
    const L = d.abertos || [];
    const parados = L.filter((t) => Number(t.priority) === 4).length;
    const velhos = L.filter((t) => t.horas_aberto >= 72).length;
    return sec('abertos', 'bi-ticket-detailed', 'Chamados abertos agora', 'Chamados que ainda não foram resolvidos, do mais urgente para o menos urgente.',
      kpis([[num(L.length), 'abertos'], [num(parados), 'operação parada', parados ? 'ruim' : ''], [num(velhos), 'abertos há mais de 3 dias', velhos ? 'medio' : '']])
      + tabela([['#'], ['Chamado'], ['Posto'], ['Urgência'], ['Situação'], ['Técnico'], ['Aberto há', 'rl-num']],
        L.map((t) => [`#${t.id}`, esc(t.title), ondeTxt(t), `<span class="rl-urg rl-urg-${t.priority}">${esc(t.urgencia || '—')}</span>`, STATUS[t.status], esc(t.tecnico || 'Sem técnico'), horas(t.horas_aberto)]),
        { vazio: 'Nenhum chamado aberto. 🎉' }));
  };
  S.fechados = (d, r, bs) => {
    const L = d.fechados || [];
    const media = L.length ? somar(L, 'horas') / L.length : 0;
    const comNota = L.filter((t) => t.nota !== null && t.nota !== undefined);
    return sec('fechados', 'bi-check2-circle', 'Chamados fechados no período', `Abertos × fechados por ${nomeBalde(r.periodo)} e a lista dos fechados.`,
      kpis([[num(L.length), 'fechados'], [num(somar(d.fechados_serie, 'n')), 'abertos no período'], [horas(media), 'tempo médio para resolver'],
        r.pode.notas && comNota.length ? [nota(somar(comNota, 'nota') / comNota.length) + ' ★', 'nota média dos usuários'] : null])
      + colunas(bs, [{ nome: 'Abertos', cor: 'var(--rl-c3)', valores: porChave(d.fechados_serie) }, { nome: 'Fechados', cor: 'var(--rl-c1)', valores: porChave(d.fechados_serie2) }])
      + tabela([['#'], ['Chamado'], ['Posto'], ['Fechado em'], ['Levou', 'rl-num'], ['Técnico'], ...(r.pode.notas ? [['Causa'], ['Nota', 'rl-num']] : [])],
        L.map((t) => [`#${t.id}`, esc(t.title), ondeTxt(t), dataHoraBR(t.fechado_em), horas(t.horas), esc(t.tecnico || '—'),
          ...(r.pode.notas ? [esc(t.causa || '—'), t.nota === null || t.nota === undefined ? '—' : `${t.nota} ★`] : [])])));
  };
  S.razoes = (d, r) => {
    const ab = d.razoes_abertura || []; const fe = d.razoes_fechamento || [];
    return sec('razoes', 'bi-question-circle', 'Razões dos chamados', 'Por que os chamados foram abertos (o problema escolhido) e, ao fechar, o que causou.',
      `<div class="rl-2col"><div><h3>Por que abriram</h3>${barras(ab.map((x) => ({ rot: x.nome, v: x.total })), { max: 15 })}</div>
      ${r.pode.notas ? `<div><h3>O que causou (no encerramento)</h3>${barras(fe.map((x) => ({ rot: x.nome, v: x.total })), { cor: 'var(--rl-c2)', max: 15 })}</div>` : ''}</div>`);
  };
  S.atraso = (d) => {
    const L = d.atraso || []; const tot = (d.atraso_total || [])[0] || {};
    const abertos = L.filter((t) => Number(t.status) <= 4);
    const media = L.length ? somar(L, 'horas_atraso') / L.length : 0;
    const pct = tot.com_prazo ? Math.round((tot.no_prazo / tot.com_prazo) * 100) : null;
    return sec('atraso', 'bi-hourglass-split', 'Dias e horas de atraso', 'Chamados que passaram do prazo (SLA; sem SLA, a previsão da TI; sem previsão, o dia que o usuário precisava).',
      kpis([[num(L.length), 'atrasados'], [num(abertos.length), 'ainda abertos e atrasados', abertos.length ? 'ruim' : ''], [horas(media), 'atraso médio'],
        pct === null ? null : [`${pct}%`, 'fechados dentro do prazo', pct >= 80 ? 'bom' : pct >= 50 ? 'medio' : 'ruim']])
      + barras(L.slice(0, 10).map((t) => ({ rot: `#${t.id} ${t.title}`, v: t.horas_atraso, cor: Number(t.status) <= 4 ? 'var(--rl-c4)' : 'var(--rl-c3)' })), { fmt: horas, max: 10 })
      + tabela([['#'], ['Chamado'], ['Posto'], ['Prazo'], ['Situação'], ['Atraso', 'rl-num']],
        L.map((t) => [`#${t.id}`, esc(t.title), ondeTxt(t), dataHoraBR(t.prazo), Number(t.status) <= 4 ? '<b class="rl-ruim-t">Aberto</b>' : `Fechado ${dataBR(t.fim)}`, `<b>${horas(t.horas_atraso)}</b>`]),
        { vazio: 'Nenhum chamado atrasado no período. 👏' }));
  };
  S.paradas = (d) => {
    const L = d.paradas || []; const ab = ((d.paradas_abertas || [])[0] || {}).n || 0;
    const media = L.length ? somar(L, 'minutos') / L.length : 0;
    const rapido = L.length ? Math.min(...L.map((t) => Number(t.minutos) || 0)) : 0;
    const titulo = L.length ? `Operações paradas resolvidas!` : 'Operações paradas resolvidas';
    return sec('paradas', 'bi-fire', titulo, 'Chamados de urgência "Operação parada" (não dava para trabalhar ou vender) que a TI resolveu no período.',
      `<div class="rl-fogo-box">${REL_FOGO(64)}<div><b class="rl-fogo-n">${num(L.length)}</b> ${L.length === 1 ? 'incêndio apagado' : 'incêndios apagados'}
        <div class="rl-mut">tempo médio para voltar a funcionar: <b>${minutos(media)}</b>${L.length ? ` · o mais rápido: <b>${minutos(rapido)}</b>` : ''}${ab ? ` · <span class="rl-ruim-t">${ab} ainda pegando fogo</span>` : ''}</div></div></div>`
      + tabela([[''], ['#'], ['Chamado'], ['Posto'], ['Resolvido em'], ['Parado por', 'rl-num'], ['Quem resolveu']],
        L.map((t) => [REL_FOGO(14), `#${t.id}`, esc(t.title), ondeTxt(t), dataHoraBR(t.fechado_em), minutos(t.minutos), esc(t.tecnico || '—')]),
        { vazio: 'Nenhuma operação parada no período.' }));
  };

  S.req_posto = (d, r) => {
    const L = d.req_posto || [];
    const postos = new Map();
    L.forEach((x) => {
      const k = `${x.empresa}|${x.posto}`;
      const p = postos.get(k) || { empresa: x.empresa, posto: x.posto, qtd: 0, valor: 0, semPreco: 0, chamados: 0, itens: [] };
      p.qtd += x.qtd; p.valor += Number(x.valor) || 0; p.semPreco += Number(x.sem_preco) || 0; p.itens.push(x);
      postos.set(k, p);
    });
    const lista = [...postos.values()].sort((a, b) => (r.pode.valores ? b.valor - a.valor : 0) || b.qtd - a.qtd);
    const vv = r.pode.valores;
    return sec('req_posto', 'bi-bag', 'Itens pedidos por posto', `Pedidos de material dos chamados abertos no período, somados por posto${vv ? ', com quantidade e valor' : ''}.`,
      kpis([[num(somar(lista, 'qtd')), 'itens pedidos'], [num(lista.length), 'postos que pediram'], vv ? [moeda(somar(lista, 'valor')), 'valor dos itens com preço'] : null])
      + `<div class="rl-2col"><div><h3>Quantidade por posto</h3>${barras([...lista].sort((a, b) => b.qtd - a.qtd).map((p) => ({ rot: p.posto, v: p.qtd })), { max: 12 })}</div>
        ${vv ? `<div><h3>Valor por posto</h3>${barras([...lista].sort((a, b) => b.valor - a.valor).map((p) => ({ rot: p.posto, v: p.valor })), { fmt: moeda, cor: 'var(--rl-c2)', max: 12 })}</div>` : ''}</div>`
      + (!lista.length ? '' : `<table class="rl-tab"><thead><tr><th>Posto / item</th><th class="rl-num">Qtd.</th>${vv ? '<th class="rl-num">Valor</th>' : ''}</tr></thead><tbody>
        ${lista.map((p) => `<tr class="rl-tab-grupo"><td>${esc(p.posto)} <small class="rl-mut">${esc(p.empresa)}</small></td><td class="rl-num">${num(p.qtd)}</td>${vv ? `<td class="rl-num">${moeda(p.valor)}${p.semPreco ? ` <small class="rl-mut">(${p.semPreco} sem preço)</small>` : ''}</td>` : ''}</tr>
          ${p.itens.map((x) => `<tr><td class="rl-ind">${esc(x.item)}</td><td class="rl-num">${num(x.qtd)}</td>${vv ? `<td class="rl-num">${x.valor ? moeda(x.valor) : '—'}</td>` : ''}</tr>`).join('')}`).join('')}
        </tbody></table>`));
  };
  const listaItens = (L, r, quandoRot) => tabela([['Item'], ['Qtd.', 'rl-num'], ['Posto'], ['Chamado'], [quandoRot], ['Etapa agora'], ...(r.pode.valores ? [['Valor', 'rl-num']] : [])],
    L.map((x) => [esc(x.item), `${num(x.qtd)} ${esc(x.unit || '')}`, ondeTxt(x), `#${x.ticket_id}`, dataBR(x.quando), ETAPA[x.status] || x.status, ...(r.pode.valores ? [x.valor ? moeda(x.valor) : '—'] : [])]));
  S.comprados = (d, r) => {
    const L = d.comprados || [];
    return sec('comprados', 'bi-cart-check', 'Itens comprados', 'Itens dos pedidos que foram marcados como comprados no período.',
      kpis([[num(somar(L, 'qtd')), 'itens comprados'], r.pode.valores ? [moeda(somar(L, 'valor')), 'total gasto'] : null]) + listaItens(L, r, 'Comprado em'));
  };
  S.entregues = (d, r) => {
    const L = d.entregues || [];
    return sec('entregues', 'bi-box-seam', 'Itens entregues', 'Itens que chegaram ao posto no período.',
      kpis([[num(somar(L, 'qtd')), 'itens entregues'], r.pode.valores ? [moeda(somar(L, 'valor')), 'valor entregue'] : null]) + listaItens(L, r, 'Entregue em'));
  };
  S.pendentes = (d, r) => {
    const L = d.pendentes || [];
    const atrasados = L.filter((x) => x.previsao && String(x.previsao).slice(0, 10) < new Date().toISOString().slice(0, 10)).length;
    const porEtapa = {};
    L.forEach((x) => { porEtapa[x.status] = (porEtapa[x.status] || 0) + x.qtd; });
    return sec('pendentes', 'bi-hourglass', 'Itens ainda não entregues', 'Tudo o que foi pedido e ainda não chegou ao posto (hoje), do pedido mais antigo para o mais novo.',
      kpis([[num(somar(L, 'qtd')), 'itens esperando'], [num(atrasados), 'com a previsão vencida', atrasados ? 'ruim' : ''], r.pode.valores ? [moeda(somar(L, 'valor')), 'valor'] : null])
      + barras(['solicitado', 'comprado', 'chegou', 'rota'].map((s) => ({ rot: ETAPA[s], v: porEtapa[s] || 0 })), { cor: 'var(--rl-c3)' })
      + tabela([['Item'], ['Qtd.', 'rl-num'], ['Posto'], ['Chamado'], ['Pedido há', 'rl-num'], ['Etapa agora'], ['Previsão'], ...(r.pode.valores ? [['Valor', 'rl-num']] : [])],
        L.map((x) => [esc(x.item), `${num(x.qtd)} ${esc(x.unit || '')}`, ondeTxt(x), `#${x.ticket_id}`, `${x.dias} d`, ETAPA[x.status] || x.status, dataBR(x.previsao), ...(r.pode.valores ? [x.valor ? moeda(x.valor) : '—'] : [])]),
        { vazio: 'Nenhum item esperando entrega. 🎉' }));
  };

  S.estrelas = (d, r, bs) => {
    const serie = d.estrelas_serie || []; const mes = d.estrelas_mes || [];
    const postos = new Map();
    const pega = (x) => { const k = `${x.empresa}|${x.posto}`; if (!postos.has(k)) postos.set(k, { empresa: x.empresa, posto: x.posto, valores: {}, soma: 0, n: 0, atual: null, anterior: null }); return postos.get(k); };
    serie.forEach((x) => { const p = pega(x); p.valores[x.balde] = x.media; p.soma += x.media * x.n; p.n += x.n; });
    mes.forEach((x) => { const p = pega(x); p.atual = x.mes_atual; p.anterior = x.mes_anterior; p.n_atual = x.n_atual; p.n_anterior = x.n_anterior; });
    const lista = [...postos.values()].map((p) => ({ ...p, media: p.n ? p.soma / p.n : null, dif: p.atual !== null && p.anterior !== null ? p.atual - p.anterior : null }))
      .sort((a, b) => (b.media ?? -1) - (a.media ?? -1));
    const fim = new Date(`${r.periodo.ate}T12:00:00`);
    const nomeMes = (off) => { const x = new Date(fim.getFullYear(), fim.getMonth() + off, 1); return `${MESES[x.getMonth()]}/${String(x.getFullYear()).slice(2)}`; };
    const subiram = lista.filter((p) => p.dif > 0.05).length; const cairam = lista.filter((p) => p.dif < -0.05).length;
    const geral = {}; const nGeral = {};
    serie.forEach((x) => { geral[x.balde] = (geral[x.balde] || 0) + x.media * x.n; nGeral[x.balde] = (nGeral[x.balde] || 0) + x.n; });
    Object.keys(geral).forEach((k) => { geral[k] = Math.round((geral[k] / nGeral[k]) * 100) / 100; });
    return sec('estrelas', 'bi-star-half', 'Estrelas dos postos', `Nota (0 a 5 estrelas) que a TI dá a quem abriu o chamado, por posto. A variação compara ${nomeMes(0)} com ${nomeMes(-1)}.`,
      kpis([[num(lista.length), 'postos avaliados'], [num(subiram), 'subiram', subiram ? 'bom' : ''], [num(cairam), 'cairam', cairam ? 'ruim' : '']])
      + (Object.keys(geral).length > 1 ? `<h3>Média geral por ${nomeBalde(r.periodo)}</h3>${colunas(bs, [{ nome: 'Média de estrelas', cor: 'var(--rl-c5)', valores: geral }], { fmt: (v) => nota(v), altura: 150 })}` : '')
      + tabela([['Posto'], ['Média no período'], [`${nomeMes(-1)}`, 'rl-num'], [`${nomeMes(0)}`, 'rl-num'], ['Variação', 'rl-num'], [`Por ${nomeBalde(r.periodo)}`]],
        lista.map((p) => [ondeTxt(p), estrelas(p.media), p.anterior === null ? '—' : nota(p.anterior), p.atual === null ? '—' : nota(p.atual),
          p.dif === null ? '<span class="rl-mut">sem comparação</span>' : Math.abs(p.dif) < 0.05 ? '<span class="rl-mut">= igual</span>'
            : p.dif > 0 ? `<b class="rl-bom-t">▲ +${nota(p.dif)}</b>` : `<b class="rl-ruim-t">▼ ${nota(p.dif)}</b>`, mini(bs, p.valores)]),
        { vazio: 'Nenhum chamado com nota no período.' }));
  };
  S.problemas = (d, r) => {
    const cat = d.problemas_cat || []; const cau = d.problemas_causa || [];
    const postos = new Map();
    const pega = (x) => { const k = `${x.empresa}|${x.posto}`; if (!postos.has(k)) postos.set(k, { empresa: x.empresa, posto: x.posto, cat: [], cau: [], total: 0 }); return postos.get(k); };
    cat.forEach((x) => { const p = pega(x); p.cat.push(x); p.total += x.total; });
    cau.forEach((x) => pega(x).cau.push(x));
    const lista = [...postos.values()].sort((a, b) => b.total - a.total);
    // em cada problema, o posto que mais teve
    const porProblema = new Map();
    cat.forEach((x) => { const m = porProblema.get(x.nome); if (!m || x.total > m.total) porProblema.set(x.nome, x); });
    const totProb = {}; cat.forEach((x) => { totProb[x.nome] = (totProb[x.nome] || 0) + x.total; });
    const top3 = (l, cor) => barras([...l].sort((a, b) => b.total - a.total).map((x) => ({ rot: x.nome, v: x.total })), { max: 3, cor });
    return sec('problemas', 'bi-exclamation-triangle', 'Maiores problemas de cada posto', 'Os problemas que mais abriram chamado em cada posto, lado a lado com o que mais causou no encerramento.',
      `<h3>Quem mais teve cada problema</h3>`
      + tabela([['Problema'], ['Chamados', 'rl-num'], ['Posto que mais teve'], ['No posto', 'rl-num']],
        [...porProblema.entries()].sort((a, b) => totProb[b[0]] - totProb[a[0]]).map(([nome, x]) => [esc(nome), num(totProb[nome]), ondeTxt(x), num(x.total)]))
      + `<div class="rl-postos">${lista.map((p) => `<div class="rl-posto">
          <div class="rl-posto-cab"><b>${esc(p.posto)}</b> <small class="rl-mut">${esc(p.empresa)} · ${p.total} chamado(s)</small></div>
          <div class="rl-2col"><div><h4>Por que abriram</h4>${top3(p.cat)}</div>
          ${r.pode.notas ? `<div><h4>O que causou</h4>${p.cau.length ? top3(p.cau, 'var(--rl-c2)') : '<p class="rl-vazio">Sem causa informada.</p>'}</div>` : ''}</div></div>`).join('')}</div>`);
  };
  S.custos = (d) => {
    const postos = new Map();
    const pega = (x) => { const k = `${x.empresa}|${x.posto}`; if (!postos.has(k)) postos.set(k, { empresa: x.empresa || '', posto: x.posto, compras: 0, retiradas: 0, perdas: 0 }); return postos.get(k); };
    (d.custo_compras || []).forEach((x) => { pega(x).compras += x.valor || 0; });
    (d.custo_retiradas || []).forEach((x) => { pega(x).retiradas += x.valor || 0; });
    (d.custo_perdas || []).forEach((x) => { pega(x).perdas += x.valor || 0; });
    const lista = [...postos.values()].map((p) => ({ ...p, total: p.compras + p.retiradas })).sort((a, b) => (b.total + b.perdas) - (a.total + a.perdas));
    const perdas = d.custo_perdas || [];
    return sec('custos', 'bi-cash-coin', 'Custo de T.I. e prejuízo por posto', 'Custo = itens comprados para o posto + itens retirados do Estoque de T.I. Prejuízo = itens que estragaram ou se perderam no período.',
      kpis([[moeda(somar(lista, 'compras')), 'compras'], [moeda(somar(lista, 'retiradas')), 'retiradas do estoque'], [moeda(somar(lista, 'total')), 'custo de T.I.'], [moeda(somar(lista, 'perdas')), 'prejuízo', somar(lista, 'perdas') ? 'ruim' : '']])
      + `<div class="rl-2col"><div><h3>Custo de T.I. por posto</h3>${barras(lista.filter((p) => p.total).sort((a, b) => b.total - a.total).map((p) => ({ rot: p.posto, v: p.total })), { fmt: moeda })}</div>
        <div><h3>Prejuízo por posto</h3>${barras(lista.filter((p) => p.perdas).sort((a, b) => b.perdas - a.perdas).map((p) => ({ rot: p.posto, v: p.perdas })), { fmt: moeda, cor: 'var(--rl-c4)' })}</div></div>`
      + tabela([['Posto'], ['Compras', 'rl-num'], ['Retiradas', 'rl-num'], ['Custo de T.I.', 'rl-num'], ['Prejuízo', 'rl-num']],
        lista.map((p) => [ondeTxt(p), moeda(p.compras), moeda(p.retiradas), `<b>${moeda(p.total)}</b>`, p.perdas ? `<b class="rl-ruim-t">${moeda(p.perdas)}</b>` : moeda(0)]))
      + (perdas.length ? `<h3>Lista de prejuízo</h3>${tabela([['Item'], ['Posto'], ['Como ficou'], ['Qtd.', 'rl-num'], ['Valor', 'rl-num']],
        perdas.map((x) => [esc(x.item), ondeTxt(x), x.status === 'LOST' ? 'Extraviado' : 'Estragado', num(x.n), moeda(x.valor)]))}` : ''));
  };

  S.inv_ativo = (d, r) => {
    const L = d.inv_ativo || []; const P = d.inv_ativo_posto || []; const vv = r.pode.valores;
    return sec('inv_ativo', 'bi-pc-display', 'Inventário ativo da empresa', 'Equipamentos em uso nos postos hoje (operando ou em conserto).',
      kpis([[num(somar(L, 'n')), 'itens em uso'], vv ? [moeda(somar(L, 'valor')), 'valor do inventário ativo'] : null, [num(P.length), 'postos']])
      + `<div class="rl-2col"><div><h3>Por categoria</h3>${barras(L.map((x) => ({ rot: tipoNome(x.type), v: vv ? x.valor : x.n, extra: vv ? `${num(x.n)} itens` : '' })), { fmt: vv ? moeda : num })}</div>
        <div><h3>Por posto</h3>${barras(P.map((x) => ({ rot: x.posto, v: vv ? x.valor : x.n, extra: vv ? `${num(x.n)} itens` : '' })), { fmt: vv ? moeda : num, cor: 'var(--rl-c2)' })}</div></div>`);
  };
  S.inv_periodo = (d, r, bs) => {
    const E = d.inv_entradas || []; const antes = (d.inv_antes || [])[0] || { n: 0, valor: 0 }; const vv = r.pode.valores;
    const campo = vv ? 'valor' : 'n'; const fmt = vv ? moeda : num;
    const ent = porChave(E, 'balde', campo);
    let acum = Number(antes[campo]) || 0; const acumulado = {};
    bs.forEach((b) => { acum += ent[b.chave] || 0; acumulado[b.chave] = acum; });
    return sec('inv_periodo', 'bi-graph-up-arrow', 'Custo do inventário no período', `O que entrou no inventário em cada ${nomeBalde(r.periodo)} (data de compra; sem ela, a do cadastro) e quanto o inventário passou a valer.`,
      kpis([[fmt(antes[campo]), vv ? 'valor no começo do período' : 'itens no começo do período'], [fmt(somar(E, campo)), vv ? 'entrou no período' : 'itens que entraram'], [fmt(acum), vv ? 'valor no fim do período' : 'itens no fim']])
      + colunas(bs, [{ nome: vv ? 'Entrou no inventário' : 'Itens que entraram', cor: 'var(--rl-c2)', valores: ent }], { fmt, linha: { nome: 'Total acumulado', cor: 'var(--rl-c1)', valores: acumulado } })
      + '<p class="rl-nota">Itens descartados ou perdidos ficam fora do total. Itens da ORCIM só contam depois de transferidos para a empresa.</p>');
  };
  S.estoque = (d, r, bs) => {
    const L = d.estoque || []; const P = d.estoque_posto || []; const vv = r.pode.valores;
    const porSt = {}; L.forEach((x) => { const o = porSt[x.status] || { n: 0, valor: 0 }; o.n += x.n; o.valor += x.valor || 0; porSt[x.status] = o; });
    const porTipo = {}; L.forEach((x) => { const o = porTipo[x.type] || { n: 0, valor: 0 }; o.n += x.n; o.valor += x.valor || 0; porTipo[x.type] = o; });
    const ret = d.estoque_retiradas || [];
    return sec('estoque', 'bi-box-seam', 'Estoque de T.I. e o custo dele', 'Itens guardados nos postos para usar quando precisar (em estoque, prontos para entregar ou comprados aguardando chegar).',
      kpis([[num(somar(L, 'n')), 'itens no estoque'], vv ? [moeda(somar(L, 'valor')), 'custo do estoque'] : null, ...Object.keys(EST).map((s) => (porSt[s] ? [num(porSt[s].n), EST[s].toLowerCase()] : null))])
      + `<div class="rl-2col"><div><h3>Por categoria</h3>${barras(Object.entries(porTipo).sort((a, b) => (vv ? b[1].valor - a[1].valor : b[1].n - a[1].n)).map(([t, o]) => ({ rot: tipoNome(t), v: vv ? o.valor : o.n, extra: vv ? `${num(o.n)} itens` : '' })), { fmt: vv ? moeda : num })}</div>
        <div><h3>Por posto</h3>${barras(P.map((x) => ({ rot: x.posto, v: vv ? x.valor : x.n, extra: vv ? `${num(x.n)} itens` : '' })), { fmt: vv ? moeda : num, cor: 'var(--rl-c2)' })}</div></div>`
      + (vv ? `<h3>Custo das retiradas do estoque por ${nomeBalde(r.periodo)}</h3>
        ${ret.length ? colunas(bs, [{ nome: 'Custo das retiradas', cor: 'var(--rl-c3)', valores: porChave(ret, 'balde', 'valor') }], { fmt: moeda, altura: 160 }) : '<p class="rl-vazio">Nenhuma retirada no período.</p>'}` : ''));
  };

  // ---- documento ----
  function montar(r, ordem, id = {}) {
    const bs = baldes(r.periodo);
    const d = r.dados || {};
    const empresas = new Set(Object.values(d).flat().map((x) => x && x.empresa).filter(Boolean));
    variasEmpresas = !r.filtro.empresa && empresas.size > 1;
    const onde = [r.filtro.empresa, r.filtro.posto].filter(Boolean).join(' · ') || 'Todas as empresas e postos';
    const grupos = REL_GRUPOS.map((g) => ({ ...g, ids: g.secoes.map((s) => s[0]).filter((s) => ordem.includes(s) && S[s]) })).filter((g) => g.ids.length);
    let n = 0;
    const corpo = grupos.map((g) => `<div class="rl-parte"><div class="rl-parte-tit"><i class="bi ${g.icon}"></i> ${esc(g.titulo)}</div>
      ${g.ids.map((s) => { n += 1; return S[s](d, r, bs).replace('<h2>', `<h2><span class="rl-n">${n}</span>`); }).join('')}</div>`).join('');
    return `
      <header class="rl-capa">
        <div class="rl-capa-marca">${id.logo ? `<img src="${esc(id.logo)}" alt="">` : '<i class="bi bi-headset"></i>'}<span>${esc(id.app_name || 'Central de Serviços')}</span></div>
        <h1>Relatório da T.I.</h1>
        <div class="rl-capa-per"><i class="bi bi-calendar3"></i> ${dataBR(r.periodo.de)} a ${dataBR(r.periodo.ate)} <span>· ${r.periodo.dias} dia(s) · gráficos por ${nomeBalde(r.periodo)}</span></div>
        <div class="rl-capa-onde"><i class="bi bi-geo-alt"></i> ${esc(onde)}</div>
        <div class="rl-capa-indice">${grupos.map((g) => `<span><i class="bi ${g.icon}"></i> ${esc(g.titulo)}</span>`).join('')}</div>
        <div class="rl-capa-gerado">Gerado em ${dataHoraBR(r.gerado_em)} por ${esc(r.gerado_por || '')}</div>
      </header>
      ${corpo}`;
  }

  // ---- PDF: imprime só o documento (o nome do arquivo vem do título da página) ----
  function imprimir(r) {
    const doc = document.getElementById('rl-doc');
    if (!doc) return;
    const caixa = document.createElement('div');
    caixa.id = 'rl-print';
    caixa.innerHTML = doc.outerHTML.replace('id="rl-doc"', 'id="rl-doc-print"');
    document.body.appendChild(caixa);
    document.body.classList.add('imprimindo-relatorio');
    const tituloAntes = document.title;
    const filtro = [r.filtro.empresa, r.filtro.posto].filter(Boolean).join(' ');
    document.title = `Relatorio TI ${r.periodo.de} a ${r.periodo.ate}${filtro ? ` ${filtro}` : ''}`;
    const limpar = () => {
      document.body.classList.remove('imprimindo-relatorio');
      caixa.remove();
      document.title = tituloAntes;
      window.removeEventListener('afterprint', limpar);
    };
    window.addEventListener('afterprint', limpar);
    setTimeout(() => { window.print(); setTimeout(() => { if (document.getElementById('rl-print')) limpar(); }, 1500); }, 150);
  }

  return { montar, imprimir };
})();
