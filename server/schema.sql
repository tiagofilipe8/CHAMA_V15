-- =====================================================================
-- Schema do sistema de Ordens de Servico (inspirado no modelo do GLPI)
-- PostgreSQL
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Entidades (empresas/clientes atendidos - equivalente a "Entities" do GLPI)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entities (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT        NOT NULL UNIQUE,
    description TEXT,
    email       TEXT,
    phone       TEXT,
    address     TEXT,
    logo        TEXT,
    sla_days    INTEGER     NOT NULL DEFAULT 0,
    sla_hours   INTEGER     NOT NULL DEFAULT 0,
    active      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migracao para bancos ja existentes
ALTER TABLE entities ADD COLUMN IF NOT EXISTS logo TEXT;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS sla_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS sla_hours INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------
-- Usuarios (tecnicos internos + clientes)
-- roles: admin | technician | client
-- client_level: 1 = requisitante (abre/gerencia apenas os proprios chamados)
--               2 = gestor (abre/gerencia todos os chamados da entidade,
--                   aprova/reprova solucoes, insere notas/instrucoes)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    name          TEXT        NOT NULL,
    email         TEXT        UNIQUE,
    phone         TEXT,
    role          TEXT        NOT NULL DEFAULT 'client'
                  CHECK (role IN ('admin', 'technician', 'client')),
    client_level  SMALLINT    NOT NULL DEFAULT 1 CHECK (client_level IN (1, 2)),
    entity_id     BIGINT      REFERENCES entities(id) ON DELETE SET NULL,
    active        BOOLEAN     NOT NULL DEFAULT TRUE,
    last_login    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_entity   ON users(entity_id);
CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role);

-- ---------------------------------------------------------------------
-- Categorias de chamados
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id        BIGSERIAL PRIMARY KEY,
    name      TEXT    NOT NULL,
    parent_id BIGINT REFERENCES categories(id) ON DELETE SET NULL,
    active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Chamados (ordens de servico)
-- status:  1 novo | 2 atribuido | 3 em andamento | 4 pendente
--          5 resolvido | 6 fechado | 7 cancelado
-- priority:1 baixa | 2 media | 3 alta | 4 urgente
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
    id                       BIGSERIAL PRIMARY KEY,
    number                   TEXT UNIQUE,
    title                    TEXT        NOT NULL,
    description              TEXT        NOT NULL,
    status                   SMALLINT    NOT NULL DEFAULT 1
                             CHECK (status BETWEEN 1 AND 7),
    priority                 SMALLINT    NOT NULL DEFAULT 2
                             CHECK (priority BETWEEN 1 AND 4),
    category_id              BIGINT      REFERENCES categories(id) ON DELETE SET NULL,
    entity_id                BIGINT      NOT NULL REFERENCES entities(id),
    requester_id             BIGINT      NOT NULL REFERENCES users(id),
    assigned_user_id         BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    approval_status          TEXT        NOT NULL DEFAULT 'none'
                             CHECK (approval_status IN
                               ('none','pending','approved','rejected')),
    approval_requested_by_id BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    approval_responded_by_id BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    approval_comment         TEXT,
    approval_requested_at    TIMESTAMPTZ,
    approval_responded_at    TIMESTAMPTZ,
    due_at                   TIMESTAMPTZ,
    closed_at                TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_entity       ON tickets(entity_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status       ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned     ON tickets(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_requester    ON tickets(requester_id);
CREATE INDEX IF NOT EXISTS idx_tickets_updated      ON tickets(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_created      ON tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_open_status  ON tickets(entity_id, status)
                        WHERE status NOT IN (6, 7);

-- ---------------------------------------------------------------------
-- Historico / timeline dos chamados
-- kind: comment | note | system | approval
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_messages (
    id         BIGSERIAL PRIMARY KEY,
    ticket_id  BIGINT      NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id    BIGINT      NOT NULL REFERENCES users(id),
    kind       TEXT        NOT NULL DEFAULT 'comment'
               CHECK (kind IN ('comment','note','system','approval')),
    content    TEXT        NOT NULL,
    new_status SMALLINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_ticket ON ticket_messages(ticket_id, created_at);

-- ---------------------------------------------------------------------
-- Anexos dos chamados
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_attachments (
    id          BIGSERIAL PRIMARY KEY,
    ticket_id   BIGINT      NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    file_name   TEXT        NOT NULL,
    storage_path TEXT       NOT NULL,
    mime_type   TEXT,
    file_size   BIGINT,
    uploaded_by BIGINT      REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_att_ticket ON ticket_attachments(ticket_id);

-- ---------------------------------------------------------------------
-- Historico de status (auditoria)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_status_history (
    id          BIGSERIAL PRIMARY KEY,
    ticket_id   BIGINT      NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    old_status  SMALLINT,
    new_status  SMALLINT    NOT NULL,
    user_id     BIGINT      REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Configuracoes do sistema (chave / valor)
-- Ex.: logo, background, nome da empresa, SMTP, WhatsApp, toggles
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Log de notificacoes enviadas (e-mail / WhatsApp)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_log (
    id         BIGSERIAL PRIMARY KEY,
    ticket_id  BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
    channel    TEXT        NOT NULL CHECK (channel IN ('email','whatsapp')),
    event      TEXT        NOT NULL,
    recipient  TEXT        NOT NULL,
    subject    TEXT,
    status     TEXT        NOT NULL DEFAULT 'sent'
               CHECK (status IN ('pending','sent','error','disabled','skipped')),
    error      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notiflog_created ON notification_log(created_at DESC);

-- ---------------------------------------------------------------------
-- Notificacoes in-app (painel / sino)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inapp_notifications (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticket_id  BIGINT   REFERENCES tickets(id) ON DELETE SET NULL,
    title      TEXT     NOT NULL,
    message    TEXT     NOT NULL,
    is_read    BOOLEAN  NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inapp_user ON inapp_notifications(user_id, is_read);

-- Migracao: data programada da proxima manutencao do ativo
ALTER TABLE assets ADD COLUMN IF NOT EXISTS next_maintenance_date DATE;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS toner TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS cilindro TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS maintenance_alert_notified_date DATE;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS next_maintenance_notes TEXT;

-- Historico de manutencoes realizadas no ativo
CREATE TABLE IF NOT EXISTS asset_maintenances (
    id          BIGSERIAL PRIMARY KEY,
    asset_id    BIGINT      NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    performed_at DATE       NOT NULL DEFAULT CURRENT_DATE,
    description TEXT        NOT NULL,
    created_by  BIGINT      NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_maintenances_asset ON asset_maintenances(asset_id, performed_at DESC);

-- ---------------------------------------------------------------------
-- Trigger: mantem updated_at atualizado
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tickets_touch   ON tickets;
CREATE TRIGGER trg_tickets_touch
    BEFORE UPDATE ON tickets
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_users_touch     ON users;
CREATE TRIGGER trg_users_touch
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_entities_touch  ON entities;
CREATE TRIGGER trg_entities_touch
    BEFORE UPDATE ON entities
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();