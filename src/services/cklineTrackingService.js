// Trước đây service này mở Chromium qua Playwright với headless: false để điền B/L vào
// trang CK Line. Cách đó chỉ chạy được trên máy cá nhân có màn hình, không chạy được
// trong container, và mỗi lượt gọi thành công lại bỏ quên một tiến trình Chromium.
//
// Nay chuyển sang cùng cơ chế với Evergreen: server chỉ dựng sẵn thông tin tra cứu và
// trả về, việc mở trang do trình duyệt của người dùng thực hiện. Không còn tiến trình
// con, không cần display server.
//
// CK Line dùng WebSquare: ô nhập và endpoint tra cứu (sup.WESSUP411.WESSUP411R01) đều
// do JS dựng sau khi trang load, không có trong HTML gốc, nên không dựng được request
// hợp lệ từ phía server. Vì vậy hãng này chỉ trả deep link.

const { createCarrierDeepLink } = require('./carrierTrackingService');
const { CARRIER_DEEP_LINK } = require('../config/trackingCarriers');

const CKLINE_URL = CARRIER_DEEP_LINK.CKLINE();

function normalizeBlNumber(blNo) {
  const normalized = String(blNo ?? '').trim().toUpperCase();

  if (!normalized) {
    const error = new Error('CK Line B/L No. không được để trống.');
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

async function openCKLineTracking(blNo) {
  const normalizedBl = normalizeBlNumber(blNo);
  const link = createCarrierDeepLink('CKLINE', normalizedBl);

  // Giữ nguyên các khoá cũ (success, carrier, bl, message) để frontend hiện tại không vỡ.
  return {
    success: true,
    carrier: 'CK LINE',
    bl: normalizedBl,
    url: link.url,
    trackingRequest: {
      method: 'GET',
      action: link.url,
      fields: {},
    },
    autoFill: false,
    message: 'Mở trang CK Line và nhập B/L ' + normalizedBl
      + ' vào ô Cargo Tracking. CK Line không hỗ trợ điền sẵn qua đường dẫn.',
  };
}

module.exports = {
  CKLINE_URL,
  normalizeBlNumber,
  openCKLineTracking,
};
