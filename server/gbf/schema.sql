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
