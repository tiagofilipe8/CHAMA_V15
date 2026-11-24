// ---------------------------------------------------------------------
// Catalogo de permissoes por perfil
//   O Administrador Mestre (role 'admin') sempre tem todas.
//   Os demais perfis tem as permissoes marcadas em "Perfis e permissoes"
//   (tabela role_permissions). Os padroes abaixo reproduzem o comportamento
//   que o sistema ja tinha antes da tela existir.
// ---------------------------------------------------------------------

// Perfis configuraveis (chave usada na tabela role_permissions)
const ROLE_KEYS = [
  { key: 'moderator', label: 'Moderador', role: 'moderator' },
  { key: 'technician', label: 'Técnico', role: 'technician' },
  { key: 'manager', label: 'Gestor', role: 'client', client_level: 2 },
  { key: 'user', label: 'Usuário', role: 'client', client_level: 1 },
];

// Agrupadas pelo que a pessoa faz. 'help' aparece em letra pequena embaixo, na tela.
const PERMISSIONS = [
  // O que a pessoa enxerga
  { key: 'ticket.view_company', group: 'Ver chamados', label: 'Chamados da própria empresa', help: 'Todos os chamados da empresa dela (e das que acompanha), não só os que ela abriu.' },
  { key: 'ticket.view_all', group: 'Ver chamados', label: 'Chamados de todas as empresas', help: 'Para a equipe de TI.' },
  { key: 'ticket.internal', group: 'Ver chamados', label: 'Notas internas', help: 'Ver e escrever recados que o solicitante não vê.' },
  { key: 'ticket.rating', group: 'Ver chamados', label: 'Causa e nota do encerramento', help: 'O que causou o problema e a nota dada ao usuário.' },
  // Quem pede
  { key: 'ticket.create', group: 'Pedir', label: 'Abrir chamados' },
  { key: 'ticket.cancel', group: 'Pedir', label: 'Cancelar e reabrir os próprios chamados' },
  { key: 'ticket.approve', group: 'Pedir', label: 'Aprovar ou reprovar a solução', help: 'Quando o técnico pede aprovação antes de fechar.' },
  // Quem atende
  { key: 'ticket.take', group: 'Atender', label: 'Assumir chamados sem técnico' },
  { key: 'ticket.work', group: 'Atender', label: 'Atender os chamados que estão com ele', help: 'Mudar a situação, editar, marcar "Em atendimento" e registrar a solução.' },
  { key: 'ticket.status_any', group: 'Atender', label: 'Mudar a situação de qualquer chamado que vê' },
  { key: 'ticket.resolve_direct', group: 'Atender', label: 'Resolver sem pedir aprovação ao solicitante' },
  // Quem coordena
  { key: 'ticket.triage', group: 'Coordenar', label: 'Triagem', help: 'Ajustar categoria, urgência, local, previsão e equipamento.' },
  { key: 'ticket.assign', group: 'Coordenar', label: 'Escolher ou trocar o técnico' },
  { key: 'ticket.manager_note', group: 'Coordenar', label: 'Instruções de gestor', help: 'Mensagem destacada para a equipe dentro do chamado.' },
  // Painel e equipamentos
  { key: 'dashboard.view', group: 'Painel e equipamentos', label: 'Ver o painel' },
  { key: 'inventory.view', group: 'Painel e equipamentos', label: 'Ver o inventário' },
  { key: 'inventory.manage', group: 'Painel e equipamentos', label: 'Cadastrar e editar equipamentos', help: 'Inclui devolver itens ao estoque e transferir de unidade.' },
  { key: 'inventory.secrets', group: 'Painel e equipamentos', label: 'Ver preço e senhas dos equipamentos', help: 'Preço, senha do AnyDesk e acesso mestre da Orcim. Quem vê uma senha fica registrado no histórico.' },
  // Estoque de T.I.
  { key: 'stock.withdraw', group: 'Estoque de T.I.', label: 'Ver o estoque e dar baixa nos itens', help: 'Pegar um item do estoque do posto, dizendo o motivo. Fica registrado no histórico do item.' },
  { key: 'stock.report', group: 'Estoque de T.I.', label: 'Relatório de estoque e custos', help: 'Movimentações por motivo, custo dos equipamentos e das retiradas.' },
  // Cadastros da própria empresa
  { key: 'users.manage', group: 'Cadastros da empresa', label: 'Usuários' },
  { key: 'locations.manage', group: 'Cadastros da empresa', label: 'Localizações' },
  { key: 'materials.manage', group: 'Cadastros da empresa', label: 'Lista de materiais', help: 'Itens que podem ser pedidos no chamado "Pedido de material".' },
];

