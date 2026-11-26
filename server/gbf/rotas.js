// Rotas agendadas: a rota montada em "Montar rota" é salva para um dia e um técnico.
// Aparece na Agenda, no calendário e no "Meu dia" do técnico, que marca cada parada como feita.
//
// GET   /rotas-agendadas?de=AAAA-MM-DD&ate=AAAA-MM-DD[&meu=1]
// POST  /rotas-agendadas                 { data, tecnico_id, titulo?, saida?: {nome, lat, lng}, paradas: [location_id...] }
// PATCH /rotas-agendadas/:id             { status: 'cancelada' | 'agendada', data?, tecnico_id? }
// POST  /rotas-agendadas/:id/paradas/:pid { feita: true|false }
const express = require('express');
const { query, withTransaction } = require('../db');
const { ah, avisarEquipe, notificar } = require('./common');

const router = express.Router();
const dataOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const dataBR = (iso) => String(iso).split('-').reverse().join('/');

async function carregar(where, params) {
  const { rows } = await query(
    `SELECT r.id, r.data::text AS data, r.titulo, r.status, r.tecnico_id, u.name AS tecnico, r.saida_nome,
            r.saida_lat::float AS saida_lat, r.saida_lng::float AS saida_lng, r.created_by, c.name AS criado_por,
            COALESCE((SELECT json_agg(json_build_object(
                'id', p.id, 'ordem', p.ordem, 'location_id', p.location_id, 'nome', l.name, 'endereco', l.address,
                'lat', l.latitude::float, 'lng', l.longitude::float, 'feita_em', p.feita_em, 'feita_por', fu.name) ORDER BY p.ordem)
              FROM gbf_rota_paradas p JOIN gbf_locations l ON l.id = p.location_id LEFT JOIN gbf_users fu ON fu.id = p.feita_por
              WHERE p.rota_id = r.id), '[]') AS paradas
     FROM gbf_rotas r LEFT JOIN gbf_users u ON u.id = r.tecnico_id LEFT JOIN gbf_users c ON c.id = r.created_by
     WHERE ${where} ORDER BY r.data, r.id`, params);
  return rows.map((r) => ({ ...r, feitas: r.paradas.filter((p) => p.feita_em).length }));
}

router.get('/', ah(async (req, res) => {
  const de = dataOk(req.query.de) ? req.query.de : new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const ate = dataOk(req.query.ate) ? req.query.ate : de;
  const conds = ['r.data BETWEEN $1::date AND $2::date'];
  const params = [de, ate];
  if (req.query.meu === '1') { params.push(req.gbfUser.id); conds.push(`r.tecnico_id = $${params.length}`); }
  if (req.query.canceladas !== '1') conds.push("r.status <> 'cancelada'");
  res.json(await carregar(conds.join(' AND '), params));
}));

