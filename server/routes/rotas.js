const express = require('express');
const { query, withTransaction } = require('../db');
const { requireAuth, has, isMaster, entityIdsOf } = require('../middleware/auth');
const notify = require('../services/notify');

// ---------------------------------------------------------------------
// Rotas da TI: o técnico planeja em que dia vai a quais locais.
//   - equipe (quem vê o painel): vê todas as rotas, monta, agenda, edita, começa, conclui e cancela
//   - gestor/usuário: vê as rotas que passam nos locais da empresa dele ("Visitas da TI")
//     e é avisado quando agendam ou mudam a rota
//   Situação: agendada -> em andamento (Começar rota) -> concluída (Concluir rota).
//   Rota de um dia que já passou e não foi concluída aparece como "não concluída" (calculado na tela).
// ---------------------------------------------------------------------
const router = express.Router();
router.use(requireAuth);

const ehEquipe = (u) => has(u, 'dashboard.view') && (isMaster(u) || ['admin', 'moderator', 'technician'].includes(u.role));
const podeAgendar = (u) => isMaster(u) || (ehEquipe(u) && (has(u, 'ticket.work') || has(u, 'ticket.assign')));
const dono = (u, p) => isMaster(u) || (podeAgendar(u) && [p.created_by, p.technician_id].map(String).includes(String(u.id)));
const dataValida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dataBR = (d) => String(d).slice(0, 10).split('-').reverse().join('/');

// campos de uma rota (com as paradas); $1.. vêm de quem chama
const CAMPOS = `p.id, to_char(p.data, 'YYYY-MM-DD') AS data, p.nota, p.status, p.technician_id, p.created_by, p.created_at, p.itens_fora,
            p.started_at, p.concluded_at, t.name AS technician_name, c.name AS created_by_name,
            si.name AS started_by_name, co.name AS concluded_by_name,
            (SELECT json_agg(json_build_object('location_id', s.location_id, 'location_name', l.name, 'city', l.city, 'address', l.address,
                     'latitude', l.latitude, 'longitude', l.longitude, 'entity_id', l.entity_id, 'ordem', s.ordem) ORDER BY s.ordem)
               FROM route_plan_stops s JOIN locations l ON l.id = s.location_id WHERE s.plan_id = p.id) AS paradas`;
const JUNTA = `FROM route_plans p
     LEFT JOIN users t ON t.id = p.technician_id
     LEFT JOIN users c ON c.id = p.created_by
     LEFT JOIN users si ON si.id = p.started_by
     LEFT JOIN users co ON co.id = p.concluded_by`;
// chamados abertos e itens de pedido que ainda não chegaram nos locais da rota (para o cartão da agenda)
const CONTAS = `,
            (SELECT count(*)::int FROM tickets tk JOIN route_plan_stops s ON s.location_id = tk.location_id
               WHERE s.plan_id = p.id AND tk.status IN (1,2,3,4)) AS n_chamados,
            (SELECT COALESCE(sum(tm.quantity), 0)::int FROM ticket_materials tm JOIN tickets tk ON tk.id = tm.ticket_id
               JOIN route_plan_stops s ON s.location_id = COALESCE(tm.location_id, tk.location_id)
               WHERE s.plan_id = p.id AND tk.status IN (1,2,3) AND tm.status NOT IN ('entregue','cancelado')) AS n_itens`;

async function carregar(id) {
  const { rows } = await query(`SELECT ${CAMPOS} ${JUNTA} WHERE p.id = $1`, [id]);
  return rows[0] || null;
}

// Rotas entre ?de= e ?ate= (padrão: de hoje até 60 dias)
router.get('/', async (req, res) => {
  const hoje = hojeSP();
  const de = dataValida(req.query.de) ? req.query.de : hoje;
  const ate = dataValida(req.query.ate) ? req.query.ate : new Date(Date.parse(de) + 60 * 86400000).toISOString().slice(0, 10);
  const params = [de, ate];
  let filtro = '';
  const equipe = ehEquipe(req.user);
  if (!equipe) {
    const ents = entityIdsOf(req.user) || [];
    params.push(ents);
    filtro = `AND EXISTS (SELECT 1 FROM route_plan_stops s2 JOIN locations l2 ON l2.id = s2.location_id
                          WHERE s2.plan_id = p.id AND l2.entity_id::text = ANY($3::text[]))`;
  }
  const { rows } = await query(
    `SELECT ${CAMPOS}${equipe ? CONTAS : ''} ${JUNTA}
     WHERE p.data BETWEEN $1 AND $2 ${filtro}
     ORDER BY p.data, p.id`, params);
  res.json({ de, ate, hoje, pode_agendar: podeAgendar(req.user), meu_id: req.user.id, meu_local: req.user.location_id || null, rotas: rows });
});

