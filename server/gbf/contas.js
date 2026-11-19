// Login, conta, usuários, notificações e configuração do Painel Beija-Flor.
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { signToken, publicUser, requireGbf, requireGestor } = require('./auth');
const { ah, getSetting, setSetting } = require('./common');
const { queryCentral, statusCentral } = require('./fonte');
const crypto = require('crypto');
const central = require('../middleware/auth');

const publico = express.Router();
const privado = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente de novo em 15 minutos.' },
});

const SENHA_MIN = 8;

// ------------------------------- Login -------------------------------
publico.post('/auth/login', loginLimiter, ah(async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(422).json({ error: 'Informe usuário e senha.' });
  const { rows } = await query('SELECT * FROM gbf_users WHERE lower(username) = $1', [username]);
  const u = rows[0];
  if (!u || !u.active || !(await bcrypt.compare(password, u.password_hash))) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }
  await query('UPDATE gbf_users SET last_login = now() WHERE id = $1', [u.id]);
  res.json({ token: signToken(u), user: publicUser(u) });
}));

// ------------------- Login único (dentro da Central) -------------------
// A Central abre o Dia a dia da TI dentro do próprio menu. Quem já entrou na Central
// troca o token dela por um token do painel, sem digitar senha de novo.
// Quem pode: permissão "ti.view" (técnico) ou "ti.manage" (gestor) em Perfis e permissões.
publico.post('/auth/central', central.requireAuth, ah(async (req, res) => {
  const cu = req.user;
  if (cu.preview) return res.status(403).json({ error: 'O Dia a dia da TI não abre na Visualização de Cargos.' });
  const gestor = central.has(cu, 'ti.manage');
  if (!gestor && !central.has(cu, 'ti.view')) {
    return res.status(403).json({ error: 'Seu perfil não tem acesso ao Dia a dia da TI. Peça ao administrador (Perfis e permissões).' });
  }
  const role = gestor ? 'gestor' : 'tecnico';
  let { rows } = await query('SELECT * FROM gbf_users WHERE central_user_id = $1', [cu.id]);
  if (!rows.length) {
    // usuário do painel com o mesmo login, ainda não ligado: liga
    ({ rows } = await query(
      'UPDATE gbf_users SET central_user_id = $1 WHERE lower(username) = lower($2) AND central_user_id IS NULL RETURNING *',
      [cu.id, cu.username]));
  }
  if (!rows.length) {
    let username = String(cu.username || `central${cu.id}`).toLowerCase();
    const existe = await query('SELECT 1 FROM gbf_users WHERE lower(username) = $1', [username]);
    if (existe.rows.length) username = `${username}.central${cu.id}`;
    // senha aleatória: este usuário entra pela Central, não pela tela de login do painel
    const hash = await bcrypt.hash(crypto.randomBytes(24).toString('base64url'), 10);
    ({ rows } = await query(
      `INSERT INTO gbf_users (username, password_hash, name, email, phone, role, must_change_password, central_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7) RETURNING *`,
      [username, hash, cu.name || cu.username, cu.email || null, cu.phone || null, role, cu.id]));
  } else {
    ({ rows } = await query(
      `UPDATE gbf_users SET name = $2, role = $3, active = TRUE, must_change_password = FALSE,
              last_login = now(), updated_at = now() WHERE id = $1 RETURNING *`,
      [rows[0].id, cu.name || rows[0].name, role]));
  }
  res.json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
}));

publico.get('/config/publica', ah(async (req, res) => {
  res.json({ nome: (await getSetting('nome_painel', null)) || 'Painel Beija-Flor', versao: require('../versao') });
}));

privado.use(requireGbf);

privado.get('/auth/me', (req, res) => res.json(publicUser(req.gbfUser)));

privado.post('/auth/senha', ah(async (req, res) => {
  const u = req.gbfUser;
  const atual = String(req.body?.atual || '');
  const nova = String(req.body?.nova || '');
  if (!(await bcrypt.compare(atual, u.password_hash))) {
    return res.status(422).json({ error: 'A senha atual não confere.' });
  }
  if (nova.length < SENHA_MIN) return res.status(422).json({ error: `A nova senha precisa de ao menos ${SENHA_MIN} caracteres.` });
  if (nova === atual) return res.status(422).json({ error: 'A nova senha precisa ser diferente da atual.' });
  await query(
    'UPDATE gbf_users SET password_hash = $1, must_change_password = FALSE, updated_at = now() WHERE id = $2',
    [await bcrypt.hash(nova, 10), u.id]);
  res.json({ ok: true });
}));

// ---------------------------- Notificações ---------------------------
privado.get('/notificacoes', ah(async (req, res) => {
  const [lista, cont] = await Promise.all([
    query(`SELECT * FROM gbf_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 60`, [req.gbfUser.id]),
    query(`SELECT count(*)::int AS n FROM gbf_notifications WHERE user_id = $1 AND is_read = FALSE`, [req.gbfUser.id]),
  ]);
  res.json({ nao_lidas: cont.rows[0].n, itens: lista.rows });
}));

privado.post('/notificacoes/lidas', ah(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : null;
  if (ids && ids.length) {
    await query('UPDATE gbf_notifications SET is_read = TRUE WHERE user_id = $1 AND id = ANY($2::bigint[])',
      [req.gbfUser.id, ids]);
  } else {
    await query('UPDATE gbf_notifications SET is_read = TRUE WHERE user_id = $1', [req.gbfUser.id]);
  }
  res.json({ ok: true });
}));

// ------------------------- Usuários (lista curta) --------------------
// Técnicos também precisam ver os nomes para filtros
privado.get('/usuarios/ativos', ah(async (req, res) => {
  const { rows } = await query(
    'SELECT id, name, role, faz_visitas FROM gbf_users WHERE active = TRUE ORDER BY name');
  res.json(rows);
}));

