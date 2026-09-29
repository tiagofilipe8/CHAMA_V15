const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

function isConfigured() {
  return Boolean(config.mail.host && config.mail.user && config.mail.fromEmail);
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.password } : undefined,
    });
  }
  return transporter;
}

async function sendMail({ to, subject, html, text, fromName }) {
  if (!isConfigured()) {
    const err = new Error('SMTP não configurado no arquivo .env');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  const t = getTransporter();
  return t.sendMail({
    from: `"${fromName || config.mail.fromName}" <${config.mail.fromEmail}>`,
    to,
    subject,
    html,
    text,
  });
}

module.exports = { sendMail, isConfigured };