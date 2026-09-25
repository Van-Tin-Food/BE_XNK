const { analyzeDocument } = require('../services/pythonOcrService');
const { normalizeOcrReferences } = require('../services/ocrReferenceService');

async function analyze(req, res) {
  try {
    const input = req.file
      ? { ...(req.body || {}), fileName: req.file.originalname, fileData: req.file.buffer.toString('base64') }
      : req.body || {};
    const result = await analyzeDocument(input);
    return res.status(200).json(await normalizeOcrReferences(result));
  } catch (error) {
    const status = Number.isInteger(error.statusCode)
      ? error.statusCode
      : /missing|thiếu|phải là|chỉ hỗ trợ|không phải|vượt quá/i.test(error.message)
        ? 400
        : 500;
    console.error(`[ocr] analyze failed (${status}):`, error);
    return res.status(status).json({ success: false, message: error.message });
  }
}

module.exports = { analyze };
