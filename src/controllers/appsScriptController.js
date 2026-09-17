const appsScriptService = require('../services/appsScriptService');
const emailService = require('../services/emailService');
const {
  saveUploadedDocument,
  resolveDocumentCode,
} = require('../services/documentProgressService');
const { randomUUID } = require('node:crypto');

function sendServiceError(res, error, message) {
  const status = error.statusCode || (error.code === 'EMAIL_CONFIG_MISSING' ? 500 : 502);
  return res.status(status).json({
    success: false,
    message,
    error: error.message,
    apps_script: error.appsScriptResponse,
    ...(error.uploadedFile ? { uploadedFile: error.uploadedFile } : {}),
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
  const body = req.body || {};
  const requestId = body.requestId || randomUUID();
  const orderCode = body.orderCode || body.order_code || body.ma_hop_dong;
  const documentCode = body.documentCode || body.document_code;
  const fileName = body.fileName || body.file_name;
  const fileData = body.fileData || body.file_data || body.fileBase64 || body.base64;
  const { mimeType, referenceCode, idChiTiet } = body;
  if (!orderCode || !documentCode || !fileName || !fileData) {
    return res.status(400).json({ success: false, message: 'Thieu thong tin upload' });
  }

  let uploadedFile = null;
  try {
    console.log(`[uploadDocument:${requestId}] calling Apps Script`);
    const result = await appsScriptService.call('uploadDocument', {
      orderCode,
      documentCode,
      fileName,
    }, 'POST', {
      action: 'uploadDocument', orderCode, documentCode, fileName, fileData,
      mimeType: mimeType || 'application/pdf',
      ...(referenceCode ? { referenceCode } : {}),
      ...(idChiTiet ? { idChiTiet } : {}),
      ...(requestId ? { requestId } : {}),
    });
    if (!result || result.success !== true) {
      const status = result?.errorCode === 'MISSING_FILE_DATA' ? 400 : 502;
      return res.status(status).json(result || {
        success: false,
        message: 'Apps Script khong tra ve ket qua upload',
      });
    }

    console.log('File upload thanh cong');

    uploadedFile = {
      fileId: result.fileId || result.file_id || result.data?.fileId || result.data?.file_id,
      fileName: result.fileName || result.file_name || result.data?.fileName || result.data?.file_name || fileName,
      fileUrl: result.fileUrl || result.file_url || result.data?.fileUrl || result.data?.file_url,
      referenceCode,
      idChiTiet,
      requestId,
    };
    const fileUrl = uploadedFile.fileUrl;
    const progress = await saveUploadedDocument(orderCode, documentCode, uploadedFile);
    return res.json({
      ...result,
      database: {
        saved: true,
        table: 'chung_tu_drive',
        orderCode: String(orderCode).trim().toUpperCase(),
        documentCode,
        fileUrl,
      },
      documentProgress: progress,
      files: progress.documents?.[resolveDocumentCode(documentCode)]?.files || [],
    });
  } catch (error) {
    console.error(`[uploadDocument:${requestId}] failed:`, {
      code: error.code,
      name: error.name,
      message: error.message,
      stage: error.stage,
    });
    if (uploadedFile) error.uploadedFile = uploadedFile;
    return sendServiceError(res, error, 'Khong the upload chung tu');
  }
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
