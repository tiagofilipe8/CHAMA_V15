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
  function assign(t, opts = {}) {
    const html = `<div class="modal fade" tabindex="-1">
      <div class="modal-dialog"><div class="modal-content">
        <div class="modal-header"><h6><i class="bi bi-person-plus me-1"></i> Atribuir técnico · ${esc(t.number)}</h6>
          <button class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="small text-muted mb-2">${esc(t.title || '')}</div>
          <select class="form-select" data-f="tech"><option value="">Carregando...</option></select>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button class="btn btn-primary" data-f="save">Salvar</button>
        </div>
      </div></div></div>`;
    return open(html, (m, finish) => {
      const sel = m.querySelector('[data-f="tech"]');
      API.get('/users?role=technician&active=true').then((users) => {
        sel.innerHTML = '<option value="">— Nenhum (desatribuir) —</option>' +
          users.map((u) => `<option value="${u.id}" ${String(u.id) === String(t.assigned_user_id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
      }).catch(() => { sel.innerHTML = '<option value="">— Nenhum (desatribuir) —</option>'; });
      m.querySelector('[data-f="save"]').addEventListener('click', async () => {
        try {
          await API.post(`/tickets/${t.id}/assign`, { user_id: sel.value || null });
          toast(sel.value ? `${t.number} atribuído a ${sel.selectedOptions[0].textContent}.` : 'Técnico removido.', 'success');
          finish(true);
        } catch (e) { showError(e); }
      });
    }, opts);
  }

  // ---------------- Resolver (formulario de encerramento) ----------------
  function resolve(t, opts = {}) {
    const html = `<div class="modal fade" tabindex="-1">
      <div class="modal-dialog modal-lg"><div class="modal-content">
        <div class="modal-header"><h6><i class="bi bi-check2-circle me-1"></i> Resolver chamado · ${esc(t.number)}</h6>
          <button class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="small text-muted mb-2">${esc(t.title || '')}</div>
          <div class="mb-3"><label class="form-label">1. O que aconteceu e o que foi feito? <span class="text-danger">*</span></label>
            <textarea class="form-control" data-f="notes" rows="4" placeholder="Ex.: O cabo de rede estava solto atrás do computador. Reconectei e testei a internet."></textarea>
            <div class="form-text">O solicitante vê este texto.</div></div>
          <div class="row">
            <div class="col-md-6 mb-3"><label class="form-label">2. Qual foi a causa? <span class="text-danger">*</span></label>
              <select class="form-select" data-f="cause"><option value="">Carregando...</option></select>
              <div class="form-text" data-f="cause-help"></div></div>
            <div class="col-md-6 mb-3"><label class="form-label">3. O que aconteceu com o equipamento? <span class="text-danger">*</span></label>
              <select class="form-select" data-f="action">
                <option value="">— escolha —</option>
                ${Object.entries(LABELS.equipmentAction).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
              </select>
              ${t.asset_id ? `<div class="form-text">Fica registrado também no histórico de manutenção de <b>${esc(t.asset_name || 'equipamento')}</b>.</div>` : ''}</div>
          </div>
          <div class="mb-2"><label class="form-label">4. Nota para o usuário <b>${esc(t.requester_name || '')}</b> neste chamado <span class="text-danger">*</span></label>
            <div class="d-flex align-items-center gap-3 flex-wrap">
              <span class="star-pick" data-f="stars">${[1, 2, 3, 4, 5].map((n) => `<i class="bi bi-star" data-n="${n}"></i>`).join('')}</span>
              <button type="button" class="btn btn-sm btn-outline-secondary" data-f="zero">0 estrelas</button>
              <span class="small text-muted" data-f="stars-label">Toque nas estrelas</span>
            </div>
            <input class="form-control form-control-sm mt-2" data-f="rating-comment" maxlength="300" placeholder="Comentário sobre o usuário (opcional)">
            <div class="form-text"><i class="bi bi-lock me-1"></i>A causa e a nota só são vistas pela equipe — o usuário não vê.</div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button class="btn btn-success" data-f="save"><i class="bi bi-check2-circle"></i> Resolver</button>
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
      API.get('/resolution-causes').then((causes) => {
        causeSel.innerHTML = '<option value="">— escolha —</option>' +
          causes.map((c) => `<option value="${c.id}" data-help="${esc(c.description || '')}">${esc(c.name)}</option>`).join('');
      }).catch(() => {});
      causeSel.addEventListener('change', () => {
        f('cause-help').textContent = causeSel.selectedOptions[0]?.dataset.help || '';
      });

      f('save').addEventListener('click', async () => {
        const body = {
          status: 5,
          resolution_notes: f('notes').value.trim(),
          resolution_cause_id: parseInt(causeSel.value, 10) || null,
          equipment_action: f('action').value,
          requester_rating: rating,
          requester_rating_comment: f('rating-comment').value.trim(),
        };
        if (body.resolution_notes.length < 5) { toast('Descreva o que aconteceu e o que foi feito.', 'warning'); return; }
        if (!body.resolution_cause_id) { toast('Escolha a causa.', 'warning'); return; }
        if (!body.equipment_action) { toast('Informe o que aconteceu com o equipamento.', 'warning'); return; }
        if (rating === null) { toast('Dê uma nota de 0 a 5 estrelas para o usuário.', 'warning'); return; }
        try {
          try {
            await API.post(`/tickets/${t.id}/status`, body);
            toast(`${t.number} resolvido.`, 'success');
          } catch (e) {
            // perfil que precisa da aprovacao do solicitante: envia para aprovar
            if (!e.data?.request_approval) throw e;
            await API.post(`/tickets/${t.id}/approval`, body);
            toast('Solução registrada. O solicitante vai aprovar para fechar o chamado.', 'success');
          }
          finish(true);
        } catch (e) { showError(e); }
      });
    }, opts);
  }

  return { assign, resolve };
})();
