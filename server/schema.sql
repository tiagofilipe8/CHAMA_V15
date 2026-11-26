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

-- =====================================================================
-- Contatos do WhatsApp (recepcao de chamados pelo WhatsApp).
-- Guarda o estado da identificacao de numeros que ainda nao sao usuarios.
--   status: new = primeira mensagem / awaiting_id = pediu identificacao
--           active = identificado (usuario criado) / blocked = desistiu
-- =====================================================================
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
    phone           TEXT PRIMARY KEY,
    user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','awaiting_id','active','blocked')),
    pending_message TEXT,
    pending_at      TIMESTAMPTZ,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_ticket_id  BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
    last_seen_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_contacts_user ON whatsapp_contacts(user_id);

-- Identificacao do chamado aberto pelo WhatsApp (para enviar a solucao de volta)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS via_whatsapp BOOLEAN NOT NULL DEFAULT FALSE;

-- Bancos ja criados antes desta coluna
ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS last_ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL;

-- Coleta guiada: nome -> empresa -> descricao (o chamado so abre no final)
ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS step TEXT NOT NULL DEFAULT 'name';
ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS draft_name TEXT;
ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS draft_empresa TEXT;
-- step so faz sentido durante a coleta (NULL quando o contato ja esta ativo)
ALTER TABLE whatsapp_contacts ALTER COLUMN step DROP NOT NULL;

-- @@INVENTARIO@@  (o init.js cria as tabelas de inventario neste ponto)
-- Migracao: data programada da proxima manutencao do ativo
ALTER TABLE assets ADD COLUMN IF NOT EXISTS next_maintenance_date DATE;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS toner TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS cilindro TEXT;
-- campos do cadastro manual que a tela e a API já usam (faltavam no schema: o cadastro dava erro)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS mac_address TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS memory_info TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS hd_info TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS cpu_info TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS os_info TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS license_info TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS webcam BOOLEAN;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS eth_port BOOLEAN;
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

-- ---------------------------------------------------------------------
-- Grupo Beija-Flor: empresa única e só categorias simples
-- ---------------------------------------------------------------------
INSERT INTO entities (name, category_mode) SELECT 'Grupo Beija-Flor', 'simple'
WHERE NOT EXISTS (SELECT 1 FROM entities);
UPDATE entities SET category_mode = 'simple' WHERE category_mode <> 'simple';

