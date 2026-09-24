// Dev/test helper wired into the Dashboard's "Test Tracking" popup - lets a user POST a
// tracking number to a carrier's tracking API from the server (UrlFetchApp, not the
// browser) and inspect the raw POSTBACK response, without writing anything to Sheet or
// Drive. Not part of the XNK_File_Index sync pipeline itself.
//
// TRACKING_CARRIERS is the extension point for adding more carriers later - each entry
// only needs a label + buildRequest(trackingNumber) returning {url, options} for
// UrlFetchApp.fetch().
var TRACKING_CARRIERS = {
  MSC: {
    label: 'MSC',
    // Endpoint path, content-type and Referer format confirmed 2026-08-24 by inspecting
    // msc.com's own main.js bundle (data-api-url="/api/feature/tools/TrackingInfo" on the
    // tracking widget, and its search() call: POST, JSON body {trackingNumber,
    // trackingMode}, header Content-Type: application/json) - fetched via Wayback Machine
    // since msc.com itself blocks curl/UrlFetchApp-style requests with an Akamai 403 (see
    // the matching fix on CARRIER_PUBLIC_TRACKING_URL.MSC, Dashboard.html, for the
    // Referer's own base64 `params` format). trackingMode '0' = Container/Bill of Lading
    // Number (vs '1' Booking Number) - '0' is correct for a BL number lookup.
    buildRequest: function (trackingNumber) {
      // Built by hand, not URLSearchParams - that's a browser/Node API, not available in
      // the Apps Script V8 server runtime (see CARRIER_PUBLIC_TRACKING_URL.MSC,
      // Dashboard.html, for the equivalent client-side version that DOES use it).
      var refInner = 'trackingNumber=' + encodeURIComponent(trackingNumber) + '&trackingMode=0';
      var refParams = 'params=' + encodeURIComponent(Utilities.base64Encode(refInner));
      return {
        url: 'https://www.msc.com/api/feature/tools/TrackingInfo',
        options: {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({ trackingNumber: trackingNumber, trackingMode: '0' }),
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': 'https://www.msc.com/en/track-a-shipment?' + refParams,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          },
          // Read status/body ourselves instead of UrlFetchApp throwing on 4xx/5xx - a
          // bot-protection block (403 Access Denied HTML) is exactly the kind of response
          // this tool exists to surface, not hide.
          muteHttpExceptions: true
        }
      };
    }
  },
  // Plain request only, same as MSC above - deliberately NOT attempting to defeat
  // COSCO's WAF/session checks or decode any obfuscated response body (an earlier
  // version of this did, via a reverse-engineered XOR cipher + cookie warm-up sequence;
  // removed 2026-08-24 - decided against maintaining a bypass of a third party's
  // anti-automation protections). If COSCO blocks this plain call, that block itself is
  // the useful signal to surface, per this file's whole design intent - see the
  // muteHttpExceptions comment on MSC above. Real lookups now go through the Dashboard's
  // "🪟 Mở cửa sổ tra cứu" / "🔗 Mở tab mới" buttons instead, which just open COSCO's own
  // public tracking page for a human to read - no automation involved.
  COSCO: {
    label: 'COSCO',
    buildRequest: function (trackingNumber) {
      var cleanNum = String(trackingNumber || '').trim();
      var trackingType = /^[A-Z]{4}\d{7}$/i.test(cleanNum) ? 'CONTAINER' : 'BOOKING';
      return {
        url: 'https://elines.coscoshipping.com/scct/scct_customer_ex/public/cargoTracking/detail',
        options: {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({ trackingType: trackingType, number: cleanNum }),
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          },
          muteHttpExceptions: true
        }
      };
    }
  },
  // Plain GET of the same public deep-link page used by the Dashboard's BL NO. auto-
  // tracking link/popup (CARRIER_PUBLIC_TRACKING_URL.YML, Dashboard.html) - same
  // no-bypass philosophy as COSCO above. Yang Ming's real tracking data comes from a
  // private REST endpoint (el.CARGO_TRACKING_GET_TRACKING, found 2026-08-24 while
  // inspecting yangming.com's own Next.js bundle) gated by blacklist/maintenance checks
  // whose exact URL wasn't resolved - rather than guess at it, this just fetches the
  // public page directly; being a client-rendered SPA, the raw HTML won't contain the
  // actual tracking result (isJson will be false), but it's the true, honest response,
  // not a fabricated one - same "surface whatever comes back" intent as COSCO.
  YML: {
    label: 'Yang Ming',
    buildRequest: function (trackingNumber) {
      return {
        url: 'https://www.yangming.com/en/esolution/tracking/cargo_tracking?service=' + encodeURIComponent(String(trackingNumber || '').trim()),
        options: {
          method: 'get',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          },
          muteHttpExceptions: true
        }
      };
    }
  },
  // Confirmed 2026-08-24 via Wayback Machine's CDX index (dozens of real archived
  // snapshots of this URL with genuine blno values) that ?blno= is read server-side
  // (this is a JSF/ViewState app) and auto-runs a full search - the best-confirmed of
  // the three carriers in this file. hapag-lloyd.com blocks curl/UrlFetchApp-style
  // requests on this exact path with a 403 though (same as msc.com), so this plain GET
  // is expected to surface that block rather than real results - same no-bypass intent
  // as COSCO/YML above; the working, human-facing path is the Dashboard's popup/BL NO.
  // link (CARRIER_PUBLIC_TRACKING_URL.HAPP, Dashboard.html), opened in the user's own
  // browser where the block doesn't apply.
  HAPP: {
    label: 'Hapag-Lloyd',
    buildRequest: function (trackingNumber) {
      return {
        url: 'https://www.hapag-lloyd.com/en/online-business/track/track-by-booking-solution.html?blno=' + encodeURIComponent(String(trackingNumber || '').trim()),
        options: {
          method: 'get',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          },
          muteHttpExceptions: true
        }
      };
    }
  },
  // Same no-bypass plain-GET pattern as HAPP above. maersk.com blocks curl/UrlFetchApp-
  // style requests on this exact path with a 502 (confirmed 2026-08-24) despite Wayback
  // having many real archived snapshots of the same /tracking/<num> path - so this is
  // expected to surface that block too; the working path is the Dashboard's popup/BL
  // NO. link (CARRIER_PUBLIC_TRACKING_URL.MAERSK, Dashboard.html).
  MAERSK: {
    label: 'Maersk',
    buildRequest: function (trackingNumber) {
      return {
        url: 'https://www.maersk.com/tracking/' + encodeURIComponent(String(trackingNumber || '').trim()),
        options: {
          method: 'get',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          },
          muteHttpExceptions: true
        }
      };
    }
  },
  // pilship.com is NOT bot-blocked (confirmed 2026-08-24, unlike the carriers above) -
  // this plain GET actually succeeds, but the real BL lookup result is fetched by the
  // page's own JS via AJAX after load (pil-ajax.js reads `refNo` from the query string),
  // so the raw HTML returned here is just the page shell (isJson will be false) - still
  // the true, honest response, same intent as the others.
  PIL: {
    label: 'PIL',
    buildRequest: function (trackingNumber) {
      return {
        url: 'https://www.pilship.com/digital-solutions/?tab=customer&id=track-trace&label=containerTandT&module=TrackTraceBL&refNo=' + encodeURIComponent(String(trackingNumber || '').trim()),
        options: {
          method: 'get',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          },
          muteHttpExceptions: true
        }
      };
    }
  },
  // one-line.com is NOT bot-blocked either - same "page shell only, real result comes
  // from client-side JS after load" situation as PIL above (this one's a Next.js SPA,
  // like Yang Ming).
  ONE: {
    label: 'ONE (Ocean Network Express)',
    buildRequest: function (trackingNumber) {
      return {
        url: 'https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?trakNoParam=' + encodeURIComponent(String(trackingNumber || '').trim()) + '&trakNoTpCdParam=B',
        options: {
          method: 'get',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          },
          muteHttpExceptions: true
        }
      };
    }
  },
  // Same no-bypass plain-GET pattern as MAERSK/HAPP above. cma-cgm.com blocks curl/
  // UrlFetchApp-style requests on this exact path with a 403 (DataDome bot protection,
  // confirmed 2026-08-24), so this is expected to surface that block too; the working
  // path is the Dashboard's popup/BL NO. link (CARRIER_PUBLIC_TRACKING_URL.CMA,
  // Dashboard.html) - see that function's comment for why this is the bare
  // /ebusiness/tracking path (no /search segment - that now 301-redirects and drops the
  // query, which is why the popup wasn't auto-filling before this fix).
  CMA: {
    label: 'CMA',
    buildRequest: function (trackingNumber) {
      return {
        url: 'https://www.cma-cgm.com/ebusiness/tracking?SearchBy=BL&Reference=' + encodeURIComponent(String(trackingNumber || '').trim()),
        options: {
          method: 'get',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          },
          muteHttpExceptions: true
        }
      };
    }
  }
};

