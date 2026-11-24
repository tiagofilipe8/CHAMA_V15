// ---------------------------------------------------------------
// Views.causas — Causas e notas
//   - Por que abrem chamados: categorias (causa de abertura)
//   - Por que fecham: causa que o técnico escolhe ao resolver (feedback do técnico)
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
  let prefs = { dias: 90, entity: '' };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('causas_prefs') || '{}') }; } catch { /* padrão */ }
  const salvar = () => { try { localStorage.setItem('causas_prefs', JSON.stringify(prefs)); } catch { /* sem armazenamento */ } };
  const PERIODOS = [[30, '30 dias'], [90, '90 dias'], [365, '12 meses'], [0, 'Tudo']];
  const fmtNota = (n) => (n === null || n === undefined ? '—' : Number(n).toFixed(1).replace('.', ','));
  const tomNota = (n) => (n === null || n === undefined ? 'sem' : n < 2.5 ? 'baixo' : n < 3.5 ? 'medio' : 'bom');

  el.innerHTML = `
    <div class="cz-filtros">
      <div class="seg" role="group" aria-label="Período">${PERIODOS.map(([v, r]) => `<button type="button" data-dias="${v}">${r}</button>`).join('')}</div>
      <select class="form-select form-select-sm cz-ent" id="cz-ent" style="display:none"></select>
      <span class="small text-muted ms-auto" id="cz-info"></span>
    </div>
    <div id="cz-corpo">${spinner()}</div>`;

  // empresas (só aparece o filtro se houver mais de uma)
  API.get('/entities').then((ents) => {
    const ativas = ents.filter((e) => e.active);
    if (ativas.length < 2) return;
    const sel = el.querySelector('#cz-ent');
    sel.innerHTML = '<option value="">Todas as empresas</option>' + ativas.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    sel.value = prefs.entity;
    sel.style.display = '';
    sel.addEventListener('change', () => { prefs.entity = sel.value; salvar(); carregar(); });
  }).catch(() => {});
  el.querySelectorAll('[data-dias]').forEach((b) => b.addEventListener('click', () => { prefs.dias = Number(b.dataset.dias); salvar(); carregar(); }));

  const barras = (lista, total, extra) => lista.map((r) => {
    const pct = total ? Math.round((r.total / total) * 100) : 0;
    return `<div class="cz-barra">
      <span class="cz-barra-nome" title="${esc(r.nome)}">${r.icon ? `${esc(r.icon)} ` : ''}${esc(r.nome)}</span>
      <i style="--w:${pct}%"></i>
      <b>${r.total}</b><small>${pct}%</small>${extra ? extra(r) : ''}
    </div>`;
  }).join('');

  async function carregar() {
    el.querySelectorAll('[data-dias]').forEach((b) => b.classList.toggle('active', Number(b.dataset.dias) === prefs.dias));
    const corpo = el.querySelector('#cz-corpo');
    let d;
    try {
      d = await API.get(`/dashboard/causas?dias=${prefs.dias}${prefs.entity ? `&entity_id=${encodeURIComponent(prefs.entity)}` : ''}`);
    } catch (e) { corpo.innerHTML = emptyState('Não foi possível carregar', e.message, 'bi-exclamation-triangle'); return; }
    const totAb = d.abertura.reduce((s, r) => s + r.total, 0);
    const totFe = d.fechamento.reduce((s, r) => s + r.total, 0);
    const avaliados = d.locais.reduce((s, r) => s + r.avaliados, 0);
    el.querySelector('#cz-info').textContent = `${totAb} aberto(s) · ${totFe} resolvido(s) · ${avaliados} com nota${prefs.dias ? ` · últimos ${prefs.dias} dias` : ''}`;

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
        <div class="card panel-card">
          <div class="dp-bloco-cab"><span><i class="bi bi-box-arrow-in-right"></i> Por que abrem chamados</span><small class="text-muted">categoria escolhida ao abrir</small></div>
          <div class="cz-lista">${totAb ? barras(d.abertura, totAb, (r) => (r.abertos ? `<span class="tg tg-blue" title="Ainda em aberto">${r.abertos} aberto(s)</span>` : '')) : '<div class="text-muted small">Nenhum chamado aberto no período.</div>'}</div>
        </div>
        <div class="card panel-card">
          <div class="dp-bloco-cab"><span><i class="bi bi-box-arrow-right"></i> Por que fecharam</span><small class="text-muted">causa informada pelo técnico ao resolver</small></div>
          <div class="cz-lista cz-fech">${totFe ? barras(d.fechamento, totFe) : '<div class="text-muted small">Nenhum chamado resolvido no período.</div>'}</div>
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
      </div>
      <div class="card panel-card mt-3">
        <div class="dp-bloco-cab"><span><i class="bi bi-person-check"></i> Encerrados por quem abriu</span><small class="text-muted">resolvi sozinho, aberto por engano...</small></div>
        <div class="cz-lista">${totUsu ? barras((d.pelo_usuario || []).map((r) => ({ ...r, nome: LABELS.encerraUsuario[r.motivo] || r.motivo })), totUsu) : '<div class="text-muted small">Nenhum no período.</div>'}</div>
      </div>`;
  }
  carregar();
};
