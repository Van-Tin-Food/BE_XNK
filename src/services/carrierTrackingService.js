const { TRACKING_CARRIERS, CARRIER_DEEP_LINK } = require('../config/trackingCarriers');

// Giới hạn độ dài body trả về. Đây là công cụ tra cứu/chẩn đoán, không phải đường ống
// dữ liệu, nên một trang HTML báo lỗi dài không nên làm phình response.
const RAW_CHAR_LIMIT = 20000;
const FETCH_TIMEOUT = Number(process.env.CARRIER_FETCH_TIMEOUT || 30000);

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeTrackingNumber(trackingNumber) {
  const normalized = String(trackingNumber ?? '').trim().toUpperCase();
  if (!normalized) throw badRequest('Số vận đơn / booking không được để trống.');
  return normalized;
}

function resolveCarrier(carrierCode) {
  const code = String(carrierCode || '').trim().toUpperCase();
  const carrier = TRACKING_CARRIERS[code];
  if (!carrier) throw badRequest(`Hãng tàu không được hỗ trợ: ${carrierCode}`);
  return { code, carrier };
}

function listCarriers() {
  return Object.entries(TRACKING_CARRIERS).map(([code, { label }]) => ({ code, label }));
}

// Trả về link tra cứu công khai để frontend mở trong trình duyệt người dùng.
// Dùng được với cả những hãng chặn request tự động từ server.
function createCarrierDeepLink(carrierCode, trackingNumber) {
  const { code, carrier } = resolveCarrier(carrierCode);
  const number = normalizeTrackingNumber(trackingNumber);

  return {
    success: true,
    carrier: code,
    label: carrier.label,
    trackingNumber: number,
    url: CARRIER_DEEP_LINK[code](number),
  };
}

// Gọi endpoint tra cứu của hãng từ phía server và trả về đúng những gì nhận được.
// Không ném lỗi với 4xx/5xx: một trang chặn bot (403) chính là thông tin cần thấy,
// không phải thứ cần giấu đi.
async function fetchCarrierTracking(carrierCode, trackingNumber) {
  const { code, carrier } = resolveCarrier(carrierCode);
  const number = normalizeTrackingNumber(trackingNumber);
  const { url, options } = carrier.buildRequest(number);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  let response;
  let text;
  try {
    response = await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
    text = await response.text();
  } catch (error) {
    const reason = error.name === 'AbortError'
      ? `quá ${FETCH_TIMEOUT}ms không phản hồi`
      : error.message;
    const failure = new Error(`Không gọi được ${carrier.label}: ${reason}`);
    failure.statusCode = 502;
    throw failure;
  } finally {
    clearTimeout(timer);
  }

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Không phải JSON - thường là HTML khung trang hoặc trang chặn bot.
    // Vẫn trả nguyên văn qua `raw` thay vì che đi.
  }

  return {
    success: response.ok,
    carrier: code,
    label: carrier.label,
    trackingNumber: number,
    status: response.status,
    headers: Object.fromEntries(response.headers),
    isJson: json !== null,
    json,
    raw: text.slice(0, RAW_CHAR_LIMIT),
    truncated: text.length > RAW_CHAR_LIMIT,
    // Luôn kèm link để người dùng tự mở khi server bị chặn.
    url: CARRIER_DEEP_LINK[code](number),
  };
}

module.exports = {
  listCarriers,
  createCarrierDeepLink,
  fetchCarrierTracking,
  normalizeTrackingNumber,
  RAW_CHAR_LIMIT,
};
