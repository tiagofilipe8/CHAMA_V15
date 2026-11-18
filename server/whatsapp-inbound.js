// ---------------------------------------------------------------------------
// Recepcao de chamados pelo WhatsApp
// ---------------------------------------------------------------------------
// Coleta guiada (todo mundo: numero novo ou cadastrado). O chamado SO abre
// depois de ter todos os dados, nesta ordem:
//   1) Nome completo  2) Empresa  3) Descricao do chamado
// Se a resposta do nome ja trouber a empresa ("Joao Silva - Empresa X"),
// o passo de empresa e pulado. Depois de ativo:
//   * Comecar com "NOVO ..." -> abre OUTRO chamado (com a mensagem como descricao).
//   * Qualquer outra mensagem -> NAO entra no chamado; a central responde
//     avisando e mandando usar o sistema ou abrir outro com "NOVO".
//
// Empresa: o chamado SEMPRE cai na empresa padrao "WhatsApp - nao
// identificado" (ou na propria empresa de quem ja e cadastrado); a empresa
// digitada fica gravada como texto na descricao e o tecnico redireciona
// ao assumir.
//
// O envio das respostas e "best effort": se o WhatsApp nao estiver conectado,
// o chamado e criado mesmo assim e a resposta nao sai (o log registra).
// Desligue a recepcao com WHATSAPP_INBOUND=0 no .env.
// ---------------------------------------------------------------------------
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query } = require('./db');
const config = require('./config');
const whatsapp = require('./services/whatsapp');
const notify = require('./services/notify');

const EMPRESA_PADRAO = 'WhatsApp - não identificado';
const MAX_TENTATIVAS = 3;
const INTERNO = new Set(['admin', 'technician', 'moderator']);

// ------------------------------- mensagens -------------------------------
const MSG_NOME = `Olá! Aqui é a Central de Atendimento.

Para abrir seu chamado, primeiro me envie o seu nome completo.

Exemplo: João Silva`;

const MSG_NOME_REPETE = `Não consegui reconhecer o nome. Envie apenas o seu nome completo, sem números e sem pontuação.

Exemplo: João Silva`;

const MSG_EMPRESA = (nome) => `Certo, ${nome}!

Qual é a empresa? Envie o nome dela.

Exemplo: Empresa X
(ou "particular" se não tiver empresa)`;

const MSG_EMPRESA_REPETE = `Não entendi a empresa. Envie o nome da empresa — ou "particular" se não tiver.`;

const MSG_DESCRICAO = `Por último, descreva o seu chamado: o problema, onde aconteceu e desde quando. Tudo em uma só mensagem.

Exemplo: A impressora do 2º andar não puxa papel desde segunda-feira.`;

const MSG_DESCRICAO_REPETE = `A descrição precisa detalhar o problema (pelo menos duas palavras). Envie a descrição do seu chamado.`;

const MSG_DESISTENCIA = `Não consegui identificar você. Para abrir um chamado, entre em contato com a Central pelo sistema ou telefone.`;

const MSG_INTERNO = `Olá! Seu número está cadastrado como equipe da Central.

Para abrir ou acompanhar chamados, use o sistema: ${config.publicUrl}`;

const MSG_TEXTO = `Por favor, envie sua mensagem em texto.`;

function MSG_CHAMADO(c) {
  return `Chamado aberto!

Número: ${c.number}
Assunto: ${c.title}

A equipe já foi avisada.
Para abrir outro chamado, comece a mensagem com "NOVO".
Para acompanhar, use o sistema: ${config.publicUrl}`;
}

// Mensagem depois de um chamado ja aberto: nada e registrado.
function MSG_APOS_CHAMADO(numero) {
  return `Recebido! Sua mensagem não foi adicionada${numero ? ` ao chamado ${numero}` : ''}.

Para abrir um novo chamado, comece a mensagem com "NOVO" seguido da descrição.
Para acompanhar os seus chamados, use o sistema: ${config.publicUrl}`;
}

