// ---------------------------------------------------------------
// Citações (conversa do chamado e chat interno)
//   @ -> lista de pessoas; quem é citado recebe um aviso
//   # -> painel de chamados: os em aberto, todos em ordem de número e um campo de busca;
//        vira um link (#16)
// Na caixa de texto a pessoa vê "@Maria Souza"; ao enviar, vira o código @[Maria Souza](u5),
// que o servidor usa para avisar e a tela usa para destacar.
//
// Mencoes.ligar(caixaDeTexto, idDoChamado)                     -> pessoas que podem abrir o chamado
// Mencoes.ligar(caixaDeTexto, { pessoas: async () => [...] })  -> pessoas de outra lista (chat)
// ---------------------------------------------------------------
const Mencoes = (() => {
  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // texto já escapado (esc) -> com @citações destacadas e #chamados como link
  function formatar(html) {
    return String(html || '')
      .replace(/@\[([^\]\n]{1,80})\]\(u(\d+)\)/g, (_, nome) => `<span class="mencao" title="Citação">@${nome}</span>`)
      .replace(/(^|[^&\w#])#(\d{1,7})\b/g, (_, antes, n) => `${antes}<a class="mencao-tk" href="#/tickets/${n}">#${n}</a>`);
  }

  // chamados para o painel do #
  const buscarChamados = (qs) => API.get(`/tickets?${qs}`).catch(() => []);
  const itemChamado = (t) => ({
    tipo: '#', id: t.id, nome: t.title, status: t.status,
    sub: [LABELS.status[t.status], t.location_name || t.entity_name, t.created_at ? fmt.timeAgo(t.created_at) : ''].filter(Boolean).join(' · '),
  });

  function ligar(input, opcoes) {
    const carregarPessoas = typeof opcoes === 'object' && opcoes && opcoes.pessoas
      ? opcoes.pessoas
      : () => API.get(`/tickets/${opcoes}/mencionaveis`);
    const caixa = document.createElement('div');
    caixa.className = 'mc-sug';
    caixa.setAttribute('role', 'listbox');
    input.parentElement.classList.add('mc-wrap');
    input.parentElement.appendChild(caixa);
    let pessoas = null;
    const escolhidos = new Map(); // nome -> id
    let itens = []; let ativo = 0; let token = null; let timer = null; let modo = null; let pedido = 0;
    let secoes = [];

    const fechar = () => { caixa.classList.remove('on', 'mc-tk'); caixa.innerHTML = ''; itens = []; token = null; modo = null; };
    const dentro = () => caixa.contains(document.activeElement) || document.activeElement === input;

    const linhaPessoa = (it, i) => `<div class="mc-it ${i === ativo ? 'on' : ''}" data-i="${i}" role="option">
      <span class="dp-avatar">${esc(it.nome.charAt(0).toUpperCase())}</span><span><b>${esc(it.nome)}</b><small>${esc(it.sub || '')}</small></span></div>`;
    const linhaChamado = (it, i) => `<div class="mc-it ${i === ativo ? 'on' : ''}" data-i="${i}" role="option">
      <span class="mc-num st-${it.status}">#${it.id}</span><span><b>${esc(it.nome)}</b><small>${esc(it.sub || '')}</small></span></div>`;

    // @: lista simples
    function pintarPessoas() {
      if (!itens.length) { fechar(); return; }
      caixa.classList.remove('mc-tk');
      caixa.innerHTML = itens.map(linhaPessoa).join('');
      caixa.classList.add('on');
    }

    // #: painel com busca e duas listas
    function pintarChamados(carregando) {
      caixa.classList.add('on', 'mc-tk');
      let busca = caixa.querySelector('.mc-busca');
      if (!busca) {
        caixa.innerHTML = `<div class="mc-cab"><i class="bi bi-search"></i>
          <input class="mc-busca" placeholder="Buscar pelo número, título ou descrição" autocomplete="off"></div><div class="mc-lista"></div>`;
        busca = caixa.querySelector('.mc-busca');
        busca.value = token ? token.termo : '';
        busca.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => carregarChamados(busca.value.trim()), 200); });
        busca.addEventListener('keydown', teclas);
        busca.addEventListener('blur', () => setTimeout(() => { if (!dentro()) fechar(); }, 150));
      }
      let i = 0;
      const lista = caixa.querySelector('.mc-lista');
      lista.innerHTML = carregando ? '<div class="mc-vazio">Procurando...</div>'
        : secoes.map((s) => `<div class="mc-sec">${esc(s.titulo)}</div>${s.itens.length
          ? s.itens.map((it) => linhaChamado(it, i++)).join('') : '<div class="mc-vazio">Nenhum chamado.</div>'}`).join('');
      lista.querySelector('.mc-it.on')?.scrollIntoView({ block: 'nearest' });
    }
    async function carregarChamados(termo) {
      const meu = ++pedido;
      pintarChamados(true);
      if (termo) {
        const r = await buscarChamados(`status=all&sort=number&limit=20&q=${encodeURIComponent(termo)}`);
        if (meu !== pedido || modo !== '#') return;
        secoes = [{ titulo: `Resultados para "${termo}"`, itens: r.map(itemChamado) }];
      } else {
        const [abertos, todos] = await Promise.all([
          buscarChamados('status=open&sort=number&limit=8'),
          buscarChamados('status=all&sort=number&limit=30'),
        ]);
        if (meu !== pedido || modo !== '#') return;
        secoes = [
          { titulo: 'Em aberto agora', itens: abertos.map(itemChamado) },
          { titulo: 'Todos, em ordem de número', itens: todos.map(itemChamado) },
        ];
      }
      itens = secoes.flatMap((s) => s.itens);
      ativo = 0;
      pintarChamados(false);
    }

    const tokenAtual = () => {
      const pos = input.selectionStart;
      const antes = input.value.slice(0, pos);
      const m = antes.match(/(^|\s)([@#])([^\s@#]{0,30})$/);
      return m ? { tipo: m[2], termo: m[3], ini: pos - m[3].length - 1, fim: pos } : null;
    };
    async function sugerir() {
      const t = tokenAtual();
      if (!t) { if (modo) fechar(); return; }
      token = t;
      const termo = semAcento(t.termo);
      if (t.tipo === '@') {
        modo = '@';
        if (!pessoas) { try { pessoas = await carregarPessoas(); } catch { pessoas = []; } }
        itens = pessoas.filter((p) => !termo || semAcento(p.name).split(/\s+/).some((w) => w.startsWith(termo)) || semAcento(p.name).includes(termo))
          .slice(0, 8).map((p) => ({ tipo: '@', id: p.id, nome: p.name, sub: [p.papel, p.location_name || p.entity_name].filter(Boolean).join(' · ') }));
        ativo = 0; pintarPessoas();
        return;
      }
      const novo = modo !== '#';
      if (novo) caixa.innerHTML = '';
      modo = '#';
      const busca = caixa.querySelector('.mc-busca');
      if (busca) busca.value = t.termo;
      clearTimeout(timer);
      if (novo) carregarChamados(t.termo);
      else timer = setTimeout(() => carregarChamados(t.termo), 200);
    }
    function escolher(it) {
      if (!it || !token) return;
      const texto = it.tipo === '@' ? `@${it.nome} ` : `#${it.id} `;
      if (it.tipo === '@') escolhidos.set(it.nome, it.id);
      const t = token;
      input.value = input.value.slice(0, t.ini) + texto + input.value.slice(t.fim);
      const pos = t.ini + texto.length;
      fechar();
      input.focus();
      input.setSelectionRange(pos, pos);
    }
    function teclas(e) {
      if (!caixa.classList.contains('on')) return;
      const repintar = () => (modo === '#' ? pintarChamados(false) : pintarPessoas());
      if (e.key === 'ArrowDown') { e.preventDefault(); if (itens.length) { ativo = (ativo + 1) % itens.length; repintar(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (itens.length) { ativo = (ativo - 1 + itens.length) % itens.length; repintar(); } }
      else if ((e.key === 'Enter' || e.key === 'Tab') && itens.length) { e.preventDefault(); e.stopImmediatePropagation(); escolher(itens[ativo]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fechar(); input.focus(); }
    }
    input.addEventListener('input', sugerir);
    input.addEventListener('click', sugerir);
    input.addEventListener('keydown', teclas);
    caixa.addEventListener('mousedown', (e) => {
      const el = e.target.closest('[data-i]');
      if (el) { e.preventDefault(); escolher(itens[Number(el.dataset.i)]); }
    });
    input.addEventListener('blur', () => setTimeout(() => { if (!dentro()) fechar(); }, 150));

    return {
      // antes de enviar: "@Maria Souza" escolhido vira @[Maria Souza](u5)
      preparar(texto) {
        let out = texto;
        [...escolhidos.entries()].sort((a, b) => b[0].length - a[0].length).forEach(([nome, id]) => {
          out = out.split(`@${nome}`).join(`@[${nome}](u${id})`);
        });
        return out;
      },
      limpar() { escolhidos.clear(); fechar(); },
      // botões @ e # ao lado da caixa: escreve o sinal e abre a lista
      abrir(sinal) {
        const pos = input.selectionStart ?? input.value.length;
        const antes = input.value.slice(0, pos);
        const precisaEspaco = antes && !/\s$/.test(antes);
        input.value = `${antes}${precisaEspaco ? ' ' : ''}${sinal}${input.value.slice(pos)}`;
        const p = pos + (precisaEspaco ? 2 : 1);
        input.focus();
        input.setSelectionRange(p, p);
        sugerir();
      },
      // a lista de pessoas mudou (ex.: entrou alguém no grupo)
      recarregarPessoas() { pessoas = null; },
    };
  }

  return { formatar, ligar };
})();
window.Mencoes = Mencoes;
