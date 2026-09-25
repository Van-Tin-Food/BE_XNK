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
const { requireAuth } = require('./middlewares/requireAuth');

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
// Xác thực
// ========================================
// Chặn trước toàn bộ route phía dưới. Danh sách đường dẫn công khai nằm trong
// PUBLIC_ROUTES của middleware (login + các endpoint health).
app.use(requireAuth);

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
// Chỉ database quyết định status code: DB hỏng -> 503 và Docker đánh dấu
// container unhealthy. OCR chết chỉ hiện trong checks.ocr nhưng vẫn trả 200,
// vì phần lớn API không phụ thuộc OCR.
// Vân tay mã nguồn được Dockerfile.api ghi vào lúc build. CI so giá trị này với
// hash của image nó vừa build để biết container đang chạy có đúng bản vừa push
// hay không — /health không phân biệt được bản cũ với bản mới.
// Chạy trực tiếp bằng npm start (ngoài Docker) thì không có file này: trả "unknown".
const SRC_HASH = (() => {
  try {
    return require('fs').readFileSync('/app/SRC_HASH', 'utf8').trim();
  } catch {
    return 'unknown';
  }
})();

app.get('/version', (req, res) => {
  return res.json({ srcHash: SRC_HASH, uptime: Math.round(process.uptime()) });
});

app.get(['/health', '/api/health'], async (req, res) => {
  const checks = { database: 'unknown', ocr: 'unknown', ai: 'unknown' };

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
        const data = await response.json().catch(() => ({}));
        checks.ocr = response.ok ? 'ok' : `fail: HTTP ${response.status}`;
        checks.ai = data.checks?.ai || (response.ok ? 'unknown' : checks.ocr);
      } catch (error) {
        checks.ocr = `fail: ${error.name === 'AbortError' ? 'timeout' : error.message}`;
        checks.ai = checks.ocr;
      } finally {
        clearTimeout(timer);
      }
    })(),
  ]);

  const healthy = checks.database === 'ok' && checks.ai === 'ok';
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

  // Docker gửi SIGTERM khi dừng container. Nếu không xử lý, tiến trình bị
  // SIGKILL sau thời gian chờ và các request đang dở bị cắt ngang.
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
