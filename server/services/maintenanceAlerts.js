const { query } = require('../db');
const notify = require('./notify');

let timer = null;
let running = false;

async function checkMaintenanceAlerts() {
  if (running) return;
  running = true;
  try {
    const { rows } = await query(
      `SELECT a.id, a.name, a.asset_tag, a.next_maintenance_date, a.next_maintenance_notes, a.location, a.department,
              e.name AS entity_name,
              (CURRENT_DATE - a.next_maintenance_date)::int AS days_overdue
       FROM assets a
       JOIN entities e ON e.id = a.entity_id
       WHERE a.next_maintenance_date IS NOT NULL
         AND a.next_maintenance_date <= CURRENT_DATE
         AND a.status NOT IN ('DISPOSED', 'LOST')
         AND (a.maintenance_alert_notified_date IS NULL
              OR a.maintenance_alert_notified_date < a.next_maintenance_date)
       ORDER BY a.next_maintenance_date ASC
       LIMIT 50`);
    if (!rows.length) return;

    const staff = await notify.getAdminsAndTechs();
    for (const a of rows) {
      const d = a.next_maintenance_date;
      const dateStr = d instanceof Date
        ? d.toISOString().slice(0, 10)
        : String(d).slice(0, 10);
      const title = `Manutenção vencida — ${a.name}`;
      const message =
        `A manutenção programada do ativo "${a.name}"` +
        `${a.asset_tag ? ` (${a.asset_tag})` : ''} venceu em ${dateStr}` +
        ` (${a.days_overdue} dia(s) de atraso).\n` +
        `Entidade: ${a.entity_name}\n` +
        `Local: ${a.location || '—'}${a.department ? ' · ' + a.department : ''}` +
        (a.next_maintenance_notes ? `\nServiço: ${a.next_maintenance_notes}` : '');
      for (const u of staff) {
        await notify.createInApp(u.id, title, message, null).catch(() => {});
      }
      await query(
        `UPDATE assets SET maintenance_alert_notified_date = next_maintenance_date
         WHERE id = $1`, [a.id]);
    }
    console.log(`[manutencao] ${rows.length} alerta(s) de manutencao vencida enviados`);
  } catch (e) {
    console.error('[manutencao] erro:', e.message);
  } finally {
    running = false;
  }
}

function startScheduler() {
  if (timer) return;
  timer = setInterval(checkMaintenanceAlerts, 5 * 60 * 1000);
  if (timer.unref) timer.unref();
  setTimeout(() => checkMaintenanceAlerts(), 3000);
}

module.exports = { checkMaintenanceAlerts, startScheduler };
