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

const PERMISSIONS = [
  // Chamados
  { key: 'ticket.create', group: 'Chamados', label: 'Abrir chamados' },
  { key: 'ticket.view_company', group: 'Chamados', label: 'Ver todos os chamados da própria empresa (e das que acompanha)' },
  { key: 'ticket.view_all', group: 'Chamados', label: 'Ver chamados de todas as empresas' },
  { key: 'ticket.triage', group: 'Chamados', label: 'Fazer triagem: categoria, urgência, localidade, previsão e equipamento' },
  { key: 'ticket.assign', group: 'Chamados', label: 'Atribuir ou trocar o técnico' },
  { key: 'ticket.take', group: 'Chamados', label: 'Assumir chamados sem técnico' },
  { key: 'ticket.watchers', group: 'Chamados', label: 'Adicionar e remover observadores' },
  { key: 'ticket.work', group: 'Chamados', label: 'Atender os chamados atribuídos a si (status, edição, solução)' },
  { key: 'ticket.status_any', group: 'Chamados', label: 'Mudar o status de qualquer chamado que vê' },
  { key: 'ticket.resolve_direct', group: 'Chamados', label: 'Resolver sem precisar da aprovação do solicitante' },
  { key: 'ticket.approve', group: 'Chamados', label: 'Aprovar ou reprovar a solução' },
  { key: 'ticket.cancel', group: 'Chamados', label: 'Cancelar e reabrir os próprios chamados' },
  { key: 'ticket.manager_note', group: 'Chamados', label: 'Enviar instruções para a equipe (destaque de gestor)' },
  { key: 'ticket.internal', group: 'Chamados', label: 'Ver e escrever notas internas' },
  { key: 'ticket.rating', group: 'Chamados', label: 'Ver a causa e a nota do encerramento' },
  // Painel e inventario
  { key: 'dashboard.view', group: 'Painel e inventário', label: 'Ver o painel' },
  { key: 'inventory.view', group: 'Painel e inventário', label: 'Ver o inventário de equipamentos' },
  { key: 'inventory.manage', group: 'Painel e inventário', label: 'Cadastrar e editar equipamentos' },
  // Administracao
  { key: 'users.manage', group: 'Administração', label: 'Gerenciar usuários da própria empresa' },
  { key: 'locations.manage', group: 'Administração', label: 'Gerenciar localizações da própria empresa' },
  { key: 'materials.manage', group: 'Administração', label: 'Editar a lista de materiais (chamado "Pedido de material")' },
];

// Permissões que só funcionam junto com outra. Ao salvar (e na tela) a dependência é ajustada:
//   marcar a de cima marca a que ela precisa; desmarcar a necessária desmarca as que dependem dela.
//   "ver chamados": precisa de uma das duas (da própria empresa OU de todas as empresas).
const VER_CHAMADOS = ['ticket.view_company', 'ticket.view_all'];
const DEPENDENCIAS = {
  'ticket.triage': VER_CHAMADOS,
  'ticket.assign': VER_CHAMADOS,
  'ticket.watchers': VER_CHAMADOS,
  'ticket.status_any': VER_CHAMADOS,
  'ticket.manager_note': VER_CHAMADOS,
  'ticket.take': VER_CHAMADOS,
  'ticket.resolve_direct': ['ticket.status_any', 'ticket.work'],
  'inventory.manage': ['inventory.view'],
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
    'ticket.create', 'ticket.view_all', 'ticket.triage', 'ticket.assign', 'ticket.watchers',
    'ticket.status_any', 'ticket.resolve_direct', 'ticket.cancel', 'ticket.internal', 'ticket.rating',
    'dashboard.view', 'inventory.view', 'inventory.manage',
  ],
  technician: [
    'ticket.create', 'ticket.view_all', 'ticket.take', 'ticket.work', 'ticket.cancel',
    'ticket.internal', 'ticket.rating', 'dashboard.view', 'inventory.view', 'inventory.manage',
  ],
  // Gestor = chefe da empresa cliente (absorveu o antigo Administrador Local)
  manager: [
    'ticket.create', 'ticket.view_company', 'ticket.triage', 'ticket.assign', 'ticket.watchers',
    'ticket.status_any', 'ticket.resolve_direct', 'ticket.approve', 'ticket.cancel', 'ticket.manager_note',
    'ticket.rating', 'dashboard.view', 'inventory.view', 'inventory.manage', 'users.manage',
    'locations.manage', 'materials.manage',
  ],
  user: ['ticket.create', 'ticket.approve', 'ticket.cancel'],
};

const ALL_KEYS = PERMISSIONS.map((p) => p.key);

function roleKeyOf(user) {
  if (!user) return null;
  if (user.role === 'client') return Number(user.client_level) === 2 ? 'manager' : 'user';
  return user.role;
}

module.exports = { ROLE_KEYS, PERMISSIONS, MASTER_ONLY, DEFAULTS, ALL_KEYS, roleKeyOf, DEPENDENCIAS, normalizarPerfil };
