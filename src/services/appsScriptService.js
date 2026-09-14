const { APPS_SCRIPT_TIMEOUT, getAppsScriptUrl } = require('../config/appsScript');

const MAX_READ_RETRIES = 2;
const RETRY_DELAY_MS = 500;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function isHtmlOrAuthPage(value) {
  const text = String(value || '').toLowerCase();
  return text.includes('<html') || text.includes('<!doctype') ||
    text.includes('accounts.google.com') || text.includes('sign in - google accounts');
}

function parseResponse(data) {
  if (typeof data !== 'string') return data;
  const text = data.trim();
  if (!text) return { success: false, message: 'Apps Script trả về response rỗng.' };
  if (isHtmlOrAuthPage(text)) {
    return {
      success: false,
      message: 'Apps Script trả về HTML. Kiểm tra URL /exec và quyền deploy Anyone.',
      raw: text.slice(0, 500),
    };
  }
  try { return JSON.parse(text); } catch {
    return { success: false, message: text.slice(0, 1000) };
  }
}

async function callAppsScript(action, params = {}, method = 'GET', body) {
  const url = new URL(getAppsScriptUrl());
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const normalizedMethod = String(method).toUpperCase();
  // Chỉ retry GET để không lặp các thao tác ghi như upload/move.
  const maxAttempts = normalizedMethod === 'GET' ? MAX_READ_RETRIES + 1 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), APPS_SCRIPT_TIMEOUT);

    try {
      const response = await fetch(url.toString(), {
        method: normalizedMethod,
        redirect: 'follow',
        headers: {
          'User-Agent': 'be-app/1.0',
          Accept: 'application/json,text/plain,*/*',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      const responseText = await response.text();

      if (!response.ok && (attempt === maxAttempts || !isRetryableStatus(response.status))) {
        const error = new Error(`Apps Script HTTP ${response.status}`);
        error.statusCode = response.status;
        error.appsScriptResponse = responseText.slice(0, 500);
        throw error;
      }

      if (response.ok || attempt === maxAttempts) {
        return parseResponse(responseText);
      }
    } catch (error) {
      const retryable = error.name === 'AbortError'
        || error.code === 'ECONNRESET'
        || error.code === 'ETIMEDOUT'
        || isRetryableStatus(error.statusCode);

      if (attempt === maxAttempts || !retryable) throw error;
    } finally {
      clearTimeout(timeout);
    }

    await wait(RETRY_DELAY_MS * (2 ** (attempt - 1)));
  }
}

const appsScriptService = {
  call: callAppsScript,
  getArchivedDocuments: (orderCode) => callAppsScript('getArchivedDocuments', { orderCode }),
  moveCompletedOrder: (orderCode, method) => callAppsScript('moveCompletedOrder', { orderCode }, method),
};

module.exports = appsScriptService;
