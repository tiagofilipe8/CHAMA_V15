// ---------------------------------------------------------------------------
// Recepcao de chamados pelo WhatsApp
// ---------------------------------------------------------------------------
// Fluxo:
//   * Numero cadastrado (users.phone) -> abre o chamado na hora e responde com
//     o numero.
//   * Numero desconhecido -> guarda a primeira mensagem e envia o pedido de
//     identificacao; quando o solicitante responde com o nome completo, abre o
//     chamado usando a PRIMEIRA mensagem como descricao.
//   * Mensagem seguinte -> vira comentario do chamado aberto nas ultimas 24 h
//     (ou do chamado citado em resposta). Comecar com "NOVO" abre outro.
//
// Empresa: chamados de quem chega sem cadastro caem na empresa padrao
// "WhatsApp - nao identificado"; o tecnico redireciona para a empresa certa
// ao assumir. Quem ja e cadastrado abre na propria empresa.
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
const JANELA_COMENTARIO_H = 24; // horas em que a conversa continua no mesmo chamado

// ------------------------------- mensagens -------------------------------
const MSG_IDENTIFICACAO = `Olá! Aqui é a Central de Atendimento.

Não encontrei o seu número cadastrado. Para abrir seu chamado, responda apenas com o seu nome completo.

Exemplo: Maria Silva`;

const MSG_IDENTIFICACAO_REPETE = `Não consegui reconhecer o nome. Responda apenas com o seu nome completo, sem números e sem pontuação.

Exemplo: Maria Silva`;

const MSG_DESISTENCIA = `Não consegui identificar você. Para abrir um chamado, entre em contato com a Central pelo sistema ou telefone.`;

const MSG_INTERNO = `Olá! Seu número está cadastrado como equipe da Central.

Para abrir ou acompanhar chamados, use o sistema: ${config.publicUrl}`;

const MSG_TEXTO = `Por favor, envie sua mensagem em texto.`;

function MSG_CHAMADO(c) {
  return `Chamado aberto!

Número: ${c.number}
Assunto: ${c.title}

A equipe já foi avisada.
Para acrescentar informações, responda esta mensagem.
Para abrir outro chamado, comece a mensagem com "NOVO".`;
}

