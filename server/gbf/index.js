// =====================================================================
// Painel Beija-Flor — módulo à parte dentro da Central de Serviços.
//
//  - Login próprio (tabela gbf_users), token que não vale na Central.
//  - Lê as demandas da Central (tickets...) sem nunca alterá-las.
//  - Tabelas próprias com prefixo gbf_, criadas aqui na subida.
//  - Tela em /gbf/ (public/gbf). API em /api/gbf.
//
// Para ligar: uma linha em server/index.js -> app.use('/api/gbf', require('./gbf'));
// =====================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const contas = require('./contas');
const alertas = require('./alertas');
const sync = require('./sync');

const router = express.Router();

// Cria/atualiza as tabelas gbf_* e o primeiro gestor
async function preparar() {
  await query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const { rows } = await query('SELECT count(*)::int AS n FROM gbf_users');
  if (rows[0].n === 0) {
    const usuario = (process.env.GBF_ADMIN_USER || 'beijaflor').toLowerCase();
    const senha = process.env.GBF_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    await query(
      `INSERT INTO gbf_users (username, password_hash, name, role, must_change_password)
       VALUES ($1, $2, 'Gestor Beija-Flor', 'gestor', TRUE)`,
      [usuario, await bcrypt.hash(senha, 10)]);
    console.log('==============================================================');
    console.log(' Painel Beija-Flor: primeiro acesso criado');
    console.log(`   usuário: ${usuario}`);
    if (!process.env.GBF_ADMIN_PASSWORD) console.log(`   senha:   ${senha}   (troque no primeiro login)`);
    console.log('==============================================================');
  }
  alertas.iniciar();
}

let pronto = null;
function garantirPronto() {
  if (!pronto) {
    pronto = preparar().catch((e) => {
      console.error('[gbf] Falha ao preparar o painel:', e.message);
      pronto = null; // tenta de novo na próxima requisição
      throw e;
    });
  }
  return pronto;
}
garantirPronto().catch(() => {});

router.use((req, res, next) => {
  garantirPronto().then(() => next(), () => res.status(503).json({ error: 'Painel indisponível no momento.' }));
});

router.use(contas.publico);
// Recebimento dos dados da Central da Orcim (autenticado pelo token de sincronização, não pelo login)
router.use(sync.receptor);
router.use(contas.privado); // daqui para baixo exige login do painel
router.use('/espelho', require('./espelho'));
router.use('/demandas', require('./demandas'));
router.use('/atividades', require('./atividades'));
// Rotina do técnico (Prompt do TI): postos, checklists, visitas, agenda, solicitações
router.use('/', require('./postos'));
router.use('/visitas', require('./visitas'));
router.use('/solicitacoes', require('./solicitacoes'));
router.use('/', require('./rotina'));

router.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  console.error('[gbf]', err.message);
  res.status(500).json({ error: 'Erro interno do painel.' });
});

module.exports = router;
