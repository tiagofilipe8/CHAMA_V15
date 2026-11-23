// ---------------------------------------------------------------------
// Opcoes padrao do sistema (usadas pelo botao "Restaurar padrão" em
// Categorias e opções). Restaurar NAO apaga nada: as opcoes padrao voltam
// ativas e com o texto original, e as opcoes criadas depois sao apenas
// desativadas — os chamados que ja usam essas opcoes continuam com elas.
// ---------------------------------------------------------------------

const IMPACT_LEVELS = [
  { name: 'Requisição', description: 'Pedido ou solicitação. Nada está parado.',
    examples: 'Criar e-mail; solicitar material; configurar PC novo; instalar programa', priority: 1, sort_order: 1 },
  { name: 'Operação prejudicada', description: 'Dá para trabalhar, mas com dificuldade.',
    examples: 'Internet lenta; impressora com defeito; computador lento; existe outro equipamento disponível', priority: 2, sort_order: 2 },
  { name: 'Parada iminente', description: 'Ainda funciona, mas pode parar a qualquer momento.',
    examples: 'Nobreak apitando; equipamento falhando; certificado vencendo', priority: 3, sort_order: 3 },
  { name: 'Operação parada', description: 'Não é possível trabalhar ou vender.',
    examples: 'PDV parado; pagamento impossível; nota fiscal bloqueada; sem internet', priority: 4, sort_order: 4 },
];

const RESOLUTION_CAUSES = [
  { name: 'Sem problema / aberto por engano', description: 'Não havia nada para consertar: chamado aberto por engano, duplicado ou o problema já tinha sumido.', neutral: true },
  { name: 'Erro do usuário', description: 'Uso incorreto, configuração alterada ou passo esquecido pelo usuário.' },
  { name: 'Acidente', description: 'Dano físico sem intenção: queda, líquido derramado, cabo puxado.' },
  { name: 'Mau uso / negligência', description: 'Uso indevido ou descuido repetido com o equipamento.' },
  { name: 'Falha do equipamento', description: 'Defeito, desgaste ou peça queimada (hardware).' },
  { name: 'Falha de software / sistema', description: 'Erro de programa, atualização, vírus ou sistema fora do ar.' },
  { name: 'Problema de rede / internet', description: 'Rede interna, Wi-Fi ou operadora de internet.' },
  { name: 'Problema elétrico', description: 'Queda de energia, nobreak, tomada ou surto elétrico.' },
  { name: 'Fornecedor externo', description: 'Causa em sistema, serviço ou equipamento de terceiros.' },
  { name: 'Solicitação / serviço planejado', description: 'Não houve falha: instalação, configuração, troca preventiva ou pedido.' },
  { name: 'Causa não identificada', description: 'Resolvido, mas não foi possível descobrir a causa.' },
].map((c, i) => ({ neutral: false, ...c, sort_order: i }));

// Arvore de categorias complexas padrao (caminhos)
const COMPLEX_PATHS = [
  ['Hardware', 'Computador'],
  ['Hardware', 'Desktop'],
  ['Hardware', 'Notebook'],
  ['Hardware', 'Impressora'],
  ['Hardware', 'Monitor / Periférico'],
  ['Software', 'Sistemas Corporativos'],
  ['Software', 'E-mail'],
  ['Software', 'Licenças'],
  ['Software', 'Nota fiscal / Certificado digital'],
  ['Rede', 'Problemas de conexão', 'DNS'],
  ['Rede', 'Problemas de conexão', 'Sem internet'],
  ['Rede', 'Problemas de conexão', 'Wi-Fi'],
  ['Rede', 'VPN'],
  ['Suporte', 'Acesso / Credenciais'],
  ['Suporte', 'Backup'],
  ['Suporte', 'Outros'],
  ['Infraestrutura', 'Energia / Nobreak'],
];

// Categorias simples padrao e onde cada uma e registrada
const SIMPLE_CATEGORIES = [
  { name: 'Computador com problema', icon: '💻', description: 'O computador não liga, trava, está lento ou com erro.',
    examples: 'Não liga; tela azul; muito lento; travando', path: ['Hardware', 'Computador'] },
  { name: 'Internet ou rede', icon: '🌐', description: 'Sem internet, internet lenta ou problema de rede/Wi-Fi.',
    examples: 'Sem internet; Wi-Fi caiu; rede lenta', path: ['Rede', 'Problemas de conexão'] },
  { name: 'Sistema ou programa', icon: '🧾', description: 'Erro ou dúvida em algum sistema ou programa.',
    examples: 'PDV com erro; sistema não abre; programa travando', path: ['Software', 'Sistemas Corporativos'] },
  { name: 'Impressora ou impressão', icon: '🖨️', description: 'A impressora não imprime, atola papel ou está sem tinta/toner.',
    examples: 'Não imprime; papel atolado; sem toner', path: ['Hardware', 'Impressora'] },
  { name: 'Acesso ou senha', icon: '🔐', description: 'Senha bloqueada, esqueceu a senha ou precisa de acesso.',
    examples: 'Senha bloqueada; novo acesso; permissão', path: ['Suporte', 'Acesso / Credenciais'] },
  { name: 'Nota fiscal / certificado', icon: '📄', description: 'Problema para emitir nota fiscal ou com certificado digital.',
    examples: 'Nota não emite; certificado vencido', path: ['Software', 'Nota fiscal / Certificado digital'] },
  { name: 'Equipamentos ou periféricos', icon: '🔧', description: 'Mouse, teclado, monitor, leitor ou outro equipamento.',
    examples: 'Mouse quebrado; monitor sem imagem; leitor não lê', path: ['Hardware', 'Monitor / Periférico'] },
  { name: 'Problemas elétricos (nobreak ou outros)', icon: '⚡', description: 'Nobreak, tomada, energia ou outro problema elétrico.',
    examples: 'Nobreak apitando; sem energia; tomada queimada', path: ['Infraestrutura', 'Energia / Nobreak'] },
].map((c, i) => ({ ...c, sort_order: i + 1 }));

