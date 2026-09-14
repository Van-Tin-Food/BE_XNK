const appsScriptService = require('../services/appsScriptService');
const emailService = require('../services/emailService');
const { saveUploadedDocument } = require('../services/documentProgressService');

function sendServiceError(res, error, message) {
  return res.status(error.code === 'EMAIL_CONFIG_MISSING' ? 500 : 502).json({
    success: false,
    message,
    error: error.message,
    apps_script: error.appsScriptResponse,
  });
}

async function getArchivedDocuments(req, res) {
  try {
    const orderCode = req.query.orderCode || req.body?.orderCode;
    return res.json(await appsScriptService.call('getArchivedDocuments', { orderCode }));
  } catch (error) { return sendServiceError(res, error, 'Khong the lay ho so luu tru'); }
}

async function moveCompletedOrder(req, res) {
  try {
    const orderCode = req.query.orderCode || req.body?.orderCode;
    return res.json(await appsScriptService.call('moveCompletedOrder', { orderCode }, 'POST'));
  } catch (error) { return sendServiceError(res, error, 'Khong the luu tru don hang'); }
}

async function uploadDocument(req, res) {
  const { orderCode, documentCode, fileName, fileData, mimeType } = req.body || {};
  if (!orderCode || !documentCode || !fileName || !fileData) {
    return res.status(400).json({ success: false, message: 'Thieu thong tin upload' });
  }

  try {
    const result = await appsScriptService.call('uploadDocument', {}, 'POST', {
      action: 'uploadDocument', orderCode, documentCode, fileName, fileData,
      ...(mimeType ? { mimeType } : {}),
    });
    if (!result || result.success !== true) return res.status(200).json(result);

    const fileUrl = result.fileUrl || result.file_url || result.data?.fileUrl || result.data?.file_url;
    const progress = await saveUploadedDocument(orderCode, documentCode, fileUrl);
    return res.json({ ...result, documentProgress: progress });
  } catch (error) { return sendServiceError(res, error, 'Khong the upload chung tu'); }
}

async function sendMissingDocumentEmail(req, res) {
  const { to_email, to_name, order_code, missing_docs } = req.body || {};
  if (!to_email || !order_code || !missing_docs) {
    return res.status(400).json({ success: false, message: 'Thieu thong tin email' });
  }
  try {
    const data = await emailService.sendMissingDocumentEmail({ to_email, to_name, order_code, missing_docs });
    return res.json({ success: true, data });
  } catch (error) { return sendServiceError(res, error, 'Khong the gui email'); }
}

module.exports = { getArchivedDocuments, moveCompletedOrder, uploadDocument, sendMissingDocumentEmail };