// ------------------------------- telefones -------------------------------
function digitsOf(v) {
  return String(v || '').replace(/\D+/g, '');
}

// Converte qualquer formato para 55 + DDD + numero (12 ou 13 digitos).
function normalizePhone(raw) {
  let d = digitsOf(raw);
  if (!d) return null;
  if (d.startsWith('0055')) d = d.slice(2); // 00 55 ...
  if (d.startsWith('550') && d.length >= 13) d = '55' + d.slice(3); // 55 0 DDD
  if (!d.startsWith('55')) d = '55' + d; // DDD + numero
  if (d.length !== 12 && d.length !== 13) return null;
  return d;
}

// Numero de quem enviou. Aceita @c.us e, quando o WhatsApp devolve o ID
// vinculado (@lid), tenta recuperar o numero pelos campos alternatorios e,
// se nao achar, pede a traducao lid -> telefone para o proprio cliente.
async function phoneFromMessage(msg) {
  const from = String(msg.from || '');
  if (from.endsWith('@c.us')) return normalizePhone(from.slice(0, -5));
  if (from.endsWith('@lid')) {
    const d = (msg && msg._data) || {};
    const alt = d.sender_pn || d.senderAlt || d.sender_alt || d.author_pn
      || d.peer_pn || d.from_pn;
    const candidato = alt || (msg.sender && msg.sender.id && msg.sender.id.user);
    const direto = candidato ? normalizePhone(candidato) : null;
    if (direto) return direto;

    try {
      const pn = await whatsapp.getPhoneFromLid(from);
      if (pn) return normalizePhone(String(pn).replace(/@c\.us$/, ''));
    } catch { /* segue sem numero */ }
    return null;
  }
  return null;
}

// ------------------------------- persistencia -------------------------------
async function findUserByPhone(norm) {
  const { rows } = await query(
    `SELECT id, username, name, role, entity_id, location_id, phone
       FROM users WHERE active AND phone IS NOT NULL`);
  for (const r of rows) {
    if (normalizePhone(r.phone) === norm) return r;
  }
  return null;
}

async function loadUser(id) {
  const { rows } = await query(
    `SELECT id, username, name, role, entity_id, location_id, phone
       FROM users WHERE id = $1 AND active`, [id]);
  return rows[0] || null;
}

async function ensureContact(norm) {
  const { rows } = await query(
    `INSERT INTO whatsapp_contacts (phone, status, pending_at, last_seen_at)
     VALUES ($1, 'new', now(), now())
     ON CONFLICT (phone) DO UPDATE
       SET last_seen_at = now(), updated_at = now()
     RETURNING *`, [norm]);
  return rows[0];
}

async function setPending(norm, body) {
  await query(
    `UPDATE whatsapp_contacts
        SET status = 'awaiting_id', pending_message = $2, pending_at = now(),
            step = 'name', attempts = 0, updated_at = now()
      WHERE phone = $1`, [norm, String(body).slice(0, 4000)]);
}

async function setAttempts(norm, attempts) {
  await query(
    `UPDATE whatsapp_contacts SET attempts = $2, updated_at = now() WHERE phone = $1`,
    [norm, attempts]);
}

async function markBlocked(norm) {
  await query(
    `UPDATE whatsapp_contacts SET status = 'blocked', updated_at = now() WHERE phone = $1`,
    [norm]);
}

async function markActive(norm, userId, ticketId) {
  await query(
    `UPDATE whatsapp_contacts
        SET status = 'active', user_id = $2, pending_message = NULL,
            attempts = 0, step = NULL, draft_name = NULL, draft_empresa = NULL,
            last_ticket_id = COALESCE($3, last_ticket_id),
            last_seen_at = now(), updated_at = now()
      WHERE phone = $1`, [norm, userId, ticketId || null]);
}

