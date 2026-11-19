// Visitas aos postos: iniciar -> checklist -> observações/pendências -> concluir.
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { query, pool } = require('../db');
const { ah, STATUS_CENTRAL, notificar, usuariosAtivos, prazoDe, avisarEquipe } = require('./common');
const { queryCentral } = require('./fonte');

const router = express.Router();
const HOJE = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;
const FOTOS_DIR = path.join(config.uploadsDir, 'gbf', 'visitas');

const fotoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(FOTOS_DIR, String(req.params.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().replace(/[^.\w]/g, '');
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Envie apenas fotos (JPG, PNG, WEBP ou HEIC, até 10 MB).'));
  },
});

async function carregar(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const { rows } = await query(
    `SELECT v.*, v.scheduled_for::text AS scheduled_for, l.name AS location_name, l.address AS location_address, l.entity_id,
            u.name AS user_name
     FROM gbf_visits v
     JOIN gbf_locations l ON l.id = v.location_id
     LEFT JOIN gbf_users u ON u.id = v.user_id
     WHERE v.id = $1`, [id]);
  const v = rows[0];
  if (!v) return null;
  // Nome da empresa vem da Central (que pode estar em outro banco)
  v.entity_name = v.entity_id
    ? (await queryCentral('SELECT name FROM entities WHERE id = $1', [v.entity_id])).rows[0]?.name || null
    : null;
  return v;
}

const podeEditar = (u, v) => v.status === 'em_andamento' && (u.role === 'gestor' || String(v.user_id) === String(u.id));

// Histórico / lista
router.get('/', ah(async (req, res) => {
  const params = [];
  const conds = ['TRUE'];
  const add = (sql, v) => { params.push(v); conds.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.posto && /^\d+$/.test(req.query.posto)) add('v.location_id = ?', Number(req.query.posto));
  if (['em_andamento', 'concluida', 'cancelada'].includes(req.query.status)) add('v.status = ?', req.query.status);
  else conds.push(`v.status <> 'cancelada'`);
  if (req.query.dias && /^\d+$/.test(req.query.dias)) add(`v.started_at >= now() - (?::int * interval '1 day')`, Number(req.query.dias));
  const { rows } = await query(
    `SELECT v.id, v.status, v.started_at, v.finished_at, v.checklist_name, v.notes, v.pending_notes,
            l.id AS location_id, l.name AS location_name, u.name AS user_name,
            (SELECT count(*)::int FROM gbf_visit_answers a WHERE a.visit_id = v.id AND a.answer = 'nao_ok') AS nao_ok,
            (SELECT count(*)::int FROM gbf_visit_answers a WHERE a.visit_id = v.id) AS itens,
            (SELECT count(*)::int FROM gbf_visit_photos f WHERE f.visit_id = v.id) AS fotos
     FROM gbf_visits v JOIN gbf_locations l ON l.id = v.location_id
     LEFT JOIN gbf_users u ON u.id = v.user_id
     WHERE ${conds.join(' AND ')} ORDER BY v.started_at DESC LIMIT 300`, params);
  res.json(rows);
}));

