const defaultPythonOcrUrl = process.env.NODE_ENV === 'production'
  ? 'http://be-xnk-ocr:8001'
  : 'http://127.0.0.1:8001';
const PYTHON_OCR_URL = String(process.env.PYTHON_OCR_URL || defaultPythonOcrUrl).replace(/\/$/, '');
const PYTHON_OCR_TIMEOUT = 180000;

async function analyzeDocument(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PYTHON_OCR_TIMEOUT);
  try {
    const response = await fetch(`${PYTHON_OCR_URL}/ocr/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload), signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.message || `Python OCR HTTP ${response.status}`);
      error.statusCode = response.status;
      throw error;
    }
    return result;
  } finally { clearTimeout(timeout); }
}

module.exports = { analyzeDocument };
