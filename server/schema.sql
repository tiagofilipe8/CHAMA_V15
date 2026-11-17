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

-- =====================================================================
-- Etapa 1 (Grupo Beija-Flor / ORCIM)
-- Perfis, postos, observadores, urgencia, categorias simples x complexas,
-- data de necessidade x previsao, historico completo e notas internas.
-- Todas as alteracoes sao idempotentes (podem rodar varias vezes).
-- =====================================================================

-- Perfis:
--   admin       = Administrador Mestre (todas as empresas)
--   admin_local = Administrador Local (somente a propria empresa)
--   moderator   = Moderador (triagem: atribui tecnico, categoria, urgencia,
--                 previsao e observadores)
--   technician  = Tecnico
--   client      = client_level 1 -> Usuario | client_level 2 -> Gestor
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'admin_local', 'moderator', 'technician', 'client'));

-- Localizacoes / postos (cada posto pertence a uma empresa)
CREATE TABLE IF NOT EXISTS locations (
    id          BIGSERIAL PRIMARY KEY,
    entity_id   BIGINT      NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    code        TEXT,
    address     TEXT,
    city        TEXT,
    state       TEXT,
    active      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_locations_entity ON locations(entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_locations_entity_name ON locations(entity_id, lower(name));

-- Usuario: posto principal
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL;

-- Gestor: empresas adicionais que acompanha (alem da empresa principal)
CREATE TABLE IF NOT EXISTS user_entities (
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_id  BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, entity_id)
);

-- Categorias
--   kind = 'complex' -> arvore detalhada (ex.: Rede > Problemas de conexao > DNS)
--   kind = 'simple'  -> lista facil para o usuario, com icone. Cada simples
--                       aponta (maps_to_id) para uma complexa: o chamado e
--                       sempre gravado na complexa, entao os dados ficam iguais
--                       para todas as empresas.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS examples TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'complex';
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_kind_check;
ALTER TABLE categories ADD CONSTRAINT categories_kind_check CHECK (kind IN ('complex', 'simple'));
ALTER TABLE categories ADD COLUMN IF NOT EXISTS maps_to_id BIGINT REFERENCES categories(id) ON DELETE SET NULL;

-- Empresa: modo de categorias mostrado aos usuarios dela.
-- Empresas que ja existiam continuam no modo complexo; novas comecam no simples.
ALTER TABLE entities ADD COLUMN IF NOT EXISTS category_mode TEXT NOT NULL DEFAULT 'complex';
ALTER TABLE entities ALTER COLUMN category_mode SET DEFAULT 'simple';
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_category_mode_check;
ALTER TABLE entities ADD CONSTRAINT entities_category_mode_check CHECK (category_mode IN ('simple', 'complex'));

-- Niveis de urgencia (o administrador pode criar outros).
-- priority = prioridade interna equivalente (1 baixa .. 4 urgente), usada no SLA/painel.
CREATE TABLE IF NOT EXISTS impact_levels (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT     NOT NULL UNIQUE,
    description TEXT,
    examples    TEXT,
    priority    SMALLINT NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 4),
    sort_order  INTEGER  NOT NULL DEFAULT 0,
    active      BOOLEAN  NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO impact_levels (name, description, examples, priority, sort_order)
SELECT v.* FROM (VALUES
  ('Requisição', 'Pedido ou solicitação. Nada está parado.',
   'Criar e-mail; solicitar material; configurar PC novo; instalar programa', 1::smallint, 1),
  ('Operação prejudicada', 'Dá para trabalhar, mas com dificuldade.',
   'Internet lenta; impressora com defeito; computador lento; existe outro equipamento disponível', 2::smallint, 2),
  ('Parada iminente', 'Ainda funciona, mas pode parar a qualquer momento.',
   'Nobreak apitando; equipamento falhando; certificado vencendo', 3::smallint, 3),
  ('Operação parada', 'Não é possível trabalhar ou vender.',
   'PDV parado; pagamento impossível; nota fiscal bloqueada; sem internet', 4::smallint, 4)
) AS v(name, description, examples, priority, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM impact_levels);

-- Chamado: posto, urgencia, datas, moderador e categoria simples escolhida
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS impact_id BIGINT REFERENCES impact_levels(id) ON DELETE SET NULL;
UPDATE tickets t SET impact_id = (SELECT il.id FROM impact_levels il
                                   WHERE il.priority = t.priority
                                   ORDER BY il.sort_order LIMIT 1)
 WHERE t.impact_id IS NULL;
-- data de necessidade (informada pelo usuario) x previsao (definida pelo suporte) x SLA (due_at)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS needed_by DATE;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS estimated_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_moderator_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS simple_category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_location ON tickets(location_id);

-- Observadores do chamado
CREATE TABLE IF NOT EXISTS ticket_watchers (
    id         BIGSERIAL PRIMARY KEY,
    ticket_id  BIGINT      NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by   BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (ticket_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_watchers_user ON ticket_watchers(user_id);

-- Historico / auditoria completo (alem do historico de status)
CREATE TABLE IF NOT EXISTS ticket_history (
    id         BIGSERIAL PRIMARY KEY,
    ticket_id  BIGINT      NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id    BIGINT      REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT        NOT NULL,
    old_value  TEXT,
    new_value  TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket ON ticket_history(ticket_id, created_at);

-- Mensagens: 'internal' = nota interna da equipe (nao aparece para clientes)
ALTER TABLE ticket_messages DROP CONSTRAINT IF EXISTS ticket_messages_kind_check;
ALTER TABLE ticket_messages ADD CONSTRAINT ticket_messages_kind_check
    CHECK (kind IN ('comment', 'note', 'system', 'approval', 'internal'));

-- Garante uma categoria complexa pelo caminho (cria os niveis que faltarem)
CREATE OR REPLACE FUNCTION chama_ensure_category(path TEXT[]) RETURNS BIGINT AS $$
DECLARE
    parent BIGINT := NULL;
    cur    BIGINT;
    part   TEXT;
BEGIN
    FOREACH part IN ARRAY path LOOP
        cur := NULL;
        SELECT id INTO cur FROM categories
         WHERE lower(name) = lower(part) AND kind = 'complex'
           AND parent_id IS NOT DISTINCT FROM parent
         ORDER BY id LIMIT 1;
        IF cur IS NULL THEN
            INSERT INTO categories (name, parent_id, kind) VALUES (part, parent, 'complex')
            RETURNING id INTO cur;
        END IF;
        parent := cur;
    END LOOP;
    RETURN parent;
END;
$$ LANGUAGE plpgsql;

-- Categorias simples padrao (lista ORCIM / Beija-Flor) e para qual complexa
-- cada uma aponta. So cria quando ainda nao existe nenhuma categoria simples.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM categories WHERE kind = 'simple') THEN
    INSERT INTO categories (name, icon, description, examples, sort_order, kind, maps_to_id)
    SELECT v.name, v.icon, v.description, v.examples, v.ord, 'simple', chama_ensure_category(v.path)
    FROM (VALUES
      ('Computador com problema', '💻', 'O computador não liga, trava, está lento ou com erro.',
       'Não liga; tela azul; muito lento; travando', 1, ARRAY['Hardware', 'Computador']),
      ('Internet ou rede', '🌐', 'Sem internet, internet lenta ou problema de rede/Wi-Fi.',
       'Sem internet; Wi-Fi caiu; rede lenta', 2, ARRAY['Rede', 'Problemas de conexão']),
      ('Sistema ou programa', '🧾', 'Erro ou dúvida em algum sistema ou programa.',
       'PDV com erro; sistema não abre; programa travando', 3, ARRAY['Software', 'Sistemas Corporativos']),
      ('Impressora ou impressão', '🖨️', 'A impressora não imprime, atola papel ou está sem tinta/toner.',
       'Não imprime; papel atolado; sem toner', 4, ARRAY['Hardware', 'Impressora']),
      ('Acesso ou senha', '🔐', 'Senha bloqueada, esqueceu a senha ou precisa de acesso.',
       'Senha bloqueada; novo acesso; permissão', 5, ARRAY['Suporte', 'Acesso / Credenciais']),
      ('Nota fiscal / certificado', '📄', 'Problema para emitir nota fiscal ou com certificado digital.',
       'Nota não emite; certificado vencido', 6, ARRAY['Software', 'Nota fiscal / Certificado digital']),
      ('Equipamentos ou periféricos', '🔧', 'Mouse, teclado, monitor, leitor ou outro equipamento.',
       'Mouse quebrado; monitor sem imagem; leitor não lê', 7, ARRAY['Hardware', 'Monitor / Periférico']),
      ('Problemas elétricos (nobreak ou outros)', '⚡', 'Nobreak, tomada, energia ou outro problema elétrico.',
       'Nobreak apitando; sem energia; tomada queimada', 8, ARRAY['Infraestrutura', 'Energia / Nobreak'])
    ) AS v(name, icon, description, examples, ord, path);
    -- detalhamento usado pela equipe no modo complexo
    PERFORM chama_ensure_category(ARRAY['Rede', 'Problemas de conexão', 'DNS']);
    PERFORM chama_ensure_category(ARRAY['Rede', 'Problemas de conexão', 'Sem internet']);
    PERFORM chama_ensure_category(ARRAY['Rede', 'Problemas de conexão', 'Wi-Fi']);
  END IF;
END $$;

-- Caminho completo de uma categoria (ex.: "Rede > Problemas de conexão > DNS")
CREATE OR REPLACE FUNCTION chama_category_path(cid BIGINT) RETURNS TEXT AS $$
  WITH RECURSIVE up AS (
    SELECT id, parent_id, name, 0 AS depth FROM categories WHERE id = cid
    UNION ALL
    SELECT c.id, c.parent_id, c.name, up.depth + 1 FROM categories c JOIN up ON c.id = up.parent_id
  )
  SELECT string_agg(name, ' > ' ORDER BY depth DESC) FROM up;
$$ LANGUAGE sql STABLE;

-- Categoria simples que corresponde a uma complexa (procura nela e nas "maes")
CREATE OR REPLACE FUNCTION chama_simple_for(cid BIGINT) RETURNS BIGINT AS $$
  WITH RECURSIVE up AS (
    SELECT id, parent_id, 0 AS depth FROM categories WHERE id = cid
    UNION ALL
    SELECT c.id, c.parent_id, up.depth + 1 FROM categories c JOIN up ON c.id = up.parent_id
  )
  SELECT s.id FROM up
  JOIN categories s ON s.maps_to_id = up.id AND s.kind = 'simple' AND s.active
  ORDER BY up.depth, s.sort_order, s.id LIMIT 1;
$$ LANGUAGE sql STABLE;


-- =====================================================================
-- Encerramento do chamado: o que aconteceu, causa, acao no equipamento
-- e nota (0 a 5 estrelas) dada pela equipe ao usuario que abriu o chamado.
-- =====================================================================
CREATE TABLE IF NOT EXISTS resolution_causes (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT     NOT NULL UNIQUE,
    description TEXT,
    sort_order  INTEGER  NOT NULL DEFAULT 0,
    active      BOOLEAN  NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO resolution_causes (name, description, sort_order)
SELECT v.* FROM (VALUES
  ('Erro do usuário', 'Uso incorreto, configuração alterada ou passo esquecido pelo usuário.', 1),
  ('Acidente', 'Dano físico sem intenção: queda, líquido derramado, cabo puxado.', 2),
  ('Mau uso / negligência', 'Uso indevido ou descuido repetido com o equipamento.', 3),
  ('Falha do equipamento', 'Defeito, desgaste ou peça queimada (hardware).', 4),
  ('Falha de software / sistema', 'Erro de programa, atualização, vírus ou sistema fora do ar.', 5),
  ('Problema de rede / internet', 'Rede interna, Wi-Fi ou operadora de internet.', 6),
  ('Problema elétrico', 'Queda de energia, nobreak, tomada ou surto elétrico.', 7),
  ('Fornecedor externo', 'Causa em sistema, serviço ou equipamento de terceiros.', 8),
  ('Solicitação / serviço planejado', 'Não houve falha: instalação, configuração, troca preventiva ou pedido.', 9),
  ('Causa não identificada', 'Resolvido, mas não foi possível descobrir a causa.', 10)
) AS v(name, description, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM resolution_causes);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution_notes TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolution_cause_id BIGINT REFERENCES resolution_causes(id) ON DELETE SET NULL;
-- equipment_action: repaired | adjusted | part_replaced | replaced | sent_external | no_change | discarded | no_equipment
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS equipment_action TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS requester_rating SMALLINT;
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_requester_rating_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_requester_rating_check CHECK (requester_rating BETWEEN 0 AND 5);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS requester_rating_comment TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_by_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

-- =====================================================================
-- Perfis e permissoes: o que cada perfil pode fazer (caixas de selecao no
-- menu do administrador). O Administrador Mestre sempre pode tudo.
-- Os valores padrao sao gravados pelo init.js (server/permissions.js).
-- =====================================================================
CREATE TABLE IF NOT EXISTS role_permissions (
    role_key   TEXT        NOT NULL,
    permission TEXT        NOT NULL,
    allowed    BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role_key, permission)
);

-- Numero do chamado sem o prefixo "CH-" (ex.: CH-2026-00102 -> 2026-00102)
UPDATE tickets SET number = substr(number, 4) WHERE number LIKE 'CH-%';

-- @@INVENTARIO@@  (o init.js cria as tabelas de inventario neste ponto)
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

DROP TRIGGER IF EXISTS trg_locations_touch ON locations;
CREATE TRIGGER trg_locations_touch
    BEFORE UPDATE ON locations
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
