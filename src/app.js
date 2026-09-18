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
const PYTHON_OCR_URL = String(
  process.env.PYTHON_OCR_URL || 'http://127.0.0.1:8001'
).replace(/\/$/, '');

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

app.get(['/health', '/api/health'], async (req, res) => {
  const checks = { database: 'unknown', ocr: 'unknown' };

  await Promise.all([
    pool.query('select 1')
      .then(() => { checks.database = 'ok'; })
      .catch((error) => { checks.database = `fail: ${error.message}`; }),
    (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(`${PYTHON_OCR_URL}/health`, {
          signal: controller.signal,
        });
        checks.ocr = response.ok ? 'ok' : `fail: HTTP ${response.status}`;
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
    node: 'ok',
    python: checks.ocr,
    checks,
    uptime: Math.round(process.uptime()),
  });
});

// Health check riêng cho Node API và PostgreSQL.
app.get('/node/health', async (req, res) => {
  try {
    await pool.query('select 1');
    return res.status(200).json({
      status: 'ok',
      service: 'node-api',
      database: 'ok',
      uptime: Math.round(process.uptime()),
    });
  } catch (error) {
    return res.status(503).json({
      status: 'degraded',
      service: 'node-api',
      database: 'fail',
      message: error.message,
    });
  }
});

// Python không public port trong Docker; Node chuyển tiếp health check nội bộ.
app.get('/python/health', async (req, res) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(`${PYTHON_OCR_URL}/health`, {
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    return res.status(response.ok ? 200 : 503).json({
      status: response.ok ? 'ok' : 'degraded',
      service: 'python-ocr',
      ...data,
    });
  } catch (error) {
    return res.status(503).json({
      status: 'down',
      service: 'python-ocr',
      message: error.name === 'AbortError' ? 'Python OCR timeout' : error.message,
    });
  } finally {
    clearTimeout(timer);
  }
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

  const shutdown = (signal) => {
    console.log(`${signal} - đang đóng server...`);
    server.close(() => {
      pool.end()
        .catch((error) => console.error('Lỗi khi đóng pool:', error.message))
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 15000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
