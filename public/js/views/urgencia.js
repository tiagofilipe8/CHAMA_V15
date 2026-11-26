// ---------------------------------------------------------------
// Score de urgência e Sugerir rotas
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

  const linhaChamado = (c) => `
    <a class="ur-ch ${TOM[c.priority] || 'u-req'}" href="#/tickets/${c.id}">
      <span class="ur-ch-num">${esc(c.number)}</span>
      <span class="ur-ch-tx"><b>${esc(c.title)}</b><small><span class="ur-tag-urg ${TOM[c.priority] || 'u-req'}"><i class="ur-dot ${TOM[c.priority] || 'u-req'}"></i>${esc(c.impact_name || URG[c.priority] || '')}</span>${c.category_name ? ` · ${esc(c.category_name)}` : ''} · ${c.assigned_name ? esc(c.assigned_name) : 'sem técnico'}</small></span>
      <span class="ur-ch-prazo">${situacaoPrazo(c)}</span>
      <span class="ur-ch-score" title="1 ponto × urgência × atraso × prazo">${numScore(c.score, ALVO_CHAMADO, '', 0.9, Number(c.priority) === 4)}<small>${conta(c)}</small></span>
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
          <a class="btn btn-sm btn-primary" href="#/rotas"><i class="bi bi-signpost-split"></i> Sugerir rota</a></div>
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
  async function abrirLevar(ordem, depois) {
    const u = API.user || {};
    const podeEntregar = Roles.can(u, 'inventory.manage') || Roles.isMaster(u);
    const veOrcim = podeEntregar && (Roles.isMaster(u) || Roles.can(u, 'ticket.view_all'));
    const pendentes = [];
    ordem.forEach((p) => p.chamados.forEach((c) => (c.materiais || []).forEach((m) => {
      if (!['entregue', 'cancelado'].includes(m.status)) pendentes.push({ id: m.id, name: m.name });
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
            <span class="lv-nome">${esc(m.name)}</span>
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
        ${podeEntregar && pendentes.length ? `<div class="lv-instr"><i class="bi bi-check2-square"></i><span><b>Marque os itens que serão entregues</b> e escolha para onde cada um vai: <b>Inventário da Empresa</b> (já em uso no local) ou <b>Estoque de T.I.</b> do local. <b>Levar na rota</b> avisa quem pediu que o item está a caminho (entrega prevista para hoje); a entrega é <b>confirmada</b> por você no local ou por quem pediu.${Object.keys(naOrcim).length ? ' Os itens com <span class="pd-tag lv-orcim"><i class="bi bi-boxes"></i>Em estoque na ORCIM</span> saem do Estoque da ORCIM.' : ''}</span>
          <button type="button" class="btn btn-sm btn-link lv-todos">Marcar todos</button></div>` : ''}
        ${blocos || '<div class="dp-vazio">Nenhum material pedido nos chamados dessas paradas.</div>'}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Fechar</button>
        ${podeEntregar && pendentes.length ? '<button class="btn btn-outline-primary btn-sm" id="lv-rota" disabled><i class="bi bi-signpost-split"></i> <span>Levar na rota</span></button><button class="btn btn-success btn-sm" id="lv-entregar" disabled><i class="bi bi-check2-circle"></i> <span>Confirmar entrega</span></button>' : ''}
      </div></div></div>`;
    document.body.appendChild(m);
    const bm = new bootstrap.Modal(m);
    let mudou = false;
    m.addEventListener('hidden.bs.modal', () => { m.remove(); if (mudou && depois) depois(); });
    const btn = m.querySelector('#lv-entregar');
    const btnRota = m.querySelector('#lv-rota');
    const marcados = () => [...m.querySelectorAll('.lv-item:not(.feito) .lv-marca:checked')].map((c) => c.closest('.lv-item'));
    const contar = () => {
      m.querySelectorAll('.lv-item:not(.feito)').forEach((it) => it.classList.toggle('marcado', it.querySelector('.lv-marca').checked));
      if (!btn) return;
      const n = marcados().length;
      const naRota = marcados().filter((it) => !it.dataset.rota).length;
      btn.disabled = !n;
      btn.querySelector('span').textContent = n ? `Confirmar entrega (${n})` : 'Confirmar entrega';
      btnRota.disabled = !naRota;
      btnRota.querySelector('span').textContent = naRota ? `Levar na rota (${naRota})` : 'Levar na rota';
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
    contar();
    bm.show();
  }

  // ---------------- Agendar a rota montada ----------------
  async function agendarRota(ordem, depois) {
    let tecnicos = [];
    try { tecnicos = await API.get('/rotas/tecnicos'); } catch (e) { showError(e); return; }
    const u = API.user || {};
    const amanha = new Date(Date.now() + 86400000).toLocaleDateString('sv-SE');
    const m = document.createElement('div');
    m.className = 'modal fade';
    m.innerHTML = `<div class="modal-dialog"><div class="modal-content">
      <div class="modal-header"><h6 class="mb-0"><i class="bi bi-calendar-plus me-1"></i> Agendar esta rota</h6><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div class="lv-total mb-3">${ordem.map((p, i) => `<span class="tg tg-blue">${i + 1}. ${esc(p.location_name)}</span>`).join(' ')}</div>
        <div class="row g-2">
          <div class="col-6"><label class="form-label small fw-semibold mb-1">Dia *</label><input type="date" class="form-control form-control-sm" id="ag-dia" min="${new Date().toLocaleDateString('sv-SE')}" value="${amanha}"></div>
          <div class="col-6"><label class="form-label small fw-semibold mb-1">Técnico</label><select class="form-select form-select-sm" id="ag-tec">
            <option value="">— a definir —</option>${tecnicos.map((t) => `<option value="${t.id}" ${String(t.id) === String(u.id) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
        </div>
        <label class="form-label small fw-semibold mt-3 mb-1">Observação</label>
        <input class="form-control form-control-sm" id="ag-nota" maxlength="500" placeholder="Ex.: saída 8h da base, levar toner">
        <div class="form-text">Quem é desses locais vê "Rota da TI agendada para o seu local" e recebe um aviso.</div>
      </div>
      <div class="modal-footer"><button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="ag-ok"><i class="bi bi-calendar-check"></i> Agendar</button></div></div></div>`;
    document.body.appendChild(m);
    const bm = new bootstrap.Modal(m);
    m.addEventListener('hidden.bs.modal', () => m.remove());
    m.querySelector('#ag-ok').addEventListener('click', async () => {
      try {
        await API.post('/rotas', { data: m.querySelector('#ag-dia').value, technician_id: m.querySelector('#ag-tec').value || null,
          nota: m.querySelector('#ag-nota').value.trim(), locais: ordem.map((p) => p.location_id) });
        bm.hide(); toast('Rota agendada. Os locais foram avisados.', 'success'); if (depois) depois();
      } catch (e) { showError(e); }
    });
    bm.show();
  }

  // ---------------- Agenda de rotas (calendário do mês + lista) ----------------
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  async function agenda(el, { modoPosto = false } = {}) {
    const u = API.user || {};
    const hoje = new Date();
    let ano = hoje.getFullYear(); let mes = hoje.getMonth();
    let diaSel = null;
    el.innerHTML = `
      <div class="card panel-card mb-3"><div class="ag-cab">
        <button class="btn btn-sm btn-outline-secondary" id="ag-ant" title="Mês anterior"><i class="bi bi-chevron-left"></i></button>
        <b id="ag-mes"></b>
        <button class="btn btn-sm btn-outline-secondary" id="ag-prox" title="Próximo mês"><i class="bi bi-chevron-right"></i></button>
        <button class="btn btn-sm btn-link" id="ag-hoje">Hoje</button>
        <span class="small text-muted ms-auto">${modoPosto ? 'As visitas da TI planejadas para o seu local' : 'Rotas planejadas pelos técnicos. Para agendar, monte a rota em "Sugerir agora".'}</span>
      </div>
      <div class="ag-grade" id="ag-grade"></div></div>
      <div id="ag-lista"></div>`;
    const doMes = () => {
      const de = `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
      const fim = new Date(ano, mes + 1, 0).getDate();
      return [de, `${ano}-${String(mes + 1).padStart(2, '0')}-${String(fim).padStart(2, '0')}`];
    };
    async function carregar() {
      el.querySelector('#ag-mes').textContent = `${MESES[mes]} de ${ano}`;
      const [de, ate] = doMes();
      let d;
      try { d = await API.get(`/rotas?de=${de}&ate=${ate}`); } catch (e) { el.querySelector('#ag-lista').innerHTML = emptyState('Não foi possível carregar', e.message, 'bi-exclamation-triangle'); return; }
      const meuLocal = String(d.meu_local || u.location_id || '');
      const passaNoMeu = (r) => meuLocal && (r.paradas || []).some((p) => String(p.location_id) === meuLocal);
      const porDia = {};
      d.rotas.forEach((r) => { (porDia[r.data] = porDia[r.data] || []).push(r); });
      // calendário
      const primeiro = new Date(ano, mes, 1).getDay();
      const fim = new Date(ano, mes + 1, 0).getDate();
      const hojeIso = new Date().toLocaleDateString('sv-SE');
      let cel = SEMANA.map((s) => `<div class="ag-sem">${s}</div>`).join('');
      for (let i = 0; i < primeiro; i += 1) cel += '<div class="ag-dia vazio"></div>';
      for (let dd = 1; dd <= fim; dd += 1) {
        const iso = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        const rs = porDia[iso] || [];
        cel += `<button type="button" class="ag-dia ${iso === hojeIso ? 'hoje' : ''} ${iso === diaSel ? 'sel' : ''} ${rs.length ? 'tem' : ''} ${rs.some(passaNoMeu) ? 'meu' : ''}" data-dia="${iso}">
          <span class="ag-n">${dd}</span>
          ${rs.length ? `<span class="ag-chip" title="${rs.map((r) => (r.paradas || []).map((p) => p.location_name).join(' → ')).join(' | ')}"><i class="bi bi-truck"></i>${rs.reduce((s, r) => s + (r.paradas || []).length, 0)}</span>` : ''}
        </button>`;
      }
      el.querySelector('#ag-grade').innerHTML = cel;
      el.querySelectorAll('.ag-dia[data-dia]').forEach((b) => b.addEventListener('click', () => { diaSel = diaSel === b.dataset.dia ? null : b.dataset.dia; carregar(); }));
      // lista
      const lista = d.rotas.filter((r) => !diaSel || r.data === diaSel);
      el.querySelector('#ag-lista').innerHTML = lista.length ? lista.map((r) => {
        const dt = new Date(`${r.data}T12:00:00`);
        const podeCancelar = d.pode_agendar && (Roles.isMaster(u) || [r.created_by, r.technician_id].map(String).includes(String(u.id)));
        return `<div class="card panel-card mb-2 ag-rota ${passaNoMeu(r) ? 'meu' : ''}">
          <div class="ag-rota-data"><b>${dt.getDate()}</b><small>${MESES[dt.getMonth()].slice(0, 3)}</small><small>${SEMANA[dt.getDay()]}</small></div>
          <div class="ag-rota-tx">
            ${passaNoMeu(r) ? '<span class="tg tg-teal mb-1"><i class="bi bi-geo-alt-fill"></i> Rota da TI agendada para o seu local</span>' : ''}
            <div class="ag-paradas">${(r.paradas || []).map((p, i) => `<span class="ag-parada ${String(p.location_id) === meuLocal ? 'meu' : ''}"><span class="ur-num">${i + 1}</span>${esc(p.location_name)}</span>`).join('<i class="bi bi-arrow-right ag-seta"></i>')}</div>
            <small class="text-muted"><i class="bi bi-person-badge"></i> ${esc(r.technician_name || 'técnico a definir')}${r.nota ? ` · ${esc(r.nota)}` : ''}</small>
          </div>
          ${podeCancelar ? `<button class="btn btn-sm btn-outline-danger ag-cancelar" data-id="${r.id}" title="Cancelar esta rota"><i class="bi bi-x-lg"></i></button>` : ''}
        </div>`;
      }).join('') : emptyState(diaSel ? 'Nenhuma rota neste dia' : 'Nenhuma rota planejada neste mês', modoPosto ? 'Quando a TI agendar uma visita ao seu local, ela aparece aqui.' : 'Monte uma rota em "Sugerir agora" e clique em "Agendar esta rota".', 'bi-calendar3');
      el.querySelectorAll('.ag-cancelar').forEach((b) => b.addEventListener('click', async () => {
        if (!await confirmDialog({ title: 'Cancelar rota', body: 'A rota sai da agenda.', confirmText: 'Cancelar rota', danger: true })) return;
        try { await API.del(`/rotas/${b.dataset.id}`); toast('Rota cancelada.', 'warning'); carregar(); } catch (e) { showError(e); }
      }));
    }
    el.querySelector('#ag-ant').addEventListener('click', () => { mes -= 1; if (mes < 0) { mes = 11; ano -= 1; } diaSel = null; carregar(); });
    el.querySelector('#ag-prox').addEventListener('click', () => { mes += 1; if (mes > 11) { mes = 0; ano += 1; } diaSel = null; carregar(); });
    el.querySelector('#ag-hoje').addEventListener('click', () => { ano = hoje.getFullYear(); mes = hoje.getMonth(); diaSel = null; carregar(); });
    carregar();
  }

  async function rotas(raiz) {
    // abas: sugerir agora (tempo real) | agenda de rotas (planejadas)
    const aba = /aba=agenda/.test(location.hash) ? 'agenda' : 'agora';
    raiz.innerHTML = `<ul class="nav nav-tabs mb-3 rt-abas">
      <li class="nav-item"><a class="nav-link ${aba === 'agora' ? 'active' : ''}" href="#/rotas"><i class="bi bi-magic"></i> Sugerir agora</a></li>
      <li class="nav-item"><a class="nav-link ${aba === 'agenda' ? 'active' : ''}" href="#/rotas?aba=agenda"><i class="bi bi-calendar3"></i> Agenda de rotas</a></li>
    </ul><div id="rt-conteudo"></div>`;
    const el = raiz.querySelector('#rt-conteudo');
    if (aba === 'agenda') { agenda(el); return; }
    el.innerHTML = spinner();
    let d;
    try { d = await API.get('/dashboard/urgencia'); } catch (e) { el.innerHTML = emptyState('Não foi possível carregar', e.message, 'bi-exclamation-triangle'); return; }
    const comCoord = d.locais.filter((l) => l.latitude !== null && l.longitude !== null && l.location_id)
      .map((l) => ({ ...l, lat: l.latitude, lng: l.longitude }));
    const semCoord = d.locais.filter((l) => !(l.latitude !== null && l.longitude !== null && l.location_id));
    let todosLocais = [];
    try { todosLocais = (await API.get('/locations?active=true')).filter((l) => l.latitude != null && l.longitude != null); } catch { /* sem lista */ }
    let prefs = { n: 2, inicio: '' };
    try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('rotas_prefs') || '{}') }; } catch { /* padrão */ }
    let escolhidos = new Set(comCoord.slice(0, prefs.n).map((l) => String(l.location_id)));
    let meuGps = null;

    el.innerHTML = `
      <div class="card panel-card mb-3"><div class="card-body ur-form">
        <label>Quantos locais quer atender?
          <input type="number" class="form-control form-control-sm" id="rt-n" min="1" max="10" value="${prefs.n}"></label>
        <label>Saindo de
          <select class="form-select form-select-sm" id="rt-inicio">
            <option value="">— começar pelo mais urgente —</option>
            <option value="gps">📍 Minha localização agora</option>
            ${todosLocais.map((l) => `<option value="${l.id}">${esc(l.name)}${l.city ? ` (${esc(l.city)})` : ''}</option>`).join('')}
          </select></label>
        <button class="btn btn-sm btn-outline-secondary" id="rt-sugerir"><i class="bi bi-magic"></i> Sugerir de novo</button>
        <span class="small text-muted ms-auto">${comCoord.length} local(is) com chamados e coordenadas</span>
      </div></div>
      <div class="ur-rota-grade">
        <div class="card panel-card">
          <div class="dp-bloco-cab"><span><i class="bi bi-list-ol"></i> Locais (por score)</span><small class="text-muted">marque os que vai atender</small></div>
          <div id="rt-cands" class="ur-cands"></div>
          ${semCoord.length ? `<div class="ur-sem">Sem coordenadas (fora da rota): ${semCoord.map((l) => `${esc(l.location_name)} <b>${n1(l.score)}</b>`).join(' · ')}.
            Cadastre a latitude e longitude em <a href="#/admin/locations">Localizações</a>.</div>` : ''}
        </div>
        <div class="rt-direita"><div class="card panel-card ur-rota" id="rt-rota"></div><div id="rt-levar"></div></div>
      </div>
      ${regrasHtml(d.regras)}`;
    el.querySelector('#rt-inicio').value = prefs.inicio;

    const salvar = () => { try { localStorage.setItem('rotas_prefs', JSON.stringify(prefs)); } catch { /* sem armazenamento */ } };
    const pontoInicio = () => {
      if (prefs.inicio === 'gps') return meuGps;
      const l = todosLocais.find((x) => String(x.id) === String(prefs.inicio));
      return l ? { lat: Number(l.latitude), lng: Number(l.longitude), location_name: l.name } : null;
    };

    function pintarCands() {
      el.querySelector('#rt-cands').innerHTML = comCoord.length ? comCoord.map((l, i) => `
        <label class="ur-cand ${escolhidos.has(String(l.location_id)) ? 'sel' : ''}">
          <input type="checkbox" data-loc="${l.location_id}" ${escolhidos.has(String(l.location_id)) ? 'checked' : ''}>
          <span class="ur-pos">${i + 1}º</span>
          <span class="ur-loc-tx"><b>${esc(l.location_name)}</b><small>${l.chamados.length} chamado(s)${l.atrasados ? ` · ${l.atrasados} atrasado(s)` : ''}${l.city ? ` · ${esc(l.city)}` : ''}</small></span>
          <span class="ur-loc-score">${numScore(l.score, ALVO_LOCAL, '', 1.05, temParada(l.chamados))}</span>
        </label>`).join('') : '<div class="dp-vazio">Nenhum local com chamados em aberto e coordenadas.</div>';
      el.querySelectorAll('#rt-cands [data-loc]').forEach((c) => c.addEventListener('change', () => {
        if (c.checked) escolhidos.add(c.dataset.loc); else escolhidos.delete(c.dataset.loc);
        pintarCands(); pintarRota();
      }));
    }

    function pintarRota() {
      const box = el.querySelector('#rt-rota');
      const paradas = comCoord.filter((l) => escolhidos.has(String(l.location_id)));
      if (!paradas.length) { box.innerHTML = '<div class="dp-vazio">Marque ao menos um local para montar a rota.</div>'; el.querySelector('#rt-levar').innerHTML = ''; return; }
      const inicio = pontoInicio();
      const ordem = ordenar(paradas, inicio);
      let total = 0; let anterior = inicio;
      const trechos = ordem.map((p) => { const dd = anterior ? km(anterior, p) * FATOR_ESTRADA : 0; total += dd; anterior = p; return dd; });
      const horas = total / VELOCIDADE;
      // Google Maps: rota pronta (abre no navegador/celular, sem chave de API)
      const pt = (p) => `${p.lat},${p.lng}`;
      const destino = ordem[ordem.length - 1];
      const meio = ordem.slice(0, -1);
      const url = `https://www.google.com/maps/dir/?api=1${inicio ? `&origin=${encodeURIComponent(pt(inicio))}` : ''}&destination=${encodeURIComponent(pt(destino))}${meio.length ? `&waypoints=${encodeURIComponent(meio.map(pt).join('|'))}` : ''}&travelmode=driving`;
      // o que levar: materiais pedidos (ainda não entregues) nos chamados das paradas
      const pendentes = ordem.flatMap((p) => p.chamados.flatMap((c) => (c.materiais || []).filter((m) => !['entregue', 'cancelado'].includes(m.status))));
      const pedidosN = ordem.reduce((s, p) => s + p.chamados.filter((c) => (c.materiais || []).some((m) => !['entregue', 'cancelado'].includes(m.status))).length, 0);
      const u = API.user || {};
      const podeAgendarRota = Roles.isMaster(u) || (Roles.can(u, 'dashboard.view') && (Roles.can(u, 'ticket.work') || Roles.can(u, 'ticket.assign')));
      box.innerHTML = `
        <div class="dp-bloco-cab"><span><i class="bi bi-signpost-split"></i> Rota sugerida</span>
          <span class="d-flex gap-1">
            <a class="btn btn-sm btn-primary" href="${url}" target="_blank" rel="noopener noreferrer"><i class="bi bi-map"></i> Abrir no Google Maps</a>
            ${podeAgendarRota ? '<button class="btn btn-sm btn-outline-primary" id="rt-agendar"><i class="bi bi-calendar-plus"></i> Agendar esta rota</button>' : ''}
            <button class="btn btn-sm btn-outline-secondary" id="rt-imprimir"><i class="bi bi-printer"></i> Relatório</button>
          </span></div>
        <div class="ur-resumo">${ordem.length} parada(s) · ~${n1(Math.round(total))} km · ~${horas < 1 ? `${Math.round(horas * 60)} min` : `${n1(Math.round(horas * 10) / 10)} h`} de estrada
          <small>estimativa pela distância em linha reta × ${n1(FATOR_ESTRADA)} a ${VELOCIDADE} km/h; o Google Maps calcula o trânsito real</small></div>
        <ol class="ur-paradas">
          ${inicio ? `<li class="ur-inicio"><i class="bi bi-geo-fill"></i> Saída: ${esc(inicio.location_name || 'sua localização')}</li>` : ''}
          ${ordem.map((p, i) => `
            <li class="ur-parada">
              <div class="ur-parada-cab"><span class="ur-num">${i + 1}</span><b>${esc(p.location_name)}</b>
                <span class="ur-loc-score">${numScore(p.score, ALVO_LOCAL, '', 1.05, temParada(p.chamados))}<small>score</small></span></div>
              <div class="ur-parada-sub">${esc([p.address, p.city].filter(Boolean).join(' · '))}${trechos[i] ? ` · ~${n1(Math.round(trechos[i]))} km do ponto anterior` : ''}</div>
              <div class="ur-chs">${p.chamados.map(linhaChamado).join('')}</div>
            </li>`).join('')}
        </ol>`;
      box.querySelector('#rt-imprimir').addEventListener('click', () => { document.body.classList.add('imprimindo-rota'); window.print(); setTimeout(() => document.body.classList.remove('imprimindo-rota'), 500); });
      box.querySelector('#rt-agendar')?.addEventListener('click', () => agendarRota(ordem, () => { location.hash = '#/rotas?aba=agenda'; }));
      // card separado: "O que levar" (abre a janela com o checklist dos pedidos)
      const lv = el.querySelector('#rt-levar');
      lv.innerHTML = `<button type="button" class="card panel-card lv-card ${pendentes.length ? '' : 'vazio'}" id="rt-abrir-levar">
        ${caixaPixel(40)}
        <span class="lv-card-tx"><b>O que levar</b>
          <small>${pendentes.length ? `${pendentes.length} item(ns) para separar · ${pedidosN} pedido(s) de material` : 'Nenhum material pedido nas paradas desta rota'}</small></span>
        <span class="btn btn-sm btn-outline-primary">Abrir lista <i class="bi bi-box-arrow-up-right"></i></span>
      </button>`;
      lv.querySelector('#rt-abrir-levar').addEventListener('click', () => abrirLevar(ordem, () => rotas(raiz)));
    }

    const sugerir = () => {
      escolhidos = new Set(comCoord.slice(0, prefs.n).map((l) => String(l.location_id)));
      pintarCands(); pintarRota();
    };
    el.querySelector('#rt-n').addEventListener('change', (e) => { prefs.n = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)); e.target.value = prefs.n; salvar(); sugerir(); });
    el.querySelector('#rt-sugerir').addEventListener('click', sugerir);
    el.querySelector('#rt-inicio').addEventListener('change', (e) => {
      prefs.inicio = e.target.value; salvar();
      if (prefs.inicio === 'gps' && !meuGps) {
        if (!navigator.geolocation) { toast('Este navegador não informa a localização.', 'warning'); return; }
        navigator.geolocation.getCurrentPosition((pos) => {
          meuGps = { lat: pos.coords.latitude, lng: pos.coords.longitude, location_name: 'sua localização' };
          pintarRota();
        }, () => toast('Não foi possível pegar a sua localização (permissão negada?).', 'warning'), { enableHighAccuracy: true, timeout: 10000 });
        return;
      }
      pintarRota();
    });
    pintarCands(); pintarRota();
  }

  return { pagina, rotas, agenda };
})();

Views.urgencia = (el) => Urgencia.pagina(el);
Views.rotas = (el) => Urgencia.rotas(el);
Views.visitas = (el) => Urgencia.agenda(el, { modoPosto: true });
