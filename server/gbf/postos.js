// Postos (unidades visitadas pela TI) e modelos de checklist.
const express = require('express');
const { query, pool } = require('../db');
const { ah, STATUS_CENTRAL, entidadesAcompanhadas } = require('./common');
const { queryCentral } = require('./fonte');

const router = express.Router();

const HOJE = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;
const FREQ = ['semanal', 'quinzenal', 'mensal', 'dias', 'nenhuma'];
const FREQ_LABEL = { semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal', dias: 'A cada X dias', nenhuma: 'Sem recorrência' };

const POSTO_SELECT = `
  SELECT l.*, l.next_visit_date::text AS next_visit_date, to_char(l.next_visit_time, 'HH24:MI') AS next_visit_time,
         c.name AS checklist_name,
         (l.next_visit_date < ${HOJE}) AS visita_atrasada,
         (l.next_visit_date = ${HOJE}) AS visita_hoje,
         (SELECT count(*)::int FROM gbf_tasks t WHERE t.location_id = l.id
            AND t.status NOT IN ('concluida','cancelada')) AS atividades_abertas,
         (SELECT count(*)::int FROM gbf_requests r WHERE r.location_id = l.id
            AND r.status IN ('a_fazer','em_andamento')) AS solicitacoes_abertas,
         (SELECT v.id FROM gbf_visits v WHERE v.location_id = l.id AND v.status = 'em_andamento'
            ORDER BY v.started_at DESC LIMIT 1) AS visita_em_andamento_id
  FROM gbf_locations l
  LEFT JOIN gbf_checklists c ON c.id = l.checklist_id`;

// Nome da empresa e demandas abertas vêm da Central (que pode estar em outro banco)
async function comCentral(lista) {
  // posto ligado a uma localização da Central: conta os chamados daquele local;
  // posto antigo sem ligação: conta pela empresa (como antes)
  const locIds = [...new Set(lista.map((p) => p.central_location_id).filter(Boolean).map(String))];
  const entIds = [...new Set(lista.filter((p) => !p.central_location_id).map((p) => p.entity_id).filter(Boolean).map(String))];
  const [porLocal, porEmpresa] = await Promise.all([
    locIds.length ? queryCentral(
      `SELECT location_id AS id, count(*)::int AS abertas FROM tickets
       WHERE location_id = ANY($1::bigint[]) AND status NOT IN (5,6,7) GROUP BY location_id`, [locIds]) : { rows: [] },
    entIds.length ? queryCentral(
      `SELECT e.id, e.name, (SELECT count(*)::int FROM tickets tk WHERE tk.entity_id = e.id AND tk.status NOT IN (5,6,7)) AS abertas
       FROM entities e WHERE e.id = ANY($1::bigint[])`, [entIds]) : { rows: [] },
  ]);
  const mLoc = new Map(porLocal.rows.map((r) => [String(r.id), r.abertas]));
  const mEnt = new Map(porEmpresa.rows.map((r) => [String(r.id), r]));
  return lista.map((p) => {
    if (p.central_location_id) return { ...p, entity_name: null, demandas_orcim_abertas: mLoc.get(String(p.central_location_id)) || 0 };
    const e = p.entity_id ? mEnt.get(String(p.entity_id)) : null;
    return { ...p, entity_name: e?.name ?? null, demandas_orcim_abertas: p.entity_id ? (e?.abertas ?? 0) : null };
  });
}

const fmtPosto = (p) => ({ ...p, frequency_label: p.frequency === 'dias' && p.frequency_days
  ? `A cada ${p.frequency_days} dias` : FREQ_LABEL[p.frequency] });

function dadosPosto(b, novo) {
  const out = {};
  if (novo || b.name !== undefined) {
    const n = String(b.name || '').trim();
    if (!n) return { erro: 'Informe o nome do posto.' };
    out.name = n.slice(0, 120);
  }
  for (const k of ['address', 'contact_name', 'phone', 'notes']) {
    if (b[k] !== undefined) out[k] = String(b[k] || '').trim() || null;
  }
  if (b.entity_id !== undefined) out.entity_id = /^\d+$/.test(String(b.entity_id)) ? Number(b.entity_id) : null;
  if (b.checklist_id !== undefined) out.checklist_id = /^\d+$/.test(String(b.checklist_id)) ? Number(b.checklist_id) : null;
  if (b.frequency !== undefined) {
    if (!FREQ.includes(b.frequency)) return { erro: 'Frequência inválida.' };
    out.frequency = b.frequency;
    if (b.frequency === 'dias') {
      const d = parseInt(b.frequency_days, 10);
      if (!(d >= 1 && d <= 365)) return { erro: 'Informe de quantos em quantos dias (1 a 365).' };
      out.frequency_days = d;
    } else out.frequency_days = null;
  }
  if (b.next_visit_date !== undefined) {
    if (b.next_visit_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.next_visit_date)) return { erro: 'Data da próxima visita inválida.' };
    out.next_visit_date = b.next_visit_date || null;
  }
  if (b.next_visit_time !== undefined) {
    if (b.next_visit_time && !/^\d{2}:\d{2}$/.test(b.next_visit_time)) return { erro: 'Horário inválido.' };
    out.next_visit_time = b.next_visit_time || null;
  }
  if (b.active !== undefined) out.active = !!b.active;
  return { out };
}

