// ---------------------------------------------------------------
// Item do inventário em qualquer tela: categoria, estados e o título com selos
//   Item.titulo(a) = ícone da categoria + nome + selos:
//     [estado] [local (link)] [etiqueta da ORCIM ou ×quantidade] [etapa do pedido (link para o chamado)]
//   Aceita os nomes de campo das várias APIs (id/asset_id, name/asset_name, type/asset_type...).
//   Os selos com link usam data-href (funcionam até dentro de uma linha que já é um <a>).
// ---------------------------------------------------------------

const INV_TYPES = {
  COMPUTER: 'Computador', NOTEBOOK: 'Notebook', SERVER: 'Servidor',
  PRINTER: 'Impressora', MONITOR: 'Monitor', UPS: 'Nobreak',
  NETWORK_DEVICE: 'Rede', MOBILE_DEVICE: 'Celular / tablet', PERIPHERAL: 'Periférico / acessório', OTHER: 'Outro',
};
// Estados do equipamento (cada um com a sua cor: classe .est-<ESTADO> no CSS)
const INV_STATUS = {
  OPERATING: 'Operando', REPAIR: 'Em conserto', BROKEN: 'Estragado', ORDERED: 'Comprado - aguardando chegar',
  READY: 'Pronto para entregar', STOCK: 'Em estoque', DISPOSED: 'Descartado', LOST: 'Extraviado',
};
// Nome curto do estado, para o selo ao lado do título
const INV_STATUS_CURTO = {
  OPERATING: 'Operando', REPAIR: 'Em conserto', BROKEN: 'Estragado', ORDERED: 'Aguardando chegar',
  READY: 'Pronto p/ entregar', STOCK: 'Em estoque', DISPOSED: 'Descartado', LOST: 'Extraviado',
};
const INV_ESTADO_ICONE = {
  OPERATING: 'bi-check-circle', REPAIR: 'bi-tools', BROKEN: 'bi-x-octagon', ORDERED: 'bi-truck',
  READY: 'bi-box-arrow-right', STOCK: 'bi-box-seam', DISPOSED: 'bi-trash3', LOST: 'bi-question-octagon',
};
// Ícone de cada categoria de equipamento
const INV_ICONES = {
  COMPUTER: 'bi-pc-display', NOTEBOOK: 'bi-laptop', SERVER: 'bi-hdd-rack', PRINTER: 'bi-printer',
  MONITOR: 'bi-display', UPS: 'bi-battery-charging', NETWORK_DEVICE: 'bi-router', MOBILE_DEVICE: 'bi-phone',
  PERIPHERAL: 'bi-mouse2', OTHER: 'bi-box',
};
const invEstado = (s) => `<span class="est est-${esc(s)}">${esc(INV_STATUS[s] || s)}</span>`;
window.INV_ICONES = INV_ICONES; window.invEstado = invEstado;