// Guarda o chamado aberto por aqui: a conversa continua nele por 24 h.
async function setLastTicket(norm, ticketId) {
  await query(
    `UPDATE whatsapp_contacts SET last_ticket_id = $2, last_seen_at = now(), updated_at = now()
      WHERE phone = $1`, [norm, ticketId]);
}

// --------------------------------- respostas ---------------------------------
// Resposta enviada apenas se o WhatsApp estiver conectado; nunca derruba o
// fluxo de criacao do chamado por causa do envio.
async function reply(norm, texto) {
  if (!whatsapp.isReady()) {
    console.log(`[whatsapp-inbound] (sem conexao) para ${norm}: ${String(texto).split('\n')[0]}`);
    return false;
  }
  try {
    await whatsapp.sendTextMessage(norm, texto);
    return true;
  } catch (err) {
    console.log(`[whatsapp-inbound] falha ao responder ${norm}: ${err.message}`);
    return false;
  }
}

// ------------------------------ identificacao ------------------------------
// Palavras que comecam frase/interacao e nunca sao nome proprio.
const STOP_NOME = new Set([
  'sobre','ola','oi','bom','boa','dia','tarde','noite','tudo','bem',
  'preciso','falta','faltando','erro','mensagem','teste','sim','nao','não',
  'ok','obrigado','obrigada','ajuda','favor','por','com','sem','para','pra',
  'de','do','da','dos','das','em','no','na','meu','minha','meus','minhas',
  'o','a','os','as','um','uma','uns','umas','é','eh','sou','aqui','esse','essa',
  'isso','isto','ref','referente','quanto','quando','onde','quem','qual','como',
  'seria','gostaria','teria','duvida','dúvida','pergunta','informacao','informação',
  'status','retorno','solucao','solução','problema','atendimento','suporte',
  'central','cliente','empresa','usuario','usuário','segue','conforme',
  'prezado','prezada','pessoal','galera','equipe','somos','estou','estamos',
]);

// Aceita "Nome", "Nome - Empresa" ou "Nome, Empresa". O nome precisa ter ao
// menos dois parese, sem numeros e sem cara de frase/problema. Maiuscula nao
// e obrigatoria: "tiago filipe" e aceito e vira "Tiago Filipe".
function parseIdentification(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (t.length < 5 || t.length > 120) return null;
  if (/\d/.test(t)) return null;
  if (/[.;!?]/.test(t)) return null;

  const corte = t.search(/\s*[|\-–—,]\s*/);
  const nome = (corte > 0 ? t.slice(0, corte) : t).trim();
  const resto = corte > 0 ? t.slice(corte).replace(/^\s*[|\-–—,]\s*/, '').trim() : '';

  const palavras = nome.split(/\s+/).filter(Boolean);
  if (palavras.length < 2 || palavras.length > 5) return null;
  if (nome.length < 5 || nome.length > 80) return null;
  if (!/^[A-Za-zÀ-ÿ'’.\- ]+$/.test(nome)) return null;
  if (palavras.some((p) => p.length < 2)) return null;
  if (STOP_NOME.has(palavras[0].toLowerCase())) return null;

  // Frase de problema costuma trazer estes termos; nome, nao.
  const problema = /\b(nao|não|sem|erro|falha|problema|preciso|parou|parada|travou|trava|quebrou|quebrado|lenta|lento|urgente|socorro|ajuda|impressora|impressao|internet|computador|notebook|monitor|tela|cpu|sistema|arquivo|e-mail|email|rede|senha|login|acesso|bloqueado|devagar|carregando|instalar|atualizar|configurar)\b/i;
  if (problema.test(nome)) return null;

  // nome vira com a inicial maiuscula (preposicoes comuns ficam minusculas)
  const MINUSCULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'du']);
  const capitalizado = palavras
    .map((p, i) => {
      const baixa = p.toLowerCase();
      if (i > 0 && MINUSCULAS.has(baixa)) return baixa;
      return p[0].toUpperCase() + p.slice(1);
    })
    .join(' ');

  return {
    nome: capitalizado,
    empresa: resto ? resto.slice(0, 80) : null,
  };
}

