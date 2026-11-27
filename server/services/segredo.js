// ---------------------------------------------------------------------
// Senhas guardadas no banco (AnyDesk e acesso mestre dos equipamentos)
//   Criptografadas com AES-256-GCM. A chave vem de SECRETS_KEY no .env
//   (ou, se não tiver, do JWT_SECRET). Quem tem só o banco (um backup, por
//   exemplo) não consegue ler as senhas.
//   ATENÇÃO: trocar a chave depois torna as senhas guardadas ilegíveis.
// ---------------------------------------------------------------------
const crypto = require('crypto');
const config = require('../config');

const chave = () => crypto.createHash('sha256')
  .update(String(process.env.SECRETS_KEY || config.jwt.secret || ''))
  .digest();

function cifrar(texto) {
  if (texto === null || texto === undefined || String(texto) === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const dados = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${dados.toString('base64')}`;
}

function decifrar(guardado) {
  if (!guardado) return null;
  const [v, iv, tag, dados] = String(guardado).split(':');
  if (v !== 'v1' || !iv || !tag || dados === undefined) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null; // chave trocada ou dado corrompido
  }
}

module.exports = { cifrar, decifrar };