// ------------------------------- Postos -------------------------------
// Os postos do Dia a dia são as localizações da Central (cadastro único em
// Administração > Localizações). Aqui só se completam frequência, checklist e agenda.
// Cria os que faltam e acompanha nome, endereço e ativo. Só lê a Central.
async function sincronizarPostos() {
  const empresas = await entidadesAcompanhadas(); // vazio = todas
  let locs;
  try {
    ({ rows: locs } = await queryCentral(
      `SELECT l.id, l.name, l.entity_id, l.active,
              NULLIF(concat_ws(' - ', l.address, NULLIF(concat_ws('/', l.city, l.state), '')), '') AS endereco
       FROM locations l ${empresas.length ? 'WHERE l.entity_id = ANY($1::bigint[])' : ''}`,
      empresas.length ? [empresas] : []));
  } catch { return; } // Central sem a tabela de localizações: segue sem sincronizar
  for (const l of locs) {
    const { rowCount } = await query(
      `UPDATE gbf_locations SET name = $2, address = COALESCE($3, address), entity_id = $4, active = $5
       WHERE central_location_id = $1`, [l.id, l.name, l.endereco, l.entity_id, l.active]);
    if (rowCount) continue;
    // posto antigo com o mesmo nome e ainda sem ligação: liga em vez de duplicar
    const mesmo = await query(
      `UPDATE gbf_locations SET central_location_id = $1, entity_id = $3, updated_at = now()
       WHERE id = (SELECT id FROM gbf_locations WHERE central_location_id IS NULL AND lower(name) = lower($2) LIMIT 1)
       RETURNING id`, [l.id, l.name, l.entity_id]);
    if (mesmo.rows.length) continue;
    await query(
      `INSERT INTO gbf_locations (name, address, entity_id, active, central_location_id)
       VALUES ($1, $2, $3, $4, $5)`, [l.name, l.endereco, l.entity_id, l.active, l.id]);
  }
}

router.get('/postos', ah(async (req, res) => {
  await sincronizarPostos();
  const todos = req.query.todos === '1';
  const { rows } = await query(
    `${POSTO_SELECT} ${todos ? '' : 'WHERE l.active'}
     ORDER BY l.active DESC, l.next_visit_date NULLS LAST, l.name`);
  res.json((await comCentral(rows)).map(fmtPosto));
}));

router.get('/postos/:id', ah(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Posto não encontrado.' });
  const { rows } = await query(`${POSTO_SELECT} WHERE l.id = $1`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Posto não encontrado.' });
  const p = (await comCentral(rows))[0];
  const [visitas, tarefas, solic, demandas] = await Promise.all([
    query(`SELECT v.id, v.status, v.started_at, v.finished_at, v.checklist_name, u.name AS user_name,
                  (SELECT count(*)::int FROM gbf_visit_answers a WHERE a.visit_id = v.id AND a.answer = 'nao_ok') AS nao_ok
           FROM gbf_visits v LEFT JOIN gbf_users u ON u.id = v.user_id
           WHERE v.location_id = $1 AND v.status <> 'cancelada'
           ORDER BY v.started_at DESC LIMIT 50`, [p.id]),
    query(`SELECT t.id, t.title, t.status, t.due_at, u.name AS assignee_name FROM gbf_tasks t
           LEFT JOIN gbf_users u ON u.id = t.assignee_id
           WHERE t.location_id = $1 AND t.status NOT IN ('concluida','cancelada') ORDER BY t.due_at NULLS LAST`, [p.id]),
    query(`SELECT id, title, status, priority, desired_date FROM gbf_requests
           WHERE location_id = $1 AND status IN ('a_fazer','em_andamento') ORDER BY created_at DESC`, [p.id]),
    p.central_location_id
      ? queryCentral(`SELECT id, number, title, status, due_at, created_at FROM tickets
               WHERE location_id = $1 AND status NOT IN (5,6,7) ORDER BY created_at ASC LIMIT 30`, [p.central_location_id])
      : p.entity_id
        ? queryCentral(`SELECT id, number, title, status, due_at, created_at FROM tickets
                 WHERE entity_id = $1 AND status NOT IN (5,6,7) ORDER BY created_at ASC LIMIT 30`, [p.entity_id])
        : { rows: [] },
  ]);
  res.json({
    ...fmtPosto(p),
    historico: visitas.rows,
    atividades: tarefas.rows,
    solicitacoes: solic.rows,
    demandas_orcim: demandas.rows.map((d) => ({ ...d, status_label: STATUS_CENTRAL[d.status] })),
  });
}));