// Quantas rotas de hoje ainda não foram concluídas (contador do menu)
router.get('/hoje', async (req, res) => {
  if (!ehEquipe(req.user)) return res.json({ n: 0 });
  const { rows } = await query(`SELECT count(*)::int AS n FROM route_plans WHERE data = $1 AND status <> 'concluida'`, [hojeSP()]);
  res.json({ n: rows[0].n });
});

// Quem pode ir (técnicos e admin mestre)
router.get('/tecnicos', async (req, res) => {
  if (!ehEquipe(req.user)) return res.status(403).json({ error: 'Acesso negado.' });
  const { rows } = await query(`SELECT id, name FROM users WHERE active AND role IN ('technician','admin','moderator') ORDER BY (role = 'technician') DESC, name`);
  res.json(rows);
});

// Uma rota (página da rota)
router.get('/:id(\\d+)', async (req, res) => {
  if (!ehEquipe(req.user)) return res.status(403).json({ error: 'Só a equipe da TI abre as rotas.' });
  const p = await carregar(req.params.id);
  if (!p) return res.status(404).json({ error: 'Rota não encontrada.' });
  res.json({ ...p, hoje: hojeSP(), pode_agendar: podeAgendar(req.user), pode_editar: dono(req.user, p) });
});

// itens de pedido desmarcados no "O que levar" (ids de ticket_materials)
const lerItensFora = (v) => [...new Set((Array.isArray(v) ? v : []).map(String).filter((x) => /^\d+$/.test(x)))].slice(0, 500);

// Lê e confere { data, technician_id, nota, locais, itens_fora } (para agendar e para editar)
async function lerPlano(b, { dataAntiga } = {}) {
  if (!dataValida(b.data)) return { error: 'Escolha o dia da rota.' };
  if (b.data < hojeSP() && b.data !== dataAntiga) return { error: 'O dia da rota não pode ser no passado.' };
  const locais = [...new Set((Array.isArray(b.locais) ? b.locais : []).map(String).filter((x) => /^\d+$/.test(x)))];
  if (!locais.length) return { error: 'Escolha pelo menos um local.' };
  const achados = (await query('SELECT id, name, entity_id FROM locations WHERE id::text = ANY($1::text[])', [locais])).rows;
  if (achados.length !== locais.length) return { error: 'Algum local não existe.' };
  let tecnico = null;
  if (b.technician_id) {
    tecnico = (await query(`SELECT id, name FROM users WHERE id = $1 AND active AND role IN ('technician','admin','moderator')`, [b.technician_id])).rows[0];
    if (!tecnico) return { error: 'Técnico inválido.' };
  }
  const nomes = locais.map((id) => achados.find((l) => String(l.id) === id).name);
  return { data: b.data, locais, nomes, tecnico, nota: String(b.nota || '').trim().slice(0, 500) || null, itensFora: lerItensFora(b.itens_fora) };
}

// grava as paradas e põe a previsão dos pedidos desses locais no dia da rota
async function gravarParadas(q, planoId, v) {
  await q('DELETE FROM route_plan_stops WHERE plan_id = $1', [planoId]);
  for (let i = 0; i < v.locais.length; i += 1) {
    await q('INSERT INTO route_plan_stops (plan_id, location_id, ordem) VALUES ($1, $2, $3)', [planoId, v.locais[i], i + 1]);
  }
  await q(`UPDATE ticket_materials tm SET previsao = $1
           FROM tickets t WHERE t.id = tm.ticket_id AND COALESCE(tm.location_id, t.location_id) = ANY($2::bigint[])
             AND tm.status NOT IN ('entregue','cancelado') AND t.status NOT IN (5,6,7)
             AND (tm.previsao IS NULL OR tm.previsao > $1 OR tm.previsao < CURRENT_DATE)`, [v.data, v.locais]);
}

