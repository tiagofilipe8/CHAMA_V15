// ---------------------------------------------------------------
// Rotas da TI
//   #/rotas              agenda: hoje, não concluídas, próximos dias (e o mês num calendário que começa na segunda)
//   #/rotas/nova         montar rota em 3 passos na mesma tela (?dia=AAAA-MM-DD já escolhe o dia; ?editar=ID edita)
//   #/rotas/ID           página da rota: paradas com os chamados, o que levar, começar e concluir
//   #/visitas            o calendário para os postos (só as rotas que passam nos locais deles)
//   Peças em comum (score, chamados, ordem de visita, "O que levar") vêm do Urgencia (urgencia.js).
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

  // situação mostrada: agendada / em andamento / concluída / não concluída (o dia passou sem concluir)
  const SIT = {
    agendada: ['Agendada', 'tg-blue', 'bi-calendar-check'],
    em_andamento: ['Em andamento', 'tg-amber', 'bi-truck'],
    concluida: ['Concluída', 'tg-green', 'bi-check2-circle'],
    nao_concluida: ['Não concluída', 'tg-gray', 'bi-exclamation-circle'],
  };
  const situacao = (r) => (r.status === 'concluida' ? 'concluida' : r.data < hojeIso() ? 'nao_concluida' : r.status);
  const tagSit = (r) => { const [t, c, i] = SIT[situacao(r)]; return `<span class="tg ${c}"><i class="bi ${i}"></i> ${t}</span>`; };

  // distância e tempo (linha reta × fator de estrada, a uma velocidade média) e o link do Google Maps
  const resumoKm = (ordem, inicio) => {
    let total = 0; let antes = inicio;
    const trechos = ordem.map((p) => {
      const ok = antes && Number.isFinite(antes.lat) && Number.isFinite(p.lat);
      const d = ok ? U.km(antes, p) * U.FATOR_ESTRADA : 0;
      total += d; if (Number.isFinite(p.lat)) antes = p;
      return d;
    });
    const horas = total / U.VELOCIDADE;
    return { trechos, km: Math.round(total), tempo: horas < 1 ? `${Math.round(horas * 60)} min` : `${U.n1(Math.round(horas * 10) / 10)} h` };
  };
  const mapsUrl = (ordem, inicio) => {
    const pts = ordem.filter((p) => Number.isFinite(p.lat));
    if (!pts.length) return null;
    const pt = (p) => `${p.lat},${p.lng}`;
    const destino = pts[pts.length - 1]; const meio = pts.slice(0, -1);
    return `https://www.google.com/maps/dir/?api=1${inicio ? `&origin=${encodeURIComponent(pt(inicio))}` : ''}&destination=${encodeURIComponent(pt(destino))}${meio.length ? `&waypoints=${encodeURIComponent(meio.map(pt).join('|'))}` : ''}&travelmode=driving`;
  };
  // itens de pedido que ainda não chegaram, nos chamados das paradas
  const pendentesDe = (ordem) => ordem.flatMap((p) => (p.chamados || []).flatMap((c) => (c.materiais || []).filter((m) => !['entregue', 'cancelado'].includes(m.status))));
  const cartaoLevar = (ordem) => {
    const pend = pendentesDe(ordem);
    const total = new Map();
    pend.forEach((m) => { const k = `${m.name}|${m.unit || ''}`; total.set(k, { ...m, quantity: (total.get(k)?.quantity || 0) + Number(m.quantity || 0) }); });
    return `<div class="ro-levar ${pend.length ? '' : 'vazio'}">
      <div class="ro-levar-cab">${U.caixaPixel(30)}<span><b>O que levar</b><small>${pend.length ? `${pend.length} item(ns) de pedido de material` : 'Nenhum material pedido nessas paradas'}</small></span></div>
      ${total.size ? `<div class="ro-levar-chips">${[...total.values()].map((x) => `<span class="tg tg-teal">${x.quantity} ${esc(x.unit || 'un')} · ${esc(x.name)}</span>`).join('')}</div>
      <button type="button" class="btn btn-sm btn-outline-primary w-100" data-levar><i class="bi bi-list-check"></i> Separar itens</button>` : ''}
    </div>`;
  };
  // uma parada (no passo 2 e na página da rota): chamados fechados, abrem com um clique
  const paradaHtml = (p, i, km, mover = '') => {
    const chs = p.chamados || [];
    const parada = U.temParada(chs);
    return `<li class="ro-parada">
      <div class="ro-parada-cab"><span class="ur-num">${i + 1}</span>
        <span class="ro-parada-tx"><b>${esc(p.location_name)}</b><small>${esc([p.address, p.city].filter(Boolean).join(' · '))}${km ? ` · ~${U.n1(Math.round(km))} km do anterior` : ''}</small></span>
        ${chs.length ? `<span class="ur-loc-score">${U.numScore(p.score, U.ALVO_LOCAL, '', 1, parada)}</span>` : ''}
        ${mover}
      </div>
      ${chs.length ? `<details class="ro-chs"><summary><i class="bi bi-chevron-right ur-seta"></i> ${chs.length} chamado(s) aberto(s)${parada ? ' · <b class="text-danger">operação parada</b>' : ''}${p.atrasados ? ` · ${p.atrasados} atrasado(s)` : ''}</summary>
        <div class="ur-chs">${chs.map((c) => U.linhaChamado(c, { semConta: true })).join('')}</div></details>`
    : '<div class="ro-sem-ch">Nenhum chamado aberto neste local (visita sem chamado).</div>'}
    </li>`;
  };
  // imprimir: abre os chamados de todas as paradas e volta depois
  const imprimir = (raiz) => {
    const fechados = [...raiz.querySelectorAll('details.ro-chs:not([open])')];
    fechados.forEach((d) => { d.open = true; });
    document.body.classList.add('imprimindo-rota');
    window.print();
    setTimeout(() => { document.body.classList.remove('imprimindo-rota'); fechados.forEach((d) => { d.open = false; }); }, 500);
  };

  // ---------------- Agenda ----------------
  function cartao(r, { modoPosto = false, meuLocal = '' } = {}) {
    const paradas = r.paradas || [];
    const passa = meuLocal && paradas.some((p) => String(p.location_id) === meuLocal);
    const d = new Date(`${r.data}T12:00:00`);
    const tag = modoPosto ? 'div' : 'a';
    const info = [`<i class="bi bi-person-badge"></i> ${esc(r.technician_name || 'técnico a definir')}`,
      r.n_chamados != null ? `${r.n_chamados} chamado(s) aberto(s)` : '', r.n_itens ? `${r.n_itens} item(ns) para levar` : '', r.nota ? esc(r.nota) : ''].filter(Boolean);
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

  // ---------------- Montar rota (3 passos na mesma tela) ----------------
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
    // locais: os que têm chamado aberto (com score) e, se precisar, qualquer local com coordenadas
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
    // locais que já têm rota agendada (fora a que está sendo editada)
    const jaTemRota = {};
    (futuras.rotas || []).filter((r) => String(r.id) !== String(editarId || '') && r.status !== 'concluida')
      .forEach((r) => (r.paradas || []).forEach((p) => { const k = String(p.location_id); if (!jaTemRota[k] || r.data < jaTemRota[k]) jaTemRota[k] = r.data; }));

    let prefs = { n: 3, inicio: '' };
    try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('rotas_prefs') || '{}') }; } catch { /* padrão */ }
    const salvarPrefs = () => { try { localStorage.setItem('rotas_prefs', JSON.stringify(prefs)); } catch { /* ok */ } };
    let escolhidos = []; // ids, na ordem em que foram marcados
    let ordemManual = null; // ids na ordem que a pessoa arrumou (null = ordem automática pela distância)
    if (plano) {
      escolhidos = (plano.paradas || []).map((p) => String(p.location_id));
      escolhidos.forEach(pegar);
      ordemManual = [...escolhidos];
    } else escolhidos = candidatos().slice(0, prefs.n);
    let meuGps = null;
    const diaPedido = qs.get('dia');
    const dia = plano ? plano.data : (/^\d{4}-\d{2}-\d{2}$/.test(diaPedido || '') && diaPedido >= h ? diaPedido : h);
    const locaisCoord = todos.filter(temCoord);

    el.innerHTML = `
      <div class="ro-montar">
        <section class="card panel-card ro-passo ro-nao-imprime">
          <div class="ro-passo-cab"><span class="ro-pn">1</span><span><b>Escolher os locais</b><small>marque onde a rota vai passar</small></span></div>
          <div class="ro-atalhos"><span>Os mais urgentes:</span>
            <div class="seg" role="group" aria-label="Quantos locais">${[2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}">${n}</button>`).join('')}</div>
            <button type="button" class="btn btn-sm btn-link" id="ro-limpar">Desmarcar todos</button></div>
          <div id="ro-cands" class="ro-cands"></div>
          <div class="ro-outro"><select class="form-select form-select-sm" id="ro-add">
            <option value="">+ Incluir outro local (sem chamado aberto)</option>
            ${locaisCoord.map((l) => `<option value="${l.id}">${esc(l.name)}${l.city ? ` (${esc(l.city)})` : ''}</option>`).join('')}</select></div>
          ${semCoord.length ? `<div class="ur-sem">Fora da rota por não ter coordenadas: ${semCoord.map((l) => esc(l.location_name)).join(' · ')}. Cadastre a latitude e a longitude em <a href="#/admin/locations">Localizações</a>.</div>` : ''}
        </section>
        <section class="card panel-card ro-passo">
          <div class="ro-passo-cab"><span class="ro-pn">2</span><span><b>Conferir a rota</b><small id="ro-resumo"></small></span></div>
          <div class="ro-saida ro-nao-imprime"><label>Saindo de
            <select class="form-select form-select-sm" id="ro-inicio">
              <option value="">— do local mais urgente —</option>
              <option value="gps">📍 Minha localização agora</option>
              ${locaisCoord.map((l) => `<option value="${l.id}">${esc(l.name)}${l.city ? ` (${esc(l.city)})` : ''}</option>`).join('')}
            </select></label>
            <button type="button" class="btn btn-sm btn-link d-none" id="ro-auto"><i class="bi bi-magic"></i> Voltar à ordem automática</button></div>
          <div id="ro-levar" class="ro-nao-imprime"></div>
          <ol class="ro-paradas" id="ro-paradas"></ol>
        </section>
      </div>
      <section class="card panel-card ro-passo ro-final ro-nao-imprime">
        <div class="ro-passo-cab"><span class="ro-pn">3</span><span><b>${plano ? 'Salvar as mudanças' : 'Agendar'}</b><small>quem é desses locais recebe um aviso com o dia da visita</small></span></div>
        <div class="ro-final-linha">
          <label>Dia<input type="date" class="form-control form-control-sm" id="ro-dia" min="${plano && plano.data < h ? plano.data : h}" value="${dia}"></label>
          <label>Técnico<select class="form-select form-select-sm" id="ro-tec"><option value="">— a definir —</option>
            ${tecnicos.map((t) => `<option value="${t.id}" ${String(t.id) === String(plano ? plano.technician_id || '' : eu().id) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
          <label class="ro-nota">Observação<input class="form-control form-control-sm" id="ro-nota" maxlength="500" placeholder="Saída 8h da base, levar toner" value="${esc(plano?.nota || '')}"></label>
        </div>
        <div class="ro-final-botoes">
          <button type="button" class="btn btn-primary" id="ro-salvar"><i class="bi bi-calendar-check"></i> ${plano ? 'Salvar alterações' : 'Agendar rota'}</button>
          <a class="btn btn-outline-primary" id="ro-maps" target="_blank" rel="noopener noreferrer"><i class="bi bi-map"></i> Google Maps</a>
          <button type="button" class="btn btn-outline-secondary" id="ro-imprimir"><i class="bi bi-printer"></i> Imprimir</button>
          ${plano ? `<a class="btn btn-link" href="#/rotas/${plano.id}">Voltar sem salvar</a>` : ''}
        </div>
      </section>`;
    const $ = (s) => el.querySelector(s);
    $('#ro-inicio').value = prefs.inicio;
    const pontoInicio = () => {
      if (prefs.inicio === 'gps') return meuGps;
      const l = todos.find((x) => String(x.id) === String(prefs.inicio));
      return l ? { lat: Number(l.latitude), lng: Number(l.longitude), location_name: l.name } : null;
    };
    const ordemAtual = () => {
      const ps = escolhidos.map(pegar).filter(Boolean);
      if (ordemManual) {
        const fixos = ordemManual.filter((id) => escolhidos.includes(id)).map(pegar).filter(Boolean);
        return fixos.concat(ps.filter((p) => !ordemManual.includes(String(p.location_id))));
      }
      return ps.length ? U.ordenar(ps, pontoInicio()) : [];
    };

    function pintarCands() {
      const ids = [...new Set([...candidatos(), ...escolhidos])];
      el.querySelectorAll('[data-n]').forEach((b) => {
        const top = candidatos().slice(0, Number(b.dataset.n));
        b.classList.toggle('active', !ordemManual && top.length === escolhidos.length && top.every((id) => escolhidos.includes(id)));
      });
      $('#ro-cands').innerHTML = ids.length ? ids.map((id, i) => {
        const l = pegar(id);
        if (!l) return '';
        const marcado = escolhidos.includes(id);
        const rotaJa = jaTemRota[id];
        return `<label class="ur-cand ${marcado ? 'sel' : ''}">
          <input type="checkbox" data-loc="${id}" ${marcado ? 'checked' : ''}>
          <span class="ur-pos">${l.chamados.length ? `${i + 1}º` : '<i class="bi bi-plus-circle"></i>'}</span>
          <span class="ur-loc-tx"><b>${esc(l.location_name)}</b><small>${l.chamados.length ? `${l.chamados.length} chamado(s)${l.atrasados ? ` · ${l.atrasados} atrasado(s)` : ''}` : 'sem chamado aberto'}${l.city ? ` · ${esc(l.city)}` : ''}</small>
            ${rotaJa ? `<span class="tg tg-blue ro-ja" title="Esse local já está numa rota agendada"><i class="bi bi-truck"></i> já tem rota ${nomeDia(rotaJa)}</span>` : ''}</span>
          ${l.chamados.length ? `<span class="ur-loc-score">${U.numScore(l.score, U.ALVO_LOCAL, '', 1.05, U.temParada(l.chamados))}</span>` : ''}
        </label>`;
      }).join('') : '<div class="dp-vazio">Nenhum local com chamado aberto e coordenadas. Inclua um local abaixo.</div>';
      el.querySelectorAll('#ro-cands [data-loc]').forEach((c) => c.addEventListener('change', () => {
        const id = c.dataset.loc;
        if (c.checked) { if (!escolhidos.includes(id)) escolhidos.push(id); } else escolhidos = escolhidos.filter((x) => x !== id);
        pintar();
      }));
    }

    function pintarRota() {
      const ordem = ordemAtual();
      const inicio = pontoInicio();
      const r = resumoKm(ordem, inicio);
      $('#ro-resumo').textContent = ordem.length ? `${ordem.length} parada(s) · ~${U.n1(r.km)} km · ~${r.tempo} de estrada` : 'marque ao menos um local no passo 1';
      $('#ro-auto').classList.toggle('d-none', !ordemManual);
      const url = mapsUrl(ordem, inicio);
      const maps = $('#ro-maps');
      if (url) { maps.href = url; maps.classList.remove('disabled'); } else { maps.removeAttribute('href'); maps.classList.add('disabled'); }
      $('#ro-paradas').innerHTML = ordem.length ? `${inicio ? `<li class="ro-inicio"><i class="bi bi-geo-fill"></i> Saída: ${esc(inicio.location_name || 'sua localização')}</li>` : ''}
        ${ordem.map((p, i) => paradaHtml(p, i, r.trechos[i], `<span class="ro-mover ro-nao-imprime">
          <button type="button" class="btn btn-sm btn-light" data-sobe="${p.location_id}" title="Passar antes" ${i === 0 ? 'disabled' : ''}><i class="bi bi-arrow-up"></i></button>
          <button type="button" class="btn btn-sm btn-light" data-desce="${p.location_id}" title="Passar depois" ${i === ordem.length - 1 ? 'disabled' : ''}><i class="bi bi-arrow-down"></i></button>
          <button type="button" class="btn btn-sm btn-light" data-tira="${p.location_id}" title="Tirar da rota"><i class="bi bi-x-lg"></i></button></span>`)).join('')}`
        : '<li class="dp-vazio">Marque ao menos um local no passo 1.</li>';
      const mover = (id, passo) => {
        const lista = ordemAtual().map((p) => String(p.location_id));
        const i = lista.indexOf(String(id)); const j = i + passo;
        if (i < 0 || j < 0 || j >= lista.length) return;
        [lista[i], lista[j]] = [lista[j], lista[i]];
        ordemManual = lista; pintar();
      };
      el.querySelectorAll('[data-sobe]').forEach((b) => b.addEventListener('click', () => mover(b.dataset.sobe, -1)));
      el.querySelectorAll('[data-desce]').forEach((b) => b.addEventListener('click', () => mover(b.dataset.desce, 1)));
      el.querySelectorAll('[data-tira]').forEach((b) => b.addEventListener('click', () => { escolhidos = escolhidos.filter((x) => x !== String(b.dataset.tira)); pintar(); }));
      $('#ro-levar').innerHTML = ordem.length ? cartaoLevar(ordem) : '';
      $('#ro-levar [data-levar]')?.addEventListener('click', () => U.abrirLevar(ordem, async () => {
        try { urg = await API.get('/dashboard/urgencia'); montarMapa(); escolhidos.forEach(pegar); pintar(); } catch { /* fica como estava */ }
      }));
    }
    const pintar = () => { pintarCands(); pintarRota(); };

    el.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => {
      prefs.n = Number(b.dataset.n); salvarPrefs();
      escolhidos = candidatos().slice(0, prefs.n); ordemManual = null; pintar();
    }));
    $('#ro-limpar').addEventListener('click', () => { escolhidos = []; ordemManual = null; pintar(); });
    $('#ro-add').addEventListener('change', (e) => {
      const id = e.target.value; e.target.value = '';
      if (!id) return;
      if (!pegar(id)) return;
      if (!escolhidos.includes(id)) escolhidos.push(id);
      pintar();
    });
    $('#ro-auto').addEventListener('click', () => { ordemManual = null; pintar(); });
    $('#ro-inicio').addEventListener('change', (e) => {
      prefs.inicio = e.target.value; salvarPrefs();
      if (prefs.inicio === 'gps' && !meuGps) {
        if (!navigator.geolocation) { toast('Este navegador não informa a localização.', 'warning'); return; }
        navigator.geolocation.getCurrentPosition((pos) => {
          meuGps = { lat: pos.coords.latitude, lng: pos.coords.longitude, location_name: 'sua localização' };
          pintar();
        }, () => toast('Não foi possível pegar a sua localização (permissão negada?).', 'warning'), { enableHighAccuracy: true, timeout: 10000 });
        return;
      }
      pintar();
    });
    $('#ro-imprimir').addEventListener('click', () => imprimir(el));
    $('#ro-salvar').addEventListener('click', async () => {
      const ordem = ordemAtual();
      if (!ordem.length) { toast('Marque ao menos um local no passo 1.', 'warning'); return; }
      const corpo = { data: $('#ro-dia').value, technician_id: $('#ro-tec').value || null, nota: $('#ro-nota').value.trim(), locais: ordem.map((p) => p.location_id) };
      if (!corpo.data) { toast('Escolha o dia da rota.', 'warning'); return; }
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
    const res = resumoKm(ordem, null);
    const url = mapsUrl(ordem, null);
    const sit = situacao(r);
    const h = r.hoje || hojeIso();
    const podeComecar = r.pode_agendar && r.status === 'agendada' && r.data <= h;
    const podeConcluir = r.pode_agendar && r.status !== 'concluida' && r.data <= h && (r.status === 'em_andamento' || sit === 'nao_concluida');
    const quem = [r.started_at ? `começou ${fmt.dateTime(r.started_at)}${r.started_by_name ? ` (${esc(r.started_by_name)})` : ''}` : '',
      r.concluded_at ? `concluída ${fmt.dateTime(r.concluded_at)}${r.concluded_by_name ? ` (${esc(r.concluded_by_name)})` : ''}` : ''].filter(Boolean).join(' · ');
    el.innerHTML = `
      <div class="card panel-card mb-3 ro-cab ro-cab-${sit}">
        <div class="ro-cab-tx">
          <h5>Rota de ${nomeDia(r.data)} ${tagSit(r)}</h5>
          <div class="ro-cab-info"><span><i class="bi bi-person-badge"></i> ${esc(r.technician_name || 'técnico a definir')}</span>
            <span><i class="bi bi-signpost-split"></i> ${ordem.length} parada(s) · ~${U.n1(res.km)} km · ~${res.tempo} de estrada</span>
            ${r.nota ? `<span><i class="bi bi-chat-left-text"></i> ${esc(r.nota)}</span>` : ''}</div>
          ${quem ? `<small class="text-muted">${quem}</small>` : ''}
          ${r.status === 'agendada' && r.data > h ? `<small class="text-muted">Você começa a rota no dia (${dataCurta(r.data)}).</small>` : ''}
        </div>
        <div class="ro-cab-botoes ro-nao-imprime">
          ${podeComecar ? '<button type="button" class="btn btn-primary" id="ro-comecar"><i class="bi bi-play-fill"></i> Começar rota</button>' : ''}
          ${podeConcluir ? '<button type="button" class="btn btn-success" id="ro-concluir"><i class="bi bi-check2-circle"></i> Concluir rota</button>' : ''}
          ${url ? `<a class="btn btn-outline-primary" href="${url}" target="_blank" rel="noopener noreferrer"><i class="bi bi-map"></i> Google Maps</a>` : ''}
          <button type="button" class="btn btn-outline-secondary" id="ro-imprimir"><i class="bi bi-printer"></i> Imprimir</button>
          ${r.pode_editar && r.status !== 'concluida' ? `<a class="btn btn-outline-secondary" href="#/rotas/nova?editar=${r.id}"><i class="bi bi-pencil"></i> Editar</a>` : ''}
          ${r.pode_editar && r.status !== 'concluida' ? '<button type="button" class="btn btn-link text-danger" id="ro-cancelar">Cancelar rota</button>' : ''}
          ${r.pode_agendar && r.status === 'concluida' ? '<button type="button" class="btn btn-link" id="ro-reabrir">Reabrir</button>' : ''}
        </div>
      </div>
      <div class="ro-pagina">
        <div class="card panel-card"><div class="dp-bloco-cab"><span><i class="bi bi-list-ol"></i> Paradas</span><small class="text-muted">clique para ver os chamados</small></div>
          <ol class="ro-paradas">${ordem.map((p, i) => paradaHtml(p, i, res.trechos[i])).join('')}</ol></div>
        <div class="ro-lado ro-nao-imprime">${cartaoLevar(ordem)}</div>
      </div>`;
    const recarregar = () => pagina(id, el);
    el.querySelector('#ro-imprimir').addEventListener('click', () => imprimir(el));
    el.querySelector('[data-levar]')?.addEventListener('click', () => U.abrirLevar(ordem, recarregar));
    el.querySelector('#ro-comecar')?.addEventListener('click', async () => {
      const comecar = async () => { await API.post(`/rotas/${r.id}/comecar`); if (window.recarregarRotasHoje) window.recarregarRotasHoje(); };
      const podeEntregar = Roles.can(eu(), 'inventory.manage') || Roles.isMaster(eu());
      // tem material para levar: abre o "O que levar" para marcar o que sai junto
      if (pendentesDe(ordem).length && podeEntregar) { U.abrirLevar(ordem, recarregar, { comecar }); return; }
      if (!await confirmDialog({ title: 'Começar rota', body: 'A rota fica "em andamento" até você concluir no fim do dia.', confirmText: 'Começar rota' })) return;
      try { await comecar(); toast('Rota começada.', 'success'); recarregar(); } catch (e) { showError(e); }
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