router.post('/postos', ah(async (req, res) => {
  const { erro, out } = dadosPosto(req.body || {}, true);
  if (erro) return res.status(422).json({ error: erro });
  const cols = Object.keys(out);
  const { rows } = await query(
    `INSERT INTO gbf_locations (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
    cols.map((c) => out[c]));
  res.status(201).json({ id: rows[0].id });
}));

router.patch('/postos/:id', ah(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Posto não encontrado.' });
  const { erro, out } = dadosPosto(req.body || {}, false);
  if (erro) return res.status(422).json({ error: erro });
  if (out.next_visit_date !== undefined) out.visit_notified_date = null; // reagendou: avisa de novo no dia
  const cols = Object.keys(out);
  if (!cols.length) return res.status(422).json({ error: 'Nada para alterar.' });
  const { rowCount } = await query(
    `UPDATE gbf_locations SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
    [req.params.id, ...cols.map((c) => out[c])]);
  if (!rowCount) return res.status(404).json({ error: 'Posto não encontrado.' });
  res.json({ ok: true });
}));

// Empresas da Central para vincular ao posto
router.get('/postos-empresas', ah(async (req, res) => {
  const { rows } = await queryCentral('SELECT id, name FROM entities WHERE active ORDER BY name');
  res.json(rows);
}));

// ----------------------------- Checklists -----------------------------
router.get('/checklists', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT c.*, (SELECT count(*)::int FROM gbf_checklist_items i WHERE i.checklist_id = c.id) AS itens,
            (SELECT count(*)::int FROM gbf_locations l WHERE l.checklist_id = c.id AND l.active) AS postos
     FROM gbf_checklists c ORDER BY c.active DESC, c.name`);
  res.json(rows);
}));

router.get('/checklists/:id', ah(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Checklist não encontrado.' });
  const c = (await query('SELECT * FROM gbf_checklists WHERE id = $1', [req.params.id])).rows[0];
  if (!c) return res.status(404).json({ error: 'Checklist não encontrado.' });
  const [itens, postos] = await Promise.all([
    query('SELECT id, label, position FROM gbf_checklist_items WHERE checklist_id = $1 ORDER BY position, id', [c.id]),
    query('SELECT id FROM gbf_locations WHERE checklist_id = $1', [c.id]),
  ]);
  res.json({ ...c, itens: itens.rows, postos: postos.rows.map((p) => p.id) });
}));

// Salva modelo inteiro (nome, itens na ordem, postos associados) numa transação
async function salvarChecklist(id, b) {
  const nome = String(b.name || '').trim();
  if (!nome) return { erro: 'Informe o nome do checklist.' };
  const itens = (Array.isArray(b.itens) ? b.itens : []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!itens.length) return { erro: 'Adicione ao menos um item.' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let cid = id;
    if (cid) {
      const r = await client.query(
        `UPDATE gbf_checklists SET name = $2, description = $3, active = $4, updated_at = now() WHERE id = $1`,
        [cid, nome.slice(0, 120), String(b.description || '').trim() || null, b.active !== false]);
      if (!r.rowCount) { await client.query('ROLLBACK'); return { erro: 'Checklist não encontrado.', status: 404 }; }
      await client.query('DELETE FROM gbf_checklist_items WHERE checklist_id = $1', [cid]);
    } else {
      cid = (await client.query(
        'INSERT INTO gbf_checklists (name, description, active) VALUES ($1,$2,$3) RETURNING id',
        [nome.slice(0, 120), String(b.description || '').trim() || null, b.active !== false])).rows[0].id;
    }
    for (const [i, label] of itens.entries()) {
      await client.query('INSERT INTO gbf_checklist_items (checklist_id, label, position) VALUES ($1,$2,$3)',
        [cid, label.slice(0, 200), i]);
    }
    if (Array.isArray(b.postos)) {
      const ids = b.postos.map(Number).filter(Boolean);
      await client.query('UPDATE gbf_locations SET checklist_id = NULL WHERE checklist_id = $1 AND NOT (id = ANY($2::bigint[]))', [cid, ids]);
      if (ids.length) await client.query('UPDATE gbf_locations SET checklist_id = $1 WHERE id = ANY($2::bigint[])', [cid, ids]);
    }
    await client.query('COMMIT');
    return { id: cid };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

router.post('/checklists', ah(async (req, res) => {
  const r = await salvarChecklist(null, req.body || {});
  if (r.erro) return res.status(r.status || 422).json({ error: r.erro });
  res.status(201).json({ id: r.id });
}));

router.put('/checklists/:id', ah(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Checklist não encontrado.' });
  const r = await salvarChecklist(req.params.id, req.body || {});
  if (r.erro) return res.status(r.status || 422).json({ error: r.erro });
  res.json({ id: r.id });
}));

router.post('/checklists/:id/duplicar', ah(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Checklist não encontrado.' });
  const c = (await query('SELECT * FROM gbf_checklists WHERE id = $1', [req.params.id])).rows[0];
  if (!c) return res.status(404).json({ error: 'Checklist não encontrado.' });
  const itens = (await query('SELECT label FROM gbf_checklist_items WHERE checklist_id = $1 ORDER BY position, id', [c.id])).rows;
  const r = await salvarChecklist(null, { name: `${c.name} (cópia)`, description: c.description, itens: itens.map((i) => i.label) });
  res.status(201).json({ id: r.id });
}));

module.exports = router;
module.exports.HOJE = HOJE;
module.exports.sincronizarPostos = sincronizarPostos;
