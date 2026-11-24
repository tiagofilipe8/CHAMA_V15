// ---------------------------------------------------------------
// TicketModals — janelas de "Atribuir técnico" e "Resolver chamado"
// Usadas na tela do chamado e no quadro (ao arrastar um cartão),
// sem precisar abrir o chamado.
//   TicketModals.assign(t, { onDone, onCancel })
//   TicketModals.resolve(t, { onDone, onCancel })
// ---------------------------------------------------------------
const TicketModals = (() => {
  // Cria o modal, mostra e remove do DOM ao fechar
  function open(html, wire, { onDone, onCancel } = {}) {
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    const node = wrap.firstChild;
    document.body.appendChild(node);
    const modal = new bootstrap.Modal(node);
    let done = false;
    const finish = (result) => { done = true; modal.hide(); if (onDone) onDone(result); };
    node.addEventListener('hidden.bs.modal', () => {
      node.remove();
      if (!done && onCancel) onCancel();
    });
    wire(node, finish);
    modal.show();
    return node;
  }

  // ---------------- Atribuir tecnico ----------------
  // Atribuir técnico: cada pessoa (Técnicos e Administrador Mestre) aparece com a carga dela —
  // chamados em aberto por urgência e o que está atendendo agora — para escolher quem pega.
  function assign(t, opts = {}) {
    const eu = API.user || {};
    const html = `<div class="modal fade" tabindex="-1">
      <div class="modal-dialog"><div class="modal-content">
        <div class="modal-header"><h6><i class="bi bi-person-gear me-1"></i> Quem fica com o chamado · ${esc(t.number)}</h6>
          <button class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="small text-muted mb-2">${esc(t.title || '')}</div>
          <div class="at-lista" data-f="lista"><div class="text-muted small">Carregando...</div></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button class="btn btn-primary" data-f="save" disabled>Salvar</button>
        </div>
      </div></div></div>`;
    return open(html, (m, finish) => {
      const lista = m.querySelector('[data-f="lista"]');
      const btn = m.querySelector('[data-f="save"]');
      const atual = String(t.assigned_user_id || '');
      let escolhido = atual;
      const TOM = { 4: 'u-stop', 3: 'u-soon', 2: 'u-slow', 1: 'u-req' };
      const pill = (p, n) => (n ? `<span class="dp-pill ${TOM[p]}" title="${n} · ${esc(LABELS.priority[p] || '')}">${n}</span>` : '');
      const pintar = (pessoas) => {
        lista.innerHTML = pessoas.map((u) => `
          <label class="at-op ${String(u.id) === escolhido ? 'sel' : ''}">
            <input type="radio" name="at-tec" value="${u.id}" ${String(u.id) === escolhido ? 'checked' : ''}>
            <span class="dp-avatar">${esc((u.name || '?').trim().charAt(0).toUpperCase())}</span>
            <span class="at-op-tx">
              <b>${esc(u.name)}${String(u.id) === String(eu.id) ? ' <span class="tg tg-teal">você</span>' : ''}${String(u.id) === atual ? ' <span class="tg tg-gray">atual</span>' : ''}</b>
              <small>${u.role === 'admin' ? 'Administrador Mestre' : 'Técnico'} · ${u.total ? `${u.total} chamado(s) em aberto` : 'sem chamados'}${u.atendendo ? ` · <span class="dp-ativo"><i class="dp-pulso"></i>atendendo #${u.atendendo.id}</span>` : ''}</small>
            </span>
            <span class="dp-pills">${pill(4, u.p4)}${pill(3, u.p3)}${pill(2, u.p2)}${pill(1, u.p1)}</span>
          </label>`).join('')
          + (atual ? `<label class="at-op at-op-nenhum ${escolhido === '' ? 'sel' : ''}"><input type="radio" name="at-tec" value="" ${escolhido === '' ? 'checked' : ''}>
              <i class="bi bi-person-dash"></i><span class="at-op-tx"><b>Ninguém</b><small>Tira o técnico do chamado</small></span></label>` : '');
        lista.querySelectorAll('input[name="at-tec"]').forEach((r) => r.addEventListener('change', () => {
          escolhido = r.value;
          lista.querySelectorAll('.at-op').forEach((op) => op.classList.toggle('sel', op.contains(r)));
          btn.disabled = escolhido === atual;
        }));
      };
      API.get(`/tickets/${t.id}/tecnicos`).then(pintar)
        .catch((e) => { lista.innerHTML = `<div class="text-danger small">${esc(e.message || 'Não foi possível carregar.')}</div>`; });
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await API.post(`/tickets/${t.id}/assign`, { user_id: escolhido || null });
          const nome = lista.querySelector('input[name="at-tec"]:checked')?.closest('.at-op')?.querySelector('b')?.childNodes[0]?.textContent || '';
          toast(escolhido ? `${t.number} agora está com ${nome.trim()}.` : 'Técnico tirado do chamado.', 'success');
          finish(true);
        } catch (e) { btn.disabled = false; showError(e); }
      });
    }, opts);
  }

  // ---------------- Resolver (formulario de encerramento) ----------------
  const EMPRESA_PADRAO_WHATSAPP = 'WhatsApp - não identificado';
  function resolve(t, opts = {}) {
    // opts.toStatus: 5 = Resolvido (padrão) ou 6 = Fechado. Os dois passam por este formulário.
    const paraStatus = opts.toStatus === 6 ? 6 : 5;
    const verbo = paraStatus === 6 ? 'Fechar' : 'Resolver';
    // Chamado do WhatsApp ainda na empresa padrao: atribuir empresa e obrigatorio.
    const precisaEmpresa = !!t.via_whatsapp
      && String(t.entity_name || '').trim() === EMPRESA_PADRAO_WHATSAPP;
    const html = `<div class="modal fade" tabindex="-1">
      <div class="modal-dialog modal-lg"><div class="modal-content">
        <div class="modal-header"><h6><i class="bi bi-check2-circle me-1"></i> ${verbo} chamado · ${esc(t.number)}</h6>
          <button class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="small text-muted mb-2">${esc(t.title || '')}</div>
          ${precisaEmpresa ? `
          <div class="alert alert-warning mb-3" data-f="empresa-box">
            <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap">
              <div><i class="bi bi-building-add me-1"></i><b>Empresa obrigatória</b>
                <div class="small">Este chamado veio pelo WhatsApp e ainda está em “${esc(EMPRESA_PADRAO_WHATSAPP)}”.
                  Atribua a empresa antes de resolver.</div>
              </div>
              <button type="button" class="btn btn-outline-primary btn-sm text-nowrap" data-f="toggle-empresa">
                <i class="bi bi-building-add"></i> Atribuir empresa</button>
            </div>
            <div class="mt-2 d-none" data-f="empresa-panel">
              <label class="form-label small">Empresa existente <span class="text-danger">*</span></label>
              <select class="form-select form-select-sm" data-f="empresa"><option value="">Carregando...</option></select>
              <div class="form-text">Localização e equipamento só permanecem se também pertencerem à empresa escolhida.</div>
              <button type="button" class="btn btn-primary btn-sm mt-2" data-f="salvar-empresa">Atribuir</button>
            </div>
          </div>` : ''}
          <div class="mb-3"><label class="form-label">1. Qual foi a causa? <span class="text-danger">*</span></label>
            <select class="form-select" data-f="cause"><option value="">Carregando...</option></select>
            <div class="form-text" data-f="cause-help"></div>
            <div class="invalid-feedback" data-f="cause-err">Escolha a causa. Se não havia problema, use “Sem problema / aberto por engano”.</div></div>
          <div class="alert alert-info small py-2 d-none" data-f="neutro-info"><i class="bi bi-info-circle me-1"></i>
            Chamado sem problema: só a causa é obrigatória. O resto é opcional.</div>
          <div class="mb-3"><label class="form-label">2. O que aconteceu e o que foi feito? <span class="text-danger" data-obrig>*</span></label>
            <textarea class="form-control" data-f="notes" rows="4" placeholder="Ex.: O cabo de rede estava solto atrás do computador. Reconectei e testei a internet."></textarea>
            <div class="invalid-feedback">Escreva pelo menos uma frase curta.</div>
            <div class="form-text">O solicitante vê este texto.</div></div>
          <div class="mb-3"><label class="form-label">3. O que aconteceu com o equipamento? <span class="text-danger" data-obrig>*</span></label>
              <select class="form-select" data-f="action">
                <option value="">— escolha —</option>
                ${Object.entries(LABELS.equipmentAction).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
              </select>
              <div class="invalid-feedback">Escolha uma opção.</div>
              ${t.asset_id ? `<div class="form-text">Fica registrado também no histórico de manutenção de <b>${esc(t.asset_name || 'equipamento')}</b>.</div>` : ''}</div>
          <div class="mb-2"><label class="form-label">4. Nota para o usuário <b>${esc(t.requester_name || '')}</b> neste chamado <span class="text-danger" data-obrig>*</span></label>
            <div class="d-flex align-items-center gap-3 flex-wrap">
              <span class="star-pick" data-f="stars">${[1, 2, 3, 4, 5].map((n) => `<i class="bi bi-star" data-n="${n}"></i>`).join('')}</span>
              <button type="button" class="btn btn-sm btn-outline-secondary" data-f="zero">0 estrelas</button>
              <span class="small text-muted" data-f="stars-label">Toque nas estrelas</span>
            </div>
            <div class="text-danger small d-none" data-f="stars-err">Dê uma nota de 0 a 5 estrelas.</div>
            <input class="form-control form-control-sm mt-2" data-f="rating-comment" maxlength="300" placeholder="Comentário sobre o usuário (opcional)">
            <div class="form-text"><i class="bi bi-lock me-1"></i>A causa e a nota só são vistas pela equipe — o usuário não vê.</div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button class="btn btn-success" data-f="save"><i class="bi bi-check2-circle"></i> ${verbo}</button>
        </div>
      </div></div></div>`;
    return open(html, (m, finish) => {
      const f = (k) => m.querySelector(`[data-f="${k}"]`);
      let rating = null;
      const starLabels = ['0 — muito ruim', '1 — ruim', '2 — regular', '3 — bom', '4 — muito bom', '5 — excelente'];
      const paintStars = () => {
        f('stars').querySelectorAll('i').forEach((i) => {
          i.className = rating !== null && Number(i.dataset.n) <= rating ? 'bi bi-star-fill' : 'bi bi-star';
        });
        f('stars-label').textContent = rating === null ? 'Toque nas estrelas' : starLabels[rating];
      };
      f('stars').querySelectorAll('i').forEach((i) => i.addEventListener('click', () => { rating = Number(i.dataset.n); paintStars(); }));
      f('zero').addEventListener('click', () => { rating = 0; paintStars(); });

      const causeSel = f('cause');
      // causas do perfil de opções da empresa do chamado
      const carregarCausas = () => API.get(`/resolution-causes?entity_id=${encodeURIComponent(t.entity_id || '')}`).then((causes) => {
        causeSel.innerHTML = '<option value="">— escolha —</option>' +
          causes.map((c) => `<option value="${c.id}" data-help="${esc(c.description || '')}" ${c.neutral ? 'data-neutral="1"' : ''}>${esc(c.name)}</option>`).join('');
        f('cause-help').textContent = '';
        atualizarNeutro();
      }).catch(() => {});
      carregarCausas();
      const ehNeutra = () => causeSel.selectedOptions[0]?.dataset.neutral === '1';
      function atualizarNeutro() {
        const n = ehNeutra();
        f('neutro-info').classList.toggle('d-none', !n);
        m.querySelectorAll('[data-obrig]').forEach((x) => { x.textContent = n ? '(opcional)' : '*'; x.className = n ? 'text-muted small' : 'text-danger'; });
        if (n) {
          ['notes', 'action'].forEach((k) => f(k).classList.remove('is-invalid'));
          f('stars-err').classList.add('d-none');
        }
      }
      causeSel.addEventListener('change', () => {
        f('cause-help').textContent = causeSel.selectedOptions[0]?.dataset.help || '';
        causeSel.classList.remove('is-invalid');
        atualizarNeutro();
      });
      ['notes', 'action'].forEach((k) => f(k).addEventListener('input', () => f(k).classList.remove('is-invalid')));
      f('stars').addEventListener('click', () => f('stars-err').classList.add('d-none'));
      f('zero').addEventListener('click', () => f('stars-err').classList.add('d-none'));

      // Empresa obrigatoria para chamados do WhatsApp ainda sem empresa real
      let empresaOk = !precisaEmpresa;
      if (precisaEmpresa) {
        const empSel = f('empresa');
        API.get('/entities').then((ents) => {
          const ativas = ents.filter((e) => e.active !== false
            && String(e.name || '').trim() !== EMPRESA_PADRAO_WHATSAPP);
          empSel.innerHTML = '<option value="">— escolha a empresa —</option>' +
            ativas.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
        }).catch(() => { empSel.innerHTML = '<option value="">Erro ao carregar as empresas</option>'; });
        f('toggle-empresa').addEventListener('click', () => f('empresa-panel').classList.toggle('d-none'));
        f('salvar-empresa').addEventListener('click', async () => {
          const novo = parseInt(empSel.value, 10);
          if (!novo) { toast('Escolha a empresa do chamado.', 'warning'); return; }
          try {
            await API.patch(`/tickets/${t.id}`, { entity_id: novo });
            t.entity_id = novo;
            t.entity_name = empSel.selectedOptions[0].textContent;
            empresaOk = true;
            carregarCausas(); // a empresa nova pode usar outro perfil de opções
            const box = f('empresa-box');
            box.className = 'alert alert-success mb-3';
            box.innerHTML = `<i class="bi bi-check-circle me-1"></i>Empresa atribuída: <b>${esc(t.entity_name)}</b>. Agora você pode resolver.`;
            toast('Empresa atribuída.', 'success');
          } catch (e) { showError(e); }
        });
      }

      f('save').addEventListener('click', async () => {
        if (!empresaOk) {
          toast('Atribua a empresa antes de resolver este chamado do WhatsApp.', 'warning');
          f('empresa-panel')?.classList.remove('d-none');
          return;
        }
        const body = {
          status: paraStatus,
          resolution_notes: f('notes').value.trim(),
          resolution_cause_id: parseInt(causeSel.value, 10) || null,
          equipment_action: f('action').value,
          requester_rating: rating,
          requester_rating_comment: f('rating-comment').value.trim(),
        };
        // Erros ficam marcados em vermelho no próprio campo (não somem)
        const neutra = ehNeutra();
        const erros = [];
        if (!body.resolution_cause_id) { causeSel.classList.add('is-invalid'); erros.push(causeSel); }
        if (!neutra && body.resolution_notes.length < 5) { f('notes').classList.add('is-invalid'); erros.push(f('notes')); }
        if (!neutra && !body.equipment_action) { f('action').classList.add('is-invalid'); erros.push(f('action')); }
        if (!neutra && rating === null) { f('stars-err').classList.remove('d-none'); erros.push(f('zero')); }
        if (erros.length) { erros[0].focus(); erros[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
        try {
          try {
            await API.post(`/tickets/${t.id}/status`, body);
            toast(`${t.number} ${paraStatus === 6 ? 'fechado' : 'resolvido'}.`, 'success');
          } catch (e) {
            // perfil que precisa da aprovacao do solicitante: envia para aprovar
            if (!e.data?.request_approval) throw e;
            await API.post(`/tickets/${t.id}/approval`, body);
            toast('Solução registrada. O solicitante vai aprovar para fechar o chamado.', 'success');
          }
          finish(true);
        } catch (e) {
          showError(e);
          if (e.data?.entity_required) f('empresa-panel')?.classList.remove('d-none');
        }
      });
    }, opts);
  }

  return { assign, resolve };
})();