// Cap on how much raw body text is sent back to the browser per call - this is a debug
// tool, not a data pipe, so a runaway HTML error page shouldn't bloat the response.
var TRACKING_TEST_RAW_CHAR_LIMIT = 20000;

// @return {string} JSON-encoded array - see the "returns a JSON string" note on
// getDashboardData (Service_DashboardData.js) for why.
function getTrackingCarrierList() {
  return JSON.stringify(Object.keys(TRACKING_CARRIERS).map(function (code) {
    return { code: code, label: TRACKING_CARRIERS[code].label };
  }));
}

// Client-callable via google.script.run from the Dashboard's Test Tracking popup.
// @return {string} JSON-encoded object - same convention as getTrackingCarrierList above.
function testCarrierTracking(carrierCode, trackingNumber) {
  trackingNumber = String(trackingNumber || '').trim();
  if (!trackingNumber) throw new Error('Vui lòng nhập số vận đơn / booking.');

  var carrier = TRACKING_CARRIERS[carrierCode];
  if (!carrier) throw new Error('Hãng tàu không được hỗ trợ: ' + carrierCode);

  var req = carrier.buildRequest(trackingNumber);
  var response = UrlFetchApp.fetch(req.url, req.options);
  var status = response.getResponseCode();
  var text = response.getContentText();

  var parsed = null;
  var isJson = false;
  try {
    parsed = JSON.parse(text);
    isJson = true;
  } catch (e) {
    // Not JSON - e.g. an HTML bot-protection block page. Surfaced via `raw` below,
    // not hidden or worked around - see the muteHttpExceptions comment on MSC above.
  }

  return JSON.stringify({
    carrier: carrierCode,
    status: status,
    headers: response.getAllHeaders(),
    isJson: isJson,
    json: isJson ? parsed : null,
    raw: text.substring(0, TRACKING_TEST_RAW_CHAR_LIMIT),
    truncated: text.length > TRACKING_TEST_RAW_CHAR_LIMIT
  });
}