router.post('/', ah(async (req, res) => {
  const u = req.gbfUser;
  const b = req.body || {};
  if (!dataOk(b.data)) return res.status(422).json({ error: 'Escolha o dia da rota.' });
  const paradas = Array.isArray(b.paradas) ? b.paradas.filter((x) => /^\d+$/.test(String(x))).map(Number) : [];
  if (!paradas.length) return res.status(422).json({ error: 'A rota precisa de pelo menos um posto.' });
  if (paradas.length > 15) return res.status(422).json({ error: 'No máximo 15 postos por rota.' });
  const tecnico = /^\d+$/.test(String(b.tecnico_id || '')) ? Number(b.tecnico_id) : u.id;
  const tec = (await query('SELECT id, name FROM gbf_users WHERE id = $1 AND active', [tecnico])).rows[0];
  if (!tec) return res.status(422).json({ error: 'Técnico inválido.' });
  const s = b.saida && typeof b.saida === 'object' ? b.saida : {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const titulo = String(b.titulo || '').trim().slice(0, 120) || null;
  const id = await withTransaction(async (q) => {
    const r = (await q(
      `INSERT INTO gbf_rotas (data, tecnico_id, titulo, saida_nome, saida_lat, saida_lng, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [b.data, tec.id, titulo, String(s.nome || '').slice(0, 120) || null, num(s.lat), num(s.lng), u.id])).rows[0].id;
    for (const [i, loc] of paradas.entries()) {
      await q('INSERT INTO gbf_rota_paradas (rota_id, ordem, location_id) VALUES ($1,$2,$3)', [r, i, loc]);
    }
    return r;
  });
  const rota = (await carregar('r.id = $1', [id]))[0];
  const nomes = rota.paradas.map((p) => p.nome).join(' → ');
  if (String(tec.id) !== String(u.id)) {
    await notificar([tec.id], { kind: 'rota', title: `Rota para você em ${dataBR(b.data)}`, message: `${u.name}: ${nomes}`, link: `#/rotas-agendadas?data=${b.data}` });
  }
  await avisarEquipe(u, { kind: 'rota', title: `${u.name} agendou uma rota para ${dataBR(b.data)}`, message: `${tec.name}: ${nomes}`, link: `#/rotas-agendadas?data=${b.data}` },
    { excluir: [tec.id] });
  res.status(201).json(rota);
}));

router.patch('/:id', ah(async (req, res) => {
  const u = req.gbfUser;
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Rota não encontrada.' });
  const r = (await carregar('r.id = $1', [req.params.id]))[0];
  if (!r) return res.status(404).json({ error: 'Rota não encontrada.' });
  const b = req.body || {};
  const sets = []; const params = [r.id];
  const set = (c, v) => { params.push(v); sets.push(`${c} = $${params.length}`); };
  if (b.status !== undefined) {
    if (!['agendada', 'cancelada'].includes(b.status)) return res.status(422).json({ error: 'Situação inválida.' });
    set('status', b.status);
  }
  if (b.data !== undefined) { if (!dataOk(b.data)) return res.status(422).json({ error: 'Data inválida.' }); set('data', b.data); }
  if (!sets.length) return res.status(422).json({ error: 'Nada para alterar.' });
  await query(`UPDATE gbf_rotas SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
  if (b.status === 'cancelada') {
    await avisarEquipe(u, { kind: 'rota', title: `${u.name} cancelou a rota de ${dataBR(r.data)}`, message: r.tecnico, link: `#/rotas-agendadas?data=${r.data}` },
      { extras: [r.tecnico_id] });
  }
  res.json((await carregar('r.id = $1', [r.id]))[0]);
}));

router.post('/:id/paradas/:pid', ah(async (req, res) => {
  const u = req.gbfUser;
  if (!/^\d+$/.test(req.params.id) || !/^\d+$/.test(req.params.pid)) return res.status(404).json({ error: 'Parada não encontrada.' });
  const feita = req.body?.feita !== false;
  const { rowCount } = await query(
    `UPDATE gbf_rota_paradas SET feita_em = ${feita ? 'now()' : 'NULL'}, feita_por = ${feita ? '$3' : 'NULL'}
     WHERE id = $2 AND rota_id = $1`, feita ? [req.params.id, req.params.pid, u.id] : [req.params.id, req.params.pid]);
  if (!rowCount) return res.status(404).json({ error: 'Parada não encontrada.' });
  const r = (await carregar('r.id = $1', [req.params.id]))[0];
  const status = r.feitas === r.paradas.length ? 'concluida' : 'agendada';
  if (r.status !== 'cancelada' && r.status !== status) {
    await query('UPDATE gbf_rotas SET status = $2, updated_at = now() WHERE id = $1', [r.id, status]);
    if (status === 'concluida') {
      await avisarEquipe(u, { kind: 'rota', title: `${u.name} concluiu a rota de ${dataBR(r.data)}`, message: `${r.paradas.length} parada(s)`, link: `#/rotas-agendadas?data=${r.data}` });
    }
  }
  res.json((await carregar('r.id = $1', [r.id]))[0]);
}));

module.exports = router;