-- ---------------------------------------------------------------------
-- Pedido de material: lista de materiais (editada pelo administrador)
-- e os itens pedidos em cada chamado
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS materials (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT        NOT NULL,
    unit        TEXT,
    description TEXT,
    active      BOOLEAN     NOT NULL DEFAULT TRUE,
    sort_order  INTEGER     NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_materials_name ON materials (lower(name));

CREATE TABLE IF NOT EXISTS ticket_materials (
    id          BIGSERIAL PRIMARY KEY,
    ticket_id   BIGINT      NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    material_id BIGINT      REFERENCES materials(id) ON DELETE SET NULL,
    name        TEXT        NOT NULL,   -- nome guardado no pedido (não muda se o material for renomeado)
    unit        TEXT,
    quantity    INTEGER     NOT NULL CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS idx_ticket_materials_ticket ON ticket_materials(ticket_id);

-- categoria que abre a lista de materiais
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_material BOOLEAN NOT NULL DEFAULT FALSE;
INSERT INTO categories (name, kind, icon, description, examples, sort_order, is_material, active)
SELECT 'Pedido de material', 'simple', '📦', 'Peça algo que está faltando.', 'Toner; bobina; mouse; cabo', 0, TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE is_material);

-- alguns materiais para começar (o administrador edita em Administração > Materiais)
INSERT INTO materials (name, unit, sort_order)
SELECT v.name, v.unit, v.ord FROM (VALUES
  ('Toner / cartucho de impressora', 'un', 1), ('Bobina de impressora (PDV)', 'un', 2), ('Papel A4', 'resma', 3),
  ('Mouse', 'un', 4), ('Teclado', 'un', 5), ('Cabo de rede', 'un', 6), ('Fone / headset', 'un', 7)
) AS v(name, unit, ord)
WHERE NOT EXISTS (SELECT 1 FROM materials);

-- Administrador Local virou Gestor (2026-11-19)
-- O Gestor (role_key 'manager') ganha o que o Administrador Local tinha liberado
-- (menos as notas internas, que sao da equipe de TI). Depois os usuarios
-- Administrador Local passam a ser Gestor. Roda uma vez: nas proximas, nao ha
-- mais linhas 'admin_local'.
INSERT INTO role_permissions (role_key, permission, allowed, updated_at)
SELECT 'manager', permission, TRUE, now() FROM role_permissions
WHERE role_key = 'admin_local' AND allowed AND permission <> 'ticket.internal'
ON CONFLICT (role_key, permission) DO UPDATE SET allowed = TRUE, updated_at = now();
DELETE FROM role_permissions WHERE role_key = 'admin_local';
UPDATE users SET role = 'client', client_level = 2 WHERE role = 'admin_local';

-- Dia a dia da TI saiu da Central (era outro sistema, 2026-11-19): some das permissoes.
-- As tabelas gbf_* nao sao apagadas aqui (os dados ficam guardados no banco).
DELETE FROM role_permissions WHERE permission IN ('ti.view', 'ti.manage');

-- =====================================================================
-- Perfis de opções (2026-11-19)
-- O que já existe (profile_id NULL) é o perfil "Padrão", que não pode ser alterado.
-- Cada perfil novo começa como cópia do Padrão (categorias, urgências e causas) e
-- pode ser editado. Cada empresa escolhe o perfil que usa (option_profile_id NULL = Padrão).
-- Apagar um perfil marca deleted_at e devolve as empresas ao Padrão; as opções dele ficam
-- guardadas porque os chamados antigos continuam apontando para elas.
-- =====================================================================
CREATE TABLE IF NOT EXISTS option_profiles (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT        NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);
ALTER TABLE categories        ADD COLUMN IF NOT EXISTS profile_id BIGINT REFERENCES option_profiles(id);
ALTER TABLE impact_levels     ADD COLUMN IF NOT EXISTS profile_id BIGINT REFERENCES option_profiles(id);
ALTER TABLE resolution_causes ADD COLUMN IF NOT EXISTS profile_id BIGINT REFERENCES option_profiles(id);
ALTER TABLE entities          ADD COLUMN IF NOT EXISTS option_profile_id BIGINT REFERENCES option_profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_categories_profile ON categories(profile_id);
CREATE INDEX IF NOT EXISTS idx_impact_levels_profile ON impact_levels(profile_id);
CREATE INDEX IF NOT EXISTS idx_resolution_causes_profile ON resolution_causes(profile_id);
-- o nome passa a ser único dentro de cada perfil (antes era único no sistema todo)
ALTER TABLE impact_levels DROP CONSTRAINT IF EXISTS impact_levels_name_key;
ALTER TABLE resolution_causes DROP CONSTRAINT IF EXISTS resolution_causes_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_impact_levels_perfil_nome ON impact_levels (COALESCE(profile_id, 0), name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_resolution_causes_perfil_nome ON resolution_causes (COALESCE(profile_id, 0), name);
-- empresa apontando para perfil apagado volta ao Padrão
UPDATE entities e SET option_profile_id = NULL
 WHERE option_profile_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM option_profiles p WHERE p.id = e.option_profile_id AND p.deleted_at IS NOT NULL);

-- =====================================================================
-- Causa neutra no encerramento: chamado aberto por engano, duplicado ou
-- que já se resolveu sozinho. Com ela só a causa é obrigatória.
-- Existe no Padrão e em cada perfil de opções.
-- =====================================================================
ALTER TABLE resolution_causes ADD COLUMN IF NOT EXISTS neutral BOOLEAN NOT NULL DEFAULT FALSE;
INSERT INTO resolution_causes (name, description, sort_order, active, neutral, profile_id)
SELECT 'Sem problema / aberto por engano',
       'Não havia nada para consertar: chamado aberto por engano, duplicado ou o problema já tinha sumido.',
       0, TRUE, TRUE, p.id
  FROM (SELECT NULL::bigint AS id UNION ALL SELECT id FROM option_profiles WHERE deleted_at IS NULL) p
 WHERE NOT EXISTS (SELECT 1 FROM resolution_causes rc
                    WHERE rc.neutral AND COALESCE(rc.profile_id, 0) = COALESCE(p.id, 0))
   AND NOT EXISTS (SELECT 1 FROM resolution_causes rc
                    WHERE rc.name = 'Sem problema / aberto por engano' AND COALESCE(rc.profile_id, 0) = COALESCE(p.id, 0));
UPDATE resolution_causes SET neutral = TRUE
 WHERE name = 'Sem problema / aberto por engano' AND NOT neutral;

-- Localização: latitude e longitude (para mapa e rotas)
ALTER TABLE locations ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6);

