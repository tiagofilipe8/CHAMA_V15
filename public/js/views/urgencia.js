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
  // cor pelo score: começa verde e vai ficando vermelho (alvo = score a partir do qual já é vermelho)
  const cor = (score, alvo) => `hsl(${Math.round(135 * (1 - Math.min(Number(score) / alvo, 1)))} 68% 40%)`;
  const ALVO_LOCAL = 12; const ALVO_CHAMADO = 6;

  // como o score é calculado (aparece nas duas páginas)
  const regrasHtml = (r) => {
    const faixas = r.faixas_prazo.slice(1).map((f, i) => [`vence em ${r.faixas_prazo[i].ate + 1}${f.ate ? ` a ${f.ate}` : ' ou mais'} dias`, f.fator]);
    return `
    <details class="ur-regras">
      <summary><i class="bi bi-calculator"></i> <span>Como o score é calculado</span>
        <small class="ur-regras-dica">clique para ver</small><i class="bi bi-chevron-down ur-seta"></i></summary>
      <div class="ur-regras-corpo">
        <p class="ur-regras-base"><b>Todo chamado aberto começa valendo 1 ponto.</b> Esse ponto é multiplicado por 3 fatores:
          a urgência, o atraso e o prazo. O <b>score do local</b> é a soma dos pontos dos chamados abertos dele
          (chamado em pausa não conta).</p>
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
        <div class="ur-escala"><span>Cor do score:</span><i style="background:linear-gradient(90deg, ${cor(0, 1)}, ${cor(0.5, 1)}, ${cor(1, 1)})"></i>
          <small>verde = pouco urgente · vermelho = local com ${ALVO_LOCAL} pontos ou mais (chamado com ${ALVO_CHAMADO} ou mais)</small></div>
        <p class="text-muted mb-0 small">Prazo usado: o "Precisa até" do chamado; se não tiver, o prazo (SLA).</p>
      </div>
    </details>`;
  };

  const linhaChamado = (c) => `
    <a class="ur-ch ${TOM[c.priority] || 'u-req'}" href="#/tickets/${c.id}">
      <span class="ur-ch-num">${esc(c.number)}</span>
      <span class="ur-ch-tx"><b>${esc(c.title)}</b><small>${esc(c.impact_name || URG[c.priority] || '')}${c.category_name ? ` · ${esc(c.category_name)}` : ''} · ${c.assigned_name ? esc(c.assigned_name) : 'sem técnico'}</small></span>
      <span class="ur-ch-prazo">${situacaoPrazo(c)}</span>
      <span class="ur-ch-score" title="1 ponto × urgência × atraso × prazo"><b style="color:${cor(c.score, ALVO_CHAMADO)}">${n1(c.score)}</b><small>${conta(c)}</small></span>
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
              <span class="ur-loc-score"><b>${n1(l.score)}</b><small>score</small></span>
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

  async function rotas(el) {
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
        <div class="card panel-card ur-rota" id="rt-rota"></div>
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
          <span class="ur-loc-score"><b>${n1(l.score)}</b></span>
        </label>`).join('') : '<div class="dp-vazio">Nenhum local com chamados em aberto e coordenadas.</div>';
      el.querySelectorAll('#rt-cands [data-loc]').forEach((c) => c.addEventListener('change', () => {
        if (c.checked) escolhidos.add(c.dataset.loc); else escolhidos.delete(c.dataset.loc);
        pintarCands(); pintarRota();
      }));
    }

    function pintarRota() {
      const box = el.querySelector('#rt-rota');
      const paradas = comCoord.filter((l) => escolhidos.has(String(l.location_id)));
      if (!paradas.length) { box.innerHTML = '<div class="dp-vazio">Marque ao menos um local para montar a rota.</div>'; return; }
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
      // o que levar: materiais pedidos nos chamados das paradas
      const levar = new Map();
      ordem.forEach((p) => p.chamados.forEach((c) => (c.materiais || []).forEach((m) => {
        const k = `${m.name}|${m.unit || ''}`;
        levar.set(k, { ...m, quantity: (levar.get(k)?.quantity || 0) + Number(m.quantity || 0) });
      })));
      box.innerHTML = `
        <div class="dp-bloco-cab"><span><i class="bi bi-signpost-split"></i> Rota sugerida</span>
          <span class="d-flex gap-1">
            <a class="btn btn-sm btn-primary" href="${url}" target="_blank" rel="noopener noreferrer"><i class="bi bi-map"></i> Abrir no Google Maps</a>
            <button class="btn btn-sm btn-outline-secondary" id="rt-imprimir"><i class="bi bi-printer"></i> Relatório</button>
          </span></div>
        <div class="ur-resumo">${ordem.length} parada(s) · ~${n1(Math.round(total))} km · ~${horas < 1 ? `${Math.round(horas * 60)} min` : `${n1(Math.round(horas * 10) / 10)} h`} de estrada
          <small>estimativa pela distância em linha reta × ${n1(FATOR_ESTRADA)} a ${VELOCIDADE} km/h; o Google Maps calcula o trânsito real</small></div>
        <ol class="ur-paradas">
          ${inicio ? `<li class="ur-inicio"><i class="bi bi-geo-fill"></i> Saída: ${esc(inicio.location_name || 'sua localização')}</li>` : ''}
          ${ordem.map((p, i) => `
            <li class="ur-parada">
              <div class="ur-parada-cab"><span class="ur-num">${i + 1}</span><b>${esc(p.location_name)}</b>
                <span class="ur-loc-score"><b>${n1(p.score)}</b><small>score</small></span></div>
              <div class="ur-parada-sub">${esc([p.address, p.city].filter(Boolean).join(' · '))}${trechos[i] ? ` · ~${n1(Math.round(trechos[i]))} km do ponto anterior` : ''}</div>
              <div class="ur-chs">${p.chamados.map(linhaChamado).join('')}</div>
            </li>`).join('')}
        </ol>
        <div class="ur-levar"><b><i class="bi bi-bag-check"></i> O que levar</b>
          ${levar.size ? `<ul>${[...levar.values()].map((m) => `<li><input type="checkbox"> ${m.quantity} ${esc(m.unit || 'un')} · ${esc(m.name)}</li>`).join('')}</ul>`
    : '<div class="text-muted small">Nenhum material pedido nesses chamados. Confira as categorias (impressora, rede...) antes de sair.</div>'}</div>`;
      box.querySelector('#rt-imprimir').addEventListener('click', () => { document.body.classList.add('imprimindo-rota'); window.print(); setTimeout(() => document.body.classList.remove('imprimindo-rota'), 500); });
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

  return { pagina, rotas };
})();

Views.urgencia = (el) => Urgencia.pagina(el);
Views.rotas = (el) => Urgencia.rotas(el);
