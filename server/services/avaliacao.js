// ---------------------------------------------------------------------
// Nota do usuário no encerramento: checklist de 5 itens, cada "sim" vale 1 estrela (0 a 5)
//   O sistema pré-marca o que dá para saber pelo próprio chamado (descrição, anexos,
//   tempo de resposta, aprovação, chamado repetido). O técnico confirma ou corrige.
// ---------------------------------------------------------------------
const { query } = require('../db');

const CRITERIOS = [
  { key: 'clara', label: 'Explicou o problema de forma clara',
    sim: 'Disse o que acontece, onde e desde quando, ou mandou foto.', nao: 'Só "não funciona", sem detalhes.' },
  { key: 'disponivel', label: 'Estava disponível e respondeu',
    sim: 'Respondeu às mensagens e estava no local combinado.', nao: 'Sumiu, demorou muito ou não estava no local.' },
  { key: 'orientacoes', label: 'Seguiu as orientações',
    sim: 'Fez o que foi pedido (reiniciar, testar, liberar acesso).', nao: 'Ignorou ou fez diferente do combinado.' },
  { key: 'sem_mau_uso', label: 'O problema não foi mau uso nem erro repetido',
    sim: 'Defeito ou situação que não dependia dele.', nao: 'Descuido, uso errado ou erro que já tinha sido orientado.' },
  { key: 'ajudou', label: 'Ajudou a mais (foto, já tinha testado, confirmou a solução)',
    sim: 'Mandou foto ou print, tentou o básico antes ou confirmou que resolveu.', nao: 'Não fez nada além do mínimo.' },
];
const CHAVES = CRITERIOS.map((c) => c.key);

// Lê o checklist enviado ({ clara: true, ... }). Devolve { criterios, nota } ou { error }.
function lerChecklist(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { error: 'Marque o checklist da nota.' };
  const criterios = {};
  for (const k of CHAVES) {
    if (typeof obj[k] !== 'boolean') return { error: 'Marque todos os itens do checklist da nota.' };
    criterios[k] = obj[k];
  }
  return { criterios, nota: CHAVES.filter((k) => criterios[k]).length };
}

const horas = (ms) => (ms < 3600000 ? `${Math.max(1, Math.round(ms / 60000))} min` : ms < 86400000 ? `${Math.round(ms / 3600000)} h` : `${Math.round(ms / 86400000)} dia(s)`);

// Sugestões para o checklist a partir do que aconteceu no chamado.
//   { clara: { valor: true|false|null, motivo: '...' }, ... }  (null = o sistema não sabe)
async function sugestoes(ticket) {
  const out = Object.fromEntries(CHAVES.map((k) => [k, { valor: null, motivo: '' }]));
  const [anexos, msgs, repetido] = await Promise.all([
    query('SELECT uploaded_by, created_at FROM ticket_attachments WHERE ticket_id = $1', [ticket.id]),
    query(`SELECT user_id, kind, created_at FROM ticket_messages WHERE ticket_id = $1 AND kind IN ('comment','note') AND new_status IS NULL ORDER BY created_at` /* conversa de verdade: sem os avisos de mudança de situação */, [ticket.id]),
    query(`SELECT t.id, t.closed_at FROM tickets t
           WHERE t.requester_id = $1 AND t.id <> $2 AND t.status IN (5,6)
             AND COALESCE(t.simple_category_id, t.category_id) IS NOT DISTINCT FROM COALESCE($3::bigint, $4::bigint)
             AND COALESCE(t.closed_at, t.resolved_at) BETWEEN $5::timestamptz - interval '30 days' AND $5::timestamptz
           ORDER BY t.closed_at DESC LIMIT 1`,
    [ticket.requester_id, ticket.id, ticket.simple_category_id, ticket.category_id, ticket.created_at]),
  ]);
  const doSolicitante = (r) => String(r.uploaded_by ?? r.user_id) === String(ticket.requester_id);
  const anexoDele = anexos.rows.some(doSolicitante);

  // 1. explicou de forma clara
  const desc = String(ticket.description || '').replace(/\s+/g, ' ').trim();
  if (anexoDele) out.clara = { valor: true, motivo: 'mandou anexo ou foto' };
  else if (desc.length >= 60) out.clara = { valor: true, motivo: 'descrição detalhada' };
  else if (desc.length < 25) out.clara = { valor: false, motivo: 'descrição muito curta' };

  // 2. disponível e respondeu: o solicitante respondeu às mensagens da equipe?
  const daEquipe = msgs.rows.filter((m) => !doSolicitante(m));
  if (daEquipe.length) {
    const primeira = daEquipe[0];
    const resposta = msgs.rows.find((m) => doSolicitante(m) && m.created_at > primeira.created_at);
    if (!resposta) out.disponivel = { valor: false, motivo: 'não respondeu às mensagens' };
    else {
      const ms = new Date(resposta.created_at) - new Date(primeira.created_at);
      out.disponivel = ms <= 86400000
        ? { valor: true, motivo: `respondeu em ${horas(ms)}` }
        : { valor: false, motivo: `demorou ${horas(ms)} para responder` };
    }
  }

  // 4. erro repetido: outro chamado igual dele fechado nos 30 dias antes deste
  if (repetido.rows.length) out.sem_mau_uso = { valor: false, motivo: `parecido com o #${repetido.rows[0].id}, de poucos dias antes` };

  // 5. ajudou a mais
  if (ticket.approval_status === 'approved' && String(ticket.approval_responded_by_id) === String(ticket.requester_id)) {
    out.ajudou = { valor: true, motivo: 'confirmou a solução' };
  } else if (ticket.awaiting_evaluation) {
    out.ajudou = { valor: true, motivo: 'avisou que foi resolvido' };
  } else if (anexoDele) {
    out.ajudou = { valor: true, motivo: 'mandou foto ou anexo' };
  }
  return out;
}

module.exports = { CRITERIOS, CHAVES, lerChecklist, sugestoes };
