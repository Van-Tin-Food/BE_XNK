// require('dotenv').config();

// const express = require('express');
// const cors = require('cors');
// const appsScriptRoutes = require('./routes/appsScriptRoutes');
// const authRouter = require('./routes/authRouter');
// const ocrRoutes = require('./routes/ocrRoutes');
// const trackingRoutes = require('./routes/trackingRoutes');

// const app = express();
// const port = process.env.PORT || 5000;

// // Cho phép Frontend ở localhost, Render hoặc domain khác gọi API.
// // Không dùng credentials/cookie nên có thể mở CORS cho mọi origin.
// app.use(cors({
//   origin: true,
//   methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
// }));
// app.options(/.*/, cors());
// app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '25mb' }));
// app.use('/api', appsScriptRoutes);
// app.use('/api/auth', authRouter);
// app.use('/api/ocr', ocrRoutes);
// app.use('/api/tracking', trackingRoutes);

// app.use((req, res) => {
//   res.status(404).json({
//     success: false,
//     message: 'Route not found',
//   });
// });

// if (require.main === module) {
//   app.listen(port, () => {
//     console.log(`Server running at http://localhost:${port}`);
//   });
// }

// module.exports = app;


require('dotenv').config();

const express = require('express');
const cors = require('cors');

const pool = require('./config/database');

const appsScriptRoutes = require('./routes/appsScriptRoutes');
const authRouter = require('./routes/authRouter');
const ocrRoutes = require('./routes/ocrRoutes');
const trackingRoutes = require('./routes/trackingRoutes');
const businessRoutes = require('./routes/businessRoutes');

const app = express();
const port = process.env.PORT || 5000;
const PYTHON_OCR_URL = String(process.env.PYTHON_OCR_URL || 'http://127.0.0.1:8001')
  .replace(/\/$/, '');

// ========================================
// CORS - Cho phép mọi domain gọi BE
// ========================================
app.use(cors());

// ========================================
// JSON body
// ========================================
app.use(
  express.json({
    limit: process.env.JSON_BODY_LIMIT || '25mb',
  })
);

// ========================================
// API Routes
// ========================================
app.use('/api', appsScriptRoutes);
app.use('/api/auth', authRouter);
app.use('/api/ocr', ocrRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api', businessRoutes);

// ========================================
// Health check - dùng cho Docker healthcheck / reverse proxy
// ========================================
app.get('/health', async (req, res) => {
  const checks = { database: 'unknown', ocr: 'unknown' };

  await Promise.all([
    pool.query('select 1')
      .then(() => { checks.database = 'ok'; })
      .catch((error) => { checks.database = `fail: ${error.message}`; }),

    (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        // OCR chỉ nhận POST /ocr/analyze; mọi phản hồi HTTP đều chứng tỏ service còn sống.
        await fetch(`${PYTHON_OCR_URL}/health`, { signal: controller.signal });
        checks.ocr = 'ok';
      } catch (error) {
        checks.ocr = `fail: ${error.name === 'AbortError' ? 'timeout' : error.message}`;
      } finally {
        clearTimeout(timer);
      }
    })(),
  ]);

  const healthy = checks.database === 'ok';
  return res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks,
    uptime: Math.round(process.uptime()),
  });
});

// ========================================
// 404 - Route không tồn tại
// ========================================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// ========================================
// Start server
// ========================================
if (require.main === module) {
  const server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });

  // Docker/Kubernetes gửi SIGTERM khi dừng container. Nếu không xử lý, tiến trình
  // bị SIGKILL sau thời gian chờ và các request đang dở bị cắt ngang.
  const shutdown = (signal) => {
    console.log(`${signal} - đang đóng server...`);
    server.close(() => {
      pool.end()
        .catch((error) => console.error('Lỗi khi đóng pool:', error.message))
        .finally(() => process.exit(0));
    });

    // Chốt chặn cuối: nếu sau 15s vẫn còn kết nối treo thì thoát hẳn.
    setTimeout(() => process.exit(1), 15000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