const Item = {
  campo(a, ...nomes) { for (const n of nomes) if (a[n] !== undefined && a[n] !== null && a[n] !== '') return a[n]; return null; },
  icone: (tipo) => INV_ICONES[tipo] || 'bi-box',
  tipoNome: (tipo) => INV_TYPES[tipo] || 'Item',

  // Para onde vai o link do local: o inventário filtrado no posto (ou o Estoque de T.I. do posto);
  //   item sem empresa = Estoque da ORCIM
  linkLocal(a) {
    const u = API.user || {};
    const can = (p) => Roles.can(u, p);
    if (a.entity_id === null && !a.location_id) {
      return (can('inventory.manage') && (Roles.isMaster(u) || can('ticket.view_all'))) ? '#/orcim' : null;
    }
    const loc = Item.campo(a, 'location_id', 'asset_location_id');
    if (!loc) return null;
    const estoque = ['STOCK', 'READY', 'ORDERED'].includes(Item.campo(a, 'status', 'asset_status'));
    if (estoque && can('stock.withdraw')) return `#/estoque?local=${loc}`;
    if (can('inventory.view')) return `#/inventory?local=${loc}`;
    if (can('stock.withdraw')) return `#/estoque?local=${loc}`;
    return null;
  },

  link(href, html, titulo, classe) {
    return href
      ? `<span class="${classe} it-link" role="link" tabindex="0" data-href="${esc(href)}" title="${esc(titulo)}">${html}</span>`
      : `<span class="${classe}" title="${esc(titulo)}">${html}</span>`;
  },

  // Só os selos (sem ícone e nome). op: { estado, local, etiqueta, etapa, semEtiqueta }
  tags(a, op = {}) {
    const o = { estado: true, local: true, etiqueta: true, etapa: true, semEtiqueta: false, ...op };
    const st = Item.campo(a, 'status', 'asset_status');
    const partes = [];
    if (o.estado && st) {
      partes.push(`<span class="est est-${esc(st)} it-est" title="Estado: ${esc(INV_STATUS[st] || st)}"><i class="bi ${INV_ESTADO_ICONE[st] || 'bi-dot'}"></i>${esc(INV_STATUS_CURTO[st] || st)}</span>`);
    }
    if (o.local) {
      const orcim = a.entity_id === null && !a.location_id;
      const nome = orcim ? 'Estoque da ORCIM' : Item.campo(a, 'location_name', 'asset_location_name', 'posto');
      if (nome) {
        const empresa = Item.campo(a, 'entity_name', 'empresa');
        partes.push(Item.link(Item.linkLocal(a), `<i class="bi ${orcim ? 'bi-boxes' : 'bi-geo-alt-fill'}"></i>${esc(nome)}`,
          orcim ? 'Abrir o Estoque da ORCIM' : `Ver os itens de ${nome}${empresa ? ` (${empresa})` : ''}`, `it-chip it-local${orcim ? ' it-orcim' : ''}`));
      }
    }
    if (o.etiqueta) {
      const qtd = a.controle === 'quantidade';
      const tag = Item.campo(a, 'asset_tag');
      if (qtd && a.quantity !== undefined && a.quantity !== null) {
        partes.push(`<span class="it-chip it-qtd ${Number(a.quantity) > 0 ? '' : 'zero'}" title="Sem etiqueta: contado por quantidade"><i class="bi bi-stack"></i>×${Number(a.quantity) || 0}</span>`);
      } else if (tag) {
        partes.push(`<span class="it-chip it-etq" title="Etiqueta da ORCIM"><i class="bi bi-upc"></i>${esc(tag)}</span>`);
      } else if (o.semEtiqueta && !qtd) {
        partes.push('<span class="it-chip it-sem" title="Ainda sem a etiqueta da ORCIM"><i class="bi bi-upc"></i>sem etiqueta</span>');
      }
    }
    if (o.etapa) {
      const etapa = Item.campo(a, 'pedido_status');
      if (etapa && PEDIDO_STATUS[etapa]) {
        const tk = Item.campo(a, 'pedido_ticket_id');
        const [nome, ic] = PEDIDO_STATUS[etapa];
        partes.push(Item.link(tk ? `#/tickets/${tk}` : null, `<i class="bi ${ic}"></i>${esc(nome)}${tk ? ` · #${esc(tk)}` : ''}`,
          tk ? `Pedido do chamado #${tk}: ${nome}` : `Pedido: ${nome}`, `pd-tag pd-${esc(etapa)} it-etapa`));
      }
    }
    return partes.length ? `<span class="it-tags">${partes.join('')}</span>` : '';
  },

  // Ícone + nome (com link para a ficha, se op.link) + selos
  titulo(a, op = {}) {
    const o = { link: true, ...op };
    const id = Item.campo(a, 'asset_id', 'id');
    const tipo = Item.campo(a, 'type', 'asset_type');
    const nome = op.nome !== undefined ? op.nome : Item.campo(a, 'asset_name', 'name') || 'Item';
    const podeAbrir = o.link && id && Roles.can(API.user || {}, 'inventory.view');
    const nomeHtml = podeAbrir
      ? Item.link(`#/inventory/${id}`, esc(nome), 'Abrir a ficha do item', 'it-nome')
      : `<b class="it-nome">${esc(nome)}</b>`;
    return `<span class="it-tit"><span class="it-ico" title="${esc(Item.tipoNome(tipo))}"><i class="bi ${Item.icone(tipo)}"></i></span>
      <span class="it-corpo">${nomeHtml}${o.depois || ''}${Item.tags(a, o)}</span></span>`;
  },
};
window.Item = Item;

// Selos com link (data-href): navegam sem disparar o link da linha em volta
document.addEventListener('click', (ev) => {
  const alvo = ev.target.closest && ev.target.closest('[data-href]');
  if (!alvo) return;
  ev.preventDefault(); ev.stopPropagation();
  location.hash = alvo.dataset.href;
}, true);
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const alvo = ev.target.closest && ev.target.closest('[data-href]');
  if (!alvo) return;
  ev.preventDefault(); ev.stopPropagation();
  location.hash = alvo.dataset.href;
}, true);
