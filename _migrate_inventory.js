const { query } = require('./server/db');
const { runInventoryMigrations } = require('./server/migrations_inventory');
(async () => {
  console.log('Criando tabelas Orcim Inventário...');
  await runInventoryMigrations(query, (...a) => console.log(...a));
  console.log('Migrations Orcim Inventário concluídas');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
