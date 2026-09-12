const { checkDocumentProgress } = require('../services/documentProgressService');

async function checkProgress(req, res) {
  try {
    return res.json(await checkDocumentProgress(req.body?.orderCode || req.query?.orderCode));
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Không thể kiểm tra tiến độ chứng từ',
    });
  }
}

module.exports = { checkProgress };
