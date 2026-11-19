const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const config = require('./config');
const { runInventoryMigrations } = require('./migrations_inventory');
const { ROLE_KEYS, ALL_KEYS, DEFAULTS } = require('./permissions');

async function runSchema(client) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  // O schema.sql altera a tabela "assets", que e criada pelas migracoes do
  // inventario. Por isso o schema roda em duas partes, com o inventario no meio
  // (antes, uma instalacao nova falhava com: relacao "assets" nao existe).
  const MARK = '-- @@INVENTARIO@@';
  const cut = sql.indexOf(MARK);
  if (cut < 0) {
    await client.query(sql);
    return;
  }
  await client.query(sql.slice(0, cut));
  await runInventoryMigrations((text, params) => client.query(text, params));
  await client.query(sql.slice(cut));
}

async function seed(client) {
  const hash = async (p) => bcrypt.hash(p, 10);

  const { rows: existing } = await client.query('SELECT count(*)::int AS c FROM users');
  if (existing[0].c > 0) {
    console.log('[seed] Usuarios ja existem, pulando seed.');
    return false;
  }

  console.log('[seed] Criando dados iniciais de demonstracao...');

  // Entidades
  const entA = (await client.query(
    `INSERT INTO entities (name, description, email, phone, address)
     VALUES ('Empresa Demo LTDA',
             'Empresa de demonstracao - suporte de TI',
             'contato@empresademo.com.br', '(11) 2222-3333',
             'Av. Paulista, 1000 - Sao Paulo/SP')
     RETURNING id`
  )).rows[0].id;

  const entB = (await client.query(
    `INSERT INTO entities (name, description, email, phone, address)
     VALUES ('Empresa Beta SA',
             'Cliente piloto - demonstrativo',
             'ti@empresabeta.com.br', '(21) 3333-4444',
             'Rua do Comercio, 500 - Rio de Janeiro/RJ')
     RETURNING id`
  )).rows[0].id;

  // Usuarios
  const [aAdmin, aTech, aCliente, aGestor, aClienteB] = await Promise.all([
    hash('admin123'),
    hash('tecnico123'),
    hash('cliente123'),
    hash('gestor123'),
    hash('cliente123'),
  ]);

  const adminId = (await client.query(
    `INSERT INTO users (username, password_hash, name, email, phone, role, client_level, entity_id, active)
     VALUES ('admin', $1, 'Administrador do Sistema', 'admin@empresa.ti', '(11) 90000-0001',
             'admin', 1, NULL, TRUE) RETURNING id`, [aAdmin]
  )).rows[0].id;

  const techId = (await client.query(
    `INSERT INTO users (username, password_hash, name, email, phone, role, client_level, entity_id, active)
     VALUES ('tecnico1', $1, 'João da Silva (Técnico)', 'joao@empresa.ti', '(11) 90000-0002',
             'technician', 1, NULL, TRUE) RETURNING id`, [aTech]
  )).rows[0].id;

  const [clienteId, gestorId, clienteBId] = (await client.query(
    `INSERT INTO users (username, password_hash, name, email, phone, role, client_level, entity_id, active)
     VALUES
       ('cliente1', $1, 'Maria Souza (Requisitante)', 'maria@empresademo.com.br', '(11) 98888-1111', 'client', 1, $4, TRUE),
       ('gestor1',  $2, 'Carlos Pereira (Gestor)',    'carlos@empresademo.com.br', '(11) 98888-2222', 'client', 2, $4, TRUE),
       ('cliente2', $3, 'Ana Lima (Requisitante)',    'ana@empresabeta.com.br',    '(21) 97777-0001', 'client', 1, $5, TRUE)
     RETURNING id`,
    [aCliente, aGestor, aClienteB, entA, entB]
  )).rows.map((r) => r.id);

  // Empresa Demo usa categorias simples; Empresa Beta usa as complexas
  await client.query(`UPDATE entities SET category_mode = 'simple' WHERE id = $1`, [entA]);
  await client.query(`UPDATE entities SET category_mode = 'complex' WHERE id = $1`, [entB]);

  // Postos (localizacoes) de demonstracao
  const insertLoc = async (entityId, name, code, city, state) => (await client.query(
    `INSERT INTO locations (entity_id, name, code, city, state) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [entityId, name, code, city, state])).rows[0].id;
  const locX = await insertLoc(entA, 'Posto X', 'PX', 'São Paulo', 'SP');
  await insertLoc(entA, 'Posto Y', 'PY', 'Campinas', 'SP');
  const locB = await insertLoc(entB, 'Matriz', 'MTZ', 'Rio de Janeiro', 'RJ');
  await client.query('UPDATE users SET location_id = $1 WHERE id = ANY($2::bigint[])', [locX, [clienteId, gestorId]]);
  await client.query('UPDATE users SET location_id = $1 WHERE id = $2', [locB, clienteBId]);
  // gestor1 tambem acompanha a Empresa Beta
  await client.query('INSERT INTO user_entities (user_id, entity_id) VALUES ($1, $2)', [gestorId, entB]);

  // Moderador (triagem) e Administrador Local (somente a Empresa Demo)
  const [aMod, aLocal] = await Promise.all([hash('moderador123'), hash('adminlocal123')]);
  await client.query(
    `INSERT INTO users (username, password_hash, name, email, phone, role, client_level, entity_id, active)
     VALUES ('moderador1', $1, 'Paula Rocha (Moderadora)', 'paula@empresa.ti', '(11) 90000-0003', 'moderator', 1, NULL, TRUE),
            ('adminlocal1', $2, 'Rafael Costa (Gestor)', 'rafael@empresademo.com.br', '(11) 98888-3333', 'client', 2, $3, TRUE)`,
    [aMod, aLocal, entA]);

  // Categorias complexas (hierarquicas, como no GLPI). chama_ensure_category
  // reaproveita as que o schema.sql ja criou e cria as que faltarem.
  const catIds = {};
  const ensureCat = async (...pathParts) =>
    (await client.query('SELECT chama_ensure_category($1::text[]) AS id', [pathParts])).rows[0].id;
  catIds.Hardware = await ensureCat('Hardware');
  catIds.Software = await ensureCat('Software');
  catIds.Rede = await ensureCat('Rede');
  catIds.Suporte = await ensureCat('Suporte');
  catIds.Desktop = await ensureCat('Hardware', 'Desktop');
  catIds.Notebook = await ensureCat('Hardware', 'Notebook');
  catIds.Impressora = await ensureCat('Hardware', 'Impressora');
  catIds.Periferico = await ensureCat('Hardware', 'Monitor / Periférico');
  catIds.Sistemas = await ensureCat('Software', 'Sistemas Corporativos');
  catIds.Email = await ensureCat('Software', 'E-mail');
  catIds.Licencas = await ensureCat('Software', 'Licenças');
  catIds.Internet = await ensureCat('Rede', 'Problemas de conexão', 'Sem internet');
  catIds.Wifi = await ensureCat('Rede', 'Problemas de conexão', 'Wi-Fi');
  catIds.Vpn = await ensureCat('Rede', 'VPN');
  catIds.Acesso = await ensureCat('Suporte', 'Acesso / Credenciais');
  catIds.Backup = await ensureCat('Suporte', 'Backup');
  catIds.Outros = await ensureCat('Suporte', 'Outros');

  // Categoria simples correspondente (para os chamados da Empresa Demo)
  const simpleOf = async (complexId) => (await client.query(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id, 0 AS depth FROM categories WHERE id = $1
       UNION ALL SELECT c.id, c.parent_id, up.depth + 1 FROM categories c JOIN up ON c.id = up.parent_id)
     SELECT s.id FROM up JOIN categories s ON s.maps_to_id = up.id AND s.kind = 'simple' AND s.active
     ORDER BY up.depth LIMIT 1`, [complexId])).rows[0]?.id || null;

  // Chamados de exemplo
  const statusNames = { 1: 'novo', 2: 'atribuido', 3: 'andamento', 4: 'pendente', 5: 'resolvido' };
  const samples = [
    { title: 'Notebook não liga', desc: 'Notebook da recepção não liga ao apertar o botão de energia. Led pisca 3 vezes.',
      status: 3, prio: 3, cat: catIds.Notebook, req: clienteId, tech: techId, entity: entA, when: '2 horas' },
    { title: 'Sem acesso à internet', desc: 'Usuários do 2º andar relatam queda total de internet desde às 9h.',
      status: 3, prio: 4, cat: catIds.Internet, req: clienteId, tech: techId, entity: entA, when: '30 minutos' },
    { title: 'Solicitação de acesso ao ERP', desc: 'Novo colaborador precisa de acesso ao módulo financeiro do ERP.',
      status: 1, prio: 2, cat: catIds.Sistemas, req: clienteBId, tech: null, entity: entB, when: '5 minutos' },
    { title: 'Impressora com atolamento', desc: 'Impressora do 1º andar apresenta erro de atolamento constante de papel.',
      status: 2, prio: 2, cat: catIds.Impressora, req: clienteId, tech: techId, entity: entA, when: '3 horas' },
    { title: 'Erro ao enviar e-mail', desc: 'Outlook apresenta erro 550 ao enviar e-mails com anexos grandes.',
      status: 4, prio: 2, cat: catIds.Email, req: clienteId, tech: techId, entity: entA, when: '1 dia' },
    { title: 'Instalação de licença do Office', desc: 'Renovar a instalação do Microsoft Office na estação da contabilidade.',
      status: 5, prio: 1, cat: catIds.Licencas, req: clienteId, tech: techId, entity: entA, when: '2 dias' },
  ];

  let seq = 100;
  for (const s of samples) {
    const now = new Date();
    const created = new Date(now.getTime() - (s.when === '5 minutos' ? 5 * 60000
      : s.when === '30 minutos' ? 30 * 60000
      : s.when === '2 horas' ? 2 * 3600000
      : s.when === '3 horas' ? 3 * 3600000
      : s.when === '1 dia' ? 24 * 3600000 : 48 * 3600000));
    seq += 1;
    const tk = await client.query(
      `INSERT INTO tickets (number, title, description, status, priority, category_id,
                            entity_id, requester_id, assigned_user_id, created_at, updated_at,
                            impact_id, location_id, simple_category_id, assigned_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10,
               (SELECT id FROM impact_levels WHERE priority = $5 ORDER BY sort_order LIMIT 1),
               $11, $12, CASE WHEN $9::bigint IS NULL THEN NULL ELSE $10::timestamptz END)
       RETURNING id`, [
        `${created.getFullYear()}-${String(seq).padStart(5, '0')}`,
        s.title, s.desc, s.status, s.prio, s.cat, s.entity, s.req, s.tech, created,
        s.entity === entA ? locX : locB,
        s.entity === entA ? await simpleOf(s.cat) : null,
      ]);
    // mensagem de abertura
    await client.query(
      `INSERT INTO ticket_messages (ticket_id, user_id, kind, content, created_at)
       VALUES ($1, $2, 'comment', $3, $4)`,
      [tk.rows[0].id, s.req, s.desc, created]);
    // historico de status
    await client.query(
      `INSERT INTO ticket_status_history (ticket_id, old_status, new_status, user_id, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [tk.rows[0].id, 1, s.status, s.status === 1 ? s.req : techId, created]);
    await client.query('UPDATE tickets SET updated_at=now() WHERE id=$1', [tk.rows[0].id]);
  }

  // Configuracoes padrao
  const settings = {
    'app.name': 'Central de Serviços',
    'app.logo': '',
    'app.background': '',
    'app.notify_email': 'true',
    'app.notify_whatsapp': 'false',
    'app.voice_enabled': 'true',
    'app.voice_new_ticket': 'true',
    'app.refresh_interval': '30000',
    'app.admin_email': 'admin@empresa.ti',
    'app.notify_techs_new': 'true',
    'app.notify_clients': 'true',
    'app.approval_on_solve': 'true',
  };
  for (const [k, v] of Object.entries(settings)) {
    await client.query('INSERT INTO settings (key, value) VALUES ($1, $2)', [k, v]);
  }

  console.log(`[seed] Admin      -> usuario: admin     / senha: admin123`);
  console.log(`[seed] Tecnico    -> usuario: tecnico1  / senha: tecnico123`);
  console.log(`[seed] Cliente    -> usuario: cliente1  / senha: cliente123`);
  console.log(`[seed] Gestor     -> usuario: gestor1   / senha: gestor123`);
  console.log(`[seed] Moderador  -> usuario: moderador1  / senha: moderador123`);
  console.log(`[seed] Gestor 2   -> usuario: adminlocal1 / senha: adminlocal123`);

  return true;
}

// Grava as permissoes padrao de cada perfil. So insere o que ainda nao existe:
// o que o administrador ja marcou/desmarcou na tela nunca e sobrescrito.
async function ensurePermissions(client) {
  for (const r of ROLE_KEYS) {
    for (const perm of ALL_KEYS) {
      await client.query(
        `INSERT INTO role_permissions (role_key, permission, allowed) VALUES ($1, $2, $3)
         ON CONFLICT (role_key, permission) DO NOTHING`,
        [r.key, perm, (DEFAULTS[r.key] || []).includes(perm)]);
    }
  }
}

async function main() {
  const client = await pool.connect();
  try {
    console.log('[init] Conectando em %s:%s/%s ...', config.db.host, config.db.port, config.db.name);
    await runSchema(client);
    console.log('[init] Schema aplicado com sucesso.');
    await ensurePermissions(client);
    // apaga copias de "Visualizacao de cargos" que ficaram abertas
    const pv = await client.query("SELECT nspname FROM pg_namespace WHERE nspname ~ '^preview_[0-9]+$'");
    for (const r of pv.rows) await client.query(`DROP SCHEMA IF EXISTS ${r.nspname} CASCADE`);
    await seed(client);
    console.log('[init] Concluido.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[init] ERRO:', err.message);
  process.exit(1);
});