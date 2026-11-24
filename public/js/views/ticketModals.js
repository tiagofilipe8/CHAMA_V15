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
          <div class="mb-2"><label class="form-label mb-1">4. Nota para o usuário <b>${esc(t.requester_name || '')}</b> neste chamado <span class="text-danger" data-obrig>*</span></label>
            <div class="form-text mt-0 mb-2">Cada item marcado vale 1 estrela. Passe o mouse no item para ver quando marcar. <i class="bi bi-magic"></i> = o sistema já marcou pelo que aconteceu no chamado; confira.</div>
            <div class="ck-lista" data-f="ck"><div class="text-muted small">Carregando...</div></div>
            <div class="ck-total" data-f="ck-total"></div>
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
      // Checklist da nota: cada "sim" = 1 estrela. O sistema pré-marca o que dá para saber pelo chamado.
      const NOMES_NOTA = ['muito ruim', 'ruim', 'regular', 'bom', 'muito bom', 'excelente'];
      let checklistTocado = false;
      const nota = () => f('ck').querySelectorAll('input[data-k]:checked').length;
      const pintarTotal = () => {
        const n = nota();
        f('ck-total').innerHTML = `${[1, 2, 3, 4, 5].map((i) => `<i class="bi ${i <= n ? 'bi-star-fill' : 'bi-star'}"></i>`).join('')} <b>${n} estrela${n === 1 ? '' : 's'}</b> · ${NOMES_NOTA[n]}`;
      };
      API.get(`/tickets/${t.id}/avaliacao-sugestoes`).then(({ criterios, sugestoes }) => {
        f('ck').innerHTML = criterios.map((c) => {
          const s = sugestoes[c.key] || {};
          // sem sugestão: "seguiu as orientações" e "não foi mau uso" começam marcados (o normal é dar certo)
          const marcado = s.valor === null || s.valor === undefined ? ['orientacoes', 'sem_mau_uso'].includes(c.key) : s.valor;
          return `<label class="ck-it ${marcado ? 'on' : ''}">
            <input type="checkbox" data-k="${c.key}" ${marcado ? 'checked' : ''}>
            <span class="ck-tx"><b>${esc(c.label)}</b>${s.motivo ? `<small class="ck-auto ${s.valor ? 'sim' : 'nao'}"><i class="bi bi-magic"></i> ${esc(s.motivo)}</small>` : ''}</span>
            <i class="bi bi-info-circle ck-i"></i>
            <span class="ck-dica"><b><i class="bi bi-check-lg"></i> Marque se:</b> ${esc(c.sim)}<br><b><i class="bi bi-x-lg"></i> Não marque se:</b> ${esc(c.nao)}</span>
          </label>`;
        }).join('');
        f('ck').querySelectorAll('input[data-k]').forEach((i) => i.addEventListener('change', () => {
          checklistTocado = true;
          i.closest('.ck-it').classList.toggle('on', i.checked);
          pintarTotal();
        }));
        pintarTotal();
      }).catch((e) => { f('ck').innerHTML = `<div class="text-danger small">${esc(e.message || 'Não foi possível carregar o checklist.')}</div>`; });

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
        if (n) ['notes', 'action'].forEach((k) => f(k).classList.remove('is-invalid'));
      }
      causeSel.addEventListener('change', () => {
        f('cause-help').textContent = causeSel.selectedOptions[0]?.dataset.help || '';
        causeSel.classList.remove('is-invalid');
        atualizarNeutro();
      });
      ['notes', 'action'].forEach((k) => f(k).addEventListener('input', () => f(k).classList.remove('is-invalid')));

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
          requester_rating_comment: f('rating-comment').value.trim(),
        };
        const ck = f('ck').querySelectorAll('input[data-k]');
        // causa neutra (sem problema): a nota é opcional, só vai se o técnico mexeu no checklist
        if (ck.length && (!ehNeutra() || checklistTocado)) {
          body.requester_rating_criteria = Object.fromEntries([...ck].map((i) => [i.dataset.k, i.checked]));
        }
        // Erros ficam marcados em vermelho no próprio campo (não somem)
        const neutra = ehNeutra();
        const erros = [];
        if (!body.resolution_cause_id) { causeSel.classList.add('is-invalid'); erros.push(causeSel); }
        if (!neutra && body.resolution_notes.length < 5) { f('notes').classList.add('is-invalid'); erros.push(f('notes')); }
        if (!neutra && !body.equipment_action) { f('action').classList.add('is-invalid'); erros.push(f('action')); }
        if (!neutra && !body.requester_rating_criteria) { toast('Espere o checklist da nota carregar.', 'warning'); return; }
        if (erros.length) { erros[0].focus(); erros[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
        try {
          try {
            await API.post(`/tickets/${t.id}/status`, body);
            toast(paraStatus === 6 ? `${t.number} fechado. O usuário pode reabrir em até 3 dias.` : `${t.number} resolvido.`, 'success');
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

  // ---------------- Em pausa: motivo + data para voltar à fila ----------------
  const DIAS_PADRAO_PAUSA = { peca: 7, usuario: 3, fornecedor: 7, agendado: 1, outro: 3 };
  const diaMais = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
  function pause(t, opts = {}) {
    const html = `<div class="modal fade" tabindex="-1">
      <div class="modal-dialog"><div class="modal-content">
        <div class="modal-header"><h6><i class="bi bi-pause-circle me-1"></i> Colocar em pausa · ${esc(t.number)}</h6>
          <button class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="small text-muted mb-2">${esc(t.title || '')}</div>
          <label class="form-label small fw-semibold mb-1">Por que está parado? *</label>
          <div class="es-razoes" data-f="motivos">${Object.entries(LABELS.pausa).map(([k, v]) => `<label class="es-razao"><input type="radio" name="pz-motivo" value="${k}"><span><b>${esc(v)}</b></span></label>`).join('')}</div>
          <label class="form-label small fw-semibold mt-3 mb-1">Volta para a fila em *</label>
          <input type="date" class="form-control form-control-sm" data-f="ate" min="${diaMais(1)}" max="${diaMais(120)}" value="${diaMais(3)}">
          <div class="form-text">Nessa data o chamado volta sozinho para a fila e você recebe um aviso. Enquanto isso ele não conta no score de urgência nem nas rotas.</div>
          <label class="form-label small fw-semibold mt-3 mb-1">Comentário <span class="text-muted fw-normal" data-f="dica">(opcional)</span></label>
          <textarea class="form-control form-control-sm" data-f="nota" rows="2" placeholder="Ex.: fonte nova pedida ao fornecedor, chega na sexta"></textarea>
          <div class="form-text">O solicitante vê o motivo e a data.</div>
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button class="btn btn-warning" data-f="save"><i class="bi bi-pause-fill"></i> Pausar</button></div>
      </div></div></div>`;
    return open(html, (m, finish) => {
      const f = (k) => m.querySelector(`[data-f="${k}"]`);
      m.querySelectorAll('[name="pz-motivo"]').forEach((r) => r.addEventListener('change', () => {
        m.querySelectorAll('.es-razao').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
        f('ate').value = diaMais(DIAS_PADRAO_PAUSA[r.value] || 3);
        f('dica').textContent = r.value === 'outro' ? '(obrigatório: explique)' : '(opcional)';
      }));
      f('save').addEventListener('click', async () => {
        const motivo = m.querySelector('[name="pz-motivo"]:checked')?.value;
        if (!motivo) { toast('Escolha por que o chamado está parado.', 'warning'); return; }
        try {
          await API.post(`/tickets/${t.id}/status`, { status: 4, pause_reason: motivo, pause_until: f('ate').value, comment: f('nota').value.trim() });
          toast(`${t.number} em pausa até ${f('ate').value.split('-').reverse().join('/')}.`, 'success');
          finish(true);
        } catch (e) { showError(e); }
      });
    }, opts);
  }

  // ---------------- Quem abriu encerra o próprio chamado ----------------
  const AJUDA_ENCERRA = {
    resolvido: 'Alguém da TI resolveu. O técnico confirma e fecha.',
    sozinho: 'Conte como resolveu: ajuda em casos iguais.',
    engano: 'Não era um problema de TI ou abriu sem querer.',
    repetido: 'Já existe outro chamado para o mesmo problema.',
    nao_preciso: 'O pedido não é mais necessário.',
    outro: 'Explique o motivo.',
  };
  function encerrarUsuario(t, opts = {}) {
    const html = `<div class="modal fade" tabindex="-1">
      <div class="modal-dialog"><div class="modal-content">
        <div class="modal-header"><h6><i class="bi bi-check2-square me-1"></i> Resolvi / não preciso mais · ${esc(t.number)}</h6>
          <button class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <div class="small text-muted mb-2">${esc(t.title || '')}</div>
          <label class="form-label small fw-semibold mb-1">O que aconteceu? *</label>
          <div class="es-razoes">${Object.entries(LABELS.encerraUsuario).map(([k, v]) => `<label class="es-razao"><input type="radio" name="eu-motivo" value="${k}"><span><b>${esc(v)}</b><small>${esc(AJUDA_ENCERRA[k])}</small></span></label>`).join('')}</div>
          <div class="mt-3 d-none" data-f="ref-box"><label class="form-label small fw-semibold mb-1">Qual é o outro chamado? *</label>
            <input class="form-control form-control-sm" data-f="ref" placeholder="Ex.: #12"></div>
          <label class="form-label small fw-semibold mt-3 mb-1" data-f="nota-rot">Observação <span class="text-muted fw-normal">(opcional)</span></label>
          <textarea class="form-control form-control-sm" data-f="nota" rows="2" maxlength="1000"></textarea>
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">Voltar</button>
          <button class="btn btn-success" data-f="save"><i class="bi bi-check2"></i> Confirmar</button></div>
      </div></div></div>`;
    return open(html, (m, finish) => {
      const f = (k) => m.querySelector(`[data-f="${k}"]`);
      const motivoSel = () => m.querySelector('[name="eu-motivo"]:checked')?.value;
      m.querySelectorAll('[name="eu-motivo"]').forEach((r) => r.addEventListener('change', () => {
        m.querySelectorAll('.es-razao').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
        f('ref-box').classList.toggle('d-none', r.value !== 'repetido');
        f('nota-rot').innerHTML = r.value === 'sozinho' ? 'Como você resolveu? <span class="text-muted fw-normal">(opcional)</span>'
          : r.value === 'outro' ? 'Explique o motivo *' : 'Observação <span class="text-muted fw-normal">(opcional)</span>';
        f('save').innerHTML = r.value === 'resolvido' ? '<i class="bi bi-check2"></i> Avisar que resolveu' : '<i class="bi bi-check2"></i> Encerrar chamado';
      }));
      const enviar = async (confirmar) => {
        const motivo = motivoSel();
        if (!motivo) { toast('Escolha o que aconteceu.', 'warning'); return; }
        const body = { motivo, nota: f('nota').value.trim(), ref: f('ref').value.trim(), confirmar };
        if (motivo === 'outro' && !body.nota) { toast('Explique o motivo.', 'warning'); return; }
        if (motivo === 'repetido' && !/^#?\d+$/.test(body.ref)) { toast('Informe o número do outro chamado (ex.: #12).', 'warning'); return; }
        try {
          await API.post(`/tickets/${t.id}/encerrar-usuario`, body);
          toast(motivo === 'resolvido' ? 'Obrigado! O técnico vai confirmar e fechar o chamado.' : 'Chamado encerrado.', 'success');
          finish(true);
        } catch (e) {
          if (e.data?.em_atendimento && !confirmar) {
            const ok = await confirmDialog({ title: 'O técnico já está atendendo', body: `${esc(e.data.error)}<br>Encerrar mesmo assim? Ele recebe um aviso.`, confirmText: 'Encerrar mesmo assim', danger: true });
            if (ok) enviar(true);
            return;
          }
          showError(e);
        }
      };
      f('save').addEventListener('click', () => enviar(false));
    }, opts);
  }

  // ---------------- Reabrir (contando o que não resolveu) ----------------
  function reopen(t, opts = {}) {
    const html = `<div class="modal fade" tabindex="-1">
      <div class="modal-dialog"><div class="modal-content">
        <div class="modal-header"><h6><i class="bi bi-arrow-counterclockwise me-1"></i> Reabrir · ${esc(t.number)}</h6>
          <button class="btn-close" data-bs-dismiss="modal"></button></div>
        <div class="modal-body">
          <label class="form-label small fw-semibold mb-1">O que não ficou resolvido? *</label>
          <textarea class="form-control" data-f="nota" rows="3" maxlength="1000" placeholder="Ex.: a impressora voltou a travar no dia seguinte"></textarea>
          ${t.reopen_until ? `<div class="form-text">Dá para reabrir até ${esc(fmt.dateTime(t.reopen_until))}.</div>` : ''}
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button class="btn btn-primary" data-f="save"><i class="bi bi-arrow-counterclockwise"></i> Reabrir</button></div>
      </div></div></div>`;
    return open(html, (m, finish) => {
      const nota = m.querySelector('[data-f="nota"]');
      m.querySelector('[data-f="save"]').addEventListener('click', async () => {
        if (!nota.value.trim()) { toast('Conte o que não ficou resolvido.', 'warning'); nota.focus(); return; }
        try {
          await API.post(`/tickets/${t.id}/status`, { status: 3, comment: nota.value.trim() });
          toast('Chamado reaberto.', 'success'); finish(true);
        } catch (e) { showError(e); }
      });
    }, opts);
  }

  return { assign, resolve, pause, encerrarUsuario, reopen };
})();
