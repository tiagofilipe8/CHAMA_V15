const express = require('express');
const { query, withTransaction } = require('../db');
const { requireAuth, has, isMaster, entityIdsOf } = require('../middleware/auth');
const notify = require('../services/notify');

// ---------------------------------------------------------------------
// Agenda de rotas: o técnico planeja em que dia vai a quais locais.
//   - equipe (quem vê o painel): vê todas as rotas e agenda/cancela
//   - gestor/usuário: vê as rotas que passam nos locais da empresa dele
//     ("Rota da TI agendada para o seu local") e é avisado quando agendam
// ---------------------------------------------------------------------
const router = express.Router();
router.use(requireAuth);

const ehEquipe = (u) => has(u, 'dashboard.view') && (isMaster(u) || ['admin', 'moderator', 'technician'].includes(u.role));
const podeAgendar = (u) => isMaster(u) || (ehEquipe(u) && (has(u, 'ticket.work') || has(u, 'ticket.assign')));
const dataValida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));

// Rotas entre ?de= e ?ate= (padrão: de hoje até 60 dias)
router.get('/', async (req, res) => {
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const de = dataValida(req.query.de) ? req.query.de : hoje;
  const ate = dataValida(req.query.ate) ? req.query.ate : new Date(Date.parse(de) + 60 * 86400000).toISOString().slice(0, 10);
  const params = [de, ate];
  let filtro = '';
  if (!ehEquipe(req.user)) {
    const ents = entityIdsOf(req.user) || [];
    params.push(ents);
    filtro = `AND EXISTS (SELECT 1 FROM route_plan_stops s2 JOIN locations l2 ON l2.id = s2.location_id
                          WHERE s2.plan_id = p.id AND l2.entity_id::text = ANY($3::text[]))`;
  }
  const { rows } = await query(
    `SELECT p.id, to_char(p.data, 'YYYY-MM-DD') AS data, p.nota, p.technician_id, p.created_by, p.created_at,
            t.name AS technician_name, c.name AS created_by_name,
            (SELECT json_agg(json_build_object('location_id', s.location_id, 'location_name', l.name, 'city', l.city,
                     'entity_id', l.entity_id, 'ordem', s.ordem) ORDER BY s.ordem)
               FROM route_plan_stops s JOIN locations l ON l.id = s.location_id WHERE s.plan_id = p.id) AS paradas
     FROM route_plans p
     LEFT JOIN users t ON t.id = p.technician_id
     LEFT JOIN users c ON c.id = p.created_by
     WHERE p.data BETWEEN $1 AND $2 ${filtro}
     ORDER BY p.data, p.id`, params);
  res.json({ de, ate, pode_agendar: podeAgendar(req.user), meu_local: req.user.location_id || null, rotas: rows });
});

// Quem pode ir (técnicos e admin mestre)
router.get('/tecnicos', async (req, res) => {
  if (!ehEquipe(req.user)) return res.status(403).json({ error: 'Acesso negado.' });
  const { rows } = await query(`SELECT id, name FROM users WHERE active AND role IN ('technician','admin','moderator') ORDER BY (role = 'technician') DESC, name`);
  res.json(rows);
});

// Agendar: { data, technician_id, nota, locais: [ids na ordem de visita] }
router.post('/', async (req, res) => {
  if (!podeAgendar(req.user)) return res.status(403).json({ error: 'Seu perfil não pode agendar rotas.' });
  const b = req.body || {};
  if (!dataValida(b.data)) return res.status(422).json({ error: 'Escolha o dia da rota.' });
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  if (b.data < hoje) return res.status(422).json({ error: 'O dia da rota não pode ser no passado.' });
  const locais = [...new Set((Array.isArray(b.locais) ? b.locais : []).map(String).filter((x) => /^\d+$/.test(x)))];
  if (!locais.length) return res.status(422).json({ error: 'Escolha pelo menos um local.' });
  const achados = (await query('SELECT id, name, entity_id FROM locations WHERE id::text = ANY($1::text[])', [locais])).rows;
  if (achados.length !== locais.length) return res.status(422).json({ error: 'Algum local não existe.' });
  let tecnico = null;
  if (b.technician_id) {
    tecnico = (await query(`SELECT id, name FROM users WHERE id = $1 AND active AND role IN ('technician','admin','moderator')`, [b.technician_id])).rows[0];
    if (!tecnico) return res.status(422).json({ error: 'Técnico inválido.' });
  }
  const nota = String(b.nota || '').trim().slice(0, 500) || null;
  const plano = await withTransaction(async (q) => {
    const { rows } = await q(`INSERT INTO route_plans (data, technician_id, nota, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
      [b.data, tecnico ? tecnico.id : null, nota, req.user.id]);
    for (let i = 0; i < locais.length; i += 1) {
      await q('INSERT INTO route_plan_stops (plan_id, location_id, ordem) VALUES ($1, $2, $3)', [rows[0].id, locais[i], i + 1]);
    }
    return rows[0];
  });
  // avisa quem é dos locais da rota (e o técnico escolhido)
  const dataBR = b.data.split('-').reverse().join('/');
  const pessoas = await query(
    `SELECT DISTINCT u.id, l.name AS local FROM users u JOIN locations l ON l.id = u.location_id
     WHERE u.active AND u.location_id::text = ANY($1::text[]) AND u.id <> $2`, [locais, req.user.id]);
  for (const p of pessoas.rows) {
    await notify.createInApp(p.id, `Rota da TI agendada para o seu local: ${dataBR}`,
      `${p.local}${tecnico ? ` · técnico: ${tecnico.name}` : ''}${nota ? ` · ${nota}` : ''}`, null, '#/visitas').catch(() => {});
  }
  if (tecnico && String(tecnico.id) !== String(req.user.id)) {
    await notify.createInApp(tecnico.id, `Você tem uma rota em ${dataBR}`, achados.map((l) => l.name).join(' → '), null, '#/rotas?aba=agenda').catch(() => {});
  }
  res.status(201).json({ id: plano.id });
});

// Cancelar (quem agendou, o técnico da rota ou o admin mestre)
router.delete('/:id', async (req, res) => {
  const { rows } = await query('SELECT * FROM route_plans WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Rota não encontrada.' });
  const p = rows[0];
  const dono = [p.created_by, p.technician_id].map(String).includes(String(req.user.id));
  if (!(isMaster(req.user) || (podeAgendar(req.user) && dono))) return res.status(403).json({ error: 'Só quem agendou, o técnico da rota ou o admin mestre cancelam.' });
  await query('DELETE FROM route_plans WHERE id = $1', [p.id]);
  res.json({ ok: true });
});

module.exports = router;
