// ---------------------------------------------------------------------
// Regras de arquivos enviados (anexos de chamados e fotos)
//   So entram fotos, PDF, Word (.docx) e Excel (.xlsx). A extensao, o tipo
//   declarado pelo navegador e o conteudo real do arquivo precisam bater. Assim
//   um ".exe", um ".html" ou um arquivo disfarcado ("foto.png" que na verdade e
//   outra coisa) e recusado.
//   Word e Excel: so os formatos sem macro (.docx/.xlsx). O arquivo e aberto e
//   recusado se tiver macro (VBA), ActiveX, objeto embutido executavel ou modelo
//   externo. .doc/.xls antigos e .docm/.xlsm nao entram.
// ---------------------------------------------------------------------
const fs = require('fs');
const zlib = require('zlib');

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// alguns navegadores/sistemas mandam .docx/.xlsx como "zip" ou "octet-stream"; o conteudo e conferido depois
const MIME_GENERICO = ['application/octet-stream', 'application/zip', 'application/x-zip-compressed', ''];

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
  // Word e Excel sem macro
  '.docx': [MIME_DOCX, ...MIME_GENERICO],
  '.xlsx': [MIME_XLSX, ...MIME_GENERICO],
};

// tipo gravado no banco (nunca o que o navegador disse)
const TIPO_CANONICO = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.heic': 'image/heic', '.heif': 'image/heif', '.docx': MIME_DOCX, '.xlsx': MIME_XLSX,
};

const EXTENSOES = Object.keys(PERMITIDOS);
const MENSAGEM = 'Só é possível anexar fotos (PNG, JPG, WEBP, GIF ou HEIC), PDF, Word (.docx) ou Excel (.xlsx).';

// Texto para o atributo accept dos campos de arquivo
const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,.pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.heif,.docx,.xlsx';

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

// ---- Word/Excel (.docx/.xlsx sao um ZIP): le a lista de arquivos internos ----
function lerZip(buf) {
  // fim do diretorio central (procura do fim para o comeco)
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) return null;
  const total = buf.readUInt16LE(fim + 10);
  let pos = buf.readUInt32LE(fim + 16);
  const itens = [];
  for (let k = 0; k < total; k += 1) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) return null;
    const nNome = buf.readUInt16LE(pos + 28);
    itens.push({
      nome: buf.toString('utf8', pos + 46, pos + 46 + nNome),
      metodo: buf.readUInt16LE(pos + 10),
      tamComp: buf.readUInt32LE(pos + 20),
      tamReal: buf.readUInt32LE(pos + 24),
      local: buf.readUInt32LE(pos + 42),
    });
    pos += 46 + nNome + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  }
  return itens;
}

function lerItemZip(buf, it) {
  if (!it || it.tamReal > 2 * 1024 * 1024) return null; // so arquivos pequenos (relacoes e tipos)
  const p = it.local;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) return null;
  const ini = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const dados = buf.subarray(ini, ini + it.tamComp);
  try {
    if (it.metodo === 0) return dados.toString('utf8');
    if (it.metodo === 8) return zlib.inflateRawSync(dados, { maxOutputLength: 2 * 1024 * 1024 }).toString('utf8');
  } catch { /* corrompido */ }
  return null;
}

// Devolve null se o documento e seguro, ou o motivo da recusa
function motivoOfficeInseguro(caminho, ext) {
  let buf;
  try { buf = fs.readFileSync(caminho); } catch { return 'não foi possível ler o arquivo'; }
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) return 'não é um arquivo do Word/Excel de verdade';
  const itens = lerZip(buf);
  if (!itens || !itens.length) return 'arquivo corrompido';
  const nomes = itens.map((i) => i.nome);
  const principal = ext === '.docx' ? 'word/document.xml' : 'xl/workbook.xml';
  if (!nomes.includes('[Content_Types].xml') || !nomes.includes(principal)) return 'não é um arquivo do Word/Excel de verdade';
  // macro, ActiveX e arquivos executaveis dentro do documento
  if (nomes.some((n) => /vbaProject|vbaData|\/activeX\/|\.(bin|exe|dll|js|vbs|ps1|bat|cmd|hta|scr|lnk)$/i.test(n)
    && !/\/printerSettings\/printerSettings\d*\.bin$/i.test(n))) return 'tem macro ou conteúdo executável';
  // objetos embutidos: so outros documentos e imagens (graficos do Excel dentro do Word, por exemplo)
  if (nomes.some((n) => /\/embeddings\//i.test(n) && !/\.(xlsx|docx|pptx|png|jpe?g|gif|emf|wmf)$/i.test(n))) return 'tem objeto embutido que não é permitido';
  const tipos = lerItemZip(buf, itens.find((i) => i.nome === '[Content_Types].xml')) || '';
  if (/macroEnabled|vbaProject|activeX/i.test(tipos)) return 'tem macro';
  // modelo, quadro ou objeto vindo de fora (truque para baixar macro depois de aberto)
  for (const it of itens.filter((i) => /\.rels$/i.test(i.nome))) {
    const xml = lerItemZip(buf, it);
    if (xml === null) return 'arquivo corrompido';
    const rels = xml.match(/<Relationship\b[^>]*>/gi) || [];
    if (rels.some((r) => /TargetMode\s*=\s*"External"/i.test(r)
      && /Type\s*=\s*"[^"]*\/(attachedTemplate|oleObject|frame|subDocument|package|control)"/i.test(r))) {
      return 'aponta para um modelo ou objeto de fora';
    }
  }
  return null;
}

// Segunda barreira: o conteudo do arquivo e mesmo o que diz ser?
function conteudoConfere(caminho, ext) {
  if (ext === '.docx' || ext === '.xlsx') return motivoOfficeInseguro(caminho, ext) === null;
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
  for (const f of files || []) {
    const ext = extensao(f.originalname);
    if (ext === '.docx' || ext === '.xlsx') {
      const motivo = motivoOfficeInseguro(f.path, ext);
      if (motivo) {
        apagarGravados(files);
        return `O arquivo "${f.originalname}" foi recusado: ${motivo}. Word e Excel só entram sem macro (.docx e .xlsx).`;
      }
    } else if (!conteudoConfere(f.path, ext)) {
      apagarGravados(files);
      return `O arquivo "${f.originalname}" não é o que diz ser. ${MENSAGEM}`;
    }
  }
  return null;
}

function apagarGravados(files) {
  for (const f of files || []) {
    try { fs.unlinkSync(f.path); } catch { /* ja removido */ }
  }
}

// Nome seguro para gravar no disco (nunca usa a extensao "crua" do usuario)
function tipoCanonico(nome) {
  return TIPO_CANONICO[extensao(nome)] || 'application/octet-stream';
}

function extensaoSegura(nome) {
  const ext = extensao(nome);
  return PERMITIDOS[ext] ? ext : '';
}

module.exports = {
  PERMITIDOS, EXTENSOES, MENSAGEM, ACCEPT,
  fileFilter, aceitaArquivo, conteudoConfere, motivoOfficeInseguro, tipoCanonico, conferirGravados, apagarGravados, extensaoSegura, extensao,
};