// Iniciar visita (se já houver uma em andamento no posto, devolve ela).
// Com request_id (solicitação de visita do gestor): as tarefas da solicitação viram o checklist.
router.post('/', ah(async (req, res) => {
  const b = req.body || {};
  let solic = null;
  if (b.request_id !== undefined && b.request_id !== null && b.request_id !== '') {
    if (!/^\d+$/.test(String(b.request_id))) return res.status(422).json({ error: 'Solicitação inválida.' });
    solic = (await query(`SELECT * FROM gbf_requests WHERE id = $1 AND kind = 'visita'`, [b.request_id])).rows[0];
    if (!solic) return res.status(404).json({ error: 'Solicitação de visita não encontrada.' });
    if (!['a_fazer', 'em_andamento'].includes(solic.status)) return res.status(409).json({ error: 'Esta solicitação já foi concluída ou cancelada.' });
    if (solic.visit_id) {
      const ja = (await query(`SELECT id FROM gbf_visits WHERE id = $1 AND status = 'em_andamento'`, [solic.visit_id])).rows[0];
      if (ja) return res.json({ id: ja.id, ja_existia: true });
    }
    b.location_id = solic.location_id;
  }
  if (!/^\d+$/.test(String(b.location_id || ''))) return res.status(422).json({ error: 'Escolha o posto.' });
  const loc = (await query('SELECT * FROM gbf_locations WHERE id = $1', [b.location_id])).rows[0];
  if (!loc) return res.status(404).json({ error: 'Posto não encontrado.' });
  const aberta = (await query(
    `SELECT id, request_id FROM gbf_visits WHERE location_id = $1 AND status = 'em_andamento' ORDER BY started_at DESC LIMIT 1`, [loc.id])).rows[0];
  if (aberta) {
    // já há visita aberta no posto: a solicitação passa a andar junto com ela
    if (solic && !aberta.request_id) {
      await query('UPDATE gbf_visits SET request_id = $2, updated_at = now() WHERE id = $1', [aberta.id, solic.id]);
      await query(`UPDATE gbf_requests SET visit_id = $2, status = 'em_andamento', handled_by = COALESCE(handled_by, $3),
                     started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = $1`, [solic.id, aberta.id, req.gbfUser.id]);
    }
    return res.json({ id: aberta.id, ja_existia: true });
  }

  let inicio = new Date();
  if (b.started_at) {
    inicio = new Date(b.started_at);
    if (Number.isNaN(inicio.getTime())) return res.status(422).json({ error: 'Data/hora de início inválida.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let nomeChecklist = null;
    let itens = [];
    if (solic) {
      nomeChecklist = `Solicitação ${require('./solicitacoes').numero(solic.id)}`;
      itens = (await client.query(
        'SELECT label, position FROM gbf_request_items WHERE request_id = $1 ORDER BY position, id', [solic.id])).rows;
    } else if (loc.checklist_id) {
      nomeChecklist = (await client.query('SELECT name FROM gbf_checklists WHERE id = $1', [loc.checklist_id])).rows[0]?.name || null;
      itens = (await client.query(
        'SELECT label, position FROM gbf_checklist_items WHERE checklist_id = $1 ORDER BY position, id', [loc.checklist_id])).rows;
    }
    const vid = (await client.query(
      `INSERT INTO gbf_visits (location_id, user_id, scheduled_for, started_at, checklist_name, request_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [loc.id, req.gbfUser.id, solic ? (solic.desired_date || loc.next_visit_date) : loc.next_visit_date, inicio, nomeChecklist,
        solic ? solic.id : null])).rows[0].id;
    for (const [i, it] of itens.entries()) {
      await client.query('INSERT INTO gbf_visit_answers (visit_id, position, item_label) VALUES ($1,$2,$3)', [vid, i, it.label]);
    }
    if (solic) {
      await client.query(
        `UPDATE gbf_requests SET visit_id = $2, status = 'em_andamento', handled_by = COALESCE(handled_by, $3),
           started_at = COALESCE(started_at, $4), updated_at = now() WHERE id = $1`, [solic.id, vid, req.gbfUser.id, inicio]);
    }
    await client.query('COMMIT');
    res.status(201).json({ id: vid });
    avisarEquipe(req.gbfUser, {
      kind: 'visita', title: `${req.gbfUser.name} iniciou a visita: ${loc.name}`,
      message: solic ? `Visita pedida · ${itens.length} tarefa(s)` : (nomeChecklist ? `Checklist: ${nomeChecklist}` : null),
      link: `#/visitas/${vid}`,
    }, { extras: solic ? [solic.requested_by] : [] }).catch((e) => console.error('[gbf] aviso:', e.message));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

router.get('/:id', ah(async (req, res) => {
  const v = await carregar(req.params.id);
  if (!v) return res.status(404).json({ error: 'Visita não encontrada.' });
  const [resp, fotos, tarefas, demandas] = await Promise.all([
    query('SELECT id, position, item_label, answer, note FROM gbf_visit_answers WHERE visit_id = $1 ORDER BY position, id', [v.id]),
    query('SELECT id, file_name, created_at FROM gbf_visit_photos WHERE visit_id = $1 ORDER BY created_at', [v.id]),
    query(`SELECT id, title, status, due_at FROM gbf_tasks WHERE visit_id = $1 ORDER BY created_at`, [v.id]),
    v.entity_id
      ? queryCentral(`SELECT id, number, title, status, due_at FROM tickets
               WHERE entity_id = $1 AND status NOT IN (5,6,7) ORDER BY created_at ASC LIMIT 20`, [v.entity_id])
      : { rows: [] },
  ]);
  res.json({
    ...v,
    pode_editar: podeEditar(req.gbfUser, v),
    respostas: resp.rows,
    fotos: fotos.rows,
    atividades: tarefas.rows,
    demandas_orcim: demandas.rows.map((d) => ({ ...d, status_label: STATUS_CENTRAL[d.status] })),
  });
}));

// Observações / pendências / horário de início
router.patch('/:id', ah(async (req, res) => {
  const v = await carregar(req.params.id);
  if (!v) return res.status(404).json({ error: 'Visita não encontrada.' });
  if (!podeEditar(req.gbfUser, v)) return res.status(403).json({ error: 'Esta visita não pode mais ser alterada.' });
  const b = req.body || {};
  const sets = [];
  const params = [v.id];
  const set = (c, val) => { params.push(val); sets.push(`${c} = $${params.length}`); };
  if (b.notes !== undefined) set('notes', String(b.notes || '').trim() || null);
  if (b.pending_notes !== undefined) set('pending_notes', String(b.pending_notes || '').trim() || null);
  if (b.started_at) {
    const d = new Date(b.started_at);
    if (Number.isNaN(d.getTime())) return res.status(422).json({ error: 'Data/hora inválida.' });
    set('started_at', d);
  }
  if (!sets.length) return res.json({ ok: true });
  await query(`UPDATE gbf_visits SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
  res.json({ ok: true });
}));

// Resposta de um item do checklist (salva a cada toque)
router.put('/:id/respostas/:rid', ah(async (req, res) => {
  const v = await carregar(req.params.id);
  if (!v) return res.status(404).json({ error: 'Visita não encontrada.' });
  if (!podeEditar(req.gbfUser, v)) return res.status(403).json({ error: 'Esta visita não pode mais ser alterada.' });
  const b = req.body || {};
  const sets = [];
  const params = [req.params.rid, v.id];
  if (b.answer !== undefined) {
    if (b.answer !== null && !['ok', 'nao_ok', 'na'].includes(b.answer)) return res.status(422).json({ error: 'Resposta inválida.' });
    params.push(b.answer); sets.push(`answer = $${params.length}`);
  }
  if (b.note !== undefined) { params.push(String(b.note || '').trim().slice(0, 1000) || null); sets.push(`note = $${params.length}`); }
  if (!sets.length) return res.json({ ok: true });
  const r = await query(`UPDATE gbf_visit_answers SET ${sets.join(', ')} WHERE id = $1 AND visit_id = $2`, params);
  if (!r.rowCount) return res.status(404).json({ error: 'Item não encontrado.' });
  res.json({ ok: true });
}));

// Concluir: atualiza última visita, calcula a próxima e registra no histórico
router.post('/:id/concluir', ah(async (req, res) => {
  const u = req.gbfUser;
  const v = await carregar(req.params.id);
  if (!v) return res.status(404).json({ error: 'Visita não encontrada.' });
  if (!podeEditar(u, v)) return res.status(403).json({ error: 'Esta visita não pode mais ser alterada.' });
  const b = req.body || {};
  const faltam = (await query(
    'SELECT count(*)::int AS n FROM gbf_visit_answers WHERE visit_id = $1 AND answer IS NULL', [v.id])).rows[0].n;
  if (faltam) return res.status(422).json({ error: `Faltam ${faltam} item(ns) do checklist. Marque OK, NÃO OK ou N/A.` });
  const pend = b.pendencia && String(b.pendencia.title || '').trim();
  const pzPend = pend ? prazoDe(b.pendencia) : undefined;
  if (pzPend && pzPend.erro) return res.status(422).json({ error: pzPend.erro });

  const client = await pool.connect();
  let proxima;
  try {
    await client.query('BEGIN');
    if (b.notes !== undefined || b.pending_notes !== undefined) {
      await client.query(
        `UPDATE gbf_visits SET notes = COALESCE($2, notes), pending_notes = COALESCE($3, pending_notes) WHERE id = $1`,
        [v.id, b.notes !== undefined ? (String(b.notes).trim() || null) : null,
          b.pending_notes !== undefined ? (String(b.pending_notes).trim() || null) : null]);
    }
    await client.query(`UPDATE gbf_visits SET status = 'concluida', finished_at = now(), updated_at = now() WHERE id = $1`, [v.id]);
    // Visita pontual (pedido específico do gestor) não conta como a visita de rotina do posto:
    // a próxima visita de rotina continua onde estava.
    const pontual = v.request_id
      ? (await client.query(`SELECT visit_type = 'pontual' AS p FROM gbf_requests WHERE id = $1`, [v.request_id])).rows[0]?.p
      : false;
    if (pontual) {
      proxima = (await client.query('SELECT next_visit_date::text AS d FROM gbf_locations WHERE id = $1', [v.location_id])).rows[0]?.d || null;
    } else {
      // Próxima visita = data da conclusão + frequência (só a próxima, sem gerar ocorrências futuras)
      proxima = (await client.query(
        `UPDATE gbf_locations SET last_visit_at = now(), visit_notified_date = NULL, updated_at = now(),
           next_visit_date = CASE frequency
             WHEN 'semanal'   THEN ${HOJE} + 7
             WHEN 'quinzenal' THEN ${HOJE} + 15
             WHEN 'mensal'    THEN (${HOJE} + interval '1 month')::date
             WHEN 'dias'      THEN ${HOJE} + COALESCE(frequency_days, 30)
             ELSE NULL END
         WHERE id = $1 RETURNING next_visit_date::text AS next_visit_date`, [v.location_id])).rows[0]?.next_visit_date || null;
    }
    if (pend) {
      await client.query(
        `INSERT INTO gbf_tasks (title, description, assignee_id, created_by, location_id, visit_id, due_at, ticket_id, all_day)
         VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8)`,
        [pend.slice(0, 200), String(b.pendencia.description || '').trim() || null, u.id, v.location_id, v.id,
          pzPend ? pzPend.due_at : (b.pendencia.due_at || null), /^\d+$/.test(String(b.pendencia.ticket_id || '')) ? b.pendencia.ticket_id : null,
          pzPend ? pzPend.all_day : false]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  const naoOk = (await query(
    `SELECT count(*)::int AS n FROM gbf_visit_answers WHERE visit_id = $1 AND answer = 'nao_ok'`, [v.id])).rows[0].n;
  // Visita feita por solicitação do gestor: a solicitação se fecha junto, com o resumo da visita
  let solicitacao = null;
  if (v.request_id) {
    const notas = b.notes !== undefined ? String(b.notes || '').trim() : (v.notes || '');
    solicitacao = (await query(
      `UPDATE gbf_requests SET status = 'concluida', completed_at = now(), updated_at = now(),
         handled_by = COALESCE(handled_by, $2), visit_id = COALESCE(visit_id, $3),
         response = COALESCE(NULLIF($4, ''), response)
       WHERE id = $1 AND status IN ('a_fazer','em_andamento') RETURNING id, requested_by`,
      [v.request_id, u.id, v.id, [naoOk ? `${naoOk} tarefa(s) com problema` : 'Todas as tarefas OK', notas].filter(Boolean).join(' · ')])).rows[0] || null;
  }
  await notificar((await usuariosAtivos('gestor')).filter((id) => String(id) !== String(u.id)), {
    kind: 'visita', title: `${solicitacao ? 'Visita solicitada concluída' : 'Visita concluída'}: ${v.location_name}`,
    message: `${u.name}${naoOk ? ` · ${naoOk} item(ns) NÃO OK` : ' · tudo OK'}`,
    link: solicitacao ? `#/solicitacoes/${solicitacao.id}` : `#/visitas/${v.id}`,
  });
  res.json({ ok: true, proxima_visita: proxima, solicitacao_id: solicitacao ? solicitacao.id : null });
}));

router.post('/:id/cancelar', ah(async (req, res) => {
  const v = await carregar(req.params.id);
  if (!v) return res.status(404).json({ error: 'Visita não encontrada.' });
  if (!podeEditar(req.gbfUser, v)) return res.status(403).json({ error: 'Esta visita não pode mais ser alterada.' });
  await query(`UPDATE gbf_visits SET status = 'cancelada', finished_at = now(), updated_at = now() WHERE id = $1`, [v.id]);
  await avisarEquipe(req.gbfUser, {
    kind: 'visita', title: `${req.gbfUser.name} cancelou a visita: ${v.location_name}`,
    message: v.request_id ? 'O pedido voltou para "a fazer".' : null, link: `#/postos/${v.location_id}`,
  });
  // a solicitação volta para "a fazer" (a visita não aconteceu)
  if (v.request_id) {
    await query(`UPDATE gbf_requests SET status = 'a_fazer', visit_id = NULL, started_at = NULL, updated_at = now()
                 WHERE id = $1 AND status = 'em_andamento' AND visit_id = $2`, [v.request_id, v.id]);
  }
  res.json({ ok: true });
}));

// Fotos (opcional)
router.post('/:id/fotos', (req, res, next) => {
  carregar(req.params.id).then((v) => {
    if (!v) return res.status(404).json({ error: 'Visita não encontrada.' });
    if (!podeEditar(req.gbfUser, v)) return res.status(403).json({ error: 'Esta visita não pode mais ser alterada.' });
    fotoUpload.array('fotos', 6)(req, res, async (err) => {
      if (err) return res.status(422).json({ error: err.message });
      try {
        for (const f of req.files || []) {
          await query(
            `INSERT INTO gbf_visit_photos (visit_id, file_name, storage_path, mime_type, file_size, uploaded_by)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [v.id, f.originalname.slice(0, 200), f.filename, f.mimetype, f.size, req.gbfUser.id]);
        }
        res.status(201).json({ ok: true, enviadas: (req.files || []).length });
      } catch (e) { next(e); }
    });
  }).catch(next);
});

router.get('/:id/fotos/:fid', ah(async (req, res) => {
  if (!/^\d+$/.test(req.params.id) || !/^\d+$/.test(req.params.fid)) return res.status(404).end();
  const f = (await query('SELECT * FROM gbf_visit_photos WHERE id = $1 AND visit_id = $2', [req.params.fid, req.params.id])).rows[0];
  if (!f) return res.status(404).json({ error: 'Foto não encontrada.' });
  const file = path.join(FOTOS_DIR, String(f.visit_id), path.basename(f.storage_path));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Arquivo não está no servidor.' });
  res.type(f.mime_type || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(path.resolve(file));
}));

router.delete('/:id/fotos/:fid', ah(async (req, res) => {
  const v = await carregar(req.params.id);
  if (!v) return res.status(404).json({ error: 'Visita não encontrada.' });
  if (!podeEditar(req.gbfUser, v)) return res.status(403).json({ error: 'Esta visita não pode mais ser alterada.' });
  const f = (await query('DELETE FROM gbf_visit_photos WHERE id = $1 AND visit_id = $2 RETURNING storage_path', [req.params.fid, v.id])).rows[0];
  if (f) { try { fs.unlinkSync(path.join(FOTOS_DIR, String(v.id), path.basename(f.storage_path))); } catch { /* já não existe */ } }
  res.json({ ok: true });
}));

module.exports = router;