-- Em atendimento (2026-11-23): o chamado que cada técnico está atendendo agora
ALTER TABLE users ADD COLUMN IF NOT EXISTS working_ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS working_since TIMESTAMPTZ;
-- resolveu, fechou, cancelou ou trocou o técnico: quem estava atendendo deixa de estar
CREATE OR REPLACE FUNCTION chama_limpa_atendimento() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN (5, 6, 7) THEN
    UPDATE users SET working_ticket_id = NULL, working_since = NULL WHERE working_ticket_id = NEW.id;
  ELSIF NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id THEN
    UPDATE users SET working_ticket_id = NULL, working_since = NULL
     WHERE working_ticket_id = NEW.id AND id IS DISTINCT FROM NEW.assigned_user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_chama_limpa_atendimento ON tickets;
CREATE TRIGGER trg_chama_limpa_atendimento AFTER UPDATE OF status, assigned_user_id ON tickets
  FOR EACH ROW EXECUTE FUNCTION chama_limpa_atendimento();

-- Observadores tirados do sistema (2026-11-23): some a permissão. A tabela ticket_watchers
-- fica guardada (histórico), mas não dá mais acesso nem avisos.
DELETE FROM role_permissions WHERE permission = 'ticket.watchers';

-- =====================================================================
-- Chat interno (2026-11-24): conversas diretas e grupos, com @ e #
-- =====================================================================
CREATE TABLE IF NOT EXISTS chat_conversations (
    id              BIGSERIAL PRIMARY KEY,
    kind            TEXT NOT NULL CHECK (kind IN ('direct','group')),
    name            TEXT,
    direct_key      TEXT UNIQUE,           -- "12:34" (as duas pessoas da conversa direta)
    created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_message_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS chat_members (
    conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_at    TIMESTAMPTZ,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
CREATE TABLE IF NOT EXISTS chat_messages (
    id              BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, id DESC);
-- aviso que abre outra tela (ex.: citação no chat abre a conversa)
ALTER TABLE inapp_notifications ADD COLUMN IF NOT EXISTS link TEXT;

-- =====================================================================
-- Inventário e Estoque de T.I. (2026-11-24)
--   local do posto, preço, AnyDesk e acesso mestre da Orcim (senhas criptografadas),
--   estados novos com cores, razões de retirada (por perfil de opções) e movimentações.
-- =====================================================================
ALTER TABLE assets ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS price NUMERIC(12,2);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS anydesk_id TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS anydesk_password_enc TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS master_user_enc TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS master_password_enc TEXT;
CREATE INDEX IF NOT EXISTS idx_assets_location ON assets(location_id);
-- estados: Operando, Em conserto, Estragado, Comprado (aguardando chegar), Pronto para entregar, Em estoque
-- (+ Descartado e Extraviado, que já existiam)
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_status_check;
UPDATE assets SET status = 'OPERATING' WHERE status = 'ACTIVE';
UPDATE assets SET status = 'REPAIR'    WHERE status = 'MAINTENANCE';
UPDATE assets SET status = 'BROKEN'    WHERE status = 'INACTIVE';
ALTER TABLE assets ADD CONSTRAINT assets_status_check
  CHECK (status IN ('OPERATING','REPAIR','BROKEN','ORDERED','READY','STOCK','DISPOSED','LOST'));
ALTER TABLE assets ALTER COLUMN status SET DEFAULT 'OPERATING';
-- categoria nova: periférico / acessório (mouse, teclado, cabo, headset...)
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_type_check
  CHECK (type IN ('COMPUTER','NOTEBOOK','SERVER','PRINTER','MONITOR','UPS','NETWORK_DEVICE','MOBILE_DEVICE','PERIPHERAL','OTHER'));

-- Razões de retirada do estoque (Categorias e opções > Razões de retirada)
CREATE TABLE IF NOT EXISTS stock_reasons (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    profile_id  BIGINT REFERENCES option_profiles(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_reasons_perfil_nome ON stock_reasons (COALESCE(profile_id, 0), name);
-- razões padrão (no Padrão e em cada perfil de opções que ainda não tem nenhuma)
INSERT INTO stock_reasons (name, description, sort_order, profile_id)
SELECT v.name, v.description, v.ord, p.id
  FROM (VALUES
    ('O outro item estragou', 'O equipamento que estava em uso quebrou e não tem conserto rápido.', 1),
    ('O outro item está em conserto', 'Substituição temporária enquanto o equipamento é consertado.', 2),
    ('Funcionário novo ou posto novo', 'Primeiro equipamento de uma pessoa, caixa, setor ou unidade nova.', 3),
    ('Troca por um melhor (upgrade)', 'O equipamento atual funciona, mas não dá conta do serviço.', 4),
    ('Perda, furto ou roubo', 'O equipamento anterior sumiu.', 5),
    ('Acidente (queda, líquido, raio)', 'O equipamento anterior foi danificado por acidente.', 6),
    ('Uso temporário ou evento', 'Empréstimo por um período; deve voltar ao estoque.', 7),
    ('Reposição de consumível', 'Toner, cabo, mouse, teclado e outros itens que gastam.', 8),
    ('Outro', 'Explique na observação.', 99)
  ) AS v(name, description, ord)
  CROSS JOIN (SELECT NULL::bigint AS id UNION ALL SELECT id FROM option_profiles WHERE deleted_at IS NULL) p
 WHERE NOT EXISTS (SELECT 1 FROM stock_reasons r WHERE COALESCE(r.profile_id, 0) = COALESCE(p.id, 0));

-- Movimentações do estoque (baixa, devolução, transferência, entrada): base do log e do relatório
CREATE TABLE IF NOT EXISTS stock_movements (
    id               BIGSERIAL PRIMARY KEY,
    asset_id         BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    kind             TEXT NOT NULL CHECK (kind IN ('entry','withdraw','return','transfer')),
    user_id          BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reason_id        BIGINT REFERENCES stock_reasons(id) ON DELETE SET NULL,
    reason_name      TEXT,
    from_entity_id   BIGINT REFERENCES entities(id) ON DELETE SET NULL,
    to_entity_id     BIGINT REFERENCES entities(id) ON DELETE SET NULL,
    from_location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    to_location_id   BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    price            NUMERIC(12,2),
    note             TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_mov_asset ON stock_movements(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_mov_data ON stock_movements(created_at DESC);

-- =====================================================================
-- Encerramento (2026-11-24)
--   - nota do usuário em checklist (5 itens, cada "sim" = 1 estrela)
--   - "Em pausa" com motivo e data para retomar (volta sozinho)
--   - técnico fecha direto; o usuário pode reabrir em até 3 dias
--   - o usuário fecha o próprio chamado com motivo, ou marca "resolvido"
--     e o técnico avalia depois (causa + checklist) para fechar
-- =====================================================================
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS requester_rating_criteria JSONB;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS pause_reason TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS pause_until DATE;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS pause_prev_status SMALLINT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS paused_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reopen_until TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS awaiting_evaluation BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closed_by_requester BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS requester_close_reason TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS requester_close_note TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS requester_close_ref BIGINT REFERENCES tickets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_pausa ON tickets(pause_until) WHERE status = 4;
-- mudanças feitas pelo próprio sistema (ex.: fim da pausa) não têm usuário
ALTER TABLE ticket_status_history ALTER COLUMN user_id DROP NOT NULL;
-- pausou, resolveu, fechou ou cancelou: quem estava atendendo deixa de estar
CREATE OR REPLACE FUNCTION chama_limpa_atendimento() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN (4, 5, 6, 7) THEN
    UPDATE users SET working_ticket_id = NULL, working_since = NULL WHERE working_ticket_id = NEW.id;
  ELSIF NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id THEN
    UPDATE users SET working_ticket_id = NULL, working_since = NULL
     WHERE working_ticket_id = NEW.id AND id IS DISTINCT FROM NEW.assigned_user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ajustes que rodam uma vez só (não desfazem o que o admin mudar depois)
CREATE TABLE IF NOT EXISTS schema_marcos (
    nome     TEXT PRIMARY KEY,
    feito_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- o técnico passa a poder fechar o chamado direto (o usuário ainda pode reabrir em até 3 dias)
DO $marco$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_marcos WHERE nome = 'tecnico_fecha_direto') THEN
    UPDATE role_permissions SET allowed = TRUE WHERE role_key = 'technician' AND permission = 'ticket.resolve_direct';
    INSERT INTO schema_marcos (nome) VALUES ('tecnico_fecha_direto');
  END IF;
END $marco$;

-- =====================================================================
-- Localizações: CEP em campo próprio (2026-11-25). O campo "Código" sai da tela.
-- O CEP que estava escrito dentro do endereço ("... · CEP 30516-120") vai para o campo CEP.
-- =====================================================================
ALTER TABLE locations ADD COLUMN IF NOT EXISTS cep TEXT;
UPDATE locations
   SET cep = regexp_replace(substring(address from '(?i)CEP[:\s]*(\d{5}-?\d{3})'), '^(\d{5})-?(\d{3})$', '\1-\2'),
       address = NULLIF(btrim(regexp_replace(address, '\s*[·,|]?\s*CEP[:\s]*\d{5}-?\d{3}', '', 'i'), ' ·,|–-'), '')
 WHERE cep IS NULL AND address ~* 'CEP[:\s]*\d{5}-?\d{3}';

-- =====================================================================
-- Manutenção pede o equipamento (2026-11-26)
--   categoria com requires_asset: quem abre escolhe o item do inventário, ou
--   "Não se aplica" (sem etiqueta, ex.: mouse) ou "Não encontrei a etiqueta" (a TI marca depois)
-- =====================================================================
ALTER TABLE categories ADD COLUMN IF NOT EXISTS requires_asset BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS asset_pendente BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS asset_nao_aplica BOOLEAN NOT NULL DEFAULT FALSE;
-- uma vez só: as categorias que já são de equipamento passam a pedir o item (o admin muda depois em Categorias e opções)
DO $marco$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_marcos WHERE nome = 'categorias_pedem_equipamento') THEN
    UPDATE categories SET requires_asset = TRUE
     WHERE kind = 'simple' AND NOT is_material
       AND name ~* '(computador|impressora|monitor|notebook|equipamento|nobreak|celular|tablet|pdv|leitor|balan)';
    INSERT INTO schema_marcos (nome) VALUES ('categorias_pedem_equipamento');
  END IF;
END $marco$;

-- =====================================================================
-- Pedidos de material: situação de cada item (2026-11-26)
--   solicitado (pedido) -> comprado -> chegou -> entregue (ou cancelado)
--   destino: para onde foi quando entregue (estoque de T.I. ou inventário) e o equipamento criado
-- =====================================================================
ALTER TABLE ticket_materials ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'solicitado';
ALTER TABLE ticket_materials ADD COLUMN IF NOT EXISTS status_at TIMESTAMPTZ;
ALTER TABLE ticket_materials ADD COLUMN IF NOT EXISTS status_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ticket_materials ADD COLUMN IF NOT EXISTS destino TEXT;
ALTER TABLE ticket_materials ADD COLUMN IF NOT EXISTS asset_id BIGINT REFERENCES assets(id) ON DELETE SET NULL;
ALTER TABLE ticket_materials DROP CONSTRAINT IF EXISTS ticket_materials_status_check;
ALTER TABLE ticket_materials ADD CONSTRAINT ticket_materials_status_check
  CHECK (status IN ('solicitado','comprado','chegou','entregue','cancelado'));
ALTER TABLE ticket_materials DROP CONSTRAINT IF EXISTS ticket_materials_destino_check;
ALTER TABLE ticket_materials ADD CONSTRAINT ticket_materials_destino_check
  CHECK (destino IS NULL OR destino IN ('estoque','inventario','nenhum'));

-- =====================================================================
-- Agenda de rotas (2026-11-26): dia, técnico e os locais na ordem de visita
-- =====================================================================
CREATE TABLE IF NOT EXISTS route_plans (
    id            BIGSERIAL PRIMARY KEY,
    data          DATE NOT NULL,
    technician_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    nota          TEXT,
    created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_route_plans_data ON route_plans(data);
CREATE TABLE IF NOT EXISTS route_plan_stops (
    id          BIGSERIAL PRIMARY KEY,
    plan_id     BIGINT NOT NULL REFERENCES route_plans(id) ON DELETE CASCADE,
    location_id BIGINT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    ordem       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_route_plan_stops_plan ON route_plan_stops(plan_id);
CREATE INDEX IF NOT EXISTS idx_route_plan_stops_loc ON route_plan_stops(location_id);

-- Pedido ligado ao inventário: preço unitário, posto de destino, categoria e os equipamentos criados (2026-11-26)
ALTER TABLE ticket_materials ADD COLUMN IF NOT EXISTS price NUMERIC(12,2);
ALTER TABLE ticket_materials ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE ticket_materials ADD COLUMN IF NOT EXISTS asset_type TEXT;
ALTER TABLE ticket_materials ADD COLUMN IF NOT EXISTS asset_ids BIGINT[] NOT NULL DEFAULT '{}';
UPDATE ticket_materials SET asset_ids = ARRAY[asset_id] WHERE asset_id IS NOT NULL AND asset_ids = '{}';

-- =====================================================================
-- Itens de quantidade e item substituído na retirada (2026-11-26)
--   controle 'unidade'   : um registro por equipamento, com etiqueta (monitor, PC, impressora)
--   controle 'quantidade': um registro por posto com a quantidade (mouse, teclado, cabo: sem etiqueta)
--   motivo da retirada com efeito: o item substituído muda de estado sozinho
--     (estragou -> Estragado, em conserto -> Em conserto, furto -> Extraviado, upgrade -> volta ao estoque)
-- =====================================================================
ALTER TABLE assets ADD COLUMN IF NOT EXISTS controle TEXT NOT NULL DEFAULT 'unidade';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_controle_check;
ALTER TABLE assets ADD CONSTRAINT assets_controle_check CHECK (controle IN ('unidade','quantidade'));
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_quantity_check;
ALTER TABLE assets ADD CONSTRAINT assets_quantity_check CHECK (quantity >= 0);
ALTER TABLE stock_reasons ADD COLUMN IF NOT EXISTS efeito TEXT;
ALTER TABLE stock_reasons DROP CONSTRAINT IF EXISTS stock_reasons_efeito_check;
ALTER TABLE stock_reasons ADD CONSTRAINT stock_reasons_efeito_check CHECK (efeito IS NULL OR efeito IN ('BROKEN','REPAIR','LOST','STOCK'));
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS replaced_asset_id BIGINT REFERENCES assets(id) ON DELETE SET NULL;
-- uma vez só: os motivos padrão que trocam um item ganham o efeito (o admin muda depois em Categorias e opções)
DO $marco$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_marcos WHERE nome = 'motivos_com_efeito') THEN
    UPDATE stock_reasons SET efeito = 'BROKEN' WHERE efeito IS NULL AND (name ILIKE 'O outro item estragou%' OR name ILIKE 'Acidente%');
    UPDATE stock_reasons SET efeito = 'REPAIR' WHERE efeito IS NULL AND name ILIKE 'O outro item está em conserto%';
    UPDATE stock_reasons SET efeito = 'LOST'   WHERE efeito IS NULL AND name ILIKE 'Perda, furto%';
    UPDATE stock_reasons SET efeito = 'STOCK'  WHERE efeito IS NULL AND name ILIKE 'Troca por um melhor%';
    -- periféricos já cadastrados passam a ser contados por quantidade
    UPDATE assets SET controle = 'quantidade' WHERE type = 'PERIPHERAL' AND (asset_tag IS NULL OR asset_tag = '');
    INSERT INTO schema_marcos (nome) VALUES ('motivos_com_efeito');
  END IF;
END $marco$;

-- =====================================================================
-- Estoque da ORCIM (2026-11-26)
--   Item da ORCIM = equipamento ainda sem empresa (entity_id NULL). Ele não aparece em nada das
--   empresas (inventário, estoque de T.I., relatórios) até ser transferido para uma empresa e posto.
--   A movimentação "transfer" com from_entity_id NULL é a saída do Estoque da ORCIM.
-- =====================================================================
ALTER TABLE assets ALTER COLUMN entity_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_orcim ON assets(id) WHERE entity_id IS NULL;

-- =====================================================================
-- Etapas do pedido de material (2026-11-26)
--   (Comprado = a caminho da ORCIM: o que estava em 'transito' vira 'comprado')
--   Pedido -> Comprado -> A caminho da ORCIM -> Na ORCIM -> A caminho do local -> Entregue
--   etapas: quando cada etapa aconteceu ({"comprado": "2026-11-26T10:00:00Z", ...})
--   previsao: dia previsto para a entrega no local (da rota agendada ou informado pela TI)
--   origem_orcim: o item vai sair do Estoque da ORCIM ao confirmar a entrega
--   A entrega é confirmada por quem pediu ("Recebi") ou pelo técnico.
-- =====================================================================
ALTER TABLE ticket_materials DROP CONSTRAINT IF EXISTS ticket_materials_status_check;
DO $junta$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ticket_materials' AND column_name = 'etapas') THEN
    UPDATE ticket_materials SET etapas = (etapas - 'transito') || CASE WHEN etapas ? 'comprado' OR NOT etapas ? 'transito' THEN '{}'::jsonb
                                            ELSE jsonb_build_object('comprado', etapas->'transito') END
      WHERE etapas ? 'transito';
  END IF;
  UPDATE ticket_materials SET status = 'comprado' WHERE status = 'transito';
END $junta$;
ALTER TABLE ticket_materials ADD CONSTRAINT ticket_materials_status_check
  CHECK (status IN ('solicitado','comprado','chegou','rota','entregue','cancelado'));
-- "Comprado" e "A caminho da ORCIM" são a mesma etapa (o que estava em trânsito volta para comprado)
ALTER TABLE ticket_materials ADD COLUMN IF NOT EXISTS etapas JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ticket_materials ADD COLUMN IF NOT EXISTS previsao DATE;
ALTER TABLE ticket_materials ADD COLUMN IF NOT EXISTS origem_orcim BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ticket_materials ADD COLUMN IF NOT EXISTS confirmado_por BIGINT REFERENCES users(id) ON DELETE SET NULL;
DO $marco$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_marcos WHERE nome = 'pedido_etapas') THEN
    UPDATE ticket_materials SET etapas = jsonb_build_object(status, COALESCE(status_at, now()))
      WHERE etapas = '{}'::jsonb AND status <> 'solicitado';
    INSERT INTO schema_marcos (nome) VALUES ('pedido_etapas');
  END IF;
END $marco$;
