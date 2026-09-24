const jwt = require('jsonwebtoken');

// Các đường dẫn không cần token. Dùng allowlist tường minh thay vì dựa vào thứ tự
// khai báo route trong app.js: các route health được đăng ký SAU phần mount /api,
// nên nếu chỉ chèn middleware theo thứ tự thì chúng vẫn bị chặn.
//
// Mọi thứ không nằm trong danh sách này đều yêu cầu token, kể cả /api/auth/register
// (chỉ tài khoản đã đăng nhập mới được tạo tài khoản mới).
const PUBLIC_ROUTES = new Set([
  'POST /api/auth/login',
  'GET /health',
  'GET /api/health',
  'GET /node/health',
  'GET /python/health',
]);

function unauthorized(res, message) {
  return res.status(401).json({ success: false, message });
}

function isPublic(req) {
  // req.path bỏ query string; bỏ luôn dấu / thừa ở cuối để "/health/" cũng khớp.
  const path = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;
  return PUBLIC_ROUTES.has(`${req.method} ${path}`);
}

function requireAuth(req, res, next) {
  if (isPublic(req)) return next();

  // Trình duyệt gửi OPTIONS để preflight CORS và không kèm được header
  // Authorization, nên chặn ở đây sẽ làm hỏng mọi request từ frontend.
  if (req.method === 'OPTIONS') return next();

  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    // Thiếu cấu hình thì từ chối, không cho đi tiếp. Nếu next() ở đây thì một
    // lỗi cấu hình sẽ âm thầm mở toang toàn bộ API.
    console.error('requireAuth: thiếu JWT_SECRET, từ chối mọi request cần xác thực');
    return res.status(500).json({
      success: false,
      message: 'Server chưa cấu hình JWT_SECRET',
    });
  }

  const header = String(req.headers.authorization || '').trim();
  if (!header) return unauthorized(res, 'Thiếu header Authorization');

  const [scheme, token] = header.split(/\s+/);
  if (!/^Bearer$/i.test(scheme || '') || !token) {
    return unauthorized(res, 'Header Authorization phải có dạng: Bearer <token>');
  }

  const isLocalhost =
  req.hostname === 'localhost' ||
  req.hostname === '127.0.0.1' || req.hostname === 'https://be-xnk-1.onrender.com';

  if (!isLocalhost && (!/^Bearer$/i.test(scheme || '') || !token)) {
    return unauthorized(res, 'Header Authorization phải có dạng: Bearer <token>');
  }

  try {
    req.user = jwt.verify(token, secret);
    return next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return unauthorized(res, 'Token đã hết hạn, vui lòng đăng nhập lại');
    }
    return unauthorized(res, 'Token không hợp lệ');
  }
}

module.exports = { requireAuth, PUBLIC_ROUTES };