const MSG_COMENTARIO = (numero) => `Registrado no chamado ${numero}.`;

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
            attempts = 0, updated_at = now()
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
            attempts = 0, last_ticket_id = COALESCE($3, last_ticket_id),
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
async function abrirChamado({ user, descricao }) {
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
  const primeira = texto.split(/\r?\n/)[0] || texto;
  const title = `Outros: ${primeira.slice(0, 70)}${primeira.length > 70 ? '…' : ''}`.slice(0, 200);
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

async function adicionarComentario(ticket, user, conteudo) {
  const { rows } = await query(
    `INSERT INTO ticket_messages (ticket_id, user_id, kind, content)
     VALUES ($1, $2, 'comment', $3) RETURNING *`,
    [ticket.id, user.id, String(conteudo).slice(0, 4000)]);
  const message = { ...rows[0], user: { id: user.id, name: user.name, role: user.role } };
  const { rows: full } = await query('SELECT * FROM tickets WHERE id = $1', [ticket.id]);
  await notify.commentAdded(full[0], message).catch((e) =>
    console.log('[whatsapp-inbound] notify.commentAdded falhou:', e.message));
}

// Chamado que esta na resposta (as nossas confirmacoes trazem o numero).
async function chamadoCitado(msg) {
  if (!msg || !msg.hasQuotedMsg) return null;
  try {
    const quoted = await msg.getQuotedMessage();
    const m = String((quoted && quoted.body) || '').match(/\b\d{4}-\d{5}\b/);
    if (!m) return null;
    const { rows } = await query('SELECT id, requester_id, number FROM tickets WHERE number = $1', [m[0]]);
    return rows[0] || null;
  } catch {
    return null;
  }
}

// Chamado aberto POR AQUI para este contato e que continua aberto.
// So anexa ao ultimo chamado que o proprio WhatsApp criou: chamados antigos
// (abertos pela Central) nao recebem estas mensagens.
async function chamadoRecente(contact) {
  if (!contact || !contact.last_ticket_id) return null;
  const { rows } = await query(
    `SELECT id, requester_id, number FROM tickets
      WHERE id = $1 AND status BETWEEN 1 AND 4
        AND updated_at > now() - make_interval(hours => $2::int)`,
    [contact.last_ticket_id, JANELA_COMENTARIO_H]);
  return rows[0] || null;
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

  // ------------------------- ainda nao identificado -------------------------
  if (!user) {

    // identificacao desistida: so volta a conversar se mandar um nome valido
    if (contact.status === 'blocked' && !parseIdentification(body)) return;

    if (!body) { await reply(norm, MSG_TEXTO); return; }

    // usuario apagado da base: recomeca a identificacao
    if (contact.status === 'active') {
      await query(
        `UPDATE whatsapp_contacts
            SET status = 'new', user_id = NULL, pending_message = NULL,
                attempts = 0, updated_at = now()
          WHERE phone = $1`, [norm]);
      contact.status = 'new';
    }

    // primeira mensagem: guarda e pede o nome
    if (contact.status === 'new') {
      await setPending(norm, body);
      console.log(`[whatsapp-inbound] ${norm} novo numero -> pedido de identificacao`);
      await reply(norm, MSG_IDENTIFICACAO);
      return;
    }

    // aguardando identificacao (attempts = nomes errados ate agora)
    const ident = parseIdentification(body);
    if (!ident) {
      const tentativa = (contact.attempts || 0) + 1;
      if (tentativa >= MAX_TENTATIVAS) {
        await markBlocked(norm);
        console.log(`[whatsapp-inbound] ${norm} desistiu apos ${tentativa} tentativas -> bloqueado`);
        await reply(norm, MSG_DESISTENCIA);
        return;
      }
      await setAttempts(norm, tentativa);
      console.log(`[whatsapp-inbound] ${norm} nome nao reconhecido (tentativa ${tentativa}/${MAX_TENTATIVAS})`);
      await reply(norm, MSG_IDENTIFICACAO_REPETE);
      return;
    }

    user = await criarUsuario(norm, ident.nome);
    let descricao = String(contact.pending_message || body).trim();
    if (ident.empresa) descricao += `\n\nEmpresa informada pelo solicitante: ${ident.empresa}`;
    const chamado = await abrirChamado({ user, descricao });
    await markActive(norm, user.id, chamado.id);
    console.log(`[whatsapp-inbound] identificado ${norm} -> ${user.name} (chamado ${chamado.number})`);
    await reply(norm, MSG_CHAMADO(chamado));
    return;
  }

  // ---------------------------- ja cadastrado ----------------------------
  // o contato passa a apontar para o usuario encontrado
  if (contact.status !== 'active' || String(contact.user_id) !== String(user.id)) {
    await markActive(norm, user.id, null);
    contact.status = 'active';
    contact.user_id = user.id;
  }

  if (!body) { await reply(norm, MSG_TEXTO); return; }

  // resposta a uma confirmacao nossa que cita o numero do chamado
  const citado = await chamadoCitado(msg);
  if (citado && String(citado.requester_id) === String(user.id)) {
    await adicionarComentario(citado, user, body);
    console.log(`[whatsapp-inbound] ${norm} comentario (citado) no chamado ${citado.number}`);
    await reply(norm, MSG_COMENTARIO(citado.number));
    return;
  }

  // "NOVO ..." abre outro chamado mesmo com conversa recente
  const ehNovo = /^novo\b/i.test(body);
  const texto = ehNovo ? body.replace(/^novo\s*[:\-–—]?\s*/i, '').trim() : body;
  if (!texto) { await reply(norm, MSG_TEXTO); return; }

  if (!ehNovo) {
    const recente = await chamadoRecente(contact);
    if (recente) {
      await adicionarComentario(recente, user, texto);
      console.log(`[whatsapp-inbound] ${norm} comentario no chamado ${recente.number}`);
      await reply(norm, MSG_COMENTARIO(recente.number));
      return;
    }
  }

  const chamado = await abrirChamado({ user, descricao: texto });
  await setLastTicket(norm, chamado.id);
  console.log(`[whatsapp-inbound] ${norm} chamado ${chamado.number} criado para ${user.name}`);
  await reply(norm, MSG_CHAMADO(chamado));
}

module.exports = {
  handle,
  normalizePhone,
  parseIdentification,
  // expostos para teste
  _internos: { abrirChamado, ensureEmpresaPadrao, ensureCategoriaPadrao },
};
