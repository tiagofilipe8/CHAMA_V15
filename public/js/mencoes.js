// ---------------------------------------------------------------
// Citações na conversa do chamado
//   @ -> lista de pessoas que podem abrir o chamado; quem é citado recebe um aviso
//   # -> lista de chamados; vira um link (#16)
// Na caixa de texto a pessoa vê "@Maria Souza"; ao enviar, vira o código @[Maria Souza](u5),
// que o servidor usa para avisar e a tela usa para destacar.
// ---------------------------------------------------------------
const Mencoes = (() => {
  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // texto já escapado (esc) -> com @citações destacadas e #chamados como link
  function formatar(html) {
    return String(html || '')
      .replace(/@\[([^\]\n]{1,80})\]\(u(\d+)\)/g, (_, nome) => `<span class="mencao" title="Citação">@${nome}</span>`)
      .replace(/(^|[^&\w#])#(\d{1,7})\b/g, (_, antes, n) => `${antes}<a class="mencao-tk" href="#/tickets/${n}">#${n}</a>`);
  }

  // liga a caixa de texto: sugestões ao digitar @ ou #
  function ligar(input, ticketId) {
    const caixa = document.createElement('div');
    caixa.className = 'mc-sug';
    caixa.setAttribute('role', 'listbox');
    input.parentElement.classList.add('mc-wrap');
    input.parentElement.appendChild(caixa);
    let pessoas = null;
    const escolhidos = new Map(); // nome -> id
    let itens = []; let ativo = 0; let token = null; let timer = null;

    const fechar = () => { caixa.classList.remove('on'); itens = []; token = null; };
    const pintar = () => {
      if (!itens.length) { fechar(); return; }
      caixa.innerHTML = itens.map((it, i) => `<div class="mc-it ${i === ativo ? 'on' : ''}" data-i="${i}" role="option">
        ${it.tipo === '@' ? `<span class="dp-avatar">${esc(it.nome.charAt(0).toUpperCase())}</span><span><b>${esc(it.nome)}</b><small>${esc(it.sub || '')}</small></span>`
    : `<span class="mc-num">#${it.id}</span><span><b>${esc(it.nome)}</b><small>${esc(it.sub || '')}</small></span>`}</div>`).join('');
      caixa.classList.add('on');
    };
    const tokenAtual = () => {
      const pos = input.selectionStart;
      const antes = input.value.slice(0, pos);
      const m = antes.match(/(^|\s)([@#])([^\s@#]{0,30})$/);
      return m ? { tipo: m[2], termo: m[3], ini: pos - m[3].length - 1, fim: pos } : null;
    };
    async function sugerir() {
      token = tokenAtual();
      if (!token) { fechar(); return; }
      const termo = semAcento(token.termo);
      if (token.tipo === '@') {
        if (!pessoas) {
          try { pessoas = await API.get(`/tickets/${ticketId}/mencionaveis`); } catch { pessoas = []; }
        }
        itens = pessoas.filter((p) => !termo || semAcento(p.name).split(/\s+/).some((w) => w.startsWith(termo)) || semAcento(p.name).includes(termo))
          .slice(0, 6).map((p) => ({ tipo: '@', id: p.id, nome: p.name, sub: [p.papel, p.location_name].filter(Boolean).join(' · ') }));
      } else {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          let lista = [];
          try { lista = await API.get(`/tickets?status=all&limit=6${termo ? `&q=${encodeURIComponent(token ? token.termo : '')}` : ''}`); } catch { lista = []; }
          if (!token || token.tipo !== '#') return;
          itens = lista.slice(0, 6).map((t) => ({ tipo: '#', id: t.id, nome: t.title, sub: `${LABELS.status[t.status] || ''}${t.location_name ? ` · ${t.location_name}` : ''}` }));
          ativo = 0; pintar();
        }, 180);
        return;
      }
      ativo = 0; pintar();
    }
    function escolher(it) {
      if (!it || !token) return;
      const texto = it.tipo === '@' ? `@${it.nome} ` : `#${it.id} `;
      if (it.tipo === '@') escolhidos.set(it.nome, it.id);
      input.value = input.value.slice(0, token.ini) + texto + input.value.slice(token.fim);
      const pos = token.ini + texto.length;
      input.setSelectionRange(pos, pos);
      fechar();
      input.focus();
    }
    input.addEventListener('input', sugerir);
    input.addEventListener('click', sugerir);
    input.addEventListener('keydown', (e) => {
      if (!caixa.classList.contains('on')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); ativo = (ativo + 1) % itens.length; pintar(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); ativo = (ativo - 1 + itens.length) % itens.length; pintar(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); escolher(itens[ativo]); }
      else if (e.key === 'Escape') { e.preventDefault(); fechar(); }
    });
    caixa.addEventListener('mousedown', (e) => {
      const el = e.target.closest('[data-i]');
      if (el) { e.preventDefault(); escolher(itens[Number(el.dataset.i)]); }
    });
    input.addEventListener('blur', () => setTimeout(fechar, 150));

    // antes de enviar: "@Maria Souza" escolhido vira @[Maria Souza](u5)
    return {
      preparar(texto) {
        let out = texto;
        [...escolhidos.entries()].sort((a, b) => b[0].length - a[0].length).forEach(([nome, id]) => {
          out = out.split(`@${nome}`).join(`@[${nome}](u${id})`);
        });
        return out;
      },
      limpar() { escolhidos.clear(); fechar(); },
    };
  }

  return { formatar, ligar };
})();
window.Mencoes = Mencoes;
