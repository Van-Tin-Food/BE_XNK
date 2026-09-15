// Upload PDF lên Drive có thể mất lâu hơn các request đọc dữ liệu.
const APPS_SCRIPT_TIMEOUT = Number(process.env.APPS_SCRIPT_TIMEOUT || 120000);

function getAppsScriptUrl() {
  const url = String(process.env.APPSCRIPT_URL || '').trim();
  if (!url) throw new Error('Missing APPSCRIPT_URL in .env');
  return url;
}

module.exports = { APPS_SCRIPT_TIMEOUT, getAppsScriptUrl };