// Permissões que só funcionam junto com outra. Ao salvar (e na tela) a dependência é ajustada:
//   marcar a de cima marca a que ela precisa; desmarcar a necessária desmarca as que dependem dela.
//   "ver chamados": precisa de uma das duas (da própria empresa OU de todas as empresas).
const VER_CHAMADOS = ['ticket.view_company', 'ticket.view_all'];
const DEPENDENCIAS = {
  'ticket.triage': VER_CHAMADOS,
  'ticket.assign': VER_CHAMADOS,
  'ticket.status_any': VER_CHAMADOS,
  'ticket.manager_note': VER_CHAMADOS,
  'ticket.take': VER_CHAMADOS,
  'ticket.resolve_direct': ['ticket.status_any', 'ticket.work'],
  'inventory.manage': ['inventory.view'],
  'inventory.secrets': ['inventory.view'],
};

// Corrige uma linha da matriz ({ perm: bool }): marca a dependência que faltar
// (a primeira da lista) e devolve o que mudou, para avisar na tela.
function normalizarPerfil(perms) {
  const ajustes = [];
  Object.entries(DEPENDENCIAS).forEach(([perm, precisa]) => {
    if (perms[perm] && !precisa.some((k) => perms[k])) {
      perms[precisa[0]] = true;
      ajustes.push({ perm, marcou: precisa[0] });
    }
  });
  return ajustes;
}

// Somente o Administrador Mestre (nao aparecem como caixas de selecao)
const MASTER_ONLY = [
  'Gerenciar empresas',
  'Gerenciar categorias, urgências e causas',
  'Configurações do sistema (e-mail, WhatsApp, backup)',
  'Editar perfis e permissões',
  'Visualização de cargos',
];

const DEFAULTS = {
  moderator: [
    'ticket.create', 'ticket.view_all', 'ticket.triage', 'ticket.assign',
    'ticket.status_any', 'ticket.resolve_direct', 'ticket.cancel', 'ticket.internal', 'ticket.rating',
    'dashboard.view', 'inventory.view', 'inventory.manage', 'stock.withdraw',
  ],
  technician: [
    'ticket.create', 'ticket.view_all', 'ticket.take', 'ticket.work', 'ticket.cancel',
    'ticket.internal', 'ticket.rating', 'dashboard.view', 'inventory.view', 'inventory.manage',
    'inventory.secrets', 'stock.withdraw',
  ],
  // Gestor = chefe da empresa cliente (absorveu o antigo Administrador Local)
  manager: [
    'ticket.create', 'ticket.view_company', 'ticket.triage', 'ticket.assign',
    'ticket.status_any', 'ticket.resolve_direct', 'ticket.approve', 'ticket.cancel', 'ticket.manager_note',
    'ticket.rating', 'dashboard.view', 'inventory.view', 'inventory.manage', 'users.manage',
    'locations.manage', 'materials.manage', 'inventory.secrets', 'stock.withdraw', 'stock.report',
  ],
  user: ['ticket.create', 'ticket.approve', 'ticket.cancel', 'stock.withdraw'],
};

const ALL_KEYS = PERMISSIONS.map((p) => p.key);

function roleKeyOf(user) {
  if (!user) return null;
  if (user.role === 'client') return Number(user.client_level) === 2 ? 'manager' : 'user';
  return user.role;
}

module.exports = { ROLE_KEYS, PERMISSIONS, MASTER_ONLY, DEFAULTS, ALL_KEYS, roleKeyOf, DEPENDENCIAS, normalizarPerfil };
