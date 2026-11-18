const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const config = require('./config');

async function runSchema(client) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await client.query(sql);
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

  // Categorias (hierarquicas, como no GLPI)
  const catIds = {};
  const insertCat = async (name, parentId = null) => {
    const r = await client.query(
      'INSERT INTO categories (name, parent_id) VALUES ($1, $2) RETURNING id', [name, parentId]);
    return r.rows[0].id;
  };
  catIds.Hardware = await insertCat('Hardware');
  catIds.Software = await insertCat('Software');
  catIds.Rede = await insertCat('Rede');
  catIds.Suporte = await insertCat('Suporte');
  catIds.Desktop = await insertCat('Desktop', catIds.Hardware);
  catIds.Notebook = await insertCat('Notebook', catIds.Hardware);
  catIds.Impressora = await insertCat('Impressora', catIds.Hardware);
  catIds.Periferico = await insertCat('Monitor / Periférico', catIds.Hardware);
  catIds.Sistemas = await insertCat('Sistemas Corporativos', catIds.Software);
  catIds.Email = await insertCat('E-mail', catIds.Software);
  catIds.Licencas = await insertCat('Licenças', catIds.Software);
  catIds.Internet = await insertCat('Internet', catIds.Rede);
  catIds.Wifi = await insertCat('Wi-Fi', catIds.Rede);
  catIds.Vpn = await insertCat('VPN', catIds.Rede);
  catIds.Acesso = await insertCat('Acesso / Credenciais', catIds.Suporte);
  catIds.Backup = await insertCat('Backup', catIds.Suporte);
  catIds.Outros = await insertCat('Outros', catIds.Suporte);

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
                            entity_id, requester_id, assigned_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       RETURNING id`, [
        `CH-${created.getFullYear()}-${String(seq).padStart(5, '0')}`,
        s.title, s.desc, s.status, s.prio, s.cat, s.entity, s.req, s.tech, created,
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

  return true;
}

async function main() {
  const client = await pool.connect();
  try {
    console.log('[init] Conectando em %s:%s/%s ...', config.db.host, config.db.port, config.db.name);
    await runSchema(client);
    console.log('[init] Schema aplicado com sucesso.');
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