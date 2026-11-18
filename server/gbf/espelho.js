// "Tudo da Orcim": consulta da cópia de todas as tabelas da Central (gbf_espelho). Só leitura, só gestor.
const express = require('express');
const { query } = require('../db');
const { requireGestor } = require('./auth');
const { ah, getSetting } = require('./common');

const router = express.Router();
router.use(requireGestor);

const POR_PAGINA = 50;
// chave numérica ordena como número (com zeros à esquerda), o resto como texto
const ORDEM_CHAVE = `CASE WHEN chave ~ '^[0-9]{1,19}$' THEN lpad(chave, 19, '0') ELSE chave END DESC`;

router.get('/', ah(async (req, res) => {
  const esquema = (await getSetting('sync_esquema', null)) || { tabelas: [] };
  const { rows } = await query(
    `SELECT tabela, count(*)::int AS registros, max(recebido_em) AS ultimo
     FROM gbf_espelho GROUP BY tabela`);
  const contagem = Object.fromEntries(rows.map((r) => [r.tabela, r]));
  const nomes = [...new Set([...esquema.tabelas.map((t) => t.nome), ...rows.map((r) => r.tabela)])].sort();
  res.json({
    recebido_em: esquema.recebido_em || null,
    tabelas: nomes.map((nome) => {
      const t = esquema.tabelas.find((x) => x.nome === nome);
      return {
        nome, registros: contagem[nome]?.registros || 0, ultimo: contagem[nome]?.ultimo || null,
        colunas: t?.colunas?.length || null, modo: t?.modo || null,
      };
    }),
  });
}));

router.get('/:tabela', ah(async (req, res) => {
  const tabela = String(req.params.tabela);
  const esquema = (await getSetting('sync_esquema', null)) || { tabelas: [] };
  const t = esquema.tabelas.find((x) => x.nome === tabela);
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const busca = String(req.query.busca || '').trim();
  const params = [tabela];
  let filtro = '';
  if (busca) { params.push(`%${busca}%`); filtro = `AND dados::text ILIKE $${params.length}`; }
  const [lista, total] = await Promise.all([
    query(`SELECT chave, dados, recebido_em FROM gbf_espelho WHERE tabela = $1 ${filtro}
           ORDER BY ${ORDEM_CHAVE} LIMIT ${POR_PAGINA} OFFSET ${(pagina - 1) * POR_PAGINA}`, params),
    query(`SELECT count(*)::int AS n FROM gbf_espelho WHERE tabela = $1 ${filtro}`, params),
  ]);
  // Sem esquema (envio antigo): colunas tiradas dos próprios registros
  const colunas = t?.colunas?.map((c) => c.nome)
    || [...new Set(lista.rows.flatMap((r) => Object.keys(r.dados)))];
  res.json({
    tabela, colunas, pk: t?.pk || ['id'], total: total.rows[0].n, pagina, por_pagina: POR_PAGINA,
    registros: lista.rows.map((r) => ({ chave: r.chave, recebido_em: r.recebido_em, dados: r.dados })),
  });
}));

router.get('/:tabela/:chave', ah(async (req, res) => {
  const { rows } = await query('SELECT chave, dados, recebido_em FROM gbf_espelho WHERE tabela = $1 AND chave = $2',
    [String(req.params.tabela), String(req.params.chave)]);
  if (!rows.length) return res.status(404).json({ error: 'Registro não encontrado.' });
  const esquema = (await getSetting('sync_esquema', null)) || { tabelas: [] };
  const ordem = esquema.tabelas.find((x) => x.nome === req.params.tabela)?.colunas?.map((c) => c.nome) || [];
  // campos na ordem da tabela da Central (o jsonb guarda em outra ordem)
  const dados = Object.fromEntries([...ordem.filter((c) => c in rows[0].dados), ...Object.keys(rows[0].dados).filter((c) => !ordem.includes(c))]
    .map((c) => [c, rows[0].dados[c]]));
  res.json({ ...rows[0], dados });
}));

module.exports = router;