// avisa quem é dos locais (e o técnico escolhido)
async function avisar(req, planoId, v, locais, titulo) {
  const pessoas = await query(
    `SELECT DISTINCT u.id, l.name AS local FROM users u JOIN locations l ON l.id = u.location_id
     WHERE u.active AND u.location_id::text = ANY($1::text[]) AND u.id <> $2`, [locais, req.user.id]);
  for (const p of pessoas.rows) {
    await notify.createInApp(p.id, `${titulo}: ${dataBR(v.data)}`,
      `${p.local}${v.tecnico ? ` · técnico: ${v.tecnico.name}` : ''}${v.nota ? ` · ${v.nota}` : ''}`, null, '#/visitas').catch(() => {});
  }
}

// Agendar: { data, technician_id, nota, locais: [ids na ordem de visita] }
router.post('/', async (req, res) => {
  if (!podeAgendar(req.user)) return res.status(403).json({ error: 'Seu perfil não pode agendar rotas.' });
  const v = await lerPlano(req.body || {});
  if (v.error) return res.status(422).json({ error: v.error });
  const plano = await withTransaction(async (q) => {
    const { rows } = await q(`INSERT INTO route_plans (data, technician_id, nota, created_by, itens_fora) VALUES ($1, $2, $3, $4, $5::bigint[]) RETURNING id`,
      [v.data, v.tecnico ? v.tecnico.id : null, v.nota, req.user.id, v.itensFora]);
    await gravarParadas(q, rows[0].id, v);
    return rows[0];
  });
  await avisar(req, plano.id, v, v.locais, 'Rota da TI agendada para o seu local');
  if (v.tecnico && String(v.tecnico.id) !== String(req.user.id)) {
    await notify.createInApp(v.tecnico.id, `Você tem uma rota em ${dataBR(v.data)}`, v.nomes.join(' → '), null, `#/rotas/${plano.id}`).catch(() => {});
  }
  res.status(201).json({ id: plano.id });
});

// Editar: dia, técnico, observação e paradas (quem agendou, o técnico da rota ou o admin mestre)
router.put('/:id(\\d+)', async (req, res) => {
  const p = await carregar(req.params.id);
  if (!p) return res.status(404).json({ error: 'Rota não encontrada.' });
  if (!dono(req.user, p)) return res.status(403).json({ error: 'Só quem agendou, o técnico da rota ou o admin mestre editam.' });
  if (p.status === 'concluida') return res.status(422).json({ error: 'Essa rota já foi concluída.' });
  const v = await lerPlano(req.body || {}, { dataAntiga: p.data });
  if (v.error) return res.status(422).json({ error: v.error });
  await withTransaction(async (q) => {
    await q('UPDATE route_plans SET data = $2, technician_id = $3, nota = $4, itens_fora = $5::bigint[] WHERE id = $1', [p.id, v.data, v.tecnico ? v.tecnico.id : null, v.nota, v.itensFora]);
    await gravarParadas(q, p.id, v);
  });
  // avisa: todos os locais se o dia mudou; senão, só os locais que entraram agora
  const antes = (p.paradas || []).map((s) => String(s.location_id));
  const novos = v.data !== p.data ? v.locais : v.locais.filter((id) => !antes.includes(id));
  if (novos.length) await avisar(req, p.id, v, novos, v.data !== p.data ? 'A rota da TI para o seu local mudou de dia' : 'Rota da TI agendada para o seu local');
  if (v.tecnico && String(v.tecnico.id) !== String(req.user.id) && String(v.tecnico.id) !== String(p.technician_id || '')) {
    await notify.createInApp(v.tecnico.id, `Você tem uma rota em ${dataBR(v.data)}`, v.nomes.join(' → '), null, `#/rotas/${p.id}`).catch(() => {});
  }
  res.json({ ok: true });
});

