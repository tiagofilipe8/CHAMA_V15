// ---------------------------------------------------------------------
// Regras de arquivos enviados (anexos de chamados e fotos)
//   So entram PDF e fotos. A extensao, o tipo declarado pelo navegador e o
//   conteudo real do arquivo (os primeiros bytes) precisam bater. Assim um
//   ".html" ou um arquivo disfarcado ("foto.png" que na verdade e outra coisa)
//   e recusado.
// ---------------------------------------------------------------------
const fs = require('fs');

// extensao -> tipos aceitos
const PERMITIDOS = {
  '.pdf': ['application/pdf'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg', 'image/jpg', 'image/pjpeg'],
  '.jpeg': ['image/jpeg', 'image/jpg', 'image/pjpeg'],
  '.webp': ['image/webp'],
  '.gif': ['image/gif'],
  // fotos do iPhone
  '.heic': ['image/heic', 'image/heif', 'application/octet-stream'],
  '.heif': ['image/heic', 'image/heif', 'application/octet-stream'],
};

const EXTENSOES = Object.keys(PERMITIDOS);
const MENSAGEM = 'Só é possível anexar PDF ou fotos (PNG, JPG, JPEG, WEBP, GIF ou HEIC).';

// Texto para o atributo accept dos campos de arquivo
const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,.pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.heif';

function extensao(nome) {
  const m = /\.[a-z0-9]+$/i.exec(String(nome || ''));
  return m ? m[0].toLowerCase() : '';
}

// Primeira barreira: nome e tipo declarado
function aceitaArquivo(file) {
  const ext = extensao(file.originalname);
  const tipos = PERMITIDOS[ext];
  if (!tipos) return false;
  return tipos.includes(String(file.mimetype || '').toLowerCase());
}

function fileFilter(req, file, cb) {
  if (aceitaArquivo(file)) cb(null, true);
  else cb(new Error(MENSAGEM));
}

// Segunda barreira: o conteudo do arquivo e mesmo o que diz ser?
function conteudoConfere(caminho, ext) {
  let buf;
  try {
    const fd = fs.openSync(caminho, 'r');
    buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
  } catch {
    return false;
  }
  const ascii = (a, b) => buf.toString('latin1', a, b);
  switch (ext) {
    case '.pdf': return ascii(0, 5) === '%PDF-';
    case '.png': return buf[0] === 0x89 && ascii(1, 4) === 'PNG';
    case '.jpg':
    case '.jpeg': return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case '.gif': return ascii(0, 4) === 'GIF8';
    case '.webp': return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case '.heic':
    case '.heif': return ascii(4, 8) === 'ftyp';
    default: return false;
  }
}

// Confere todos os arquivos ja gravados; se algum nao bater, apaga todos.
function conferirGravados(files) {
  const ruins = (files || []).filter((f) => !conteudoConfere(f.path, extensao(f.originalname)));
  if (ruins.length) {
    apagarGravados(files);
    return `O arquivo "${ruins[0].originalname}" não é um PDF ou uma foto de verdade. ${MENSAGEM}`;
  }
  return null;
}

function apagarGravados(files) {
  for (const f of files || []) {
    try { fs.unlinkSync(f.path); } catch { /* ja removido */ }
  }
}

// Nome seguro para gravar no disco (nunca usa a extensao "crua" do usuario)
function extensaoSegura(nome) {
  const ext = extensao(nome);
  return PERMITIDOS[ext] ? ext : '';
}

module.exports = {
  PERMITIDOS, EXTENSOES, MENSAGEM, ACCEPT,
  fileFilter, aceitaArquivo, conteudoConfere, conferirGravados, apagarGravados, extensaoSegura, extensao,
};
