const {
  listCarriers,
  createCarrierDeepLink,
  fetchCarrierTracking,
} = require('../services/carrierTrackingService');

function sendError(res, error, fallbackMessage) {
  if (error.statusCode === 400) {
    return res.status(400).json({ success: false, message: error.message });
  }

  if (error.statusCode === 502) {
    return res.status(502).json({ success: false, message: error.message });
  }

  console.error(`${fallbackMessage}:`, error.message);
  return res.status(500).json({ success: false, message: fallbackMessage });
}

async function getCarriers(req, res) {
  return res.status(200).json({ success: true, carriers: listCarriers() });
}

// Trả link tra cứu để frontend mở trong trình duyệt người dùng.
async function getCarrierLink(req, res) {
  try {
    const { carrier, trackingNumber, code, blNo } = req.body || {};
    return res.status(200).json(
      createCarrierDeepLink(carrier, trackingNumber ?? code ?? blNo),
    );
  } catch (error) {
    return sendError(res, error, 'Không tạo được link tra cứu');
  }
}

// Gọi thẳng endpoint của hãng từ server. Nhiều hãng chặn request tự động - khi đó
// response vẫn trả về nguyên trạng (status 403/502...) để phía gọi biết đường xử lý.
async function lookupCarrier(req, res) {
  try {
    const { carrier, trackingNumber, code, blNo } = req.body || {};
    return res.status(200).json(
      await fetchCarrierTracking(carrier, trackingNumber ?? code ?? blNo),
    );
  } catch (error) {
    return sendError(res, error, 'Không tra cứu được vận đơn');
  }
}

module.exports = { getCarriers, getCarrierLink, lookupCarrier };
