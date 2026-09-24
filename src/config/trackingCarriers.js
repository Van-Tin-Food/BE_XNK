// Registry tra cứu vận đơn theo hãng tàu, port từ update_funtions/Service_TrackingTest.js
// (Apps Script) sang Node. Thay cho cơ chế Playwright cũ: gọi thẳng HTTP từ server,
// không mở trình duyệt, nên chạy được trong container không có display server.
//
// Mỗi entry chỉ cần label + buildRequest(trackingNumber) trả về { url, options } theo
// đúng định dạng fetch(). Thêm hãng mới = thêm một entry.
//
// Nguyên tắc giữ nguyên từ bản Apps Script: KHÔNG tìm cách vượt qua WAF / bot protection
// của bên thứ ba. Hãng nào chặn thì trả về đúng phản hồi bị chặn để phía gọi biết, chứ
// không che giấu hay bịa dữ liệu. Với các hãng đó, đường đi thật sự là mở trang tra cứu
// công khai trong trình duyệt của người dùng (xem createCarrierDeepLink).

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const JSON_ACCEPT = 'application/json, text/plain, */*';

function clean(trackingNumber) {
  return String(trackingNumber || '').trim();
}

// GET một trang công khai - dùng chung cho các hãng render kết quả bằng JS phía client.
function publicPageRequest(buildUrl) {
  return (trackingNumber) => ({
    url: buildUrl(encodeURIComponent(clean(trackingNumber))),
    options: {
      method: 'GET',
      headers: { Accept: HTML_ACCEPT, 'User-Agent': BROWSER_UA },
    },
  });
}

const TRACKING_CARRIERS = {
  MSC: {
    label: 'MSC',
    // Endpoint, content-type và định dạng Referer lấy từ chính bundle main.js của msc.com.
    // trackingMode '0' = Container/Bill of Lading (khác '1' = Booking).
    // msc.com chặn request kiểu curl bằng Akamai 403 - xem ghi chú đầu file.
    buildRequest: (trackingNumber) => {
      const number = clean(trackingNumber);
      const refInner = `trackingNumber=${encodeURIComponent(number)}&trackingMode=0`;
      const refParams = `params=${encodeURIComponent(Buffer.from(refInner, 'utf8').toString('base64'))}`;
      return {
        url: 'https://www.msc.com/api/feature/tools/TrackingInfo',
        options: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: JSON_ACCEPT,
            'X-Requested-With': 'XMLHttpRequest',
            Referer: `https://www.msc.com/en/track-a-shipment?${refParams}`,
            'User-Agent': BROWSER_UA,
          },
          body: JSON.stringify({ trackingNumber: number, trackingMode: '0' }),
        },
      };
    },
  },

  COSCO: {
    label: 'COSCO',
    buildRequest: (trackingNumber) => {
      const number = clean(trackingNumber);
      return {
        url: 'https://elines.coscoshipping.com/scct/scct_customer_ex/public/cargoTracking/detail',
        options: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: JSON_ACCEPT,
            'User-Agent': BROWSER_UA,
          },
          body: JSON.stringify({
            trackingType: /^[A-Z]{4}\d{7}$/i.test(number) ? 'CONTAINER' : 'BOOKING',
            number,
          }),
        },
      };
    },
  },

  // SPA Next.js: HTML trả về chỉ là khung trang, dữ liệu thật do JS gọi sau khi load.
  YML: {
    label: 'Yang Ming',
    buildRequest: publicPageRequest(
      (n) => `https://www.yangming.com/en/esolution/tracking/cargo_tracking?service=${n}`,
    ),
  },

  // App JSF: ?blno= được đọc ở server và tự chạy tra cứu. Bị chặn 403 với request tự động.
  HAPP: {
    label: 'Hapag-Lloyd',
    buildRequest: publicPageRequest(
      (n) => `https://www.hapag-lloyd.com/en/online-business/track/track-by-booking-solution.html?blno=${n}`,
    ),
  },

  MAERSK: {
    label: 'Maersk',
    buildRequest: publicPageRequest((n) => `https://www.maersk.com/tracking/${n}`),
  },

  // Không bị chặn bot, nhưng kết quả thật được tải bằng AJAX sau khi trang load.
  PIL: {
    label: 'PIL',
    buildRequest: publicPageRequest(
      (n) => 'https://www.pilship.com/digital-solutions/?tab=customer&id=track-trace'
        + `&label=containerTandT&module=TrackTraceBL&refNo=${n}`,
    ),
  },

  ONE: {
    label: 'ONE (Ocean Network Express)',
    buildRequest: publicPageRequest(
      (n) => `https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?trakNoParam=${n}&trakNoTpCdParam=B`,
    ),
  },

  // DataDome chặn 403. Dùng đúng path /ebusiness/tracking, không có /search
  // (path cũ bị 301 và mất luôn query string).
  CMA: {
    label: 'CMA',
    buildRequest: publicPageRequest(
      (n) => `https://www.cma-cgm.com/ebusiness/tracking?SearchBy=BL&Reference=${n}`,
    ),
  },

  // CK Line chạy WebSquare - ô nhập và endpoint tra cứu (sup.WESSUP411.WESSUP411R01)
  // đều do JS dựng sau khi load, không có trong HTML gốc. Không tự dựng được request
  // hợp lệ từ server nên hãng này chỉ có deep link, xem CARRIER_DEEP_LINK bên dưới.
  CKLINE: {
    label: 'CK Line',
    buildRequest: publicPageRequest(() => 'https://es.ckline.co.kr/'),
  },
};

// Trang tra cứu công khai để mở trong trình duyệt của người dùng. Đây là đường đi dùng
// được với mọi hãng, kể cả hãng chặn request tự động, vì request khi đó xuất phát từ
// trình duyệt thật của người dùng.
const CARRIER_DEEP_LINK = {
  MSC: (n) => 'https://www.msc.com/en/track-a-shipment?params='
    + encodeURIComponent(Buffer.from(`trackingNumber=${encodeURIComponent(n)}&trackingMode=0`, 'utf8').toString('base64')),
  COSCO: (n) => `https://elines.coscoshipping.com/ebusiness/cargoTracking?trackingType=BILLOFLADING&number=${encodeURIComponent(n)}`,
  YML: (n) => `https://www.yangming.com/en/esolution/tracking/cargo_tracking?service=${encodeURIComponent(n)}`,
  HAPP: (n) => `https://www.hapag-lloyd.com/en/online-business/track/track-by-booking-solution.html?blno=${encodeURIComponent(n)}`,
  MAERSK: (n) => `https://www.maersk.com/tracking/${encodeURIComponent(n)}`,
  PIL: (n) => 'https://www.pilship.com/digital-solutions/?tab=customer&id=track-trace'
    + `&label=containerTandT&module=TrackTraceBL&refNo=${encodeURIComponent(n)}`,
  ONE: (n) => `https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?trakNoParam=${encodeURIComponent(n)}&trakNoTpCdParam=B`,
  CMA: (n) => `https://www.cma-cgm.com/ebusiness/tracking?SearchBy=BL&Reference=${encodeURIComponent(n)}`,
  CKLINE: () => 'https://es.ckline.co.kr/',
};

module.exports = { TRACKING_CARRIERS, CARRIER_DEEP_LINK, BROWSER_UA };