// Descricao precisa descrever o problema: nao vale saudacao, nome ou "ok".
const VAZIAS = new Set([
  'oi','ola','olá','obrigado','obrigada','obg','vlw','ok','sim','nao','não',
  'valeu','teste','bom','boa','dia','tarde','noite','tudo','bem','favor','por',
  'aqui','isso','isto','né','tbm','tb','muito','legal','certo','entendi',
]);

function descricaoValida(texto) {
  const s = String(texto || '').trim();
  if (s.length < 10 || s.length > 4000) return false;
  const palavras = s.split(/\s+/);
  if (palavras.length < 2) return false;
  if (!/[A-Za-zÀ-ÿ]{4,}/.test(s)) return false;
  if (parseIdentification(s)) return false; // parece nome de pessoa
  // so palavras de preenchimento ("ok obrigado", "bom dia") nao contam
  const limpas = palavras.map((p) => p.toLowerCase().replace(/[!.,;]+$/, ''));
  if (limpas.every((p) => VAZIAS.has(p))) return false;
  return true;
}

// Resposta invalida no passo atual: conta ate MAX_TENTATIVAS e entao bloqueia.
async function tentativaInvalida(norm, contact, mensagem, etapa) {
  const tentativa = (contact.attempts || 0) + 1;
  if (tentativa >= MAX_TENTATIVAS) {
    await markBlocked(norm);
    console.log(`[whatsapp-inbound] ${norm} desistiu apos ${tentativa} tentativas (${etapa}) -> bloqueado`);
    await reply(norm, MSG_DESISTENCIA);
    return;
  }
  await setAttempts(norm, tentativa);
  console.log(`[whatsapp-inbound] ${norm} ${etapa} invalida (tentativa ${tentativa}/${MAX_TENTATIVAS})`);
  await reply(norm, mensagem);
}

// ------------------------------- padroes ------------------------------------
async function ensureEmpresaPadrao() {
  const { rows } = await query('SELECT id FROM entities WHERE name = $1', [EMPRESA_PADRAO]);
  if (rows.length) return rows[0].id;
  try {
    const ins = await query(
      `INSERT INTO entities (name, description)
       VALUES ($1, $2) RETURNING id`,
      [EMPRESA_PADRAO, 'Chamados abertos por WhatsApp sem empresa identificada. Redirecione para a empresa correta.']);
    return ins.rows[0].id;
  } catch (err) {
    // corrida com outro processo: alguem criou antes
    const again = await query('SELECT id FROM entities WHERE name = $1', [EMPRESA_PADRAO]);
    if (again.rows.length) return again.rows[0].id;
    throw err;
  }
}

async function ensureCategoriaPadrao() {
  const { rows } = await query(
    `SELECT id FROM categories
      WHERE active AND kind = 'simple' AND is_material = FALSE AND lower(name) = 'outros'
      ORDER BY id LIMIT 1`);
  if (rows.length) return rows[0].id;
  try {
    const ins = await query(
      `INSERT INTO categories (name, icon, description, sort_order, kind, maps_to_id)
       SELECT 'Outros', '📌', 'Categoria padrão de chamados abertos pelo WhatsApp.', 99, 'simple',
              chama_ensure_category(ARRAY['Suporte','Outros'])
       RETURNING id`);
    return ins.rows[0].id;
  } catch (err) {
    const again = await query(
      `SELECT id FROM categories WHERE active AND kind='simple' AND lower(name)='outros' ORDER BY id LIMIT 1`);
    if (again.rows.length) return again.rows[0].id;
    throw err;
  }
}

