const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Carrega .env do diretorio raiz do projeto
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  env: process.env.NODE_ENV || 'production',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'os_service',
    user: process.env.DB_USER || 'os_app',
    password: process.env.DB_PASSWORD || 'os_app_secret',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret_change_me',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),
  mail: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    fromName: process.env.MAIL_FROM_NAME || 'Central de Atendimento',
    fromEmail: process.env.MAIL_FROM_EMAIL || 'no-reply@exemplo.com.br',
  },
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneId: process.env.WHATSAPP_PHONE_ID || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'os_webhook_verify',
    version: process.env.WHATSAPP_VERSION || 'v21.0',
  },
  uploadsDir: path.join(__dirname, '..', 'uploads'),
  publicDir: path.join(__dirname, '..', 'public'),
  backupsDir: path.join(__dirname, '..', 'backups'),
};

// Garante pastas necessarias
for (const dir of [config.uploadsDir, path.join(config.publicDir, 'vendor'), config.backupsDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
const keep = path.join(config.uploadsDir, '.gitkeep');
if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');

module.exports = config;