// Só o "O que levar" (marcar/desmarcar na página da rota): { itens_fora: [ids] }
router.put('/:id(\\d+)/itens', async (req, res) => {
  if (!podeAgendar(req.user)) return res.status(403).json({ error: 'Seu perfil não mexe nas rotas.' });
  const p = await carregar(req.params.id);
  if (!p) return res.status(404).json({ error: 'Rota não encontrada.' });
  if (p.status === 'concluida') return res.status(422).json({ error: 'Essa rota já foi concluída.' });
  await query('UPDATE route_plans SET itens_fora = $2::bigint[] WHERE id = $1', [p.id, lerItensFora(req.body?.itens_fora)]);
  res.json({ ok: true });
});

// Começar a rota (no dia, ou atrasada): "em andamento"
router.post('/:id(\\d+)/comecar', async (req, res) => {
  if (!podeAgendar(req.user)) return res.status(403).json({ error: 'Seu perfil não pode começar rotas.' });
  const p = await carregar(req.params.id);
  if (!p) return res.status(404).json({ error: 'Rota não encontrada.' });
  if (p.status !== 'agendada') return res.status(422).json({ error: p.status === 'concluida' ? 'Essa rota já foi concluída.' : 'Essa rota já começou.' });
  if (p.data > hojeSP()) return res.status(422).json({ error: `Essa rota é para ${dataBR(p.data)}. Para sair hoje, mude o dia em Editar.` });
  await query(`UPDATE route_plans SET status = 'em_andamento', started_at = now(), started_by = $2 WHERE id = $1`, [p.id, req.user.id]);
  res.json({ ok: true });
});

// Concluir a rota (fim do dia)
router.post('/:id(\\d+)/concluir', async (req, res) => {
  if (!podeAgendar(req.user)) return res.status(403).json({ error: 'Seu perfil não pode concluir rotas.' });
  const p = await carregar(req.params.id);
  if (!p) return res.status(404).json({ error: 'Rota não encontrada.' });
  if (p.status === 'concluida') return res.status(422).json({ error: 'Essa rota já foi concluída.' });
  if (p.data > hojeSP()) return res.status(422).json({ error: 'Só dá para concluir no dia da rota ou depois.' });
  await query(`UPDATE route_plans SET status = 'concluida', concluded_at = now(), concluded_by = $2,
                 started_at = COALESCE(started_at, now()), started_by = COALESCE(started_by, $2) WHERE id = $1`, [p.id, req.user.id]);
  res.json({ ok: true });
});

// Reabrir (concluiu por engano): volta para "em andamento"
router.post('/:id(\\d+)/reabrir', async (req, res) => {
  if (!podeAgendar(req.user)) return res.status(403).json({ error: 'Seu perfil não pode mexer nas rotas.' });
  const p = await carregar(req.params.id);
  if (!p) return res.status(404).json({ error: 'Rota não encontrada.' });
  if (p.status !== 'concluida') return res.status(422).json({ error: 'Essa rota não está concluída.' });
  await query(`UPDATE route_plans SET status = 'em_andamento', concluded_at = NULL, concluded_by = NULL WHERE id = $1`, [p.id]);
  res.json({ ok: true });
});

// Cancelar (quem agendou, o técnico da rota ou o admin mestre); rota concluída fica no histórico
router.delete('/:id(\\d+)', async (req, res) => {
  const p = await carregar(req.params.id);
  if (!p) return res.status(404).json({ error: 'Rota não encontrada.' });
  if (!dono(req.user, p)) return res.status(403).json({ error: 'Só quem agendou, o técnico da rota ou o admin mestre cancelam.' });
  if (p.status === 'concluida') return res.status(422).json({ error: 'Rota concluída fica no histórico e não pode ser cancelada.' });
  await query('DELETE FROM route_plans WHERE id = $1', [p.id]);
  // quem é dos locais tinha sido avisado da visita: avisa que não vai mais (só rota de hoje em diante)
  if (p.data >= hojeSP()) {
    const locais = (p.paradas || []).map((s) => String(s.location_id));
    if (locais.length) await avisar(req, p.id, { data: p.data, tecnico: null, nota: null }, locais, 'A rota da TI para o seu local foi cancelada');
  }
  res.json({ ok: true });
});

module.exports = router;