async function ensureImpactoPadrao() {
  const { rows } = await query(
    `SELECT id, priority FROM impact_levels WHERE active
      ORDER BY CASE WHEN priority = 2 THEN 0 ELSE 1 END, sort_order LIMIT 1`);
  return rows[0] || null;
}

// ------------------------------- chamados -----------------------------------
// assunto: inicio da descricao (o que aparece no topo do chamado).
async function abrirChamado({ user, descricao, assunto }) {
  const entId = user.entity_id || (await ensureEmpresaPadrao());
  const catId = await ensureCategoriaPadrao();
  const impact = await ensureImpactoPadrao();

  // SLA da empresa (mesmo calculo do POST /api/tickets)
  let dueAt = null;
  try {
    const ent = await query('SELECT sla_days, sla_hours FROM entities WHERE id = $1', [entId]);
    if (ent.rows.length) {
      const sd = Number(ent.rows[0].sla_days) || 0;
      const sh = Number(ent.rows[0].sla_hours) || 0;
      if (sd || sh) {
        const d = new Date();
        d.setDate(d.getDate() + sd);
        d.setHours(d.getHours() + sh);
        dueAt = d.toISOString();
      }
    }
  } catch {}

  // Localizacao: so a do usuario, se pertencer a mesma empresa
  let locId = null;
  if (user.location_id) {
    const loc = await query('SELECT entity_id FROM locations WHERE id = $1 AND active', [user.location_id]);
    if (loc.rows.length && String(loc.rows[0].entity_id) === String(entId)) locId = user.location_id;
  }

  const texto = String(descricao || '').trim().slice(0, 4000);
  const primeira = (String(assunto || '').split(/\r?\n/)[0] || texto.split(/\r?\n/)[0] || '').trim();
  const title = (primeira.slice(0, 80) + (primeira.length > 80 ? '…' : '')) || 'Chamado por WhatsApp';
  const hoje = new Date().toISOString().slice(0, 10);

  const { rows } = await query(
    `INSERT INTO tickets (title, description, category_id, simple_category_id, entity_id,
                          requester_id, priority, impact_id, due_at, location_id, needed_by)
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [title, texto, catId, entId, user.id,
      impact ? impact.priority : 2, impact ? impact.id : null, dueAt, locId, hoje]);
  const ticketId = rows[0].id;

  await query(
    `UPDATE tickets SET number = to_char(created_at,'YYYY') || '-' || lpad(id::text,5,'0')
      WHERE id = $1 RETURNING number`, [ticketId]);
  await query(
    `INSERT INTO ticket_status_history (ticket_id, old_status, new_status, user_id)
     VALUES ($1, NULL, 1, $2)`, [ticketId, user.id]);
  await query(
    `INSERT INTO ticket_messages (ticket_id, user_id, kind, content)
     VALUES ($1, $2, 'comment', $3)`, [ticketId, user.id, texto]);
  await query(
    `INSERT INTO ticket_history (ticket_id, user_id, action, old_value, new_value)
     VALUES ($1, $2, 'created', NULL, $3)`,
    [ticketId, user.id, impact ? impact.name : null]);

  const { rows: full } = await query('SELECT * FROM tickets WHERE id = $1', [ticketId]);
  await notify.ticketCreated(full[0]).catch((e) =>
    console.log('[whatsapp-inbound] notify.ticketCreated falhou:', e.message));
  return full[0];
}

async function criarUsuario(norm, nome) {
  const { rows } = await query(
    `SELECT id FROM users WHERE username = $1`, [`wa_${norm}`]);
  if (rows.length) return loadUser(rows[0].id);

  const hash = await bcrypt.hash(crypto.randomBytes(18).toString('hex'), 10);
  const entId = await ensureEmpresaPadrao();
  const ins = await query(
    `INSERT INTO users (username, password_hash, name, phone, role, client_level, entity_id, active)
     VALUES ($1, $2, $3, $4, 'client', 1, $5, TRUE)
     RETURNING id`,
    [`wa_${norm}`, hash, nome, norm, entId]);
  return loadUser(ins.rows[0].id);
}

// --------------------------------- fluxo ------------------------------------
// Coleta guiada: nome -> empresa -> descricao. O chamado so abre no final.
async function coletar(norm, contact, user, body) {
  // bloqueado: so volta a conversar quando mandar um nome valido
  if (contact.status === 'blocked') {
    if (!parseIdentification(body)) return;
    await query(
      `UPDATE whatsapp_contacts
          SET status = 'awaiting_id', step = 'name',
              draft_name = NULL, draft_empresa = NULL, attempts = 0,
              updated_at = now()
        WHERE phone = $1`, [norm]);
    contact.status = 'awaiting_id';
    contact.step = 'name';
    contact.draft_name = null;
    contact.draft_empresa = null;
  }

  // primeira mensagem: ja aceita se ja for um nome; senao guarda e pede
  if (contact.status === 'new') {
    if (!parseIdentification(body)) {
      await setPending(norm, body);
      console.log(`[whatsapp-inbound] ${norm} primeiro contato -> pedido de nome`);
      await reply(norm, MSG_NOME);
      return;
    }
    await query(
      `UPDATE whatsapp_contacts
          SET status = 'awaiting_id', step = 'name', pending_message = $2,
              attempts = 0, updated_at = now()
        WHERE phone = $1`, [norm, String(body).slice(0, 4000)]);
    contact.status = 'awaiting_id';
    contact.step = 'name';
  }

  const step = contact.step || 'name';

  // ---------------------------- 1) nome ----------------------------
  if (step === 'name') {
    const ident = parseIdentification(body);
    if (!ident) return tentativaInvalida(norm, contact, MSG_NOME_REPETE, 'nome');
    const proximo = ident.empresa ? 'description' : 'company';
    await query(
      `UPDATE whatsapp_contacts
          SET status = 'awaiting_id', draft_name = $2,
              draft_empresa = COALESCE($3, draft_empresa), step = $4,
              attempts = 0, updated_at = now()
        WHERE phone = $1`, [norm, ident.nome, ident.empresa, proximo]);
    console.log(`[whatsapp-inbound] ${norm} nome aceito: ${ident.nome}` +
      (ident.empresa ? ` (empresa na mesma mensagem: ${ident.empresa})` : ''));
    await reply(norm, proximo === 'company' ? MSG_EMPRESA(ident.nome) : MSG_DESCRICAO);
    return;
  }

  // --------------------------- 2) empresa ---------------------------
  if (step === 'company') {
    const emp = String(body).replace(/\s+/g, ' ').trim();
    if (emp.length < 2 || emp.length > 80 || !/[A-Za-zÀ-ÿ]/.test(emp)) {
      return tentativaInvalida(norm, contact, MSG_EMPRESA_REPETE, 'empresa');
    }
    await query(
      `UPDATE whatsapp_contacts
          SET draft_empresa = $2, step = 'description', attempts = 0,
              updated_at = now()
        WHERE phone = $1`, [norm, emp]);
    console.log(`[whatsapp-inbound] ${norm} empresa aceita: ${emp}`);
    await reply(norm, MSG_DESCRICAO);
    return;
  }

  // -------------------------- 3) descricao --------------------------
  if (step === 'description') {
    if (!descricaoValida(body)) {
      return tentativaInvalida(norm, contact, MSG_DESCRICAO_REPETE, 'descricao');
    }

    let solicitante = user;
    if (!solicitante) {
      const nome = contact.draft_name;
      if (!nome) { // seguro: so chega aqui com o nome coletado
        await query(
          `UPDATE whatsapp_contacts SET status = 'new', step = 'name',
                  updated_at = now() WHERE phone = $1`, [norm]);
        await reply(norm, MSG_NOME);
        return;
      }
      solicitante = await criarUsuario(norm, nome);
    }

    let descricao = String(body).trim().slice(0, 4000);
    if (contact.draft_empresa) {
      descricao += `\n\nEmpresa informada pelo solicitante: ${contact.draft_empresa}`;
    }
    const chamado = await abrirChamado({ user: solicitante, descricao, assunto: body });
    await markActive(norm, solicitante.id, chamado.id);
    console.log(`[whatsapp-inbound] ${norm} coleta concluida -> ${solicitante.name} (chamado ${chamado.number}, assunto: ${chamado.title})`);
    await reply(norm, MSG_CHAMADO(chamado));
    return;
  }

  // passo desconhecido: recomeca pelo nome
  await query(
    `UPDATE whatsapp_contacts SET status = 'awaiting_id', step = 'name',
            attempts = 0, updated_at = now() WHERE phone = $1`, [norm]);
  await reply(norm, MSG_NOME);
}

async function handle(msg) {
  if (process.env.WHATSAPP_INBOUND === '0') return;
  if (!msg || msg.fromMe) return; // nao processa o que a propria conta envia
  const from = String(msg.from || '');
  if (!from.endsWith('@c.us') && !from.endsWith('@lid')) return; // grupos/status

  const norm = await phoneFromMessage(msg);
  if (!norm) {
    console.log(`[whatsapp-inbound] numero nao reconhecido em: ${from}`);
    return;
  }

  const body = String(msg.body || '').trim();
  const contact = await ensureContact(norm);
  let user = await findUserByPhone(norm);
  if (!user && contact.user_id) user = await loadUser(contact.user_id);

  // Equipe interna abre chamado pelo sistema, nao por aqui
  if (user && INTERNO.has(user.role)) {
    await reply(norm, MSG_INTERNO);
    return;
  }

  if (!body) { await reply(norm, MSG_TEXTO); return; }

  // usuario apagado da base: recomeca a coleta do zero
  if (!user && contact.status === 'active') {
    await query(
      `UPDATE whatsapp_contacts
          SET status = 'new', user_id = NULL, pending_message = NULL,
              step = 'name', attempts = 0, updated_at = now()
        WHERE phone = $1`, [norm]);
    contact.status = 'new';
    contact.user_id = null;
  }

  // ---------------- contato ativo: nada entra no chamado ----------------
  if (user && contact.status === 'active') {
    // "NOVO ..." abre outro chamado com a mensagem como descricao
    if (/^novo\b/i.test(body)) {
      const texto = body.replace(/^novo\s*[:\-–—]?\s*/i, '').trim();
      if (!texto) { await reply(norm, MSG_TEXTO); return; }
      const chamado = await abrirChamado({ user, descricao: texto, assunto: texto });
      await setLastTicket(norm, chamado.id);
      console.log(`[whatsapp-inbound] ${norm} chamado ${chamado.number} criado para ${user.name}`);
      await reply(norm, MSG_CHAMADO(chamado));
      return;
    }

    // qualquer outra mensagem: NAO vira comentario (nem citando a confirmacao)
    let numero = null;
    if (contact.last_ticket_id) {
      const r = await query('SELECT number FROM tickets WHERE id = $1', [contact.last_ticket_id]);
      numero = r.rows.length ? r.rows[0].number : null;
    }
    console.log(`[whatsapp-inbound] ${norm} mensagem fora do chamado (nao registrada${numero ? `, ultimo=${numero}` : ''})`);
    await reply(norm, MSG_APOS_CHAMADO(numero));
    return;
  }

  // --------------- nao coletado ainda: coleta guiada ---------------
  await coletar(norm, contact, user, body);
}

module.exports = {
  handle,
  normalizePhone,
  parseIdentification,
  descricaoValida,
  // expostos para teste
  _internos: { abrirChamado, ensureEmpresaPadrao, ensureCategoriaPadrao },
};
