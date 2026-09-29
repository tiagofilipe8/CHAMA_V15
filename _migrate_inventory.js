const { query } = require('./server/db');
(async()=>{
  console.log('Criando tabelas Orcim Inventário...');
  await query(`
    CREATE TABLE IF NOT EXISTS assets (
      id BIGSERIAL PRIMARY KEY,
      entity_id BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      asset_tag TEXT UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('COMPUTER','NOTEBOOK','SERVER','PRINTER','MONITOR','UPS','NETWORK_DEVICE','MOBILE_DEVICE','OTHER')),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','MAINTENANCE','STOCK','DISPOSED','LOST')),
      manufacturer TEXT,
      model TEXT,
      serial_number TEXT,
      description TEXT,
      location TEXT,
      department TEXT,
      responsible_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      purchase_date DATE,
      warranty_expiration DATE,
      notes TEXT,
      primary_photo_id BIGINT,
      last_seen_at TIMESTAMPTZ,
      created_by BIGINT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('assets ok');
  await query(`CREATE INDEX IF NOT EXISTS idx_assets_entity ON assets(entity_id);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_assets_tag ON assets(asset_tag);`);

  await query(`
    CREATE TABLE IF NOT EXISTS asset_photos (
      id BIGSERIAL PRIMARY KEY,
      asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INT NOT NULL,
      caption TEXT,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      uploaded_by BIGINT REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('asset_photos ok');
  await query(`CREATE INDEX IF NOT EXISTS idx_asset_photos_asset ON asset_photos(asset_id);`);

  await query(`
    CREATE TABLE IF NOT EXISTS agents (
      id BIGSERIAL PRIMARY KEY,
      asset_id BIGINT UNIQUE REFERENCES assets(id) ON DELETE SET NULL,
      agent_id TEXT UNIQUE NOT NULL,
      machine_guid TEXT,
      hardware_fingerprint TEXT,
      version TEXT,
      status TEXT NOT NULL DEFAULT 'NEVER_CONNECTED' CHECK (status IN ('ONLINE','OFFLINE','NEVER_CONNECTED','DISABLED','ERROR')),
      last_seen_at TIMESTAMPTZ,
      last_inventory_at TIMESTAMPTZ,
      ip TEXT,
      hostname TEXT,
      entity_id BIGINT REFERENCES entities(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('agents ok');

  await query(`
    CREATE TABLE IF NOT EXISTS agent_credentials (
      id BIGSERIAL PRIMARY KEY,
      agent_id BIGINT REFERENCES agents(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      entity_id BIGINT REFERENCES entities(id),
      provision_token_hash TEXT,
      provision_expires_at TIMESTAMPTZ,
      revoked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('agent_credentials ok');

  await query(`
    CREATE TABLE IF NOT EXISTS inventory_snapshots (
      id BIGSERIAL PRIMARY KEY,
      asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK (type IN ('FULL','INCREMENTAL')),
      payload_hash TEXT,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('inventory_snapshots ok');

  await query(`
    CREATE TABLE IF NOT EXISTS inventory_changes (
      id BIGSERIAL PRIMARY KEY,
      snapshot_id BIGINT REFERENCES inventory_snapshots(id) ON DELETE CASCADE,
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('inventory_changes ok');

  await query(`
    CREATE TABLE IF NOT EXISTS asset_history (
      id BIGSERIAL PRIMARY KEY,
      asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id),
      agent_id BIGINT REFERENCES agents(id),
      action TEXT NOT NULL,
      field TEXT,
      old_value TEXT,
      new_value TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('asset_history ok');

  await query(`
    CREATE TABLE IF NOT EXISTS asset_customer_history (
      id BIGSERIAL PRIMARY KEY,
      asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      old_entity_id BIGINT REFERENCES entities(id),
      new_entity_id BIGINT REFERENCES entities(id),
      user_id BIGINT REFERENCES users(id),
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('asset_customer_history ok');

  // Detalhes de hardware (normalizado)
  await query(`
    CREATE TABLE IF NOT EXISTS computer_details (
      asset_id BIGINT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
      hostname TEXT,
      domain TEXT,
      os_name TEXT,
      os_edition TEXT,
      os_version TEXT,
      os_build TEXT,
      os_arch TEXT,
      last_boot TIMESTAMPTZ,
      cpu_manufacturer TEXT,
      cpu_model TEXT,
      cpu_cores INT,
      cpu_threads INT,
      cpu_frequency_mhz INT,
      cpu_arch TEXT,
      motherboard_manufacturer TEXT,
      motherboard_model TEXT,
      motherboard_serial TEXT,
      bios_manufacturer TEXT,
      bios_version TEXT,
      bios_date DATE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('computer_details ok');

  await query(`
    CREATE TABLE IF NOT EXISTS computer_memory (
      id BIGSERIAL PRIMARY KEY,
      asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      slot TEXT,
      manufacturer TEXT,
      part_number TEXT,
      serial TEXT,
      capacity_gb NUMERIC,
      speed_mhz INT,
      type TEXT
    );
  `);
  console.log('computer_memory ok');

  await query(`
    CREATE TABLE IF NOT EXISTS computer_storage (
      id BIGSERIAL PRIMARY KEY,
      asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      manufacturer TEXT,
      model TEXT,
      serial TEXT,
      capacity_gb NUMERIC,
      type TEXT,
      interface TEXT,
      firmware TEXT
    );
  `);
  console.log('computer_storage ok');

  await query(`
    CREATE TABLE IF NOT EXISTS computer_gpu (
      id BIGSERIAL PRIMARY KEY,
      asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      manufacturer TEXT,
      model TEXT,
      memory_gb NUMERIC,
      driver_version TEXT
    );
  `);
  console.log('computer_gpu ok');

  await query(`
    CREATE TABLE IF NOT EXISTS computer_network_interfaces (
      id BIGSERIAL PRIMARY KEY,
      asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      name TEXT,
      manufacturer TEXT,
      model TEXT,
      mac TEXT,
      ip TEXT,
      speed_mbps INT,
      status TEXT
    );
  `);
  console.log('computer_network ok');

  await query(`
    CREATE TABLE IF NOT EXISTS computer_software (
      id BIGSERIAL PRIMARY KEY,
      asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      publisher TEXT,
      version TEXT,
      arch TEXT,
      install_date DATE,
      product_id TEXT,
      UNIQUE(asset_id, name, version)
    );
  `);
  console.log('computer_software ok');

  // Adiciona FK para primary_photo_id
  await query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_assets_primary_photo') THEN ALTER TABLE assets ADD CONSTRAINT fk_assets_primary_photo FOREIGN KEY (primary_photo_id) REFERENCES asset_photos(id) ON DELETE SET NULL; END IF; END $$;`);
  console.log('fk primary_photo ok');

  // Adiciona asset_id em tickets para vincular OS
  await query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS asset_id BIGINT REFERENCES assets(id) ON DELETE SET NULL;`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tickets_asset ON tickets(asset_id);`);
  console.log('tickets.asset_id ok');

  // Trigger para updated_at em assets e agents
  await query(`
    CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
    BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
  `);
  await query(`DROP TRIGGER IF EXISTS trg_assets_touch ON assets; CREATE TRIGGER trg_assets_touch BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION touch_updated_at();`);
  await query(`DROP TRIGGER IF EXISTS trg_agents_touch ON agents; CREATE TRIGGER trg_agents_touch BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION touch_updated_at();`);
  await query(`DROP TRIGGER IF EXISTS trg_computer_details_touch ON computer_details; CREATE TRIGGER trg_computer_details_touch BEFORE UPDATE ON computer_details FOR EACH ROW EXECUTE FUNCTION touch_updated_at();`);
  console.log('triggers ok');
  console.log('Migrations Orcim Inventário concluídas');
  process.exit(0);
})();
