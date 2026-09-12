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

const appsScriptRoutes = require('./routes/appsScriptRoutes');
const authRouter = require('./routes/authRouter');
const ocrRoutes = require('./routes/ocrRoutes');
const trackingRoutes = require('./routes/trackingRoutes');
const businessRoutes = require('./routes/businessRoutes');

const app = express();
const port = process.env.PORT || 5000;

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
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

module.exports = app;
