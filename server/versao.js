// Versão que aparece no fim do menu.
// Formato: "v<versão do package.json> · <commit curto>". No Render o commit vem da variável
// RENDER_GIT_COMMIT (o próprio Render preenche a cada publicação); na máquina local, do git.
const { execFileSync } = require('child_process');
const path = require('path');
const { version } = require('../package.json');

function commitCurto() {
  if (process.env.RENDER_GIT_COMMIT) return process.env.RENDER_GIT_COMMIT.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return '';
  }
}

const commit = commitCurto();
module.exports = commit ? `v${version} · ${commit}` : `v${version}`;
