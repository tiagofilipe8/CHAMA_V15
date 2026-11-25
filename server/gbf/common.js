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
// Atividades e solicitações usam a mesma escala de urgência dos chamados
const PRIORIDADE_TAREFA = PRIORIDADE_CENTRAL;

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

// Avisa a equipe (gestores e técnicos ativos) e quem mais vier em "extras", menos quem fez a ação.
// "excluir": ids que já receberam um aviso mais específico.
async function avisarEquipe(ator, aviso, { extras = [], excluir = [] } = {}) {
  const fora = new Set([ator && ator.id, ...excluir].filter(Boolean).map(String));
  const ids = [...await usuariosAtivos('gestor'), ...await usuariosAtivos('tecnico'), ...extras]
    .filter((id) => id && !fora.has(String(id)));
  await notificar(ids, aviso);
}

// Atividade reagendada, concluída ou cancelada: os avisos antigos de "atrasada" / "vence em breve"
// dela deixam de valer (ficam como lidos; a tela mostra que não estão mais atrasados).
async function limparAvisosPrazo(taskId) {
  await query(`UPDATE gbf_notifications SET is_read = TRUE
               WHERE kind IN ('atividade_atrasada','atividade_prazo') AND link = $1 AND is_read = FALSE`, [`#/atividades/${taskId}`]);
}

// "tecnico" inclui os gestores que também fazem visitas
// Prazo de atividade a partir de data + horário opcional (fuso de São Paulo, UTC-3, sem horário de verão).
// Sem horário = o dia todo: vence às 23:59:59 do dia. Devolve undefined se não veio due_date.
function prazoDe(b) {
  if (!b || b.due_date === undefined) return undefined;
  if (!b.due_date) return { due_at: null, all_day: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.due_date))) return { erro: 'Data do prazo inválida.' };
  const hora = /^\d{2}:\d{2}$/.test(String(b.due_time || '')) ? b.due_time : null;
  const due = new Date(`${b.due_date}T${hora ? `${hora}:00` : '23:59:59'}-03:00`);
  if (Number.isNaN(due.getTime())) return { erro: 'Prazo inválido.' };
  return { due_at: due.toISOString(), all_day: !hora };
}
const textoPrazo = (dueAt, allDay) => {
  const d = new Date(dueAt);
  return allDay
    ? `${d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}, o dia todo`
    : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

async function usuariosAtivos(role = null) {
  let filtro = '';
  if (role === 'tecnico') filtro = "AND (role = 'tecnico' OR (role = 'gestor' AND faz_visitas))";
  else if (role) filtro = 'AND role = $1';
  const { rows } = await query(
    `SELECT id FROM gbf_users WHERE active = TRUE ${filtro}`,
    role && role !== 'tecnico' ? [role] : []);
  return rows.map((r) => r.id);
}

module.exports = {
  ah, STATUS_CENTRAL, PRIORIDADE_CENTRAL, STATUS_TAREFA, PRIORIDADE_TAREFA, prazoDe, textoPrazo, avisarEquipe, limparAvisosPrazo,
  getSetting, setSetting, entidadesAcompanhadas, escopoTickets, tabelaExiste,
  notificar, usuariosAtivos,
};