// ----------------------- Usuários (só gestor) ------------------------
privado.get('/usuarios', requireGestor, ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM gbf_users ORDER BY active DESC, name');
  res.json(rows.map(publicUser));
}));

function validarDados(b, novo) {
  const out = {};
  if (novo || b.username !== undefined) {
    const un = String(b.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(un)) return { erro: 'Usuário: 3 a 40 caracteres (letras, números, ponto, hífen).' };
    out.username = un;
  }
  if (novo || b.name !== undefined) {
    const n = String(b.name || '').trim();
    if (!n) return { erro: 'Informe o nome.' };
    out.name = n.slice(0, 120);
  }
  if (b.email !== undefined) out.email = String(b.email || '').trim() || null;
  if (b.phone !== undefined) out.phone = String(b.phone || '').trim() || null;
  // Papéis em etiquetas: gestor e/ou técnico. Gestor + técnico = gestor que também faz visitas.
  if (Array.isArray(b.papeis)) {
    const p = new Set(b.papeis.map(String));
    if (![...p].every((x) => ['gestor', 'tecnico'].includes(x))) return { erro: 'Papel inválido.' };
    if (!p.size) return { erro: 'Escolha pelo menos um papel: Gestor e/ou Técnico.' };
    out.role = p.has('gestor') ? 'gestor' : 'tecnico';
    out.faz_visitas = p.has('gestor') && p.has('tecnico');
  } else if (novo || b.role !== undefined) {
    const r = b.role || 'tecnico';
    if (!['gestor', 'tecnico'].includes(r)) return { erro: 'Papel inválido.' };
    out.role = r;
    if (r === 'tecnico') out.faz_visitas = false;
  }
  if (b.active !== undefined) out.active = !!b.active;
  return { out };
}

privado.post('/usuarios', requireGestor, ah(async (req, res) => {
  const b = req.body || {};
  const { erro, out } = validarDados(b, true);
  if (erro) return res.status(422).json({ error: erro });
  const senha = String(b.password || '');
  if (senha.length < SENHA_MIN) return res.status(422).json({ error: `A senha precisa de ao menos ${SENHA_MIN} caracteres.` });
  try {
    const { rows } = await query(
      `INSERT INTO gbf_users (username, password_hash, name, email, phone, role, faz_visitas, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE) RETURNING *`,
      [out.username, await bcrypt.hash(senha, 10), out.name, out.email ?? null, out.phone ?? null, out.role, !!out.faz_visitas]);
    res.status(201).json(publicUser(rows[0]));
  } catch (e) {
    if (e.code === '23505') return res.status(422).json({ error: 'Já existe um usuário com esse login.' });
    throw e;
  }
}));

privado.patch('/usuarios/:id', requireGestor, ah(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const alvo = (await query('SELECT * FROM gbf_users WHERE id = $1', [req.params.id])).rows[0];
  if (!alvo) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const b = req.body || {};
  const { erro, out } = validarDados(b, false);
  if (erro) return res.status(422).json({ error: erro });

  // Não deixar o painel sem nenhum gestor ativo
  const perdeGestor = alvo.role === 'gestor' && alvo.active
    && (out.role === 'tecnico' || out.active === false);
  if (perdeGestor) {
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM gbf_users WHERE role = 'gestor' AND active = TRUE AND id <> $1`, [alvo.id]);
    if (!rows[0].n) return res.status(422).json({ error: 'É preciso manter ao menos um gestor ativo.' });
  }

  const sets = [];
  const params = [alvo.id];
  for (const [k, v] of Object.entries(out)) { params.push(v); sets.push(`${k} = $${params.length}`); }
  if (b.password) {
    if (String(b.password).length < SENHA_MIN) return res.status(422).json({ error: `A senha precisa de ao menos ${SENHA_MIN} caracteres.` });
    params.push(await bcrypt.hash(String(b.password), 10));
    sets.push(`password_hash = $${params.length}`, 'must_change_password = TRUE');
  }
  if (!sets.length) return res.status(422).json({ error: 'Nada para alterar.' });
  sets.push('updated_at = now()');
  try {
    const { rows } = await query(`UPDATE gbf_users SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
    res.json(publicUser(rows[0]));
  } catch (e) {
    if (e.code === '23505') return res.status(422).json({ error: 'Já existe um usuário com esse login.' });
    throw e;
  }
}));

// --------------------------- Configuração ----------------------------
privado.get('/config', requireGestor, ah(async (req, res) => {
  const [entidades, todas] = await Promise.all([
    getSetting('entidades', []),
    // Se o banco da Orcim estiver fora do ar, a tela abre mesmo assim e mostra o motivo
    queryCentral('SELECT id, name, active FROM entities ORDER BY name').catch(() => ({ rows: [] })),
  ]);
  res.json({
    nome_painel: (await getSetting('nome_painel', null)) || 'Painel Beija-Flor',
    entidades: Array.isArray(entidades) ? entidades : [],
    empresas_central: todas.rows,
    fonte: await statusCentral(),
    sync: await require('./sync').statusSync(),
  });
}));

privado.put('/config', requireGestor, ah(async (req, res) => {
  const b = req.body || {};
  if (b.entidades !== undefined) {
    if (!Array.isArray(b.entidades)) return res.status(422).json({ error: 'Lista de empresas inválida.' });
    await setSetting('entidades', b.entidades.map(Number).filter(Boolean));
  }
  if (b.nome_painel !== undefined) {
    await setSetting('nome_painel', String(b.nome_painel).trim().slice(0, 60) || 'Painel Beija-Flor');
  }
  res.json({ ok: true });
}));

module.exports = { publico, privado };
