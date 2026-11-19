// Autenticação do Painel Beija-Flor — separada da Central.
// O token é assinado com um segredo DERIVADO (não o JWT_SECRET puro), então
// um token do painel não abre a Central e um token da Central não abre o painel.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db');

const SECRET = process.env.GBF_JWT_SECRET
  || crypto.createHmac('sha256', config.jwt.secret).update('painel-beija-flor').digest('hex');
const AUDIENCE = 'gbf-painel';
const EXPIRES = process.env.GBF_JWT_EXPIRES_IN || '12h';

function signToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role, name: user.name }, SECRET,
    { expiresIn: EXPIRES, audience: AUDIENCE });
}

function publicUser(u) {
  return {
    id: u.id, username: u.username, name: u.name, email: u.email, phone: u.phone,
    role: u.role, active: u.active, must_change_password: u.must_change_password,
    // papéis: gestor e/ou técnico (o gestor que também faz visitas tem os dois)
    faz_visitas: !!u.faz_visitas,
    papeis: u.role === 'gestor' ? (u.faz_visitas ? ['gestor', 'tecnico'] : ['gestor']) : ['tecnico'],
    last_login: u.last_login,
  };
}

async function requireGbf(req, res, next) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token && req.query.token) token = String(req.query.token); // links de arquivo
  if (!token) return res.status(401).json({ error: 'Faça login no Painel Beija-Flor.' });
  let payload;
  try {
    payload = jwt.verify(token, SECRET, { audience: AUDIENCE });
  } catch {
    return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  }
  const { rows } = await query('SELECT * FROM gbf_users WHERE id = $1', [payload.sub]);
  if (!rows.length || !rows[0].active) {
    return res.status(401).json({ error: 'Usuário inativo ou não encontrado.' });
  }
  req.gbfUser = rows[0];
  next();
}

function requireGestor(req, res, next) {
  if (req.gbfUser?.role !== 'gestor') {
    return res.status(403).json({ error: 'Apenas o gestor pode fazer isso.' });
  }
  next();
}

module.exports = { signToken, publicUser, requireGbf, requireGestor };