// Garante o caminho (cria o que faltar) e reativa cada nivel. Devolve os ids do caminho.
async function ensurePathActive(q, path) {
  const ids = [];
  for (let i = 1; i <= path.length; i++) {
    const { rows } = await q('SELECT chama_ensure_category($1::text[]) AS id', [path.slice(0, i)]);
    ids.push(String(rows[0].id));
  }
  await q('UPDATE categories SET active = TRUE WHERE id = ANY($1::bigint[])', [ids]);
  return ids;
}

// Cada funcao recebe q(text, params) e devolve um resumo do que mudou
async function restoreImpactLevels(q) {
  const keep = [];
  for (const l of IMPACT_LEVELS) {
    const { rows } = await q(
      `INSERT INTO impact_levels (name, description, examples, priority, sort_order, active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, examples = EXCLUDED.examples,
         priority = EXCLUDED.priority, sort_order = EXCLUDED.sort_order, active = TRUE
       RETURNING id`, [l.name, l.description, l.examples, l.priority, l.sort_order]);
    keep.push(String(rows[0].id));
  }
  const off = await q(`UPDATE impact_levels SET active = FALSE WHERE active AND NOT (id = ANY($1::bigint[]))`, [keep]);
  return { restored: keep.length, deactivated: off.rowCount };
}

async function restoreResolutionCauses(q) {
  const keep = [];
  for (const c of RESOLUTION_CAUSES) {
    const { rows } = await q(
      `INSERT INTO resolution_causes (name, description, sort_order, active, neutral) VALUES ($1, $2, $3, TRUE, $4)
       ON CONFLICT ((COALESCE(profile_id, 0)), name) DO UPDATE SET description = EXCLUDED.description,
         sort_order = EXCLUDED.sort_order, active = TRUE, neutral = EXCLUDED.neutral
       RETURNING id`, [c.name, c.description, c.sort_order, c.neutral]);
    keep.push(String(rows[0].id));
  }
  const off = await q(`UPDATE resolution_causes SET active = FALSE WHERE active AND profile_id IS NULL AND NOT (id = ANY($1::bigint[]))`, [keep]);
  return { restored: keep.length, deactivated: off.rowCount };
}

async function restoreComplexCategories(q) {
  const keep = new Set();
  for (const p of [...COMPLEX_PATHS, ...SIMPLE_CATEGORIES.map((s) => s.path)]) {
    (await ensurePathActive(q, p)).forEach((id) => keep.add(id));
  }
  const off = await q(
    `UPDATE categories SET active = FALSE WHERE kind = 'complex' AND active AND NOT (id = ANY($1::bigint[]))`, [[...keep]]);
  return { restored: keep.size, deactivated: off.rowCount };
}

async function restoreSimpleCategories(q) {
  const keep = [];
  for (const s of SIMPLE_CATEGORIES) {
    const ids = await ensurePathActive(q, s.path);
    const target = ids[ids.length - 1];
    const cur = await q(`SELECT id FROM categories WHERE kind = 'simple' AND lower(name) = lower($1) ORDER BY id LIMIT 1`, [s.name]);
    let id;
    if (cur.rows.length) {
      id = cur.rows[0].id;
      await q(
        `UPDATE categories SET name = $2, icon = $3, description = $4, examples = $5, sort_order = $6,
           maps_to_id = $7, parent_id = NULL, active = TRUE WHERE id = $1`,
        [id, s.name, s.icon, s.description, s.examples, s.sort_order, target]);
    } else {
      const ins = await q(
        `INSERT INTO categories (name, icon, description, examples, sort_order, kind, maps_to_id, active)
         VALUES ($1, $2, $3, $4, $5, 'simple', $6, TRUE) RETURNING id`,
        [s.name, s.icon, s.description, s.examples, s.sort_order, target]);
      id = ins.rows[0].id;
    }
    keep.push(String(id));
  }
  const off = await q(
    `UPDATE categories SET active = FALSE WHERE kind = 'simple' AND active AND NOT (id = ANY($1::bigint[]))`, [keep]);
  return { restored: keep.length, deactivated: off.rowCount };
}

module.exports = {
  IMPACT_LEVELS, RESOLUTION_CAUSES, COMPLEX_PATHS, SIMPLE_CATEGORIES,
  restoreImpactLevels, restoreResolutionCauses, restoreComplexCategories, restoreSimpleCategories,
};
