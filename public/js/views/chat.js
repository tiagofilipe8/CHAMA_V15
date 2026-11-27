// ---------------------------------------------------------------
// Chat interno: conversas diretas e grupos
//   @ cita uma pessoa da conversa (ela recebe aviso) · # marca um chamado (lista + busca)
// ---------------------------------------------------------------
const Chat = (() => {
  let aberta = null;      // id da conversa aberta
  let tela = null;        // elemento da página
  let conversas = [];
  let citacoes = null;
  let membros = [];
  let naoLidas = 0;

  const eu = () => String((API.user || {}).id);
  const hora = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dia = (d) => {
    const x = new Date(d); const hoje = new Date(); const ontem = new Date(Date.now() - 86400000);
    if (x.toDateString() === hoje.toDateString()) return 'Hoje';
    if (x.toDateString() === ontem.toDateString()) return 'Ontem';
    return x.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
  };
  const textoMsg = (s) => Mencoes.formatar(esc(s)).replace(/\n/g, '<br>');
  const resumo = (s) => esc(String(s || '').replace(/\s+/g, ' ').slice(0, 70));

  // ---------- bolinha do menu ----------
  function pintarBolinha() {
    const b = document.querySelector('#nav-chat .nav-chat-n');
    if (!b) return;
    b.classList.toggle('d-none', !naoLidas);
    b.textContent = naoLidas > 99 ? '99+' : String(naoLidas);
  }
  async function carregarBolinha() {
    if (!window.CHAT_LIGADO) return;
    try { naoLidas = (await API.get('/chat/unread')).unread; } catch { naoLidas = 0; }
    pintarBolinha();
  }

  // ---------- lista de conversas ----------
  function pintarLista() {
    const box = tela && tela.querySelector('#ch-lista');
    if (!box) return;
    const filtro = (tela.querySelector('#ch-filtro').value || '').toLowerCase();
    const lista = conversas.filter((c) => !filtro || String(c.titulo).toLowerCase().includes(filtro)
      || (c.membros || []).some((m) => String(m.name).toLowerCase().includes(filtro)));
    box.innerHTML = lista.length ? lista.map((c) => `
      <a class="ch-conv ${String(c.id) === String(aberta) ? 'on' : ''}" href="#/chat/${c.id}">
        <span class="ch-av ${c.kind === 'group' ? 'grp' : ''}">${c.kind === 'group' ? '<i class="bi bi-people-fill"></i>' : esc(String(c.titulo).charAt(0).toUpperCase())}</span>
        <span class="ch-conv-tx">
          <b>${esc(c.titulo)}</b>
          <small>${c.ultima ? `${String(c.ultima.user_id) === eu() ? 'Você: ' : (c.kind === 'group' ? `${esc(String(c.ultima.user_name || '').split(' ')[0])}: ` : '')}${resumo(c.ultima.content)}` : '<i>Sem mensagens</i>'}</small>
        </span>
        <span class="ch-conv-meta">${c.ultima ? `<small>${esc(dia(c.ultima.created_at) === 'Hoje' ? hora(c.ultima.created_at) : dia(c.ultima.created_at))}</small>` : ''}
          ${c.nao_lidas ? `<b class="ch-n">${c.nao_lidas}</b>` : ''}</span>
      </a>`).join('') : `<div class="ch-vazio">${conversas.length ? 'Nada encontrado.' : 'Nenhuma conversa ainda.<br>Clique em <b>Nova conversa</b>.'}</div>`;
  }
  async function carregarLista() {
    try { conversas = await API.get('/chat/conversations'); } catch (e) { conversas = []; showError(e); }
    naoLidas = conversas.reduce((s, c) => s + (c.nao_lidas || 0), 0);
    pintarBolinha();
    pintarLista();
  }

  // ---------- mensagens ----------
  function htmlMensagens(msgs) {
    let ultimoDia = null; let ultimoAutor = null;
    return msgs.map((m) => {
      const d = dia(m.created_at);
      let sep = '';
      if (d !== ultimoDia) { sep = `<div class="ch-dia"><span>${esc(d)}</span></div>`; ultimoDia = d; ultimoAutor = null; }
      const meu = String(m.user_id) === eu();
      const mostraNome = !meu && membros.length > 2 && ultimoAutor !== String(m.user_id);
      ultimoAutor = String(m.user_id);
      return `${sep}<div class="ch-msg ${meu ? 'meu' : ''}" data-id="${m.id}">
        <div class="ch-bolha">${mostraNome ? `<div class="ch-autor">${esc(m.user_name || 'Usuário removido')}</div>` : ''}
          ${m.deleted_at ? '<i class="ch-apagada">Mensagem apagada</i>' : textoMsg(m.content)}
          <span class="ch-hora">${hora(m.created_at)}</span>
          ${meu && !m.deleted_at ? `<button class="ch-apagar" data-apagar="${m.id}" title="Apagar mensagem"><i class="bi bi-trash3"></i></button>` : ''}
        </div></div>`;
    }).join('');
  }
  let mensagens = [];
  function pintarMensagens(rolarFim) {
    const box = tela.querySelector('#ch-msgs');
    if (!box) return;
    const perto = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    box.innerHTML = mensagens.length ? htmlMensagens(mensagens)
      : '<div class="ch-vazio">Nenhuma mensagem ainda. Use <b>@</b> para citar alguém e <b>#</b> para marcar um chamado.</div>';
    if (rolarFim || perto) box.scrollTop = box.scrollHeight;
  }

  async function abrirConversa(id) {
    aberta = id;
    tela.classList.add('ch-com-conversa');
    const painel = tela.querySelector('#ch-painel');
    painel.innerHTML = spinner();
    pintarLista();
    let c;
    try {
      [c, mensagens] = await Promise.all([API.get(`/chat/conversations/${id}`), API.get(`/chat/conversations/${id}/messages`)]);
    } catch (e) {
      painel.innerHTML = emptyState('Conversa não encontrada', e.message, 'bi-chat-x');
      return;
    }
    membros = c.membros;
    const outros = membros.filter((m) => String(m.id) !== eu());
    painel.innerHTML = `
      <div class="ch-cab">
        <a class="btn btn-sm btn-link ch-voltar" href="#/chat" title="Voltar"><i class="bi bi-arrow-left"></i></a>
        <span class="ch-av ${c.kind === 'group' ? 'grp' : ''}">${c.kind === 'group' ? '<i class="bi bi-people-fill"></i>' : esc(String(c.titulo).charAt(0).toUpperCase())}</span>
        <div class="ch-cab-tx"><b>${esc(c.titulo)}</b>
          <small>${c.kind === 'group' ? `${membros.length} pessoas: ${esc(outros.map((m) => m.name.split(' ')[0]).join(', '))}` : esc([outros[0]?.papel, outros[0]?.location_name].filter(Boolean).join(' · '))}</small></div>
        ${c.kind === 'group' ? `<div class="dropdown ms-auto">
          <button class="btn btn-sm btn-outline-secondary" data-bs-toggle="dropdown"><i class="bi bi-three-dots"></i></button>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><a class="dropdown-item" href="#" id="ch-add"><i class="bi bi-person-plus me-2"></i>Adicionar pessoas</a></li>
            <li><a class="dropdown-item" href="#" id="ch-renomear"><i class="bi bi-pencil me-2"></i>Mudar o nome</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item text-danger" href="#" id="ch-sair"><i class="bi bi-box-arrow-right me-2"></i>Sair do grupo</a></li>
          </ul></div>` : ''}
      </div>
      <div class="ch-msgs" id="ch-msgs"></div>
      <form class="ch-escrever" id="ch-form" autocomplete="off">
        <div class="ch-caixa">
          <textarea id="ch-texto" rows="1" placeholder="Escreva uma mensagem. @ cita alguém, # marca um chamado" maxlength="4000"></textarea>
        </div>
        <button type="button" class="btn btn-sm btn-light ch-sinal" data-sinal="@" title="Citar uma pessoa">@</button>
        <button type="button" class="btn btn-sm btn-light ch-sinal" data-sinal="#" title="Marcar um chamado">#</button>
        <button class="btn btn-primary ch-enviar" title="Enviar"><i class="bi bi-send-fill"></i></button>
      </form>`;
    pintarMensagens(true);
    const texto = painel.querySelector('#ch-texto');
    citacoes = Mencoes.ligar(texto, { pessoas: async () => membros.filter((m) => String(m.id) !== eu()) });
    const ajustar = () => { texto.style.height = 'auto'; texto.style.height = `${Math.min(texto.scrollHeight, 160)}px`; };
    texto.addEventListener('input', ajustar);
    texto.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.defaultPrevented) { e.preventDefault(); painel.querySelector('#ch-form').requestSubmit(); }
    });
    painel.querySelectorAll('.ch-sinal').forEach((b) => b.addEventListener('click', () => citacoes.abrir(b.dataset.sinal)));
    painel.querySelector('#ch-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const bruto = texto.value.trim();
      if (!bruto) return;
      const content = citacoes.preparar(bruto);
      texto.value = ''; ajustar(); citacoes.limpar();
      try {
        const m = await API.post(`/chat/conversations/${id}/messages`, { content });
        if (!mensagens.some((x) => String(x.id) === String(m.id))) mensagens.push(m);
        pintarMensagens(true);
        carregarLista();
      } catch (err) { texto.value = bruto; showError(err); }
    });
    painel.querySelector('#ch-msgs').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-apagar]');
      if (!b) return;
      if (!await confirmDialog({ title: 'Apagar mensagem', body: 'A mensagem some para todos da conversa.', confirmText: 'Apagar', danger: true })) return;
      try { await API.del(`/chat/messages/${b.dataset.apagar}`); } catch (err) { showError(err); }
    });
    // carregar mensagens antigas ao chegar no topo
    const box = painel.querySelector('#ch-msgs');
    let acabou = mensagens.length < 50; let buscando = false;
    box.addEventListener('scroll', async () => {
      if (box.scrollTop > 40 || acabou || buscando || !mensagens.length) return;
      buscando = true;
      try {
        const antigas = await API.get(`/chat/conversations/${id}/messages?antes=${mensagens[0].id}`);
        if (antigas.length < 50) acabou = true;
        const altura = box.scrollHeight;
        mensagens = [...antigas, ...mensagens];
        pintarMensagens(false);
        box.scrollTop = box.scrollHeight - altura;
      } catch { /* tenta de novo depois */ }
      buscando = false;
    });
    if (c.kind === 'group') {
      painel.querySelector('#ch-add').addEventListener('click', (e) => { e.preventDefault(); escolherPessoas({ adicionar: id, ja: membros.map((m) => String(m.id)) }); });
      painel.querySelector('#ch-renomear').addEventListener('click', async (e) => {
        e.preventDefault();
        const nome = prompt('Novo nome do grupo:', c.name || '');
        if (!nome || !nome.trim()) return;
        try { await API.patch(`/chat/conversations/${id}`, { name: nome.trim() }); abrirConversa(id); carregarLista(); } catch (err) { showError(err); }
      });
      painel.querySelector('#ch-sair').addEventListener('click', async (e) => {
        e.preventDefault();
        if (!await confirmDialog({ title: 'Sair do grupo', body: `Você deixa de ver as mensagens de "${esc(c.name)}".`, confirmText: 'Sair', danger: true })) return;
        try { await API.del(`/chat/conversations/${id}/members/me`); location.hash = '#/chat'; } catch (err) { showError(err); }
      });
    }
    texto.focus();
    await API.post(`/chat/conversations/${id}/read`).catch(() => {});
    carregarLista();
  }

  // ---------- nova conversa / adicionar pessoas ----------
  async function escolherPessoas({ adicionar = null, ja = [] } = {}) {
    let pessoas = [];
    try { pessoas = await API.get('/chat/people'); } catch (e) { showError(e); return; }
    pessoas = pessoas.filter((p) => !ja.includes(String(p.id)));
    const sel = new Set();
    const m = document.createElement('div');
    m.className = 'modal fade';
    m.innerHTML = `<div class="modal-dialog modal-dialog-scrollable"><div class="modal-content">
      <div class="modal-header"><h6 class="mb-0">${adicionar ? 'Adicionar pessoas ao grupo' : 'Nova conversa'}</h6><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <input class="form-control form-control-sm mb-2" id="np-busca" placeholder="Buscar pelo nome">
        <div class="small text-muted mb-2">${adicionar ? 'Marque quem vai entrar no grupo.' : 'Marque uma pessoa para conversar só com ela, ou várias para criar um grupo.'}</div>
        <div id="np-lista" class="np-lista"></div>
        <div id="np-grupo" class="mt-2 d-none"><label class="form-label small mb-1">Nome do grupo *</label>
          <input class="form-control form-control-sm" id="np-nome" maxlength="80" placeholder="Ex.: Equipe de campo"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="np-ok" disabled>${adicionar ? 'Adicionar' : 'Conversar'}</button></div>
    </div></div>`;
    document.body.appendChild(m);
    const modal = new bootstrap.Modal(m);
    const pintar = () => {
      const q = m.querySelector('#np-busca').value.trim().toLowerCase();
      const lista = pessoas.filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.entity_name || '').toLowerCase().includes(q));
      m.querySelector('#np-lista').innerHTML = lista.map((p) => `
        <label class="np-it ${sel.has(String(p.id)) ? 'on' : ''}"><input type="checkbox" value="${p.id}" ${sel.has(String(p.id)) ? 'checked' : ''}>
          <span class="ch-av">${esc(p.name.charAt(0).toUpperCase())}</span>
          <span><b>${esc(p.name)}</b><small>${esc([p.papel, p.location_name || p.entity_name].filter(Boolean).join(' · '))}</small></span></label>`).join('')
        || '<div class="text-muted small p-2">Ninguém encontrado.</div>';
      m.querySelectorAll('#np-lista input').forEach((c) => c.addEventListener('change', () => {
        if (c.checked) sel.add(c.value); else sel.delete(c.value);
        pintar();
      }));
      m.querySelector('#np-grupo').classList.toggle('d-none', !!adicionar || sel.size < 2);
      m.querySelector('#np-ok').disabled = !sel.size;
    };
    m.querySelector('#np-busca').addEventListener('input', pintar);
    m.querySelector('#np-ok').addEventListener('click', async () => {
      try {
        if (adicionar) {
          await API.post(`/chat/conversations/${adicionar}/members`, { user_ids: [...sel] });
          modal.hide(); citacoes?.recarregarPessoas(); abrirConversa(adicionar);
        } else {
          const r = await API.post('/chat/conversations', { user_ids: [...sel], name: m.querySelector('#np-nome').value.trim() });
          modal.hide(); location.hash = `#/chat/${r.id}`;
        }
      } catch (e) { showError(e); }
    });
    m.addEventListener('hidden.bs.modal', () => m.remove());
    m.addEventListener('shown.bs.modal', () => m.querySelector('#np-busca').focus());
    pintar();
    modal.show();
  }

  // ---------- página ----------
  async function pagina(el, id) {
    tela = el;
    aberta = id || null;
    el.innerHTML = `
      <div class="ch-app">
        <aside class="ch-lado">
          <div class="ch-lado-cab">
            <input class="form-control form-control-sm" id="ch-filtro" placeholder="Buscar conversa">
            <button class="btn btn-sm btn-primary" id="ch-nova" title="Nova conversa"><i class="bi bi-pencil-square"></i><span> Nova</span></button>
          </div>
          <div class="ch-lista" id="ch-lista">${spinner()}</div>
        </aside>
        <section class="ch-painel" id="ch-painel">
          <div class="ch-vazio ch-escolha"><i class="bi bi-chat-dots"></i>Escolha uma conversa ou comece uma nova.
            <small>Use <b>@</b> para citar alguém (a pessoa recebe um aviso) e <b>#</b> para marcar um chamado.</small></div>
        </section>
      </div>`;
    el.querySelector('#ch-filtro').addEventListener('input', pintarLista);
    el.querySelector('#ch-nova').addEventListener('click', () => escolherPessoas());
    await carregarLista();
    if (id) abrirConversa(id);
  }

  // ---------- tempo real ----------
  function chegou(m) {
    const naTela = tela && document.body.contains(tela) && String(m.conversation_id) === String(aberta);
    if (naTela) {
      if (!mensagens.some((x) => String(x.id) === String(m.id))) { mensagens.push(m); pintarMensagens(String(m.user_id) === eu()); }
      if (String(m.user_id) !== eu()) API.post(`/chat/conversations/${aberta}/read`).catch(() => {});
    }
    if (tela && document.body.contains(tela)) carregarLista();
    else if (String(m.user_id) !== eu()) {
      naoLidas += 1; pintarBolinha();
      toast(`${m.user_name}: ${String(m.content).replace(/@\[([^\]]+)\]\(u\d+\)/g, '@$1').slice(0, 80)}`, 'info');
    }
  }
  function apagada(d) {
    if (String(d.conversation_id) !== String(aberta)) return;
    const m = mensagens.find((x) => String(x.id) === String(d.id));
    if (m) { m.deleted_at = new Date().toISOString(); m.content = ''; pintarMensagens(false); }
  }

  return { pagina, chegou, apagada, carregarBolinha, pintarBolinha };
})();

const chatDesligado = (el) => {
  el.innerHTML = emptyState('Chat desligado', Roles.isMaster(API.user || {})
    ? 'Ligue o chat interno em Configurações > Chat interno.' : 'O chat interno não está ligado neste sistema.', 'bi-chat-dots');
};
Views.chat = (el) => (window.CHAT_LIGADO ? Chat.pagina(el, null) : chatDesligado(el));
Views.chatConversa = (id) => (el) => (window.CHAT_LIGADO ? Chat.pagina(el, id) : chatDesligado(el));
window.Chat = Chat;
