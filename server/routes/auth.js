const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { signToken, publicUser, requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(422).json({ error: 'Informe usuário e senha.' });
  }
  try {
    const { rows } = await query(
      `SELECT u.*, e.name AS entity_name, e.logo AS entity_logo FROM users u
       LEFT JOIN entities e ON e.id = u.entity_id
       WHERE u.username = $1`, [String(username).trim()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }
    if (!user.active) {
      return res.status(403).json({ error: 'Usuário inativo. Contate o administrador.' });
    }
    await query(`UPDATE users SET last_login = now() WHERE id = $1`, [user.id]);
    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao autenticar.', details: err.message });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post('/password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(422).json({ error: 'Informe a senha atual e a nova senha.' });
  }
  if (String(new_password).length < 6) {
    return res.status(422).json({ error: 'A nova senha deve ter ao menos 6 caracteres.' });
  }
  const ok = await bcrypt.compare(String(current_password), req.user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Senha atual incorreta.' });
  const hash = await bcrypt.hash(String(new_password), 10);
  await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, req.user.id]);
  res.json({ ok: true });
});

module.exports = router;