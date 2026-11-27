// ---------------------------------------------------------------
// Rotas da TI
//   #/rotas              agenda: hoje, não concluídas, próximos dias (e o mês num calendário que começa na segunda)
//   #/rotas/nova         montar rota em 3 telas: 1 locais · 2 ordem · 3 dia, técnico e o que levar
//                        (?dia=AAAA-MM-DD já escolhe o dia; ?editar=ID edita uma rota)
//   #/rotas/ID           página da rota: cada parada com os chamados e o que levar para lá; começar, entregar e concluir
//   #/visitas            o calendário para os postos (só as rotas que passam nos locais deles)
//   O que levar: os itens de pedido das paradas aparecem marcados (sugestão); quem desmarca fica em route_plans.itens_fora.
// ---------------------------------------------------------------
const Rotas = (() => {
  const U = Urgencia;
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const MES3 = MESES.map((m) => m.slice(0, 3).toLowerCase());
  const SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']; // começa na segunda, igual ao Painel
  const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const hojeIso = () => new Date().toLocaleDateString('sv-SE');
  const somaDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
  const dataCurta = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const nomeDia = (iso) => {
    const h = hojeIso();
    if (iso === h) return 'hoje';
    if (iso === somaDias(h, 1)) return 'amanhã';
    if (iso === somaDias(h, -1)) return 'ontem';
    return `${DIA_SEMANA[new Date(`${iso}T12:00:00`).getDay()]}, ${dataCurta(iso)}`;
  };
  const eu = () => API.user || {};
  const podeMontar = () => { const x = eu(); return Roles.isMaster(x) || (Roles.can(x, 'dashboard.view') && (Roles.can(x, 'ticket.work') || Roles.can(x, 'ticket.assign'))); };
  const podeEntregar = () => Roles.can(eu(), 'inventory.manage') || Roles.isMaster(eu());
  const veOrcim = () => podeEntregar() && (Roles.isMaster(eu()) || Roles.can(eu(), 'ticket.view_all'));

  // situação mostrada: agendada / em andamento / concluída / não concluída (o dia passou sem concluir)
  const SIT = {
    agendada: ['Agendada', 'tg-blue', 'bi-calendar-check'],
    em_andamento: ['Em andamento', 'tg-amber', 'bi-truck'],
    concluida: ['Concluída', 'tg-green', 'bi-check2-circle'],
    nao_concluida: ['Não concluída', 'tg-gray', 'bi-exclamation-circle'],
  };
  const situacao = (r) => (r.status === 'concluida' ? 'concluida' : r.data < hojeIso() ? 'nao_concluida' : r.status);
  const tagSit = (r) => { const [t, c, i] = SIT[situacao(r)]; return `<span class="tg ${c}"><i class="bi ${i}"></i> ${t}</span>`; };

  // score num selo pequeno: vermelho com chaminha (score alto ou operação parada), laranja, verde
  const scorePill = (score, parada = false) => {
    const s = Number(score) || 0;
    const tom = parada || s >= U.ALVO_LOCAL ? 'quente' : s >= 6 ? 'morno' : 'calmo';
    return `<span class="ro-score ro-score-${tom}" title="Score de urgência ${U.n1(s)}${parada ? ' · tem operação parada' : ''}">${tom === 'quente' ? '<i class="bi bi-fire"></i>' : ''}${U.n1(s)}</span>`;
  };
  const prazoTag = (c) => (c.dias_atraso > 0 ? `<span class="tg tg-red">${c.dias_atraso} dia(s) atrasado</span>`
    : c.dias_para_prazo === 0 ? '<span class="tg tg-amber">vence hoje</span>'
      : c.dias_para_prazo != null ? `<span class="tg tg-gray">vence em ${c.dias_para_prazo} dia(s)</span>` : '');
  const chamadoLinha = (c) => `<a class="ro-ch ro-ch-p${Number(c.priority) || 1}" href="#/tickets/${c.id}">
      <span class="ro-ch-num">${esc(c.number)}</span>
      <span class="ro-ch-tx"><b>${esc(c.title)}</b><small>${esc(c.impact_name || '')}${c.category_name ? ` · ${esc(c.category_name)}` : ''} · ${c.assigned_name ? esc(c.assigned_name) : 'sem técnico'}</small></span>
      ${prazoTag(c)}${scorePill(c.score, Number(c.priority) === 4)}</a>`;
  const chamadosHtml = (p) => {
    const chs = p.chamados || [];
    if (!chs.length) return '<div class="ro-sem-ch">Nenhum chamado aberto neste local (visita sem chamado).</div>';
    return `<details class="ro-chs"><summary><i class="bi bi-chevron-right ur-seta"></i> ${chs.length} chamado(s) aberto(s)${U.temParada(chs) ? ' · <b class="text-danger">operação parada</b>' : ''}${p.atrasados ? ` · ${p.atrasados} atrasado(s)` : ''}</summary>
      <div class="ro-chs-lista">${chs.map(chamadoLinha).join('')}</div></details>`;
  };

  // distância e tempo (linha reta × fator de estrada, a uma velocidade média) e o link do Google Maps
  const temPonto = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
  const dist = (a, b) => (temPonto(a) && temPonto(b) ? U.km(a, b) : 0);
  const resumoKm = (ordem, inicio) => {
    let total = 0; let antes = inicio;
    const trechos = ordem.map((p) => { const d = antes ? dist(antes, p) * U.FATOR_ESTRADA : 0; total += d; if (temPonto(p)) antes = p; return d; });
    const horas = total / U.VELOCIDADE;
    return { trechos, km: Math.round(total), tempo: horas < 1 ? `${Math.round(horas * 60)} min` : `${U.n1(Math.round(horas * 10) / 10)} h` };
  };
  const mapsUrl = (ordem, inicio) => {
    const pts = ordem.filter(temPonto);
    if (!pts.length) return null;
    const pt = (p) => `${p.lat},${p.lng}`;
    const destino = pts[pts.length - 1]; const meio = pts.slice(0, -1);
    return `https://www.google.com/maps/dir/?api=1${temPonto(inicio) ? `&origin=${encodeURIComponent(pt(inicio))}` : ''}&destination=${encodeURIComponent(pt(destino))}${meio.length ? `&waypoints=${encodeURIComponent(meio.map(pt).join('|'))}` : ''}&travelmode=driving`;
  };
  // Resumo em destaque: paradas, km e tempo, com o botão do Google Maps ao lado
  const resumoBloco = (ordem, inicio, url) => {
    const r = resumoKm(ordem, inicio);
    return `<div class="ro-resumo">
      <div class="ro-stat"><i class="bi bi-geo-alt-fill"></i><span><b>${ordem.length}</b><small>parada${ordem.length === 1 ? '' : 's'}</small></span></div>
      <div class="ro-stat"><i class="bi bi-signpost-2-fill"></i><span><b>~${U.n1(r.km)} km</b><small>no total</small></span></div>
      <div class="ro-stat"><i class="bi bi-clock-fill"></i><span><b>~${r.tempo}</b><small>de estrada</small></span></div>
      ${url ? `<a class="btn btn-maps ro-nao-imprime" href="${url}" target="_blank" rel="noopener noreferrer"><i class="bi bi-map-fill"></i> Abrir no Google Maps</a>` : ''}
    </div>
    <div class="ro-resumo-nota">Estimativa pela distância entre os locais. O Google Maps mostra o caminho e o trânsito de verdade.</div>`;
  };

  // Caminho mais curto saindo de "inicio" (opcional) e terminando em "fim" (opcional).
  //   Até 8 paradas soltas testa todas as ordens; acima disso, vizinho mais próximo + 2-opt.
  function maisCurto(paradas, inicio, fimId) {
    const fim = fimId ? paradas.find((p) => String(p.location_id) === String(fimId)) : null;
    const meio = paradas.filter((p) => p !== fim);
    const custo = (o) => { let t = 0; let a = inicio || null; o.forEach((p) => { if (a) t += dist(a, p); a = p; }); return t; };
    const comFim = (o) => (fim ? [...o, fim] : o);
    if (meio.length <= 8) {
      let melhor = meio.slice(); let menor = custo(comFim(melhor));
      const usar = new Array(meio.length).fill(false); const atual = [];
      const testar = () => {
        if (atual.length === meio.length) { const c = custo(comFim(atual)); if (c < menor - 1e-9) { menor = c; melhor = atual.slice(); } return; }
        for (let i = 0; i < meio.length; i += 1) {
          if (usar[i]) continue;
          usar[i] = true; atual.push(meio[i]); testar(); atual.pop(); usar[i] = false;
        }
      };
      testar();
      return comFim(melhor);
    }
    const resto = meio.slice(); let ordem = []; let a = inicio || null;
    if (!a) { resto.sort((x, y) => y.score - x.score); a = resto.shift(); ordem.push(a); }
    while (resto.length) { let k = 0; let d = Infinity; resto.forEach((p, i) => { const x = dist(a, p); if (x < d) { d = x; k = i; } }); a = resto.splice(k, 1)[0]; ordem.push(a); }
    let melhorou = true;
    while (melhorou) {
      melhorou = false;
      for (let i = 0; i < ordem.length - 1; i += 1) {
        for (let j = i + 1; j < ordem.length; j += 1) {
          const nova = [...ordem.slice(0, i), ...ordem.slice(i, j + 1).reverse(), ...ordem.slice(j + 1)];
          if (custo(comFim(nova)) < custo(comFim(ordem)) - 1e-9) { ordem = nova; melhorou = true; }
        }
      }
    }
    return comFim(ordem);
  }

  // ---------------- O que levar (dentro da tela, por parada, marcado como sugestão) ----------------
  const DESTINOS = { inventario: 'Inventário da Empresa (em uso)', estoque: 'Estoque de T.I. do local' };
  const itensDaParada = (p) => (p.chamados || []).flatMap((c) => (c.materiais || []).filter((m) => m.status !== 'cancelado')
    .map((m) => ({ ...m, ticket_id: c.id, ticket_number: c.number })));
  async function procurarOrcim(itens) {
    if (!veOrcim()) return {};
    const lista = itens.filter((m) => !['entregue', 'cancelado'].includes(m.status) && !m.comprado).map((m) => ({ id: m.id, name: m.name }));
    if (!lista.length) return {};
    try { return await API.post('/orcim/procurar', { materiais: lista }); } catch { return {}; }
  }
  const usaOrcim = (m, naOrcim) => { const o = naOrcim[m.id]; return !!(o && !m.comprado && o.disponivel >= Number(m.quantity || 1)); };
  // modo: 'planejar' (caixinha marcada = vai nesta rota) | 'entregar' (rota em andamento) | 'ver' (só olhar)
  function itemLevar(m, { modo, fora, naOrcim, podeMexer }) {
    const nome = Item.titulo({ name: m.name, type: m.asset_type || 'PERIPHERAL' }, { link: false, estado: false, local: false, etapa: false, etiqueta: false });
    const meio = `<span class="ro-lv-qtd">${m.quantity} ${esc(m.unit || 'un')}</span><span class="ro-lv-nome">${nome}</span>
      <a class="ro-lv-tk" href="#/tickets/${m.ticket_id}" title="Chamado do pedido">${esc(m.ticket_number)}</a>`;
    const o = naOrcim[m.id];
    const tagOrcim = o && !m.comprado && !['entregue', 'rota'].includes(m.status)
      ? `<span class="pd-tag lv-orcim ${usaOrcim(m, naOrcim) ? '' : 'pouco'}" title="${esc(o.itens.map((a) => `${a.asset_tag ? `${a.asset_tag} · ` : ''}${a.name}`).join('\n'))}"><i class="bi bi-boxes"></i>${usaOrcim(m, naOrcim) ? 'sai do Estoque da ORCIM' : `a ORCIM tem só ${o.disponivel}`}</span>` : '';
    if (modo === 'planejar') {
      const marcado = !fora.has(String(m.id));
      return `<label class="ro-lv-item ${marcado ? 'marcado' : 'fora'}">
        <input type="checkbox" class="form-check-input" data-levar="${m.id}" ${marcado ? 'checked' : ''} ${podeMexer ? '' : 'disabled'}>
        ${meio}<span class="ro-lv-st">${tagOrcim}${pedidoTag(m.status)}</span></label>`;
    }
    if (m.status === 'entregue' || modo === 'ver' || !podeMexer) {
      return `<div class="ro-lv-item ${m.status === 'entregue' ? 'feito' : ''}">${meio}<span class="ro-lv-st">${pedidoTag(m.status)}${m.status === 'entregue' && m.destino && m.destino !== 'nenhum' ? ` <small class="text-muted">${m.destino === 'estoque' ? 'no Estoque de T.I.' : 'no Inventário da Empresa'}</small>` : ''}</span></div>`;
    }
    const dest = m.destino === 'nenhum' ? { ...DESTINOS, nenhum: 'Consumível (só entregar)' } : DESTINOS;
    return `<div class="ro-lv-item" data-m="${m.id}" data-t="${m.ticket_id}">${meio}
      <span class="ro-lv-st">${pedidoTag(m.status)}</span>
      <span class="ro-lv-acao"><select class="form-select form-select-sm" data-dest aria-label="Para onde vai">${Object.entries(dest).map(([k, v]) => `<option value="${k}" ${k === (m.destino || 'inventario') ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button type="button" class="btn btn-sm btn-success" data-entregue><i class="bi bi-check2-circle"></i> Entregue</button></span></div>`;
  }
  const contarLevar = (itens, fora) => {
    const abertos = itens.filter((m) => m.status !== 'entregue');
    return { total: abertos.length, marcados: abertos.filter((m) => !fora.has(String(m.id))).length };
  };
  // ao marcar/desmarcar: atualiza o conjunto "fora", a aparência da linha e chama "depois"
  const ligarCaixas = (raiz, fora, depois) => raiz.querySelectorAll('[data-levar]').forEach((c) => c.addEventListener('change', () => {
    if (c.checked) fora.delete(c.dataset.levar); else fora.add(c.dataset.levar);
    const lin = c.closest('.ro-lv-item'); lin.classList.toggle('marcado', c.checked); lin.classList.toggle('fora', !c.checked);
    if (depois) depois();
  }));

  // imprimir: abre os chamados de todas as paradas e volta depois
  const imprimir = (raiz) => {
    const fechados = [...raiz.querySelectorAll('details.ro-chs:not([open])')];
    fechados.forEach((d) => { d.open = true; });
    document.body.classList.add('imprimindo-rota');
    window.print();
    setTimeout(() => { document.body.classList.remove('imprimindo-rota'); fechados.forEach((d) => { d.open = false; }); }, 500);
  };

  // arrastar para mudar a ordem (mouse e dedo): a alça [data-alca] move o item [data-id] dentro da lista
  function arrastavel(lista, aoSoltar) {
    lista.querySelectorAll('[data-alca]').forEach((alca) => alca.addEventListener('pointerdown', (ev) => {
      const item = alca.closest('[data-id]');
      if (!item) return;
      ev.preventDefault();
      item.classList.add('arrastando');
      // escuta na página toda: mudar o item de lugar na lista faz o navegador soltar a captura da alça
      const mover = (e) => {
        if (e.pointerId !== ev.pointerId) return;
        e.preventDefault();
        const alvo = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-id]');
        if (!alvo || alvo === item || alvo.parentNode !== item.parentNode) return;
        const r = alvo.getBoundingClientRect();
        item.parentNode.insertBefore(item, e.clientY > r.top + r.height / 2 ? alvo.nextSibling : alvo);
      };
      const soltar = (e) => {
        if (e.pointerId !== ev.pointerId) return;
        document.removeEventListener('pointermove', mover); document.removeEventListener('pointerup', soltar); document.removeEventListener('pointercancel', soltar);
        item.classList.remove('arrastando');
        aoSoltar([...item.parentNode.children].filter((x) => x.dataset.id).map((x) => x.dataset.id));
      };
      document.addEventListener('pointermove', mover, { passive: false });
      document.addEventListener('pointerup', soltar); document.addEventListener('pointercancel', soltar);
    }));
  }

  // ---------------- Agenda ----------------
  function cartao(r, { modoPosto = false, meuLocal = '' } = {}) {
    const paradas = r.paradas || [];
    const passa = meuLocal && paradas.some((p) => String(p.location_id) === meuLocal);
    const d = new Date(`${r.data}T12:00:00`);
    const tag = modoPosto ? 'div' : 'a';
    const info = [`<i class="bi bi-person-badge"></i> ${esc(r.technician_name || 'técnico a definir')}`,
      r.n_chamados != null ? `${r.n_chamados} chamado(s) aberto(s)` : '', r.n_itens ? `${r.n_itens} item(ns) de pedido` : '', r.nota ? esc(r.nota) : ''].filter(Boolean);
    return `<${tag} class="card panel-card ro-cartao ro-${situacao(r)} ${passa ? 'meu' : ''}" ${modoPosto ? '' : `href="#/rotas/${r.id}"`}>
      <span class="ro-data"><b>${d.getDate()}</b><small>${MES3[d.getMonth()]}</small><small>${DIA_SEMANA[d.getDay()]}</small></span>
      <span class="ro-tx">
        ${passa ? '<span class="tg tg-teal mb-1 align-self-start"><i class="bi bi-geo-alt-fill"></i> Rota da TI agendada para o seu local</span>' : ''}
        <span class="ro-trajeto">${paradas.map((p) => `<span class="${String(p.location_id) === meuLocal ? 'meu' : ''}">${esc(p.location_name)}</span>`).join('<i class="bi bi-arrow-right"></i>')}</span>
        <small class="text-muted">${info.join(' · ')}</small>
      </span>
      ${modoPosto ? '' : `${tagSit(r)}<i class="bi bi-chevron-right ro-seta"></i>`}
    </${tag}>`;
  }

  async function agenda(el, { modoPosto = false } = {}) {
    let vista = 'lista';
    if (modoPosto) vista = 'mes';
    else { try { vista = sessionStorage.getItem('rotas_vista') || 'lista'; } catch { /* padrão */ } }
    const h = hojeIso();
    let ano = new Date().getFullYear(); let mes = new Date().getMonth(); let diaSel = null;
    const pode = !modoPosto && podeMontar();
    el.innerHTML = `
      ${modoPosto ? '' : `<div class="ro-barra">
        <div class="seg" role="group" aria-label="Ver"><button type="button" data-vista="lista"><i class="bi bi-list-ul"></i> Próximas</button><button type="button" data-vista="mes"><i class="bi bi-calendar3"></i> Mês</button></div>
        ${pode ? '<a class="btn btn-primary btn-sm ms-auto" href="#/rotas/nova"><i class="bi bi-plus-lg"></i> Montar rota</a>' : ''}
      </div>`}
      <div id="ro-corpo">${spinner()}</div>`;
    const corpo = el.querySelector('#ro-corpo');
    const marcarVista = () => el.querySelectorAll('[data-vista]').forEach((b) => b.classList.toggle('active', b.dataset.vista === vista));
    el.querySelectorAll('[data-vista]').forEach((b) => b.addEventListener('click', () => {
      vista = b.dataset.vista; try { sessionStorage.setItem('rotas_vista', vista); } catch { /* ok */ }
      marcarVista(); render();
    }));
    marcarVista();

    async function lista() {
      let d;
      try { d = await API.get(`/rotas?de=${somaDias(h, -14)}&ate=${somaDias(h, 60)}`); } catch (e) { corpo.innerHTML = emptyState('Não foi possível carregar', e.message, 'bi-exclamation-triangle'); return; }
      const opt = { modoPosto, meuLocal: String(d.meu_local || eu().location_id || '') };
      const deHoje = d.rotas.filter((r) => r.data === h);
      const proximas = d.rotas.filter((r) => r.data > h);
      const passadas = d.rotas.filter((r) => r.data < h).reverse();
      const naoConcluidas = passadas.filter((r) => r.status !== 'concluida');
      const concluidas = passadas.filter((r) => r.status === 'concluida');
      corpo.innerHTML = `
        <section class="ro-sec"><h6 class="ro-sec-tit"><i class="bi bi-sun"></i> Hoje <small>${dataCurta(h)}</small></h6>
          ${deHoje.length ? deHoje.map((r) => cartao(r, opt)).join('')
    : `<div class="ro-vazio">Nenhuma rota para hoje.${pode ? ` <a href="#/rotas/nova?dia=${h}">Montar rota para hoje</a>` : ''}</div>`}</section>
        ${naoConcluidas.length ? `<section class="ro-sec"><h6 class="ro-sec-tit"><i class="bi bi-exclamation-circle"></i> Não concluídas <small>o dia passou e a rota não foi concluída</small></h6>
          ${naoConcluidas.map((r) => cartao(r, opt)).join('')}</section>` : ''}
        <section class="ro-sec"><h6 class="ro-sec-tit"><i class="bi bi-calendar-week"></i> Próximos dias</h6>
          ${proximas.length ? proximas.map((r) => cartao(r, opt)).join('') : '<div class="ro-vazio">Nenhuma rota agendada para os próximos dias.</div>'}</section>
        ${concluidas.length ? `<details class="ro-sec ro-passadas"><summary class="ro-sec-tit"><i class="bi bi-chevron-right ur-seta"></i> Concluídas nos últimos 14 dias <small>${concluidas.length}</small></summary>
          ${concluidas.map((r) => cartao(r, opt)).join('')}</details>` : ''}`;
    }

    async function mesVista() {
      const de = `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
      const fim = new Date(ano, mes + 1, 0).getDate();
      const ate = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(fim).padStart(2, '0')}`;
      if (!corpo.querySelector('.ro-cal')) {
        corpo.innerHTML = `<div class="card panel-card mb-3 ro-cal"><div class="ag-cab">
            <button class="btn btn-sm btn-outline-secondary" data-mes="-1" title="Mês anterior"><i class="bi bi-chevron-left"></i></button>
            <b class="ro-mes-nome"></b>
            <button class="btn btn-sm btn-outline-secondary" data-mes="1" title="Próximo mês"><i class="bi bi-chevron-right"></i></button>
            <button class="btn btn-sm btn-link" data-mes="0">Hoje</button>
            ${pode ? '<span class="small text-muted ms-auto">Clique num dia sem rota para montar uma rota nele.</span>' : ''}
          </div><div class="ag-grade ro-grade"></div></div><div class="ro-dia-lista"></div>`;
        corpo.querySelectorAll('[data-mes]').forEach((b) => b.addEventListener('click', () => {
          const n = Number(b.dataset.mes);
          if (!n) { ano = new Date().getFullYear(); mes = new Date().getMonth(); } else { mes += n; if (mes < 0) { mes = 11; ano -= 1; } if (mes > 11) { mes = 0; ano += 1; } }
          diaSel = null; mesVista();
        }));
      }
      corpo.querySelector('.ro-mes-nome').textContent = `${MESES[mes]} de ${ano}`;
      let d;
      try { d = await API.get(`/rotas?de=${de}&ate=${ate}`); } catch (e) { corpo.querySelector('.ro-dia-lista').innerHTML = emptyState('Não foi possível carregar', e.message, 'bi-exclamation-triangle'); return; }
      const meuLocal = String(d.meu_local || eu().location_id || '');
      const passaNoMeu = (r) => meuLocal && (r.paradas || []).some((p) => String(p.location_id) === meuLocal);
      const porDia = {};
      d.rotas.forEach((r) => { (porDia[r.data] = porDia[r.data] || []).push(r); });
      const vazias = (new Date(ano, mes, 1).getDay() + 6) % 7; // segunda = 0
      let cel = SEMANA.map((s) => `<div class="ag-sem">${s}</div>`).join('');
      for (let i = 0; i < vazias; i += 1) cel += '<div class="ag-dia vazio"></div>';
      for (let dd = 1; dd <= fim; dd += 1) {
        const iso = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        const rs = porDia[iso] || [];
        cel += `<button type="button" class="ag-dia ${iso === h ? 'hoje' : ''} ${iso === diaSel ? 'sel' : ''} ${rs.length ? 'tem' : ''} ${rs.some(passaNoMeu) ? 'meu' : ''} ${iso < h ? 'passado' : ''}" data-dia="${iso}">
          <span class="ag-n">${dd}</span>
          ${rs.map((r) => `<span class="ro-chip ro-${situacao(r)}" title="${esc((r.paradas || []).map((p) => p.location_name).join(' → '))}"><i class="bi bi-truck"></i>${(r.paradas || []).length}</span>`).join('')}
        </button>`;
      }
      corpo.querySelector('.ro-grade').innerHTML = cel;
      corpo.querySelectorAll('.ag-dia[data-dia]').forEach((b) => b.addEventListener('click', () => {
        const dia = b.dataset.dia;
        // dia sem rota (hoje ou depois): já vai montar a rota nele
        if (pode && !(porDia[dia] || []).length && dia >= h) { location.hash = `#/rotas/nova?dia=${dia}`; return; }
        diaSel = diaSel === dia ? null : dia; mesVista();
      }));
      const opt = { modoPosto, meuLocal };
      const lista = d.rotas.filter((r) => !diaSel || r.data === diaSel);
      corpo.querySelector('.ro-dia-lista').innerHTML = `
        ${diaSel && pode && diaSel >= h ? `<div class="mb-2"><a class="btn btn-sm btn-outline-primary" href="#/rotas/nova?dia=${diaSel}"><i class="bi bi-plus-lg"></i> Montar outra rota para ${dataCurta(diaSel)}</a></div>` : ''}
        ${lista.length ? lista.map((r) => cartao(r, opt)).join('')
    : emptyState(diaSel ? 'Nenhuma rota neste dia' : 'Nenhuma rota neste mês', modoPosto ? 'Quando a TI agendar uma visita ao seu local, ela aparece aqui.' : 'Clique num dia para montar uma rota nele.', 'bi-calendar3')}`;
    }
    const render = () => (vista === 'mes' ? mesVista() : lista());
    render();
  }

  // ---------------- Montar rota: 3 telas (1 locais · 2 ordem · 3 dia, técnico e o que levar) ----------------
  async function montar(el) {
    if (!podeMontar()) { location.hash = '#/rotas'; toast('Seu perfil não monta rotas.', 'warning'); return; }
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    const editarId = /^\d+$/.test(qs.get('editar') || '') ? qs.get('editar') : null;
    const h = hojeIso();
    el.innerHTML = spinner();
    let urg; let todos = []; let tecnicos = []; let futuras = { rotas: [] }; let plano = null;
    try {
      [urg, todos, tecnicos, futuras, plano] = await Promise.all([
        API.get('/dashboard/urgencia'), API.get('/locations?active=true').catch(() => []), API.get('/rotas/tecnicos').catch(() => []),
        API.get(`/rotas?de=${h}&ate=${somaDias(h, 60)}`).catch(() => ({ rotas: [] })), editarId ? API.get(`/rotas/${editarId}`) : null]);
    } catch (e) { el.innerHTML = emptyState('Não foi possível carregar', e.message, 'bi-exclamation-triangle'); return; }
    if (plano && (!plano.pode_editar || plano.status === 'concluida')) {
      toast(plano.status === 'concluida' ? 'Essa rota já foi concluída.' : 'Só quem agendou, o técnico da rota ou o admin mestre editam.', 'warning');
      location.hash = `#/rotas/${plano.id}`; return;
    }
    if (plano && window.migalhaDetalhe) window.migalhaDetalhe(`Editar a rota de ${nomeDia(plano.data)}`);
    const temCoord = (l) => l.latitude != null && l.longitude != null && l.latitude !== '' && l.longitude !== '';
    // locais: os que têm chamado aberto (por score) e, se precisar, qualquer local com coordenadas
    let porId = new Map();
    const montarMapa = () => {
      porId = new Map();
      urg.locais.filter((l) => l.location_id && temCoord(l)).forEach((l) => porId.set(String(l.location_id), { ...l, lat: Number(l.latitude), lng: Number(l.longitude) }));
    };
    montarMapa();
    const candidatos = () => urg.locais.filter((l) => l.location_id && temCoord(l)).map((l) => String(l.location_id));
    const pegar = (id) => {
      id = String(id);
      if (porId.has(id)) return porId.get(id);
      const l = todos.find((x) => String(x.id) === id) || (plano && (plano.paradas || []).map((p) => ({ ...p, id: p.location_id, name: p.location_name })).find((x) => String(x.id) === id));
      if (!l) return null;
      const p = { location_id: l.id, location_name: l.name, city: l.city, address: l.address, entity_name: l.entity_name, latitude: l.latitude, longitude: l.longitude,
        lat: Number(l.latitude), lng: Number(l.longitude), score: 0, chamados: [], atrasados: 0 };
      porId.set(id, p);
      return p;
    };
    const semCoord = urg.locais.filter((l) => !(l.location_id && temCoord(l)));
    const locaisCoord = todos.filter(temCoord);
    // locais que já têm rota agendada (fora a que está sendo editada)
    const jaTemRota = {};
    (futuras.rotas || []).filter((r) => String(r.id) !== String(editarId || '') && r.status !== 'concluida')
      .forEach((r) => (r.paradas || []).forEach((p) => { const k = String(p.location_id); if (!jaTemRota[k] || r.data < jaTemRota[k]) jaTemRota[k] = r.data; }));

    let prefs = { n: 3, inicio: '' };
    try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('rotas_prefs') || '{}') }; } catch { /* padrão */ }
    const salvarPrefs = () => { try { localStorage.setItem('rotas_prefs', JSON.stringify(prefs)); } catch { /* ok */ } };
    let passo = 1;
    let escolhidos = []; // ids dos locais da rota
    let modoOrdem = 'curto'; // 'curto' (o sistema calcula) | 'manual' (a pessoa arrastou)
    let ordemManual = null; let fimId = '';
    let meuGps = null;
    const fora = new Set();
    let naOrcim = {};
    const diaPedido = qs.get('dia');
    const campos = {
      dia: plano ? plano.data : (/^\d{4}-\d{2}-\d{2}$/.test(diaPedido || '') && diaPedido >= h ? diaPedido : h),
      tec: plano ? String(plano.technician_id || '') : String(eu().id),
      nota: plano ? plano.nota || '' : '',
    };
    if (plano) {
      escolhidos = (plano.paradas || []).map((p) => String(p.location_id));
      escolhidos.forEach(pegar);
      modoOrdem = 'manual'; ordemManual = [...escolhidos];
      (plano.itens_fora || []).forEach((x) => fora.add(String(x)));
    } else escolhidos = candidatos().slice(0, Math.max(1, prefs.n));

    const pontoInicio = () => {
      if (prefs.inicio === 'gps') return meuGps;
      const l = todos.find((x) => String(x.id) === String(prefs.inicio));
      return l ? { lat: Number(l.latitude), lng: Number(l.longitude), location_name: l.name } : null;
    };
    const ordemAtual = () => {
      const ps = escolhidos.map(pegar).filter(Boolean);
      if (modoOrdem === 'manual' && ordemManual) {
        const fixos = ordemManual.filter((id) => escolhidos.includes(id)).map(pegar).filter(Boolean);
        return fixos.concat(ps.filter((p) => !ordemManual.includes(String(p.location_id))));
      }
      if (fimId && !escolhidos.includes(fimId)) fimId = '';
      return ps.length ? maisCurto(ps, pontoInicio(), fimId) : [];
    };

    const PASSOS = [[1, 'Locais'], [2, 'Ordem'], [3, 'Dia e técnico']];
    el.innerHTML = `<div class="ro-passos ro-nao-imprime">${PASSOS.map(([n, t]) => `<button type="button" class="ro-passo-bt" data-ir="${n}"><span class="ro-pn">${n}</span>${t}</button>`).join('<i class="bi bi-chevron-right"></i>')}
        ${plano ? `<a class="btn btn-sm btn-link ms-auto" href="#/rotas/${plano.id}">Voltar sem salvar</a>` : ''}</div>
      <div id="ro-tela"></div>`;
    const tela = el.querySelector('#ro-tela');
    const $ = (s) => tela.querySelector(s);
    const ir = (n) => {
      if (n > 1 && !escolhidos.length) { toast('Escolha pelo menos um local.', 'warning'); return; }
      passo = n; pintar(); window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    el.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => ir(Number(b.dataset.ir))));

    // ---- tela 1: quantos e quais locais ----
    function tela1() {
      const cand = candidatos();
      const extras = escolhidos.filter((id) => !cand.includes(id));
      const linha = (id, pos) => {
        const l = pegar(id); if (!l) return '';
        const marcado = escolhidos.includes(id);
        return `<label class="ro-cand ${marcado ? 'sel' : ''}">
          <input type="checkbox" class="form-check-input" data-loc="${id}" ${marcado ? 'checked' : ''}>
          <span class="ro-pos">${pos || ''}</span>
          <span class="ro-cand-tx"><b>${esc(l.location_name)}</b>
            <small>${l.chamados.length ? `${l.chamados.length} chamado(s)${l.atrasados ? ` · ${l.atrasados} atrasado(s)` : ''}` : 'sem chamado aberto'}${l.city ? ` · ${esc(l.city)}` : ''}${jaTemRota[id] ? ` · <span class="text-primary"><i class="bi bi-truck"></i> já tem rota ${nomeDia(jaTemRota[id])}</span>` : ''}</small></span>
          ${l.chamados.length ? scorePill(l.score, U.temParada(l.chamados)) : ''}
        </label>`;
      };
      tela.innerHTML = `<div class="card panel-card ro-tela">
        <div class="ro-q"><b>Quantos locais você quer atender?</b>
          <span class="ro-contador"><button type="button" class="btn btn-sm" data-menos aria-label="Um local a menos"><i class="bi bi-dash-lg"></i></button><b>${escolhidos.length}</b><button type="button" class="btn btn-sm" data-mais aria-label="Um local a mais"><i class="bi bi-plus-lg"></i></button></span>
          <small>Os mais urgentes já vêm marcados. Marque ou desmarque à vontade.</small></div>
        <h6 class="ro-lista-tit">Locais mais urgentes <small>${cand.length} com chamado aberto, do mais urgente para o menos</small></h6>
        <div class="ro-cands">${cand.length ? cand.map((id, i) => linha(id, `${i + 1}º`)).join('') : '<div class="dp-vazio">Nenhum local com chamado aberto e coordenadas. Inclua um local abaixo.</div>'}</div>
        ${extras.length ? `<h6 class="ro-lista-tit">Outros locais <small>sem chamado aberto</small></h6><div class="ro-cands">${extras.map((id) => linha(id, '')).join('')}</div>` : ''}
        <div class="ro-outro"><select class="form-select form-select-sm" id="ro-add">
          <option value="">+ Incluir outro local (sem chamado aberto)</option>
          ${locaisCoord.filter((l) => !escolhidos.includes(String(l.id)) && !cand.includes(String(l.id))).map((l) => `<option value="${l.id}">${esc(l.name)}${l.city ? ` (${esc(l.city)})` : ''}</option>`).join('')}</select></div>
        ${semCoord.length ? `<div class="ur-sem">Fora da rota por não ter coordenadas: ${semCoord.map((l) => esc(l.location_name)).join(' · ')}. Cadastre a latitude e a longitude em <a href="#/admin/locations">Localizações</a>.</div>` : ''}
        <div class="ro-nav"><span class="text-muted small">${escolhidos.length} local(is) escolhido(s)</span>
          <button type="button" class="btn btn-primary" data-ir2="2" ${escolhidos.length ? '' : 'disabled'}>Próximo: ordem <i class="bi bi-arrow-right"></i></button></div>
      </div>`;
      tela.querySelectorAll('[data-loc]').forEach((c) => c.addEventListener('change', () => {
        const id = c.dataset.loc;
        if (c.checked) { if (!escolhidos.includes(id)) escolhidos.push(id); } else escolhidos = escolhidos.filter((x) => x !== id);
        pintar();
      }));
      $('[data-mais]').addEventListener('click', () => {
        const prox = cand.find((id) => !escolhidos.includes(id));
        if (!prox) { toast('Todos os locais com chamado já estão marcados. Inclua outro local abaixo.', 'info'); return; }
        escolhidos.push(prox); prefs.n = escolhidos.length; salvarPrefs(); pintar();
      });
      $('[data-menos]').addEventListener('click', () => {
        if (!escolhidos.length) return;
        // tira o menos urgente dos marcados (os incluídos à mão saem por último)
        const marcados = cand.filter((id) => escolhidos.includes(id));
        const sai = marcados.length ? marcados[marcados.length - 1] : escolhidos[escolhidos.length - 1];
        escolhidos = escolhidos.filter((x) => x !== sai); prefs.n = escolhidos.length; salvarPrefs(); pintar();
      });
      $('#ro-add').addEventListener('change', (e) => { const id = e.target.value; if (id && pegar(id) && !escolhidos.includes(id)) escolhidos.push(id); pintar(); });
      $('[data-ir2]').addEventListener('click', () => ir(2));
    }

    // ---- tela 2: em que ordem ----
    function tela2() {
      const ordem = ordemAtual();
      const inicio = pontoInicio();
      const r = resumoKm(ordem, inicio);
      const url = mapsUrl(ordem, inicio);
      tela.innerHTML = `<div class="card panel-card ro-tela">
        <div class="ro-q"><b>Em que ordem?</b>
          <div class="seg" role="group" aria-label="Como ordenar"><button type="button" data-modo="curto"><i class="bi bi-magic"></i> Caminho mais curto</button><button type="button" data-modo="manual"><i class="bi bi-arrows-move"></i> Eu arrumo</button></div></div>
        ${resumoBloco(ordem, inicio, url)}
        <div class="ro-ordem-campos">
          <label>Saindo de<select class="form-select form-select-sm" id="ro-inicio">
            <option value="">— da primeira parada —</option>
            <option value="gps">📍 Minha localização agora</option>
            ${locaisCoord.map((l) => `<option value="${l.id}">${esc(l.name)}${l.city ? ` (${esc(l.city)})` : ''}</option>`).join('')}</select></label>
          ${modoOrdem === 'curto' ? `<label>Terminar em<select class="form-select form-select-sm" id="ro-fim">
            <option value="">— o sistema escolhe —</option>
            ${escolhidos.map((id) => pegar(id)).filter(Boolean).map((p) => `<option value="${p.location_id}" ${String(p.location_id) === fimId ? 'selected' : ''}>${esc(p.location_name)}</option>`).join('')}</select></label>`
    : '<span class="small text-muted align-self-end"><i class="bi bi-grip-vertical"></i> Arraste pela alça para mudar a ordem.</span>'}
        </div>
        <ol class="ro-ordem" id="ro-ordem">
          ${temPonto(inicio) ? `<li class="ro-inicio"><i class="bi bi-geo-fill"></i> Saída: ${esc(inicio.location_name || 'sua localização')}</li>` : ''}
          ${ordem.map((p, i) => `<li class="ro-parada" data-id="${p.location_id}">
            <div class="ro-parada-cab">
              <span class="ro-alca" data-alca title="Arraste para mudar a ordem"><i class="bi bi-grip-vertical"></i></span>
              <span class="ur-num">${i + 1}</span>
              <span class="ro-parada-tx"><b>${esc(p.location_name)}${modoOrdem === 'curto' && fimId && String(p.location_id) === fimId ? ' <i class="bi bi-flag-fill text-success" title="Destino final"></i>' : ''}</b>
                <small>${esc([p.address, p.city].filter(Boolean).join(' · '))}${r.trechos[i] ? ` · ~${U.n1(Math.round(r.trechos[i]))} km do anterior` : ''}</small></span>
              ${p.chamados.length ? scorePill(p.score, U.temParada(p.chamados)) : ''}
              <span class="ro-mover">
                <button type="button" class="btn btn-sm btn-light" data-sobe="${p.location_id}" title="Passar antes" ${i === 0 ? 'disabled' : ''}><i class="bi bi-arrow-up"></i></button>
                <button type="button" class="btn btn-sm btn-light" data-desce="${p.location_id}" title="Passar depois" ${i === ordem.length - 1 ? 'disabled' : ''}><i class="bi bi-arrow-down"></i></button>
                <button type="button" class="btn btn-sm btn-light" data-tira="${p.location_id}" title="Tirar da rota"><i class="bi bi-x-lg"></i></button></span>
            </div>
            ${chamadosHtml(p)}
          </li>`).join('')}
        </ol>
        <div class="ro-nav"><button type="button" class="btn btn-outline-secondary" data-ir2="1"><i class="bi bi-arrow-left"></i> Locais</button>
          <button type="button" class="btn btn-primary" data-ir2="3">Próximo: dia e técnico <i class="bi bi-arrow-right"></i></button></div>
      </div>`;
      tela.querySelectorAll('[data-modo]').forEach((b) => {
        b.classList.toggle('active', b.dataset.modo === modoOrdem);
        b.addEventListener('click', () => {
          if (b.dataset.modo === 'manual' && modoOrdem !== 'manual') ordemManual = ordemAtual().map((p) => String(p.location_id));
          modoOrdem = b.dataset.modo; pintar();
        });
      });
      $('#ro-inicio').value = prefs.inicio;
      $('#ro-inicio').addEventListener('change', (e) => {
        prefs.inicio = e.target.value; salvarPrefs();
        if (prefs.inicio === 'gps' && !meuGps) {
          if (!navigator.geolocation) { toast('Este navegador não informa a localização.', 'warning'); return; }
          navigator.geolocation.getCurrentPosition((pos) => { meuGps = { lat: pos.coords.latitude, lng: pos.coords.longitude, location_name: 'sua localização' }; pintar(); },
            () => toast('Não foi possível pegar a sua localização (permissão negada?).', 'warning'), { enableHighAccuracy: true, timeout: 10000 });
          return;
        }
        pintar();
      });
      $('#ro-fim')?.addEventListener('change', (e) => { fimId = e.target.value; pintar(); });
      const mover = (id, passoMov) => {
        const lista = ordemAtual().map((p) => String(p.location_id));
        const i = lista.indexOf(String(id)); const j = i + passoMov;
        if (i < 0 || j < 0 || j >= lista.length) return;
        [lista[i], lista[j]] = [lista[j], lista[i]];
        ordemManual = lista; modoOrdem = 'manual'; pintar();
      };
      tela.querySelectorAll('[data-sobe]').forEach((b) => b.addEventListener('click', () => mover(b.dataset.sobe, -1)));
      tela.querySelectorAll('[data-desce]').forEach((b) => b.addEventListener('click', () => mover(b.dataset.desce, 1)));
      tela.querySelectorAll('[data-tira]').forEach((b) => b.addEventListener('click', () => { escolhidos = escolhidos.filter((x) => x !== String(b.dataset.tira)); pintar(); }));
      arrastavel($('#ro-ordem'), (ids) => { ordemManual = ids; modoOrdem = 'manual'; pintar(); });
      tela.querySelectorAll('[data-ir2]').forEach((b) => b.addEventListener('click', () => ir(Number(b.dataset.ir2))));
    }

    // ---- tela 3: dia, técnico e o que levar ----
    async function tela3() {
      const ordem = ordemAtual();
      const itens = ordem.flatMap(itensDaParada).filter((m) => m.status !== 'entregue');
      const faltaOrcim = itens.filter((m) => !(m.id in naOrcim));
      if (faltaOrcim.length) Object.assign(naOrcim, await procurarOrcim(faltaOrcim));
      if (passo !== 3) return;
      const url = mapsUrl(ordem, pontoInicio());
      const op = { modo: 'planejar', fora, naOrcim, podeMexer: true };
      const blocos = ordem.map((p, i) => {
        const lista = itensDaParada(p).filter((m) => m.status !== 'entregue');
        return lista.length ? `<div class="ro-lv-parada"><div class="ro-lv-cab"><span class="ur-num">${i + 1}</span><b>${esc(p.location_name)}</b></div>${lista.map((m) => itemLevar(m, op)).join('')}</div>` : '';
      }).join('');
      tela.innerHTML = `<div class="card panel-card ro-tela">
        <div class="ro-q"><b>Quando e quem?</b></div>
        <div class="ro-trajeto ro-trajeto-resumo">${ordem.map((p) => `<span>${esc(p.location_name)}</span>`).join('<i class="bi bi-arrow-right"></i>')}</div>
        ${resumoBloco(ordem, pontoInicio(), url)}
        <div class="ro-campos">
          <label>Dia<input type="date" class="form-control form-control-sm" id="ro-dia" min="${plano && plano.data < h ? plano.data : h}" value="${campos.dia}"></label>
          <label>Técnico<select class="form-select form-select-sm" id="ro-tec"><option value="">— a definir —</option>
            ${tecnicos.map((t) => `<option value="${t.id}" ${String(t.id) === campos.tec ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
          <label class="ro-nota">Observação<input class="form-control form-control-sm" id="ro-nota" maxlength="500" placeholder="Saída 8h da base, levar toner" value="${esc(campos.nota)}"></label>
        </div>
        <div class="ro-levar-box">
          <div class="ro-levar-cab">${U.caixaPixel(30)}<span><b>O que levar</b><small id="ro-lv-conta"></small></span>
            ${itens.length ? '<button type="button" class="btn btn-sm btn-link ms-auto" id="ro-lv-todos"></button>' : ''}</div>
          ${blocos || '<div class="ro-sem-ch">Nenhum material pedido nos chamados dessas paradas.</div>'}
        </div>
        <div class="ro-nav"><button type="button" class="btn btn-outline-secondary" data-ir2="2"><i class="bi bi-arrow-left"></i> Ordem</button>
          <span class="d-flex gap-2 flex-wrap ms-auto">
            <button type="button" class="btn btn-outline-secondary" id="ro-imprimir"><i class="bi bi-printer"></i> Imprimir</button>
            <button type="button" class="btn btn-primary" id="ro-salvar"><i class="bi bi-calendar-check"></i> ${plano ? 'Salvar alterações' : 'Agendar rota'}</button></span></div>
        <div class="small text-muted text-end">Quem é desses locais recebe um aviso com o dia da visita.</div>
      </div>`;
      const conta = () => {
        const c = contarLevar(itens, fora);
        const txt = $('#ro-lv-conta'); if (txt) txt.textContent = c.total ? `${c.marcados} de ${c.total} item(ns) marcados para levar · desmarque o que não vai` : '';
        const bt = $('#ro-lv-todos'); if (bt) bt.textContent = c.marcados === c.total ? 'Desmarcar todos' : 'Marcar todos';
      };
      ligarCaixas(tela, fora, conta);
      $('#ro-lv-todos')?.addEventListener('click', () => {
        const todosMarcados = contarLevar(itens, fora).marcados === itens.length;
        itens.forEach((m) => { if (todosMarcados) fora.add(String(m.id)); else fora.delete(String(m.id)); });
        tela.querySelectorAll('[data-levar]').forEach((c) => { c.checked = !todosMarcados; const l = c.closest('.ro-lv-item'); l.classList.toggle('marcado', !todosMarcados); l.classList.toggle('fora', todosMarcados); });
        conta();
      });
      conta();
      $('#ro-dia').addEventListener('change', (e) => { campos.dia = e.target.value; });
      $('#ro-tec').addEventListener('change', (e) => { campos.tec = e.target.value; });
      $('#ro-nota').addEventListener('input', (e) => { campos.nota = e.target.value; });
      $('[data-ir2]').addEventListener('click', () => ir(2));
      $('#ro-imprimir').addEventListener('click', () => imprimir(tela));
      $('#ro-salvar').addEventListener('click', async () => {
        if (!campos.dia) { toast('Escolha o dia da rota.', 'warning'); return; }
        // só guarda os desmarcados que ainda estão nas paradas desta rota
        const ids = new Set(itens.map((m) => String(m.id)));
        const corpo = { data: campos.dia, technician_id: campos.tec || null, nota: campos.nota.trim(), locais: ordem.map((p) => p.location_id), itens_fora: [...fora].filter((x) => ids.has(x)) };
        const btn = $('#ro-salvar'); btn.disabled = true;
        try {
          let id = plano ? plano.id : null;
          if (plano) await API.request('PUT', `/rotas/${plano.id}`, corpo);
          else id = (await API.post('/rotas', corpo)).id;
          toast(plano ? 'Rota atualizada.' : 'Rota agendada. Os locais foram avisados.', 'success');
          if (window.recarregarRotasHoje) window.recarregarRotasHoje();
          location.hash = `#/rotas/${id}`;
        } catch (e) { btn.disabled = false; showError(e); }
      });
    }

    function pintar() {
      el.querySelectorAll('[data-ir]').forEach((b) => {
        const n = Number(b.dataset.ir);
        b.classList.toggle('atual', n === passo); b.classList.toggle('feito', n < passo);
      });
      if (passo === 1) tela1(); else if (passo === 2) tela2(); else tela3();
    }
    pintar();
  }

  // ---------------- Página da rota ----------------
  async function pagina(id, el) {
    el.innerHTML = spinner();
    let r; let urg;
    try { [r, urg] = await Promise.all([API.get(`/rotas/${id}`), API.get('/dashboard/urgencia')]); } catch (e) { el.innerHTML = emptyState('Não foi possível abrir a rota', e.message, 'bi-exclamation-triangle'); return; }
    if (window.migalhaDetalhe) window.migalhaDetalhe(`Rota de ${nomeDia(r.data)}`);
    const porLoc = new Map(urg.locais.filter((l) => l.location_id).map((l) => [String(l.location_id), l]));
    const ordem = (r.paradas || []).map((p) => {
      const l = porLoc.get(String(p.location_id));
      return { ...p, lat: p.latitude == null ? NaN : Number(p.latitude), lng: p.longitude == null ? NaN : Number(p.longitude),
        score: l ? l.score : 0, chamados: l ? l.chamados : [], atrasados: l ? l.atrasados : 0 };
    });
    const fora = new Set((r.itens_fora || []).map(String));
    const sit = situacao(r);
    const modo = r.status === 'agendada' ? 'planejar' : r.status === 'em_andamento' ? 'entregar' : 'ver';
    const todosItens = ordem.flatMap(itensDaParada);
    const naOrcim = modo === 'ver' ? {} : await procurarOrcim(todosItens);
    const res = resumoKm(ordem, null);
    const url = mapsUrl(ordem, null);
    const h = r.hoje || hojeIso();
    const podeComecar = r.pode_agendar && r.status === 'agendada' && r.data <= h;
    const podeConcluir = r.pode_agendar && r.status !== 'concluida' && r.data <= h && (r.status === 'em_andamento' || sit === 'nao_concluida');
    const op = { modo, fora, naOrcim, podeMexer: podeEntregar() && r.pode_agendar && r.status !== 'concluida' };
    const quem = [r.started_at ? `começou ${fmt.dateTime(r.started_at)}${r.started_by_name ? ` (${esc(r.started_by_name)})` : ''}` : '',
      r.concluded_at ? `concluída ${fmt.dateTime(r.concluded_at)}${r.concluded_by_name ? ` (${esc(r.concluded_by_name)})` : ''}` : ''].filter(Boolean).join(' · ');
    // o que levar de cada parada: antes de começar, a caixinha diz o que vai; depois, só os marcados (com "Entregue")
    const levarDaParada = (p) => {
      let itens = itensDaParada(p);
      if (modo === 'planejar') itens = itens.filter((m) => m.status !== 'entregue');
      const deixados = modo === 'planejar' ? [] : itens.filter((m) => m.status !== 'entregue' && fora.has(String(m.id)));
      if (modo !== 'planejar') itens = itens.filter((m) => m.status === 'entregue' || !fora.has(String(m.id)));
      if (!itens.length && !deixados.length) return '';
      return `<div class="ro-levar-parada"><div class="ro-levar-parada-tit"><i class="bi bi-box-seam"></i> Levar para cá</div>
        ${itens.map((m) => itemLevar(m, op)).join('')}
        ${deixados.length ? `<div class="ro-sem-ch">${deixados.length} item(ns) ficaram para outra rota.</div>` : ''}</div>`;
    };
    el.innerHTML = `
      <div class="card panel-card mb-3 ro-cab ro-cab-${sit}">
        <div class="ro-cab-tx">
          <h5>Rota de ${nomeDia(r.data)} ${tagSit(r)}</h5>
          <div class="ro-cab-info"><span><i class="bi bi-person-badge"></i> ${esc(r.technician_name || 'técnico a definir')}</span>
            <span id="ro-lv-resumo"></span>
            ${r.nota ? `<span><i class="bi bi-chat-left-text"></i> ${esc(r.nota)}</span>` : ''}</div>
          ${resumoBloco(ordem, null, url)}
          ${quem ? `<small class="text-muted">${quem}</small>` : ''}
          ${r.status === 'agendada' && r.data > h ? `<small class="text-muted">Você começa a rota no dia (${dataCurta(r.data)}). Até lá, marque ou desmarque o que vai levar em cada parada.</small>` : ''}
        </div>
        <div class="ro-cab-botoes ro-nao-imprime">
          ${podeComecar ? '<button type="button" class="btn btn-primary" id="ro-comecar"><i class="bi bi-play-fill"></i> Começar rota</button>' : ''}
          ${podeConcluir ? '<button type="button" class="btn btn-success" id="ro-concluir"><i class="bi bi-check2-circle"></i> Concluir rota</button>' : ''}
          <button type="button" class="btn btn-outline-secondary" id="ro-imprimir"><i class="bi bi-printer"></i> Imprimir</button>
          ${r.pode_editar && r.status !== 'concluida' ? `<a class="btn btn-outline-secondary" href="#/rotas/nova?editar=${r.id}"><i class="bi bi-pencil"></i> Editar</a>` : ''}
          ${r.pode_editar && r.status !== 'concluida' ? '<button type="button" class="btn btn-link text-danger" id="ro-cancelar">Cancelar rota</button>' : ''}
          ${r.pode_agendar && r.status === 'concluida' ? '<button type="button" class="btn btn-link" id="ro-reabrir">Reabrir</button>' : ''}
        </div>
      </div>
      <ol class="ro-paradas ro-paradas-pag">${ordem.map((p, i) => `<li class="card panel-card ro-parada">
          <div class="ro-parada-cab"><span class="ur-num">${i + 1}</span>
            <span class="ro-parada-tx"><b>${esc(p.location_name)}</b><small>${esc([p.address, p.city].filter(Boolean).join(' · '))}${res.trechos[i] ? ` · ~${U.n1(Math.round(res.trechos[i]))} km do anterior` : ''}</small></span>
            ${p.chamados.length ? scorePill(p.score, U.temParada(p.chamados)) : ''}</div>
          ${chamadosHtml(p)}
          ${levarDaParada(p)}
        </li>`).join('')}</ol>`;
    const recarregar = () => pagina(id, el);
    const abertos = todosItens.filter((m) => m.status !== 'entregue');
    const resumoLevar = () => {
      const c = contarLevar(todosItens, fora);
      const s = el.querySelector('#ro-lv-resumo');
      if (s) s.innerHTML = c.total ? `<i class="bi bi-box-seam"></i> levar ${c.marcados} de ${c.total} item(ns) de pedido` : '';
    };
    resumoLevar();
    // marcar/desmarcar antes de começar: salva sozinho
    let espera = null;
    ligarCaixas(el, fora, () => {
      resumoLevar();
      clearTimeout(espera);
      espera = setTimeout(async () => {
        try { await API.request('PUT', `/rotas/${r.id}/itens`, { itens_fora: [...fora] }); } catch (e) { showError(e); }
      }, 400);
    });
    // entregue no local (rota em andamento)
    el.querySelectorAll('[data-entregue]').forEach((b) => b.addEventListener('click', async () => {
      const lin = b.closest('.ro-lv-item');
      const m = abertos.find((x) => String(x.id) === lin.dataset.m);
      b.disabled = true;
      try {
        await API.post(`/tickets/${lin.dataset.t}/materials/${lin.dataset.m}/confirmar`, { destino: lin.querySelector('[data-dest]').value, orcim: !!(m && m.origem_orcim) });
        toast('Entrega confirmada e registrada no inventário.', 'success'); recarregar();
      } catch (e) { b.disabled = false; showError(e); }
    }));
    el.querySelector('#ro-imprimir').addEventListener('click', () => imprimir(el));
    el.querySelector('#ro-comecar')?.addEventListener('click', async () => {
      // os itens marcados (que ainda não saíram) ficam "a caminho do local" e quem pediu é avisado
      const sair = podeEntregar() ? abertos.filter((m) => m.status !== 'rota' && !fora.has(String(m.id))) : [];
      if (!await confirmDialog({ title: 'Começar rota', body: `${sair.length ? `${sair.length} item(ns) marcados ficam a caminho do local e quem pediu é avisado. ` : ''}A rota fica em andamento até você concluir no fim do dia.`, confirmText: 'Começar rota' })) return;
      let falhou = 0;
      for (const m of sair) {
        try { await API.post(`/tickets/${m.ticket_id}/materials/${m.id}/rota`, { destino: m.destino || 'inventario', orcim: usaOrcim(m, naOrcim) }); } catch (e) { falhou += 1; showError(e); }
      }
      try {
        await API.post(`/rotas/${r.id}/comecar`);
        if (window.recarregarRotasHoje) window.recarregarRotasHoje();
        toast(`Rota começada${sair.length - falhou ? `: ${sair.length - falhou} item(ns) a caminho do local` : ''}.`, 'success'); recarregar();
      } catch (e) { showError(e); }
    });
    el.querySelector('#ro-concluir')?.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Concluir rota', body: 'A rota fica concluída na agenda. Itens que ainda estão a caminho do local continuam esperando a confirmação da entrega.', confirmText: 'Concluir rota' })) return;
      try { await API.post(`/rotas/${r.id}/concluir`); if (window.recarregarRotasHoje) window.recarregarRotasHoje(); toast('Rota concluída.', 'success'); recarregar(); } catch (e) { showError(e); }
    });
    el.querySelector('#ro-reabrir')?.addEventListener('click', async () => {
      try { await API.post(`/rotas/${r.id}/reabrir`); if (window.recarregarRotasHoje) window.recarregarRotasHoje(); toast('Rota reaberta.', 'info'); recarregar(); } catch (e) { showError(e); }
    });
    el.querySelector('#ro-cancelar')?.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Cancelar rota', body: 'A rota sai da agenda e quem é dos locais recebe um aviso de que a visita foi cancelada.', confirmText: 'Cancelar rota', danger: true })) return;
      try { await API.del(`/rotas/${r.id}`); if (window.recarregarRotasHoje) window.recarregarRotasHoje(); toast('Rota cancelada.', 'warning'); location.hash = '#/rotas'; } catch (e) { showError(e); }
    });
  }

  return { agenda, montar, pagina };
})();

Views.rotas = (el) => Rotas.agenda(el);
Views.rotaNova = (el) => Rotas.montar(el);
Views.rota = (id, el) => Rotas.pagina(id, el);
Views.visitas = (el) => Rotas.agenda(el, { modoPosto: true });
