// ---------------------------------------------------------------------
// Chamados "Em pausa": sempre com motivo e data para retomar.
//   Quando a data chega, o chamado volta sozinho para a situação de antes
//   e o técnico (ou a equipe, se não tiver técnico) recebe um aviso.
// ---------------------------------------------------------------------
const { query, withTransaction } = require('../db');

const MOTIVOS_PAUSA = {
  peca: 'Aguardando peça ou compra',
  usuario: 'Aguardando o usuário',
  fornecedor: 'Aguardando fornecedor ou terceiro',
  agendado: 'Visita agendada',
  outro: 'Outro',
};
const MAX_DIAS_PAUSA = 120;

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

// Confere motivo e data. Devolve { motivo, ate } ou { error }.
function lerPausa(body = {}) {
  const motivo = String(body.pause_reason || '');
  if (!MOTIVOS_PAUSA[motivo]) return { error: 'Escolha o motivo da pausa.' };
  const ate = String(body.pause_until || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ate) || Number.isNaN(Date.parse(ate))) return { error: 'Informe a data para retomar o chamado.' };
  const hoje = hojeSP();
  if (ate <= hoje) return { error: 'A data para retomar precisa ser depois de hoje.' };
  if ((Date.parse(ate) - Date.parse(hoje)) / 86400000 > MAX_DIAS_PAUSA) return { error: `A pausa pode durar no máximo ${MAX_DIAS_PAUSA} dias.` };
  const nota = String(body.comment || '').trim();
  if (motivo === 'outro' && !nota) return { error: 'Explique o motivo da pausa no comentário.' };
  return { motivo, ate };
}

let timer = null;
async function retomarVencidas() {
  try {
    const notify = require('./notify');
    const { rows: vencidas } = await query(
      `SELECT id FROM tickets WHERE status = 4 AND pause_until IS NOT NULL AND pause_until <= $1::date`, [hojeSP()]);
    const rows = [];
    for (const v of vencidas) {
      // tudo junto: volta a situação, registra no histórico e na conversa (em nome de quem pausou)
      const t = await withTransaction(async (q) => {
        const r = await q(
          `UPDATE tickets SET status = CASE WHEN pause_prev_status IN (1,2,3) THEN pause_prev_status
                                            WHEN assigned_user_id IS NOT NULL THEN 3 ELSE 1 END,
                  pause_reason = NULL, pause_until = NULL, pause_prev_status = NULL, paused_at = NULL
           WHERE id = $1 AND status = 4
           RETURNING id, status, assigned_user_id, title, COALESCE(paused_by, assigned_user_id, requester_id) AS autor`, [v.id]);
        if (!r.rows.length) return null;
        const x = r.rows[0];
        await q('UPDATE tickets SET paused_by = NULL WHERE id = $1', [x.id]);
        await q(`INSERT INTO ticket_status_history (ticket_id, old_status, new_status, user_id) VALUES ($1, 4, $2, $3)`, [x.id, x.status, x.autor]);
        await q(`INSERT INTO ticket_messages (ticket_id, user_id, kind, content, new_status) VALUES ($1, $2, 'system', $3, $4)`,
          [x.id, x.autor, 'A data da pausa chegou: o chamado voltou para a fila.', x.status]);
        return x;
      });
      if (t) rows.push(t);
    }
    for (const t of rows) {
      const quem = t.assigned_user_id
        ? [t.assigned_user_id]
        : (await query(`SELECT id FROM users WHERE active AND role IN ('admin','moderator')`)).rows.map((r) => r.id);
      for (const id of quem) {
        await notify.createInApp(id, `#${t.id} saiu da pausa`, `A data para retomar chegou: ${t.title}`, t.id).catch(() => {});
      }
    }
    if (rows.length) console.log(`[pausas] ${rows.length} chamado(s) retomado(s)`);
  } catch (err) {
    console.error('[pausas] erro ao retomar:', err.message);
  }
}

function startScheduler() {
  if (timer) return;
  setTimeout(retomarVencidas, 20 * 1000);
  timer = setInterval(retomarVencidas, 10 * 60 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = { MOTIVOS_PAUSA, lerPausa, startScheduler, retomarVencidas, hojeSP };
