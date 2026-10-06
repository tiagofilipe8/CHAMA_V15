-- =====================================================================
-- Painel Beija-Flor — módulo à parte, com login próprio.
-- Tudo aqui usa o prefixo gbf_ e NUNCA altera as tabelas da Central
-- (tickets, users, entities...). Das tabelas da Central o módulo só lê.
-- Aplicado automaticamente na subida do servidor (idempotente).
-- =====================================================================

-- Usuários do painel (independentes de "users" da Central)
-- papel: gestor  = vê tudo, cria atividades para qualquer um, gerencia usuários
--        tecnico = vê as demandas e cuida das próprias atividades
CREATE TABLE IF NOT EXISTS gbf_users (
    id                   BIGSERIAL PRIMARY KEY,
    username             TEXT        NOT NULL UNIQUE,
    password_hash        TEXT        NOT NULL,
    name                 TEXT        NOT NULL,
    email                TEXT,
    phone                TEXT,
    role                 TEXT        NOT NULL DEFAULT 'tecnico'
                         CHECK (role IN ('gestor', 'tecnico')),
    active               BOOLEAN     NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN     NOT NULL DEFAULT FALSE,
    last_login           TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Atividades do nosso técnico
-- status: a_fazer | em_andamento | aguardando | concluida | cancelada
-- prioridade: 1 baixa | 2 normal | 3 alta | 4 urgente
CREATE TABLE IF NOT EXISTS gbf_tasks (
    id               BIGSERIAL PRIMARY KEY,
    title            TEXT        NOT NULL,
    description      TEXT,
    status           TEXT        NOT NULL DEFAULT 'a_fazer'
                     CHECK (status IN ('a_fazer','em_andamento','aguardando','concluida','cancelada')),
    priority         SMALLINT    NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 4),
    assignee_id      BIGINT      REFERENCES gbf_users(id) ON DELETE SET NULL,
    created_by       BIGINT      REFERENCES gbf_users(id) ON DELETE SET NULL,
    ticket_id        BIGINT,     -- chamado da Central relacionado (só referência, sem FK)
    location         TEXT,
    due_at           TIMESTAMPTZ,
    started_at       TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    due_soon_notified BOOLEAN    NOT NULL DEFAULT FALSE,
    overdue_notified BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gbf_tasks_assignee ON gbf_tasks(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_gbf_tasks_due      ON gbf_tasks(due_at) WHERE status NOT IN ('concluida','cancelada');
CREATE INDEX IF NOT EXISTS idx_gbf_tasks_ticket   ON gbf_tasks(ticket_id);

-- Histórico das atividades (comentários e mudanças) — nunca apagado
CREATE TABLE IF NOT EXISTS gbf_task_events (
    id         BIGSERIAL PRIMARY KEY,
    task_id    BIGINT      NOT NULL REFERENCES gbf_tasks(id) ON DELETE CASCADE,
    user_id    BIGINT      REFERENCES gbf_users(id) ON DELETE SET NULL,
    kind       TEXT        NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment','system')),
    content    TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gbf_task_events_task ON gbf_task_events(task_id, created_at);

-- Notificações do painel (sino)
CREATE TABLE IF NOT EXISTS gbf_notifications (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES gbf_users(id) ON DELETE CASCADE,
    kind       TEXT        NOT NULL,
    title      TEXT        NOT NULL,
    message    TEXT,
    link       TEXT,
    is_read    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gbf_notif_user ON gbf_notifications(user_id, is_read, created_at DESC);

-- Último estado visto de cada chamado da Central (para avisar novidades)
CREATE TABLE IF NOT EXISTS gbf_ticket_watch (
    ticket_id     BIGINT PRIMARY KEY,
    last_status   SMALLINT,
    sla_notified  BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Configurações do painel (chave / valor JSON)
CREATE TABLE IF NOT EXISTS gbf_settings (
    key        TEXT PRIMARY KEY,
    value      JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- Rotina do técnico (Prompt do TI): postos, checklists, visitas,
-- solicitações do gestor. Fluxo: POSTO -> AGENDA -> VISITA -> CHECKLIST
-- -> CONCLUSÃO -> HISTÓRICO.
-- =====================================================================

-- Modelos de checklist
CREATE TABLE IF NOT EXISTS gbf_checklists (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT        NOT NULL,
    description TEXT,
    active      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gbf_checklist_items (
    id           BIGSERIAL PRIMARY KEY,
    checklist_id BIGINT  NOT NULL REFERENCES gbf_checklists(id) ON DELETE CASCADE,
    label        TEXT    NOT NULL,
    position     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gbf_checklist_items ON gbf_checklist_items(checklist_id, position);

-- Postos / unidades visitadas
-- frequency: semanal | quinzenal | mensal | dias (a cada X dias) | nenhuma
CREATE TABLE IF NOT EXISTS gbf_locations (
    id               BIGSERIAL PRIMARY KEY,
    name             TEXT        NOT NULL,
    address          TEXT,
    contact_name     TEXT,
    phone            TEXT,
    notes            TEXT,
    entity_id        BIGINT,     -- empresa correspondente na Central/Orcim (só referência)
    checklist_id     BIGINT      REFERENCES gbf_checklists(id) ON DELETE SET NULL,
    frequency        TEXT        NOT NULL DEFAULT 'nenhuma'
                     CHECK (frequency IN ('semanal','quinzenal','mensal','dias','nenhuma')),
    frequency_days   INTEGER,
    last_visit_at    TIMESTAMPTZ,
    next_visit_date  DATE,
    next_visit_time  TIME,
    visit_notified_date DATE,
    active           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gbf_locations_next ON gbf_locations(next_visit_date) WHERE active;

-- Visitas realizadas (o checklist é copiado para a visita: mudar o modelo
-- depois não altera o histórico)
CREATE TABLE IF NOT EXISTS gbf_visits (
    id             BIGSERIAL PRIMARY KEY,
    location_id    BIGINT      NOT NULL REFERENCES gbf_locations(id) ON DELETE CASCADE,
    user_id        BIGINT      REFERENCES gbf_users(id) ON DELETE SET NULL,
    status         TEXT        NOT NULL DEFAULT 'em_andamento'
                   CHECK (status IN ('em_andamento','concluida','cancelada')),
    scheduled_for  DATE,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at    TIMESTAMPTZ,
    checklist_name TEXT,
    notes          TEXT,
    pending_notes  TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gbf_visits_location ON gbf_visits(location_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_gbf_visits_status   ON gbf_visits(status, started_at DESC);

CREATE TABLE IF NOT EXISTS gbf_visit_answers (
    id         BIGSERIAL PRIMARY KEY,
    visit_id   BIGINT  NOT NULL REFERENCES gbf_visits(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL DEFAULT 0,
    item_label TEXT    NOT NULL,
    answer     TEXT    CHECK (answer IN ('ok','nao_ok','na')),
    note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_gbf_visit_answers ON gbf_visit_answers(visit_id, position);

CREATE TABLE IF NOT EXISTS gbf_visit_photos (
    id           BIGSERIAL PRIMARY KEY,
    visit_id     BIGINT      NOT NULL REFERENCES gbf_visits(id) ON DELETE CASCADE,
    file_name    TEXT        NOT NULL,
    storage_path TEXT        NOT NULL,
    mime_type    TEXT,
    file_size    BIGINT,
    uploaded_by  BIGINT      REFERENCES gbf_users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Solicitações do gestor para a TI
CREATE TABLE IF NOT EXISTS gbf_requests (
    id            BIGSERIAL PRIMARY KEY,
    title         TEXT        NOT NULL,
    description   TEXT,
    location_id   BIGINT      REFERENCES gbf_locations(id) ON DELETE SET NULL,
    priority      SMALLINT    NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 4),
    desired_date  DATE,
    status        TEXT        NOT NULL DEFAULT 'a_fazer'
                  CHECK (status IN ('a_fazer','em_andamento','concluida','cancelada')),
    requested_by  BIGINT      REFERENCES gbf_users(id) ON DELETE SET NULL,
    handled_by    BIGINT      REFERENCES gbf_users(id) ON DELETE SET NULL,
    response      TEXT,
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gbf_requests_status ON gbf_requests(status, created_at DESC);

-- Atividades podem pertencer a um posto
ALTER TABLE gbf_tasks ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES gbf_locations(id) ON DELETE SET NULL;
ALTER TABLE gbf_tasks ADD COLUMN IF NOT EXISTS visit_id BIGINT REFERENCES gbf_visits(id) ON DELETE SET NULL;
