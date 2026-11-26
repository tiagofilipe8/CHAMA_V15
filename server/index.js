const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const multer = require('multer');

const config = require('./config');
const { initSocket } = require('./services/realtime');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const entityRoutes = require('./routes/entities');
const categoryRoutes = require('./routes/categories');
const ticketRoutes = require('./routes/tickets');
const dashboardRoutes = require('./routes/dashboard');
const settingRoutes = require('./routes/settings');
const notificationRoutes = require('./routes/notifications');
const backupRoutes = require('./routes/backup');
const whatsappRoutes = require('./routes/whatsapp');
const inventoryRoutes = require('./routes/inventory');
const locationRoutes = require('./routes/locations');
const impactLevelRoutes = require('./routes/impactLevels');
const resolutionCauseRoutes = require('./routes/resolutionCauses');
const permissionRoutes = require('./routes/permissions');
const materialRoutes = require('./routes/materials');
const optionProfileRoutes = require('./routes/optionProfiles');
const chatRoutes = require('./routes/chat');
const stockRoutes = require('./routes/stock');
const stockReasonRoutes = require('./routes/stockReasons');
const pedidoRoutes = require('./routes/pedidos');
const backupService = require('./services/backup');
const maintenanceAlerts = require('./services/maintenanceAlerts');

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false, // ajustavel conforme necessidade do dept
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
if (config.env !== 'production') app.use(morgan('dev'));

// Limite de tentativas no login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
});
app.use('/api/auth/login', loginLimiter);

// Rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/entities', entityRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/impact-levels', impactLevelRoutes);
app.use('/api/resolution-causes', resolutionCauseRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/option-profiles', optionProfileRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/stock-reasons', stockReasonRoutes);
app.use('/api/pedidos', pedidoRoutes);

// Garante que handlers assincronos lancados virem resposta 500 (nao crash)
const wrapAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function wrapRouter(r) {
  (r.stack || []).forEach((layer) => {
    if (layer.route && Array.isArray(layer.route.stack)) {
      layer.route.stack.forEach((h) => {
        if (h.method && h.handle) h.handle = wrapAsync(h.handle);
      });
    } else if (layer.handle && layer.handle.stack) {
      wrapRouter(layer.handle);
    }
  });
}
[authRoutes, userRoutes, entityRoutes, categoryRoutes, ticketRoutes,
 dashboardRoutes, settingRoutes, notificationRoutes, backupRoutes, whatsappRoutes, inventoryRoutes,
 locationRoutes, impactLevelRoutes, resolutionCauseRoutes, permissionRoutes, materialRoutes,
 optionProfileRoutes].forEach(wrapRouter);

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.message || err);
});


// Arquivos estaticos
// /uploads publico serve SO as imagens do sistema (logo e fundo), que ficam
// na raiz da pasta. Anexos de chamados e fotos de equipamentos ficam em
// subpastas e so saem pelas rotas com login (que conferem o acesso).
app.use('/uploads', (req, res, next) => {
  const nome = decodeURIComponent(req.path || '');
  if (nome.slice(1).includes('/') || nome.includes('\\') || !/\.(png|jpe?g|webp|gif)$/i.test(nome)) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}, express.static(config.uploadsDir, { fallthrough: false, index: false, dotfiles: 'deny' }));
app.use('/vendor', express.static(path.join(config.publicDir, 'vendor'), { index: false }));
app.use(express.static(config.publicDir));

// API 404
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// Healthcheck
app.get('/healthz', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Erros gerais
app.use((err, req, res, next) => {
  console.error('[error]', err.message, err.stack);
  if (err instanceof multer?.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  res.status(err.status || 500).json({ error: err.message || 'Erro interno do servidor.' });
});

// SPA fallback para paginas estaticas
app.get(/^\/(?!api|uploads|vendor|healthz).*/, (req, res) => {
  res.sendFile(path.join(config.publicDir, 'app.html'));
});

initSocket(server);
backupService.startScheduler();
require('./services/pausas').startScheduler(); // chamados em pausa voltam para a fila na data marcada
maintenanceAlerts.startScheduler();

server.listen(config.port, () => {
  console.log('==============================================================');
  console.log(` Central de Serviços - rodando em ${config.publicUrl}`);
  console.log(` Modo: ${config.env}  |  Banco: ${config.db.name}@${config.db.host}`);
  console.log('==============================================================');
});
