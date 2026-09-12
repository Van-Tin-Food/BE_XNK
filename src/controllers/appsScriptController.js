const appsScriptService = require('../services/appsScriptService');
const emailService = require('../services/emailService');
const { saveUploadedDocument } = require('../services/documentProgressService');

function sendServiceError(res, error, message = 'Khong the ket noi Apps Script') {
  return res.status(error.code === 'EMAIL_CONFIG_MISSING' ? 500 : 502).json({
    success: false,
    message,
    error: error.message,
    apps_script: error.appsScriptResponse,
  });
}

function actionHandler(action, { method = 'GET', params = () => ({}) } = {}) {
  return async (req, res) => {
    try {
      const result = await appsScriptService.call(action, params(req), method);
      return res.status(200).json(result);
    } catch (error) {
      return sendServiceError(res, error);
    }
  };
}

const getSheetTotal = actionHandler('getSheetTotal');
const getSheetSummary = actionHandler('getSheetSummary');
const getSheetNoti = actionHandler('getSheetNoti');
const markAllNotificationsRead = actionHandler('markAllNotificationsRead', { method: 'POST' });
const markNotificationRead = actionHandler('markNotificationRead', { method: 'POST' });
const getFolderById = actionHandler('getFolderById', {
  params: (req) => ({ folderId: req.query.folderId || req.query.id }),
});
const getArchivedDocuments = actionHandler('getArchivedDocuments', {
  params: (req) => ({ orderCode: req.query.orderCode || req.body?.orderCode }),
});
const checkDocumentsAndSaveStatus = actionHandler('checkDocumentsAndSaveStatus', { method: 'POST' });
const moveCompletedOrder = actionHandler('moveCompletedOrder', {
  method: 'POST',
  params: (req) => ({ orderCode: req.query.orderCode || req.body?.orderCode }),
});
const getSheetReturnItem = actionHandler('getSheetReturnItem');

async function editSummary(req, res) {
  const { orderCode, order_code: legacyOrderCode, data, updates } = req.body || {};
  const resolvedOrderCode = orderCode || legacyOrderCode;
  const changes = data || updates;
  if (!resolvedOrderCode) return res.status(400).json({ success: false, message: 'Thieu orderCode' });
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return res.status(400).json({ success: false, message: 'Thieu du lieu cap nhat' });
  }
  try {
    const result = await appsScriptService.call('editSummary', {}, 'POST', {
      action: 'editSummary', orderCode: resolvedOrderCode, data: changes,
    });
    return res.status(200).json(result);
  } catch (error) { return sendServiceError(res, error, 'Khong the cap nhat Summary'); }
}

async function editReturnItem(req, res) {
  try {
    const result = await appsScriptService.call('editReturnItem', {}, 'POST', {
      ...(req.body || {}), action: 'editReturnItem',
    });
    return res.status(200).json(result);
  } catch (error) { return sendServiceError(res, error, 'Khong the cap nhat hang rong'); }
}

async function uploadDocument(req, res) {
  const { orderCode, documentCode, fileName, fileData, mimeType } = req.body || {};
  if (!orderCode || !documentCode || !fileName || !fileData) {
    return res.status(400).json({ success: false, message: 'Thieu thong tin upload' });
  }
  try {
    const uploadResult = await appsScriptService.call('uploadDocument', {}, 'POST', {
      action: 'uploadDocument', orderCode, documentCode, fileName, fileData,
      ...(mimeType ? { mimeType } : {}),
    });
    if (!uploadResult || uploadResult.success !== true) return res.status(200).json(uploadResult);

    const fileUrl = uploadResult.fileUrl || uploadResult.file_url
      || uploadResult.data?.fileUrl || uploadResult.data?.file_url;
    const documentProgress = await saveUploadedDocument(orderCode, documentCode, fileUrl);
    return res.status(200).json({ ...uploadResult, documentProgress });
  } catch (error) {
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
    return res.status(200).json({ success: true, data });
  } catch (error) { return sendServiceError(res, error, 'Khong the gui email'); }
}

async function runCheckDocumentsJob(req, res) {
  try {
    const result = await appsScriptService.call('checkDocumentsAndSaveStatus', {}, 'POST');
    return res?.json(result) || result;
  } catch (error) { if (res) return sendServiceError(res, error); throw error; }
}

const updateAll = actionHandler('updateAll');
const getPIFiles = actionHandler('getPIFiles');
const getSheetSell = actionHandler('getSheetSell');
const checkDriveAndUpdate = actionHandler('checkDriveAndUpdate');

module.exports = {
  getSheetTotal, getSheetSummary, getSheetNoti, markAllNotificationsRead, markNotificationRead,
  getFolderById, getArchivedDocuments, getSheetReturnItem, checkDocumentsAndSaveStatus,
  moveCompletedOrder, uploadDocument, editSummary, editReturnItem, sendMissingDocumentEmail,
  runCheckDocumentsJob, updateAll, getPIFiles, getSheetSell, checkDriveAndUpdate,
  runCheckDriveAndUpdateJob: runCheckDocumentsJob,
};
