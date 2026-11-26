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

-- Cópia de TODAS as tabelas da Central da Orcim (integração global, server/integracao-beijaflor)
CREATE TABLE IF NOT EXISTS gbf_espelho (
    tabela        TEXT        NOT NULL,
    chave         TEXT        NOT NULL,
    dados         JSONB       NOT NULL,
    recebido_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tabela, chave)
);
CREATE INDEX IF NOT EXISTS idx_gbf_espelho_recebido ON gbf_espelho(tabela, recebido_em DESC);

-- Login unico: liga o usuario do painel ao usuario da Central (menu unico em /app.html)
ALTER TABLE gbf_users ADD COLUMN IF NOT EXISTS central_user_id BIGINT UNIQUE;
-- Posto do Dia a dia = localização da Central (cadastro único em Administração > Localizações)
ALTER TABLE gbf_locations ADD COLUMN IF NOT EXISTS central_location_id BIGINT UNIQUE;


-- Solicitação de visita: o gestor escolhe o posto, a data desejada, a urgência e as tarefas
-- (tiradas dos checklists). Quando a TI inicia a visita pela solicitação, as tarefas viram o
-- checklist da visita; ao concluir a visita, a solicitação se fecha sozinha.
ALTER TABLE gbf_requests ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'geral';
ALTER TABLE gbf_requests DROP CONSTRAINT IF EXISTS gbf_requests_kind_check;
ALTER TABLE gbf_requests ADD CONSTRAINT gbf_requests_kind_check CHECK (kind IN ('geral','visita'));
ALTER TABLE gbf_requests ADD COLUMN IF NOT EXISTS visit_id BIGINT REFERENCES gbf_visits(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS gbf_request_items (
    id          BIGSERIAL PRIMARY KEY,
    request_id  BIGINT  NOT NULL REFERENCES gbf_requests(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL DEFAULT 0,
    label       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gbf_request_items_request ON gbf_request_items(request_id, position);
ALTER TABLE gbf_visits ADD COLUMN IF NOT EXISTS request_id BIGINT REFERENCES gbf_requests(id) ON DELETE SET NULL;

-- Tipo da solicitação de visita: de rotina (checklist do posto) ou pontual (pedido específico)
ALTER TABLE gbf_requests ADD COLUMN IF NOT EXISTS visit_type TEXT;
ALTER TABLE gbf_requests DROP CONSTRAINT IF EXISTS gbf_requests_visit_type_check;
ALTER TABLE gbf_requests ADD CONSTRAINT gbf_requests_visit_type_check CHECK (visit_type IS NULL OR visit_type IN ('rotina','pontual'));

-- Reagendamentos (visita do posto, solicitação ou atividade), sempre com o motivo.
-- Quem reagenda avisa os outros pelo sino de notificações.
CREATE TABLE IF NOT EXISTS gbf_reschedules (
    id          BIGSERIAL PRIMARY KEY,
    kind        TEXT        NOT NULL CHECK (kind IN ('posto','solicitacao','atividade')),
    ref_id      BIGINT      NOT NULL,
    old_date    DATE,
    new_date    DATE,
    reason      TEXT        NOT NULL,
    user_id     BIGINT      REFERENCES gbf_users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gbf_reschedules_ref ON gbf_reschedules(kind, ref_id, created_at DESC);

-- Papéis: um gestor também pode fazer visitas (ser técnico). Ex.: o Lucas é gestor e técnico.
ALTER TABLE gbf_users ADD COLUMN IF NOT EXISTS faz_visitas BOOLEAN NOT NULL DEFAULT FALSE;

-- Atividade sem horário = o dia todo (vence às 23:59 daquele dia)
ALTER TABLE gbf_tasks ADD COLUMN IF NOT EXISTS all_day BOOLEAN NOT NULL DEFAULT FALSE;

-- Atividade de vários dias: dia em que começa (o prazo é a entrega)
ALTER TABLE gbf_tasks ADD COLUMN IF NOT EXISTS start_date DATE;

-- Atividade "Aguardando": o que está esperando (peça, resposta, aprovação...)
ALTER TABLE gbf_tasks ADD COLUMN IF NOT EXISTS waiting_for TEXT;

-- Causas de encerramento vindas da Orcim: lá cada empresa pode ter a sua lista (nomes repetem
-- entre perfis) e existe a causa "neutra" (aberto por engano). Aqui só guardamos para contar.
DO $$
BEGIN
  IF to_regclass('public.resolution_causes') IS NOT NULL THEN
    ALTER TABLE resolution_causes ADD COLUMN IF NOT EXISTS neutral BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE resolution_causes ADD COLUMN IF NOT EXISTS profile_id BIGINT;
    ALTER TABLE resolution_causes DROP CONSTRAINT IF EXISTS resolution_causes_name_key;
  END IF;
END $$;

-- Coordenadas do posto (rotas). A localização da Orcim também guarda as dela (vêm na cópia).
ALTER TABLE gbf_locations ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6);
ALTER TABLE gbf_locations ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6);
DO $$
BEGIN
  IF to_regclass('public.locations') IS NOT NULL THEN
    ALTER TABLE locations ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6);
    ALTER TABLE locations ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6);
  END IF;
END $$;

-- Inventário próprio da TI do Beija-Flor (os itens da Orcim vêm da cópia, tabela assets)
CREATE TABLE IF NOT EXISTS gbf_inventario (
    id            BIGSERIAL PRIMARY KEY,
    nome          TEXT        NOT NULL,
    tipo          TEXT,
    marca         TEXT,
    modelo        TEXT,
    numero_serie  TEXT,
    patrimonio    TEXT,
    location_id   BIGINT      REFERENCES gbf_locations(id) ON DELETE SET NULL,
    setor         TEXT,
    responsavel   TEXT,
    estado        TEXT        NOT NULL DEFAULT 'OPERATING'
                  CHECK (estado IN ('OPERATING','REPAIR','BROKEN','ORDERED','READY','STOCK','DISPOSED','LOST')),
    origem        TEXT        NOT NULL DEFAULT 'Setor de Compras',
    preco         NUMERIC(12,2),
    data_compra   DATE,
    garantia_ate  DATE,
    observacoes   TEXT,
    created_by    BIGINT      REFERENCES gbf_users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gbf_inventario_posto ON gbf_inventario(location_id);
CREATE TABLE IF NOT EXISTS gbf_inventario_hist (
    id         BIGSERIAL PRIMARY KEY,
    item_id    BIGINT      NOT NULL REFERENCES gbf_inventario(id) ON DELETE CASCADE,
    user_id    BIGINT      REFERENCES gbf_users(id) ON DELETE SET NULL,
    texto      TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gbf_inventario_hist ON gbf_inventario_hist(item_id, created_at DESC);
-- Equipamentos da Orcim: posto e preço também vêm na cópia
DO $$
BEGIN
  IF to_regclass('public.assets') IS NOT NULL THEN
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS location_id BIGINT;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS price NUMERIC(12,2);
    -- a Orcim nova tem outros estados (Operando, Em conserto...): a cópia aceita os dois jeitos
    ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_status_check;
    ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_type_check;
  END IF;
END $$;
