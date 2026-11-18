// Utilidades compartilhadas do Painel Beija-Flor.
const { query } = require('../db');

// Handler assíncrono -> erro vira resposta 500 em vez de derrubar o processo
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const STATUS_CENTRAL = {
  1: 'Novo', 2: 'Atribuído', 3: 'Em andamento', 4: 'Pendente',
  5: 'Resolvido', 6: 'Fechado', 7: 'Cancelado',
};
// Urgência do chamado (mesmos nomes da Orcim); a chave é a prioridade interna
const PRIORIDADE_CENTRAL = { 1: 'Requisição', 2: 'Operação prejudicada', 3: 'Parada iminente', 4: 'Operação parada' };

const STATUS_TAREFA = {
  a_fazer: 'A fazer', em_andamento: 'Em andamento', aguardando: 'Aguardando',
  concluida: 'Concluída', cancelada: 'Cancelada',
};
const PRIORIDADE_TAREFA = { 1: 'Baixa', 2: 'Normal', 3: 'Alta', 4: 'Urgente' };

async function getSetting(key, fallback = null) {
  const { rows } = await query('SELECT value FROM gbf_settings WHERE key = $1', [key]);
  return rows.length ? rows[0].value : fallback;
}

async function setSetting(key, value) {
  await query(
    `INSERT INTO gbf_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]);
}

// Empresas (entities da Central) acompanhadas pelo painel. Lista vazia = todas.
async function entidadesAcompanhadas() {
  const v = await getSetting('entidades', []);
  return Array.isArray(v) ? v.map(Number).filter(Boolean) : [];
}

// Fragmento SQL de escopo para a tabela tickets com alias "t"
async function escopoTickets(params) {
  const ids = await entidadesAcompanhadas();
  if (!ids.length) return 'TRUE';
  params.push(ids);
  return `t.entity_id = ANY($${params.length}::bigint[])`;
}

async function tabelaExiste(nome) {
  const { rows } = await query('SELECT to_regclass($1) AS t', [`public.${nome}`]);
  return !!rows[0].t;
}

async function notificar(userIds, { kind, title, message = null, link = null }) {
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  for (const id of ids) {
    await query(
      `INSERT INTO gbf_notifications (user_id, kind, title, message, link)
       VALUES ($1, $2, $3, $4, $5)`, [id, kind, title, message, link]);
  }
}

async function usuariosAtivos(role = null) {
  const { rows } = await query(
    `SELECT id FROM gbf_users WHERE active = TRUE ${role ? 'AND role = $1' : ''}`,
    role ? [role] : []);
  return rows.map((r) => r.id);
}

module.exports = {
  ah, STATUS_CENTRAL, PRIORIDADE_CENTRAL, STATUS_TAREFA, PRIORIDADE_TAREFA,
  getSetting, setSetting, entidadesAcompanhadas, escopoTickets, tabelaExiste,
  notificar, usuariosAtivos,
};
