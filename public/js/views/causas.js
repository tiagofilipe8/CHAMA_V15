// ---------------------------------------------------------------
// Views.causas — Causas e notas
//   - Por que abrem / por que fecham: cada card tem 3 visões
//       Total (por causa) · Por posto (quem tem mais chamados) · Por razão (escolhe a causa e ranqueia os postos)
//   - Custo de material por posto: compras, retiradas do estoque e estragado/perdido (só quem vê preços)
//   - Score dos locais: média das estrelas (0 a 5) que o técnico dá ao encerrar,
//     por localidade dentro de cada empresa, com a nota individual de cada usuário
// ---------------------------------------------------------------

Views.causas = async function causas(el) {
  const user = API.user || {};
  if (!Roles.can(user, 'ticket.rating') || !Roles.canSeeDashboard(user)) {
    location.hash = '#/dashboard';
    toast('Seu perfil não vê as causas e as notas dos chamados.', 'warning');
    return;
  }
  let prefs = { dias: 90, entity: '', posto: '', mes: '', ano: '' };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('causas_prefs') || '{}') }; } catch { /* padrão */ }
  const salvar = () => { try { localStorage.setItem('causas_prefs', JSON.stringify(prefs)); } catch { /* sem armazenamento */ } };
  // visão de cada card (total / por posto / por razão), a causa escolhida e o tipo
  const visao = {
    ab: { modo: 'total', razao: '', tipo: '' },
    fe: { modo: 'total', razao: '' },
    mat: { modo: 'perdas' },
    ...(() => { try { return JSON.parse(localStorage.getItem('causas_visao') || '{}'); } catch { return {}; } })(),
  };
  const salvarVisao = () => { try { localStorage.setItem('causas_visao', JSON.stringify(visao)); } catch { /* sem armazenamento */ } };
  const PERIODOS = [[30, '30 dias'], [90, '90 dias'], [365, '12 meses'], [0, 'Tudo']];
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const fmtNota = (n) => (n === null || n === undefined ? '—' : Number(n).toFixed(1).replace('.', ','));
  const tomNota = (n) => (n === null || n === undefined ? 'sem' : n < 2.5 ? 'baixo' : n < 3.5 ? 'medio' : 'bom');
  const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  el.innerHTML = `
    <div class="card panel-card cz-filtro-card mb-3">
      <div class="cz-fgrupo">
        <span class="cz-flabel"><i class="bi bi-calendar3"></i> Período</span>
        <div class="seg" role="group" aria-label="Período">${PERIODOS.map(([v, r]) => `<button type="button" data-dias="${v}">${r}</button>`).join('')}</div>
        <span class="cz-ou">ou</span>
        <select class="form-select form-select-sm cz-sel" id="cz-ano" title="Ano"></select>
        <select class="form-select form-select-sm cz-sel" id="cz-mes" title="Mês"></select>
      </div>
      <div class="cz-fgrupo" id="cz-ent-grupo" style="display:none">
        <span class="cz-flabel"><i class="bi bi-building"></i> Empresa</span>
        <select class="form-select form-select-sm cz-sel" id="cz-ent"></select>
      </div>
      <div class="cz-fgrupo">
        <span class="cz-flabel"><i class="bi bi-geo-alt"></i> Posto</span>
        <select class="form-select form-select-sm cz-sel" id="cz-posto"><option value="">Todos os postos</option></select>
      </div>
      <button type="button" class="btn btn-sm btn-link cz-limpar" id="cz-limpar"><i class="bi bi-x-circle"></i> Limpar filtros</button>
      <div class="cz-resumo" id="cz-info"></div>
    </div>
    <div id="cz-corpo">${spinner()}</div>`;

  // empresas (só aparece o filtro se houver mais de uma)
  API.get('/entities').then((ents) => {
    const ativas = ents.filter((e) => e.active);
    if (ativas.length < 2) return;
    const sel = el.querySelector('#cz-ent');
    sel.innerHTML = '<option value="">Todas as empresas</option>' + ativas.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    sel.value = prefs.entity;
    el.querySelector('#cz-ent-grupo').style.display = '';
    sel.addEventListener('change', async () => { prefs.entity = sel.value; await carregarPostos(); salvar(); carregar(); });
  }).catch(() => {});
  // período: botões (últimos dias) OU mês/ano escolhidos (um anula o outro)
  const anoAtual = new Date().getFullYear();
  const selAno = el.querySelector('#cz-ano'); const selMes = el.querySelector('#cz-mes');
  selAno.innerHTML = '<option value="">Ano</option>' + [0, 1, 2, 3].map((k) => `<option value="${anoAtual - k}">${anoAtual - k}</option>`).join('');
  selMes.innerHTML = '<option value="">Mês (o ano todo)</option>' + MESES.map((m, i) => `<option value="${String(i + 1).padStart(2, '0')}">${m}</option>`).join('');
  selAno.value = prefs.ano; selMes.value = prefs.mes; selMes.disabled = !prefs.ano;
  const porData = () => { prefs.ano = selAno.value; prefs.mes = prefs.ano ? selMes.value : ''; selMes.disabled = !prefs.ano; if (!prefs.ano) selMes.value = ''; salvar(); carregar(); };
  selAno.addEventListener('change', porData);
  selMes.addEventListener('change', porData);
  el.querySelectorAll('[data-dias]').forEach((b) => b.addEventListener('click', () => {
    prefs.dias = Number(b.dataset.dias); prefs.ano = ''; prefs.mes = ''; selAno.value = ''; selMes.value = ''; selMes.disabled = true; salvar(); carregar();
  }));
  // postos (da empresa escolhida, se houver)
  const selPosto = el.querySelector('#cz-posto');
  let nomesPostos = [];
  const carregarPostos = async () => {
    let locs = [];
    try { locs = await API.get(`/locations${prefs.entity ? `?entity_id=${encodeURIComponent(prefs.entity)}` : ''}`); } catch { /* sem lista */ }
    nomesPostos = locs;
    selPosto.innerHTML = '<option value="">Todos os postos</option>' + locs.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
    if (!locs.some((l) => String(l.id) === String(prefs.posto))) prefs.posto = '';
    selPosto.value = prefs.posto;
  };
  selPosto.addEventListener('change', () => { prefs.posto = selPosto.value; salvar(); carregar(); });
  el.querySelector('#cz-limpar').addEventListener('click', async () => {
    prefs = { dias: 90, entity: '', posto: '', mes: '', ano: '' };
    selAno.value = ''; selMes.value = ''; selMes.disabled = true;
    const se = el.querySelector('#cz-ent'); if (se) se.value = '';
    await carregarPostos(); salvar(); carregar();
  });
  await carregarPostos();

  const barras = (lista, total, extra) => lista.map((r) => {
    const pct = total ? Math.round((r.total / total) * 100) : 0;
    return `<div class="cz-barra">
      <span class="cz-barra-nome" title="${esc(r.nome)}">${r.icon ? `${esc(r.icon)} ` : ''}${esc(r.nome)}</span>
      <i style="--w:${pct}%"></i>
      <b>${r.total}</b><small>${pct}%</small>${extra ? extra(r) : ''}
    </div>`;
  }).join('');

  // soma linhas da matriz (causa × posto) por uma chave
  const agrupar = (linhas, chave) => {
    const m = new Map();
    linhas.forEach((x) => {
      const k = chave(x);
      const g = m.get(k) || { ...x, total: 0, abertos: 0, causas: new Map() };
      g.total += x.total; g.abertos += x.abertos || 0;
      g.causas.set(x.causa, (g.causas.get(x.causa) || 0) + x.total);
      m.set(k, g);
    });
    return [...m.values()].sort((a, b) => b.total - a.total || String(a.posto).localeCompare(String(b.posto)));
  };

  // ---------- card de análise: Total / Por posto / Por razão ----------
  function cardAnalise(id, cfg, linhasTodas) {
    const v = visao[id];
    const linhas = cfg.tipos && v.tipo ? linhasTodas.filter((x) => x.tipo === v.tipo) : linhasTodas;
    const total = linhas.reduce((s, x) => s + x.total, 0);
    const causas = agrupar(linhas, (x) => x.causa).map((g) => ({ nome: g.causa, icon: g.icon, total: g.total, abertos: g.abertos, tipo: g.tipo }));
    if (v.modo === 'razao' && (!v.razao || !causas.some((c) => c.nome === v.razao))) v.razao = causas[0] ? causas[0].nome : '';
    const seg = `<div class="seg seg-sm cz-modos" role="group">
      ${[['total', 'Total', 'bi-bar-chart'], ['posto', 'Por posto', 'bi-geo-alt'], ['razao', 'Por razão', 'bi-funnel']].map(([k, r, ic]) => `<button type="button" data-card="${id}" data-modo="${k}" class="${v.modo === k ? 'active' : ''}"><i class="bi ${ic}"></i> ${r}</button>`).join('')}
    </div>`;
    const tipos = cfg.tipos ? [...new Set(linhasTodas.map((x) => x.tipo))].sort() : [];
    const selTipo = tipos.length > 1 ? `<select class="form-select form-select-sm cz-mini" data-card="${id}" data-campo="tipo"><option value="">Todos os tipos</option>${tipos.map((t) => `<option ${t === v.tipo ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : '';
    let corpo;
    if (!total) corpo = `<div class="dp-vazio">${cfg.vazio}</div>`;
    else if (v.modo === 'total') {
      corpo = `<div class="cz-lista cz-${cfg.cor}">${barras(causas, total, (r) => `${r.abertos ? `<span class="tg tg-blue" title="Ainda em aberto">${r.abertos} aberto(s)</span>` : '<span></span>'}<button type="button" class="cz-ir" data-card="${id}" data-razao="${esc(r.nome)}" title="Ver os postos com mais chamados desta causa"><i class="bi bi-arrow-right-circle"></i></button>`)}</div>`;
    } else if (v.modo === 'posto') {
      const postos = agrupar(linhas, (x) => `${x.location_id || ''}`);
      const max = postos[0] ? postos[0].total : 0;
      corpo = `<div class="cz-rank">${postos.map((p, i) => {
        const top = [...p.causas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        return `<div class="cz-rank-item">
          <span class="cz-pos ${i < 3 ? `p${i + 1}` : ''}">${i + 1}º</span>
          <div class="cz-rank-tx"><div class="cz-rank-cab"><b>${esc(p.posto)}</b><small class="text-muted multi-empresa">${esc(p.empresa || '')}</small>
            <span class="cz-rank-n">${p.total}</span></div>
            <span class="cz-rank-barra cz-${cfg.cor}"><i style="--w:${max ? Math.round((p.total / max) * 100) : 0}%"></i></span>
            <div class="cz-chips">${top.map(([c, n]) => `<button type="button" class="cz-chip" data-card="${id}" data-razao="${esc(c)}" title="Ranquear os postos por esta causa">${esc(c)} <b>${n}</b></button>`).join('')}</div></div>
        </div>`;
      }).join('')}</div>`;
    } else {
      const daCausa = linhas.filter((x) => x.causa === v.razao);
      const totPorPosto = new Map(agrupar(linhas, (x) => `${x.location_id || ''}`).map((p) => [`${p.location_id || ''}`, p.total]));
      const postos = agrupar(daCausa, (x) => `${x.location_id || ''}`);
      const max = postos[0] ? postos[0].total : 0;
      const totCausa = postos.reduce((s, p) => s + p.total, 0);
      const grupos = cfg.tipos ? [...new Set(causas.map((c) => c.tipo))].sort() : [null];
      corpo = `<div class="cz-razao-sel">
          <label class="small text-muted">Causa</label>
          <select class="form-select form-select-sm" data-card="${id}" data-campo="razao">${grupos.map((g) => {
            const ops = causas.filter((c) => !g || c.tipo === g).map((c) => `<option value="${esc(c.nome)}" ${c.nome === v.razao ? 'selected' : ''}>${esc(c.nome)} (${c.total})</option>`).join('');
            return g ? `<optgroup label="${esc(g)}">${ops}</optgroup>` : ops;
          }).join('')}</select>
          <small class="text-muted">${totCausa} chamado(s) · ${postos.length} posto(s)</small>
        </div>
        <div class="cz-rank">${postos.map((p, i) => {
          const doPosto = totPorPosto.get(`${p.location_id || ''}`) || p.total;
          return `<div class="cz-rank-item">
            <span class="cz-pos ${i < 3 ? `p${i + 1}` : ''}">${i + 1}º</span>
            <div class="cz-rank-tx"><div class="cz-rank-cab"><b>${esc(p.posto)}</b><small class="text-muted multi-empresa">${esc(p.empresa || '')}</small>
              <span class="cz-rank-n">${p.total}</span></div>
              <span class="cz-rank-barra cz-${cfg.cor}"><i style="--w:${max ? Math.round((p.total / max) * 100) : 0}%"></i></span>
              <small class="text-muted">${Math.round((p.total / totCausa) * 100)}% desta causa · ${Math.round((p.total / doPosto) * 100)}% dos chamados do posto${p.abertos ? ` · <span class="text-primary">${p.abertos} em aberto</span>` : ''}</small></div>
          </div>`;
        }).join('')}</div>`;
    }
    return `<div class="card panel-card cz-card">
      <div class="cz-card-cab">
        <div class="cz-card-tit"><span class="cz-card-ico ${cfg.cor}"><i class="bi ${cfg.icone}"></i></span><div><b>${cfg.titulo}</b><small>${cfg.sub}</small></div></div>
        <div class="cz-card-ctl">${selTipo}${seg}</div>
      </div>
      <div class="cz-card-corpo">${corpo}</div>
    </div>`;
  }

  // ---------- card de custo de material por posto ----------
  const MAT_MODOS = [
    ['perdas', 'Estragado / perdido', 'bi-heartbreak', 'Valor dos equipamentos que estragaram ou sumiram no período (preço cadastrado × quantidade).'],
    ['retiradas', 'Retiradas do estoque', 'bi-box-arrow-up', 'Custo dos itens que o posto pegou do Estoque de T.I. no período.'],
    ['compras', 'Compras', 'bi-cart-check', 'Pedidos de material comprados para o posto no período (preço × quantidade).'],
    ['total', 'Tudo', 'bi-sigma', 'Compras + retiradas do estoque + estragado/perdido.'],
  ];
  function cardMateriais(lista) {
    const v = visao.mat;
    const modo = MAT_MODOS.find((m) => m[0] === v.modo) || MAT_MODOS[0];
    const val = (x) => (modo[0] === 'total' ? x.compras + x.retiradas + x.perdas : x[modo[0]]);
    const qtd = (x) => (modo[0] === 'total' ? x.compras_n + x.retiradas_n + x.perdas_n : x[`${modo[0]}_n`]);
    const postos = lista.filter((x) => val(x) > 0).sort((a, b) => val(b) - val(a));
    const max = postos[0] ? val(postos[0]) : 0;
    const soma = postos.reduce((s, x) => s + val(x), 0);
    return `<div class="card panel-card cz-card">
      <div class="cz-card-cab">
        <div class="cz-card-tit"><span class="cz-card-ico vermelho"><i class="bi bi-cash-stack"></i></span><div><b>Custo de material por posto</b><small>${esc(modo[3])}</small></div></div>
        <div class="cz-card-ctl"><select class="form-select form-select-sm cz-mini" data-card="mat" data-campo="modo">${MAT_MODOS.map((m) => `<option value="${m[0]}" ${m[0] === modo[0] ? 'selected' : ''}>${m[1]}</option>`).join('')}</select></div>
      </div>
      <div class="cz-card-corpo">${postos.length ? `<div class="cz-mat-soma"><i class="bi ${modo[2]}"></i> ${esc(modo[1])}: <b>${moeda(soma)}</b> em ${postos.length} posto(s)</div>
        <div class="cz-rank">${postos.map((p, i) => `<div class="cz-rank-item">
          <span class="cz-pos ${i < 3 ? `p${i + 1}` : ''}">${i + 1}º</span>
          <div class="cz-rank-tx"><div class="cz-rank-cab"><b>${esc(p.posto)}</b><small class="text-muted multi-empresa">${esc(p.empresa || '')}</small>
            <span class="cz-rank-n">${moeda(val(p))}</span></div>
            <span class="cz-rank-barra cz-mat"><i style="--w:${max ? Math.round((val(p) / max) * 100) : 0}%"></i></span>
            <small class="text-muted">${qtd(p)} item(ns)${modo[0] === 'total' ? ` · compras ${moeda(p.compras)} · estoque ${moeda(p.retiradas)} · perdas ${moeda(p.perdas)}` : ''}</small></div>
        </div>`).join('')}</div>` : '<div class="dp-vazio">Nenhum custo de material no período.</div>'}</div>
    </div>`;
  }

  let dados = null;
  function desenhar() {
    const d = dados;
    const corpo = el.querySelector('#cz-corpo');
    // usuários por local (para abrir dentro de cada local)
    const usuariosDe = (l) => d.usuarios.filter((u) => String(u.entity_id) === String(l.entity_id) && String(u.location_id ?? '') === String(l.location_id ?? ''));
    const blocosEmpresa = d.empresas.map((emp) => {
      const locs = d.locais.filter((l) => String(l.entity_id) === String(emp.entity_id));
      return `
        <div class="cz-emp">
          <div class="cz-emp-cab">
            <span class="cz-emp-nome"><i class="bi bi-building"></i> ${esc(emp.entity_name)}</span>
            <span class="cz-nota ${tomNota(emp.media)}" title="Score geral da empresa">${emp.media === null ? 'sem notas' : `${starsHtml(emp.media)} <b>${fmtNota(emp.media)}</b>`}</span>
            <small class="text-muted">${emp.avaliados} nota(s) em ${emp.chamados} chamado(s) resolvido(s)</small>
          </div>
          ${locs.map((l) => {
            const us = usuariosDe(l);
            return `
            <details class="cz-loc ${tomNota(l.media)}">
              <summary>
                <span class="cz-loc-nome"><i class="bi bi-geo-alt-fill"></i> ${esc(l.location_name)}</span>
                <span class="cz-nota ${tomNota(l.media)}">${l.media === null ? '<span class="text-muted small">sem nota</span>' : `${starsHtml(l.media)} <b>${fmtNota(l.media)}</b>`}</span>
                <span class="cz-loc-n">${l.avaliados}/${l.chamados} com nota</span>
                <span class="cz-loc-causa" title="Causa de fechamento que mais aparece neste local">${l.causa_principal ? `<i class="bi bi-wrench-adjustable"></i>${esc(l.causa_principal)}` : ''}</span>
                ${l.media !== null && l.media < 2.5 ? '<span class="tg tg-red">treinamento</span>' : l.media !== null && l.media < 3.5 ? '<span class="tg tg-amber">atenção</span>' : ''}
              </summary>
              <div class="cz-users">${us.length ? us.map((u) => `
                <div class="cz-user"><i class="bi bi-person"></i><span>${esc(u.name)}</span>
                  <span class="cz-nota ${tomNota(u.media)}">${starsHtml(u.media)} <b>${fmtNota(u.media)}</b></span>
                  <small class="text-muted">${u.avaliados} nota(s)</small></div>`).join('')
              : '<div class="text-muted small">Nenhum usuário com nota neste local.</div>'}</div>
            </details>`;
          }).join('')}
        </div>`;
    }).join('');

    // checklist da nota: em que cada local mais falha (% de "não" em cada item)
    const comCk = d.locais.filter((l) => l.com_checklist > 0);
    const pct = (n, tot) => (tot ? Math.round((n / tot) * 100) : 0);
    const celula = (n, tot) => { const p = pct(n, tot); return `<td class="text-center"><span class="cz-falha ${p >= 50 ? 'alta' : p >= 25 ? 'media' : 'baixa'}" title="${n} de ${tot} chamado(s) sem este item">${p}%</span></td>`; };
    const tabelaCk = comCk.length ? `
      <div class="table-responsive"><table class="table table-sm align-middle mb-0 cz-ck">
        <thead><tr><th>Local</th><th class="text-center">Notas</th>${Object.values(CHECKLIST_NOTA).map((v) => `<th class="text-center">${esc(v)}</th>`).join('')}</tr></thead>
        <tbody>${comCk.map((l) => `<tr><td>${esc(l.location_name)}<small class="text-muted multi-empresa"> · ${esc(l.entity_name)}</small></td><td class="text-center">${l.com_checklist}</td>
          ${Object.keys(CHECKLIST_NOTA).map((k) => celula(l[`nao_${k}`], l.com_checklist)).join('')}</tr>`).join('')}</tbody>
      </table></div>` : '<div class="dp-vazio">Ainda não há chamados avaliados com o checklist.</div>';
    const totUsu = (d.pelo_usuario || []).reduce((s, r) => s + r.total, 0);

    corpo.innerHTML = `
      <div class="cz-grade">
        ${cardAnalise('ab', { titulo: 'Por que abrem chamados', sub: 'categoria escolhida ao abrir', icone: 'bi-box-arrow-in-right', cor: 'azul', tipos: true, vazio: 'Nenhum chamado aberto no período.' }, d.mat_abertura || [])}
        ${cardAnalise('fe', { titulo: 'Por que fecharam', sub: 'causa informada pelo técnico ao resolver', icone: 'bi-box-arrow-right', cor: 'violeta', vazio: 'Nenhum chamado resolvido no período.' }, (d.mat_fechamento || []).map((x) => ({ ...x, abertos: 0 })))}
        ${d.materiais ? cardMateriais(d.materiais) : ''}
        <div class="card panel-card cz-card">
          <div class="cz-card-cab"><div class="cz-card-tit"><span class="cz-card-ico verde"><i class="bi bi-person-check"></i></span><div><b>Encerrados por quem abriu</b><small>resolvi sozinho, aberto por engano...</small></div></div></div>
          <div class="cz-card-corpo"><div class="cz-lista">${totUsu ? barras((d.pelo_usuario || []).map((r) => ({ ...r, nome: LABELS.encerraUsuario[r.motivo] || r.motivo })), totUsu) : '<div class="dp-vazio">Nenhum no período.</div>'}</div></div>
        </div>
      </div>
      <div class="card panel-card mt-3">
        <div class="dp-bloco-cab"><span><i class="bi bi-star-half"></i> Score dos locais com a TI</span>
          <small class="text-muted">média das estrelas (0 a 5) que o técnico dá ao encerrar · clique no local para ver cada usuário</small></div>
        <p class="cz-aviso"><i class="bi bi-mortarboard"></i> Locais com score menor podem ter necessidade de treinamento.</p>
        ${blocosEmpresa || '<div class="dp-vazio">Nenhum chamado resolvido no período.</div>'}
      </div>
      <div class="card panel-card mt-3">
        <div class="dp-bloco-cab"><span><i class="bi bi-list-check"></i> Onde cada local mais falha</span>
          <small class="text-muted">% dos chamados em que o item do checklist da nota ficou sem marcar · vermelho = foco do treinamento</small></div>
        ${tabelaCk}
      </div>`;
  }

  // troca de visão dentro dos cards (sem recarregar do servidor)
  el.querySelector('#cz-corpo').addEventListener('click', (e) => {
    const b = e.target.closest('[data-card]');
    if (!b || b.tagName === 'SELECT') return;
    const v = visao[b.dataset.card];
    if (b.dataset.modo) v.modo = b.dataset.modo;
    if (b.dataset.razao !== undefined) { v.modo = 'razao'; v.razao = b.dataset.razao; }
    salvarVisao(); desenhar();
  });
  el.querySelector('#cz-corpo').addEventListener('change', (e) => {
    const s = e.target.closest('select[data-card]');
    if (!s) return;
    visao[s.dataset.card][s.dataset.campo] = s.value;
    salvarVisao(); desenhar();
  });

  async function carregar() {
    el.querySelectorAll('[data-dias]').forEach((b) => b.classList.toggle('active', !prefs.ano && Number(b.dataset.dias) === prefs.dias));
    el.querySelector('#cz-limpar').style.visibility = (prefs.ano || prefs.posto || prefs.entity || prefs.dias !== 90) ? 'visible' : 'hidden';
    const corpo = el.querySelector('#cz-corpo');
    try {
      const periodo = prefs.ano ? (prefs.mes ? `&mes=${prefs.ano}-${prefs.mes}` : `&ano=${prefs.ano}`) : '';
      dados = await API.get(`/dashboard/causas?dias=${prefs.dias}${periodo}${prefs.entity ? `&entity_id=${encodeURIComponent(prefs.entity)}` : ''}${prefs.posto ? `&location_id=${encodeURIComponent(prefs.posto)}` : ''}`);
    } catch (e) { corpo.innerHTML = emptyState('Não foi possível carregar', e.message, 'bi-exclamation-triangle'); return; }
    const d = dados;
    const totAb = d.abertura.reduce((s, r) => s + r.total, 0);
    const totFe = d.fechamento.reduce((s, r) => s + r.total, 0);
    const avaliados = d.locais.reduce((s, r) => s + r.avaliados, 0);
    const posto = prefs.posto ? (nomesPostos.find((l) => String(l.id) === String(prefs.posto)) || {}).name : '';
    const quando = prefs.ano ? `${prefs.mes ? `${MESES[Number(prefs.mes) - 1]} de ` : ''}${prefs.ano}` : prefs.dias ? `últimos ${prefs.dias === 365 ? '12 meses' : `${prefs.dias} dias`}` : 'desde o início';
    el.querySelector('#cz-info').innerHTML = `
      <span class="cz-pill"><i class="bi bi-calendar-check"></i> ${esc(quando)}</span>
      ${posto ? `<span class="cz-pill"><i class="bi bi-geo-alt-fill"></i> ${esc(posto)}</span>` : ''}
      <span class="cz-pill azul"><b>${totAb}</b> aberto(s)</span>
      <span class="cz-pill violeta"><b>${totFe}</b> resolvido(s)</span>
      <span class="cz-pill ambar"><b>${avaliados}</b> com nota</span>`;
    desenhar();
  }
  carregar();
};
