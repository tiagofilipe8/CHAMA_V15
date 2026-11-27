// ---------------------------------------------------------------
// Score de urgência (e as peças da tela de Rotas: score, chamados, ordem de visita, "O que levar")
//   score do chamado = peso da urgência × fator de atraso × fator de prazo (ver o servidor:
//   server/services/scoreUrgencia.js); score do local = soma dos chamados abertos dele.
//   Rotas: escolhe quantos locais atender, o sistema sugere os de maior score e monta a ordem
//   de visita pela menor distância (coordenadas dos locais, sem API paga); abre no Google Maps
//   e gera um relatório para imprimir com os chamados e o que levar.
// ---------------------------------------------------------------

const Urgencia = (() => {
  const TOM = { 4: 'u-stop', 3: 'u-soon', 2: 'u-slow', 1: 'u-req' };
  const URG = { 4: 'Operação parada', 3: 'Parada iminente', 2: 'Operação prejudicada', 1: 'Requisição' };
  const n1 = (x) => String(Math.round(Number(x) * 100) / 100).replace('.', ',');
  const fmtDia = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
  const situacaoPrazo = (c) => (c.dias_atraso > 0 ? `<span class="tg tg-red">${c.dias_atraso} dia(s) atrasado</span>`
    : c.dias_para_prazo === 0 ? '<span class="tg tg-amber">vence hoje</span>'
      : c.dias_para_prazo !== null ? `<span class="tg tg-gray">vence ${fmtDia(c.prazo)} (em ${c.dias_para_prazo} dia${c.dias_para_prazo > 1 ? 's' : ''})</span>`
        : '<span class="tg tg-gray">sem data</span>');
  const conta = (c) => `1 × ${n1(c.peso)} × ${n1(c.fator_atraso)} × ${n1(c.fator_prazo)}`;
  // cor pelo score, em degradê: verde -> amarelo -> laranja -> vermelho (alvo = score em que fica vermelho)
  const DEGRADE = [[22, 163, 74], [234, 179, 8], [249, 115, 22], [220, 38, 38]]; // verde, amarelo, laranja, vermelho
  const cor = (score, alvo) => {
    const t = Math.max(0, Math.min(Number(score) / alvo, 1)) * (DEGRADE.length - 1);
    const i = Math.min(Math.floor(t), DEGRADE.length - 2); const f = t - i;
    const [a, b] = [DEGRADE[i], DEGRADE[i + 1]];
    return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(' ')})`;
  };
  // o número vai do verde (0) ao vermelho (18); de 18 para cima ele pega fogo
  const ALVO_LOCAL = 18; const ALVO_CHAMADO = 18;

  // Score 18 ou mais: fogo em pixel art atrás do número.
  //   8 quadros de 12x18 pixels, gerados aqui: a chama balança, as línguas sobem e somem,
  //   o miolo é quase branco e as bordas vão do amarelo ao vermelho escuro; algumas faíscas sobem.
  const FOGO = 18;
  const FOGO_L = 12; const FOGO_A = 18; const FOGO_Q = 8;
  const PALETA_FOGO = ['#5c0f08', '#9e1c10', '#d9360f', '#f46b0d', '#ffa21a', '#ffd23f', '#fff3a8'];
  (function estiloFogo() {
    if (document.getElementById('estilo-fogo')) return;
    // números "aleatórios" fixos (o desenho sai sempre igual)
    let semente = 7;
    const rnd = () => { semente = (semente * 16807) % 2147483647; return semente / 2147483647; };
    const pix = [];
    for (let f = 0; f < FOGO_Q; f += 1) {
      const fase = (f / FOGO_Q) * Math.PI * 2;
      for (let y = 0; y < FOGO_A; y += 1) {
        const v = y / (FOGO_A - 1);              // 0 = topo, 1 = base
        const subida = 1 - v;
        // centro balança mais em cima do que embaixo
        const cx = FOGO_L / 2 + Math.sin(fase + y * 0.55) * 1.5 * subida ** 1.3 + Math.sin(fase * 2 + y) * 0.35 * subida;
        // largura: base larga e arredondada, afinando até a ponta; respira um pouco a cada quadro
        const forma = v < 0.86 ? Math.sin((v / 0.86) * Math.PI / 2) ** 1.15 : 1 - ((v - 0.86) / 0.14) ** 2 * 0.35;
        const meia = (0.35 + 5.3 * forma) * (1 + 0.1 * Math.sin(fase * 1.5 + y * 0.9));
        for (let x = 0; x < FOGO_L; x += 1) {
          const dx = Math.abs(x + 0.5 - cx) / meia;
          let calor = (1 - dx) * 0.75 + v * 0.55 - 0.18 + (rnd() - 0.5) * 0.18;
          if (dx >= 1) {
            // línguas soltas na borda de cima
            if (v < 0.55 && dx < 1.35 && rnd() < 0.14) calor = 0.12; else continue;
          }
          const nivel = Math.max(0, Math.min(PALETA_FOGO.length - 1, Math.floor(calor * PALETA_FOGO.length)));
          if (calor <= 0.04) continue;
          pix.push([x + f * FOGO_L, y, PALETA_FOGO[nivel]]);
        }
      }
      // faíscas subindo
      for (let k = 0; k < 3; k += 1) {
        const y = Math.floor(((f / FOGO_Q) * FOGO_A * 0.6 + k * 4) % (FOGO_A * 0.45));
        const x = Math.round(FOGO_L / 2 + Math.sin(fase + k * 2.1) * 3.5);
        if (x >= 0 && x < FOGO_L) pix.push([x + f * FOGO_L, y, k === 1 ? '#ffd23f' : '#f46b0d']);
      }
    }
    const rects = pix.map(([x, y, c]) => `<rect x='${x}' y='${y}' width='1' height='1' fill='${c}'/>`).join('');
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${FOGO_L * FOGO_Q}' height='${FOGO_A}' shape-rendering='crispEdges'>${rects}</svg>`;
    const st = document.createElement('style');
    st.id = 'estilo-fogo';
    st.textContent = `.ur-fogo{background-image:url("data:image/svg+xml,${encodeURIComponent(svg)}")}`;
    document.head.appendChild(st);
  }());
  // abaixo de 18: um emoji para cada faixa (de 18 para cima é o fogo em pixel art)
  const FAIXAS_EMOJI = [[3, '😌', 'tranquilo'], [6, '🙂', 'baixo'], [9, '😐', 'atenção'], [12, '😟', 'preocupante'], [15, '😰', 'alto'], [FOGO, '😱', 'quase pegando fogo']];
  const faixaEmoji = (score) => FAIXAS_EMOJI.find(([ate]) => Number(score) < ate);
  // tamanho do número: cresce com o score até 18 (depois disso fica do tamanho do 18)
  const tamanho = (score, base) => `${(base + 0.45 * Math.min(Math.max(Number(score), 0), FOGO) / FOGO).toFixed(2)}rem`;
  // operação parada é perigoso: ganha um foguinho menor mesmo com score abaixo de 18
  const temParada = (lista) => (lista || []).some((c) => Number(c.priority) === 4);
  const numScore = (score, alvo, cls = '', base = 1.05, parada = false) => {
    if (Number(score) < FOGO && parada) {
      return `<span class="ur-em-chamas pequeno ${cls}" title="Score ${n1(score)}: tem chamado de operação parada" style="font-size:${tamanho(score, base)}"><span class="ur-fogo" aria-hidden="true"></span><b class="ur-num-parada" style="--c:${cor(FOGO, alvo)}">${n1(score)}</b></span>`;
    }
    if (Number(score) >= FOGO) {
      return `<span class="ur-em-chamas ${cls}" title="Score ${n1(score)}: pegando fogo" style="font-size:${tamanho(score, base)}"><span class="ur-fogo" aria-hidden="true"></span><b class="ur-num-fogo">${n1(score)}</b></span>`;
    }
    const [, emoji, nome] = faixaEmoji(score);
    return `<span class="ur-num-emoji" title="Score ${n1(score)}: ${nome}"><span class="ur-emoji" aria-hidden="true">${emoji}</span><b style="color:${cor(score, alvo)};font-size:${tamanho(score, base)}">${n1(score)}</b></span>`;
  };


  // como o score é calculado (aparece nas duas páginas)
  const regrasHtml = (r) => {
    const faixas = r.faixas_prazo.slice(1).map((f, i) => [`vence em ${r.faixas_prazo[i].ate + 1}${f.ate ? ` a ${f.ate}` : ' ou mais'} dias`, f.fator]);
    return `
    <details class="ur-regras">
      <summary><i class="bi bi-calculator"></i> <span>Como o score é calculado</span>
        <small class="ur-regras-dica">clique para ver</small><i class="bi bi-chevron-down ur-seta"></i></summary>
      <div class="ur-regras-corpo">
        <div class="ur-base">
          <div class="ur-base-num">1<small>ponto</small></div>
          <div><b>A base: cada chamado aberto vale 1 ponto.</b>
            <div>Não importa o tipo de problema: todo chamado começa com 1. Um local com 3 chamados abertos parte de 3 pontos.</div>
            <div>Depois, o ponto de cada chamado é <b>multiplicado</b> por 3 fatores (urgência, atraso e prazo), que fazem ele
              valer mais (×2, ×3...) ou menos (×0,5, ×0,25).</div>
            <div>O <b>score do local</b> é a soma dos pontos de todos os chamados abertos dele. Chamado em pausa não conta.</div></div>
        </div>
        <div class="ur-formula"><span>1 ponto</span>×<span>urgência</span>×<span>atraso</span>×<span>prazo</span>=<b>score do chamado</b></div>
        <div class="ur-regras-grade">
          <div><b>1. Urgência</b><small>quanto o problema atrapalha</small>
            ${[1, 2, 3, 4].map((p) => `<div class="ur-linha"><span><i class="ur-dot ${TOM[p]}"></i>${URG[p]}</span><b>×${n1(r.peso_urgencia[p])}</b></div>`).join('')}</div>
          <div><b>2. Atraso</b><small>sobe 1 a cada dia depois do prazo</small>
            <div class="ur-linha"><span>no prazo</span><b>×1</b></div>
            <div class="ur-linha"><span>1 dia atrasado</span><b>×2</b></div>
            <div class="ur-linha"><span>3 dias atrasado</span><b>×4</b></div>
            <div class="ur-linha"><span>${r.atraso_max} dias ou mais</span><b>×${r.atraso_max + 1}</b></div></div>
          <div><b>3. Prazo</b><small>o que é para depois pesa menos</small>
            <div class="ur-linha"><span>atrasado, hoje ou amanhã</span><b>×1</b></div>
            ${faixas.map(([txt, f]) => `<div class="ur-linha"><span>${txt}</span><b>×${n1(f)}</b></div>`).join('')}
            <div class="ur-linha"><span>sem data</span><b>×${n1(r.fator_sem_prazo)}</b></div></div>
        </div>
        <div class="ur-exemplos"><b>Exemplos</b>
          <div><span>Requisição atrasada 1 dia</span><code>1 × 1 × 2 × 1</code><b>= 2</b></div>
          <div><span>Operação parada que vence hoje</span><code>1 × 3 × 1 × 1</code><b>= 3</b></div>
          <div><span>Operação prejudicada atrasada 3 dias</span><code>1 × 1,5 × 4 × 1</code><b>= 6</b></div>
          <div><span>Operação parada para daqui a 10 dias</span><code>1 × 3 × 1 × 0,25</code><b>= 0,75</b></div>
        </div>
        <div class="ur-escala"><span>Cor do score:</span>
          <span class="ur-regua">${[0, 3, 6, 9, 12, 15].map((n) => `<span class="ur-regua-it" title="${faixaEmoji(n)[2]}"><i>${faixaEmoji(n)[1]}</i><b style="color:${cor(n, ALVO_LOCAL)};font-size:${tamanho(n, 0.85)}">${n}</b></span>`).join('')}<span class="ur-em-chamas regua" title="pegando fogo" style="font-size:${tamanho(FOGO, 0.85)}"><span class="ur-fogo" aria-hidden="true"></span><b class="ur-num-fogo">${FOGO}</b></span></span>
          <small>o número vai do verde ao vermelho conforme o score sobe; a partir de ${FOGO} ele pega fogo.
            Local ou chamado com <b>operação parada</b> ganha um foguinho menor mesmo abaixo de ${FOGO}, porque é perigoso.</small></div>
        <p class="text-muted mb-0 small">Prazo usado: o "Precisa até" do chamado; se não tiver, o prazo (SLA).</p>
      </div>
    </details>`;
  };

  // semConta: sem a conta do score embaixo do número (nas telas de rota, para quem vai para a rua)
  const linhaChamado = (c, { semConta = false } = {}) => `
    <a class="ur-ch ${TOM[c.priority] || 'u-req'}" href="#/tickets/${c.id}">
      <span class="ur-ch-num">${esc(c.number)}</span>
      <span class="ur-ch-tx"><b>${esc(c.title)}</b><small><span class="ur-tag-urg ${TOM[c.priority] || 'u-req'}"><i class="ur-dot ${TOM[c.priority] || 'u-req'}"></i>${esc(c.impact_name || URG[c.priority] || '')}</span>${c.category_name ? ` · ${esc(c.category_name)}` : ''} · ${c.assigned_name ? esc(c.assigned_name) : 'sem técnico'}</small></span>
      <span class="ur-ch-prazo">${situacaoPrazo(c)}</span>
      <span class="ur-ch-score" title="1 ponto × urgência × atraso × prazo">${numScore(c.score, ALVO_CHAMADO, '', 0.9, Number(c.priority) === 4)}${semConta ? '' : `<small>${conta(c)}</small>`}</span>
    </a>`;

  // ---------------- Score de urgência ----------------
  async function pagina(el) {
    el.innerHTML = spinner();
    let d;
    try { d = await API.get('/dashboard/urgencia'); } catch (e) { el.innerHTML = emptyState('Não foi possível carregar', e.message, 'bi-exclamation-triangle'); return; }
    const max = Math.max(1, ...d.locais.map((l) => l.score));
    el.innerHTML = `
      ${regrasHtml(d.regras)}
      ${d.pausados ? `<div class="small text-muted mt-2"><i class="bi bi-pause-circle"></i> ${d.pausados} chamado(s) em pausa não entram no score (aguardando peça, fornecedor, usuário ou visita agendada).</div>` : ''}
      <div class="card panel-card mt-3">
        <div class="dp-bloco-cab"><span><i class="bi bi-sort-down"></i> Locais por urgência</span>
          <a class="btn btn-sm btn-primary" href="#/rotas/nova"><i class="bi bi-signpost-split"></i> Montar rota</a></div>
        ${d.locais.length ? d.locais.map((l, i) => `
          <details class="ur-loc" style="--cor:${cor(l.score, ALVO_LOCAL)}">
            <summary>
              <i class="bi bi-chevron-right ur-seta"></i>
              <span class="ur-pos">${i + 1}º</span>
              <span class="ur-loc-tx"><b>${esc(l.location_name)}</b><small>${esc(l.entity_name)}${l.city ? ` · ${esc(l.city)}` : ''}${l.latitude === null ? ' · <span class="text-warning-emphasis">sem coordenadas</span>' : ''}</small></span>
              <span class="ur-barra" title="quanto maior e mais vermelha, mais urgente"><i style="--w:${Math.max(4, Math.round((l.score / max) * 100))}%"></i></span>
              <span class="ur-loc-n">${l.chamados.length} chamado(s)${l.atrasados ? ` · <b class="text-danger">${l.atrasados} atrasado(s)</b>` : ''}</span>
              <span class="ur-loc-score">${numScore(l.score, ALVO_LOCAL, '', 1.05, temParada(l.chamados))}<small>score</small></span>
            </summary>
            <div class="ur-chs">${l.chamados.map(linhaChamado).join('')}</div>
          </details>`).join('') : '<div class="dp-vazio"><i class="bi bi-check2-circle text-success"></i> Nenhum chamado em aberto.</div>'}
      </div>`;
  }

  // ---------------- Sugerir rotas ----------------
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const km = (a, b) => {
    const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const FATOR_ESTRADA = 1.3; // linha reta -> estrada (estimativa)
  const VELOCIDADE = 50;     // km/h médio (estimativa)

  // ordem de visita: vizinho mais próximo a partir do ponto de partida (ou do mais urgente)
  function ordenar(paradas, inicio) {
    const resto = paradas.slice();
    const ordem = [];
    let atual = inicio;
    if (!atual) { resto.sort((a, b) => b.score - a.score); const p = resto.shift(); ordem.push(p); atual = p; }
    while (resto.length) {
      let melhor = 0; let dist = Infinity;
      resto.forEach((p, i) => { const dd = km(atual, p); if (dd < dist) { dist = dd; melhor = i; } });
      const p = resto.splice(melhor, 1)[0];
      ordem.push(p); atual = p;
    }
    return ordem;
  }

  // ---------------- Caixinha em pixel art (ícone do "O que levar") ----------------
  const CAIXA_PIX = [
    '............',
    '.LLLLLLLLLL.',
    'LLLLLYYLLLLL',
    'DDDDDYYDDDDD',
    'BBBBBYYBBBBB',
    'BBBBBYYBBBBB',
    'BBWWBYYBBBBB',
    'BBWWBYYBBBBB',
    'BBBBBYYBBBBB',
    'SBBBBYYBBBBS',
    'SSSSSSSSSSSS',
    '............',
  ];
  const CORES_CAIXA = { L: '#e9c48a', D: '#a8692e', B: '#c98b48', Y: '#f4d36b', W: '#fff7e0', S: '#8a5426' };
  const caixaPixel = (tam = 28) => {
    const r = CAIXA_PIX.flatMap((lin, y) => [...lin].map((c, x) => (CORES_CAIXA[c] ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${CORES_CAIXA[c]}"/>` : ''))).join('');
    return `<svg class="caixa-pix" width="${tam}" height="${tam}" viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
  };

  // ---------------- "O que levar": janela com o checklist de todos os pedidos das paradas ----------------
  //   Marque os itens que serão entregues, escolha para onde cada um vai e entregue tudo de uma vez.
  //   Se o item existe no Estoque da ORCIM, a etiqueta mostra "Em estoque na ORCIM" e ele sai de lá.
  const DESTINOS = { inventario: 'Inventário da Empresa (em uso)', estoque: 'Estoque de T.I. do local' };
  //   op.comecar: abre no modo "Começar rota" (os itens marcados saem para entrega e a rota começa)
  async function abrirLevar(ordem, depois, op = {}) {
    const u = API.user || {};
    const podeEntregar = Roles.can(u, 'inventory.manage') || Roles.isMaster(u);
    const veOrcim = podeEntregar && (Roles.isMaster(u) || Roles.can(u, 'ticket.view_all'));
    const pendentes = [];
    ordem.forEach((p) => p.chamados.forEach((c) => (c.materiais || []).forEach((m) => {
      // item já comprado é entregue ele mesmo: não procura no Estoque da ORCIM
      if (!['entregue', 'cancelado'].includes(m.status) && !m.comprado) pendentes.push({ id: m.id, name: m.name });
    })));
    let naOrcim = {};
    if (veOrcim && pendentes.length) { try { naOrcim = await API.post('/orcim/procurar', { materiais: pendentes }); } catch { naOrcim = {}; } }
    const tagOrcim = (m) => {
      const o = naOrcim[m.id];
      if (!o) return '';
      const basta = o.disponivel >= Number(m.quantity || 1);
      return `<span class="pd-tag lv-orcim ${basta ? '' : 'pouco'}" title="${esc(o.itens.map((a) => `${a.asset_tag ? `${a.asset_tag} · ` : ''}${a.name}${a.controle === 'quantidade' ? ` (×${a.quantity})` : ''}`).join('\n'))}"><i class="bi bi-boxes"></i>Em estoque na ORCIM <b>${o.disponivel}</b></span>`;
    };
    const blocos = ordem.map((p, i) => {
      const chs = p.chamados.filter((c) => (c.materiais || []).some((m) => m.status !== 'cancelado'));
      if (!chs.length) return '';
      return `<div class="lv-parada"><div class="lv-parada-cab"><span class="ur-num">${i + 1}</span><b>${esc(p.location_name)}</b></div>
        ${chs.map((c) => `<div class="lv-ch"><a href="#/tickets/${c.id}" class="lv-ch-num">${esc(c.number)}</a> <span class="text-muted">${esc(c.title)}</span></div>
          ${(c.materiais || []).filter((m) => m.status !== 'cancelado').map((m) => {
            const feito = m.status === 'entregue';
            const o = naOrcim[m.id];
            const daOrcim = o && o.disponivel >= Number(m.quantity || 1);
            return `
          <div class="lv-item ${feito ? 'feito' : ''}" data-t="${c.id}" data-m="${m.id}" data-nome="${esc(m.name)}" ${m.status === 'rota' ? 'data-rota="1"' : ''}>
            <label class="lv-check" title="${feito ? 'Já entregue' : 'Entregar este item'}"><input type="checkbox" class="lv-marca" ${feito ? 'checked disabled' : ''} ${!feito && !podeEntregar ? 'disabled' : ''}></label>
            <span class="lv-qtd">${m.quantity} ${esc(m.unit || 'un')}</span>
            <span class="lv-nome">${Item.titulo({ name: m.name, type: m.asset_type || 'PERIPHERAL' }, { link: false, estado: false, local: false, etapa: false, etiqueta: false })}</span>
            <span class="lv-st">${feito ? `${pedidoTag('entregue')}${m.destino && m.destino !== 'nenhum' ? ` <small class="text-muted">${m.destino === 'estoque' ? 'no Estoque de T.I.' : 'no Inventário da Empresa'}</small>` : ''}` : m.status === 'rota' ? `${pedidoTag('rota')}${m.previsao ? ` <small class="text-muted">prev. ${esc(String(m.previsao).slice(8, 10))}/${esc(String(m.previsao).slice(5, 7))}</small>` : ''}` : (o ? tagOrcim(m) : pedidoTag(m.status))}</span>
            ${!feito && podeEntregar ? `<span class="lv-acao">
              ${o ? `<label class="lv-origem" title="${daOrcim ? 'O item sai do Estoque da ORCIM e vai para a empresa' : 'A ORCIM não tem a quantidade toda'}"><input type="checkbox" class="lv-usa-orcim" ${daOrcim && (m.status !== 'rota' || m.origem_orcim) ? 'checked' : ''} ${daOrcim ? '' : 'disabled'}> do Estoque da ORCIM</label>` : ''}
              <select class="form-select form-select-sm lv-dest" aria-label="Para onde vai">${Object.entries(m.destino === 'nenhum' ? { ...DESTINOS, nenhum: 'Consumível (só entregar)' } : DESTINOS).map(([k, v]) => `<option value="${k}" ${k === (m.destino || 'inventario') ? 'selected' : ''}>${v}</option>`).join('')}</select></span>` : ''}
          </div>`;
          }).join('')}`).join('')}
      </div>`;
    }).join('');
    const total = new Map();
    ordem.forEach((p) => p.chamados.forEach((c) => (c.materiais || []).filter((m) => !['entregue', 'cancelado'].includes(m.status)).forEach((m) => {
      const k = `${m.name}|${m.unit || ''}`; total.set(k, { ...m, quantity: (total.get(k)?.quantity || 0) + Number(m.quantity || 0) });
    })));
    const m = document.createElement('div');
    m.className = 'modal fade';
    m.innerHTML = `<div class="modal-dialog modal-lg modal-dialog-scrollable"><div class="modal-content">
      <div class="modal-header"><h6 class="mb-0 d-flex align-items-center gap-2">${caixaPixel(26)} O que levar nesta rota</h6><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        ${total.size ? `<div class="lv-total"><b>Para separar:</b> ${[...total.values()].map((x) => `<span class="tg tg-teal">${x.quantity} ${esc(x.unit || 'un')} · ${esc(x.name)}</span>`).join(' ')}</div>` : ''}
        ${podeEntregar && pendentes.length ? `<div class="lv-instr"><i class="bi bi-check2-square"></i><span><b>Marque os itens que serão entregues</b> e escolha para onde cada um vai: <b>Inventário da Empresa</b> (já em uso no local) ou <b>Estoque de T.I.</b> do local. ${op.comecar ? '<b>Começar rota</b> põe os itens marcados como a caminho do local e avisa quem pediu' : '<b>Saiu para entrega</b> avisa quem pediu que o item está a caminho (entrega prevista para hoje)'}; a entrega é <b>confirmada</b> por você no local ou por quem pediu.${Object.keys(naOrcim).length ? ' Os itens com <span class="pd-tag lv-orcim"><i class="bi bi-boxes"></i>Em estoque na ORCIM</span> saem do Estoque da ORCIM.' : ''}</span>
          <button type="button" class="btn btn-sm btn-link lv-todos">Marcar todos</button></div>` : ''}
        ${blocos || '<div class="dp-vazio">Nenhum material pedido nos chamados dessas paradas.</div>'}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Fechar</button>
        ${podeEntregar && pendentes.length ? `${op.comecar ? '' : '<button class="btn btn-outline-primary btn-sm" id="lv-rota" disabled><i class="bi bi-truck"></i> <span>Saiu para entrega</span></button>'}<button class="btn ${op.comecar ? 'btn-outline-success' : 'btn-success'} btn-sm" id="lv-entregar" disabled><i class="bi bi-check2-circle"></i> <span>Confirmar entrega</span></button>` : ''}
        ${op.comecar ? '<button class="btn btn-primary btn-sm" id="lv-comecar"><i class="bi bi-play-fill"></i> <span>Começar rota</span></button>' : ''}
      </div></div></div>`;
    document.body.appendChild(m);
    const bm = new bootstrap.Modal(m);
    let mudou = false;
    m.addEventListener('hidden.bs.modal', () => { m.remove(); if (mudou && depois) depois(); });
    const btn = m.querySelector('#lv-entregar');
    const btnRota = m.querySelector('#lv-rota');
    const btnComecar = m.querySelector('#lv-comecar');
    const marcados = () => [...m.querySelectorAll('.lv-item:not(.feito) .lv-marca:checked')].map((c) => c.closest('.lv-item'));
    const contar = () => {
      m.querySelectorAll('.lv-item:not(.feito)').forEach((it) => it.classList.toggle('marcado', it.querySelector('.lv-marca').checked));
      const n = marcados().length;
      const naRota = marcados().filter((it) => !it.dataset.rota).length;
      if (btnComecar) btnComecar.querySelector('span').textContent = naRota ? `Começar rota levando ${naRota} item${naRota === 1 ? '' : 's'}` : 'Começar rota';
      if (!btn) return;
      btn.disabled = !n;
      btn.querySelector('span').textContent = n ? `Confirmar entrega (${n})` : 'Confirmar entrega';
      if (btnRota) {
        btnRota.disabled = !naRota;
        btnRota.querySelector('span').textContent = naRota ? `Saiu para entrega (${naRota})` : 'Saiu para entrega';
      }
    };
    m.querySelectorAll('.lv-marca').forEach((c) => c.addEventListener('change', contar));
    m.querySelector('.lv-todos')?.addEventListener('click', (e) => {
      const caixas = [...m.querySelectorAll('.lv-item:not(.feito) .lv-marca:not(:disabled)')];
      const todos = caixas.every((c) => c.checked);
      caixas.forEach((c) => { c.checked = !todos; });
      e.target.textContent = todos ? 'Marcar todos' : 'Desmarcar todos';
      contar();
    });
    btn?.addEventListener('click', async () => {
      const lista = marcados();
      if (!lista.length) return;
      btn.disabled = true;
      let ok = 0;
      for (const it of lista) {
        const destino = it.querySelector('.lv-dest').value;
        const orcim = !!it.querySelector('.lv-usa-orcim:checked');
        try {
          await API.post(`/tickets/${it.dataset.t}/materials/${it.dataset.m}/confirmar`, { destino, orcim });
          ok += 1; mudou = true;
          it.classList.remove('marcado'); it.classList.add('feito');
          const c = it.querySelector('.lv-marca'); c.checked = true; c.disabled = true;
          it.querySelector('.lv-st').innerHTML = `${pedidoTag('entregue')} <small class="text-muted">${destino === 'estoque' ? 'no Estoque de T.I.' : 'no Inventário da Empresa'}${orcim ? ' · saiu da ORCIM' : ''}</small>`;
          it.querySelector('.lv-acao')?.remove();
        } catch (e) { showError(e); }
      }
      if (ok) toast(`${ok} item${ok === 1 ? '' : 's'} entregue${ok === 1 ? '' : 's'} e registrado${ok === 1 ? '' : 's'} no inventário.`, 'success');
      contar();
    });
    // levar na rota: fica "a caminho do local" e quem pediu acompanha
    btnRota?.addEventListener('click', async () => {
      const lista = marcados().filter((it) => !it.dataset.rota);
      if (!lista.length) return;
      btnRota.disabled = true;
      let ok = 0;
      for (const it of lista) {
        const destino = it.querySelector('.lv-dest').value;
        const orcim = !!it.querySelector('.lv-usa-orcim:checked');
        try {
          await API.post(`/tickets/${it.dataset.t}/materials/${it.dataset.m}/rota`, { destino, orcim });
          ok += 1; mudou = true;
          it.dataset.rota = '1';
          it.querySelector('.lv-st').innerHTML = `${pedidoTag('rota')} <small class="text-muted">prev. hoje</small>`;
        } catch (e) { showError(e); }
      }
      if (ok) toast(`${ok} item${ok === 1 ? '' : 's'} a caminho do local. Quem pediu já pode acompanhar e confirmar quando receber.`, 'success');
      contar();
    });
    // começar a rota: os itens marcados ficam "a caminho do local" (quem pediu é avisado) e a rota começa
    btnComecar?.addEventListener('click', async () => {
      btnComecar.disabled = true;
      let ok = 0;
      for (const it of marcados().filter((x) => !x.dataset.rota)) {
        const destino = it.querySelector('.lv-dest').value;
        const orcim = !!it.querySelector('.lv-usa-orcim:checked');
        try {
          await API.post(`/tickets/${it.dataset.t}/materials/${it.dataset.m}/rota`, { destino, orcim });
          ok += 1; mudou = true; it.dataset.rota = '1';
        } catch (e) { showError(e); }
      }
      try {
        await op.comecar();
        mudou = true;
        toast(`Rota começada${ok ? `: ${ok} item${ok === 1 ? '' : 's'} a caminho do local` : ''}.`, 'success');
        bm.hide();
      } catch (e) { showError(e); btnComecar.disabled = false; }
    });
    contar();
    bm.show();
  }

  // peças usadas pela tela de Rotas (public/js/views/rotas.js)
  return { pagina, numScore, linhaChamado, ordenar, km, FATOR_ESTRADA, VELOCIDADE, abrirLevar, caixaPixel, temParada, ALVO_LOCAL, n1 };
})();

Views.urgencia = (el) => Urgencia.pagina(el);
