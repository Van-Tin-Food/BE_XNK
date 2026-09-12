const pool = require('../config/database');
const {
  DOCUMENT_STAGES,
  DOCUMENT_COLUMN_BY_CODE,
} = require('../config/documentStages');

function hasDocument(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function getDocumentStatus(row) {
  return Object.fromEntries(
    Object.entries(DOCUMENT_COLUMN_BY_CODE).map(([documentCode, column]) => [
      documentCode,
      {
        status: hasDocument(row[column]) ? 1 : 0,
        fileUrl: hasDocument(row[column]) ? String(row[column]).trim() : null,
        updatedAt: row.date_time || null,
      },
    ]),
  );
}

function calculateProgress(documentStatus) {
  const currentStage = DOCUMENT_STAGES.find((stage) => stage.documents.some(
    (code) => documentStatus[code].status === 0,
  ));

  if (!currentStage) {
    return {
      currentStage: null,
      missingDocuments: [],
      exceededDocuments: [],
      isExceeded: false,
    };
  }

  const missingDocuments = currentStage.documents.filter(
    (code) => documentStatus[code].status === 0,
  );
  const exceededDocuments = DOCUMENT_STAGES
    .filter((stage) => stage.stage > currentStage.stage)
    .flatMap((stage) => stage.documents)
    .filter((code) => documentStatus[code].status === 1);

  return {
    currentStage: currentStage.stage,
    currentStageKey: currentStage.key,
    currentStageLabel: currentStage.label,
    missingDocuments,
    exceededDocuments,
    isExceeded: exceededDocuments.length > 0,
  };
}

async function saveUploadedDocument(orderCode, documentCode, fileUrl) {
  const normalizedOrderCode = String(orderCode || '').trim();
  const normalizedDocumentCode = String(documentCode || '').trim().toUpperCase();
  const column = DOCUMENT_COLUMN_BY_CODE[normalizedDocumentCode];

  if (!normalizedOrderCode || !column || !hasDocument(fileUrl)) {
    const error = new Error('Thieu orderCode, documentCode hoac fileUrl');
    error.statusCode = 400;
    throw error;
  }

  const result = await pool.query(
    `INSERT INTO public.chung_tu_drive (order_code, "${column}", date_time)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (order_code) DO UPDATE SET
       "${column}" = EXCLUDED."${column}",
       date_time = CURRENT_TIMESTAMP
     RETURNING order_code`,
    [normalizedOrderCode, String(fileUrl).trim()],
  );

  const currentRow = await findDocumentStatus(result.rows[0].order_code);
  const currentStatus = getDocumentStatus(currentRow);
  const isComplete = DOCUMENT_STAGES.every((stage) => stage.documents.every(
    (code) => currentStatus[code].status === 1,
  ));

  await pool.query(
    `UPDATE public.chung_tu_drive
     SET status = $1, date_time = CURRENT_TIMESTAMP
     WHERE order_code = $2`,
    [isComplete ? 1 : 0, result.rows[0].order_code],
  );

  return checkDocumentProgress(result.rows[0].order_code);
}

async function findDocumentStatus(orderCode) {
  const result = await pool.query(
    `SELECT order_code, ${Object.values(DOCUMENT_COLUMN_BY_CODE).map((column) => `"${column}"`).join(', ')}, date_time
     FROM public.chung_tu_drive
     WHERE order_code = $1`,
    [String(orderCode).trim()],
  );

  return result.rows[0] || null;
}

async function syncExceededNotification(orderCode, progress) {
  if (!progress.isExceeded) {
    await pool.query(
      `UPDATE public.thong_bao
       SET status = 1, date_time = CURRENT_TIMESTAMP
       WHERE order_code = $1 AND type = 'VUOT_LO_TRINH' AND status = 0`,
      [orderCode],
    );
    return null;
  }

  const missing = progress.missingDocuments.join(', ');
  const name = `ĐƠN VƯỢT LỘ TRÌNH - GIAI ĐOẠN ${progress.currentStage}`;

  const existing = await pool.query(
    `SELECT id_thong_bao, name, order_code, type, mss_docs, status
     FROM public.thong_bao
     WHERE order_code = $1 AND type = 'VUOT_LO_TRINH'
     ORDER BY date_time DESC
     LIMIT 1`,
    [orderCode],
  );
  const old = existing.rows[0];

  if (old && old.name === name && old.mss_docs === missing) {
    return old;
  }

  const notificationId = old?.id_thong_bao || `TB-VUOT-${Date.now()}`;
  const result = await pool.query(
    `INSERT INTO public.thong_bao
       (id_thong_bao, name, order_code, type, mss_docs, status, update_by, date_time)
     VALUES ($1, $2, $3, 'VUOT_LO_TRINH', $4, 0, 'Backend', CURRENT_TIMESTAMP)
     ON CONFLICT (id_thong_bao) DO UPDATE SET
       name = EXCLUDED.name,
       mss_docs = EXCLUDED.mss_docs,
       status = 0,
       update_by = EXCLUDED.update_by,
       date_time = CURRENT_TIMESTAMP
     RETURNING id_thong_bao, name, order_code, type, mss_docs, status, update_by, date_time`,
    [notificationId, name, orderCode, missing],
  );

  return result.rows[0];
}

async function checkDocumentProgress(orderCode) {
  const normalizedOrderCode = String(orderCode || '').trim();
  if (!normalizedOrderCode) {
    const error = new Error('Thiếu orderCode');
    error.statusCode = 400;
    throw error;
  }

  const row = await findDocumentStatus(normalizedOrderCode);
  if (!row) {
    const error = new Error('Không tìm thấy trạng thái chứng từ của đơn hàng');
    error.statusCode = 404;
    throw error;
  }

  const documentStatus = getDocumentStatus(row);
  const progress = calculateProgress(documentStatus);
  const notification = await syncExceededNotification(normalizedOrderCode, progress);

  return {
    success: true,
    orderCode: normalizedOrderCode,
    ...progress,
    documents: documentStatus,
    notification,
  };
}

module.exports = {
  checkDocumentProgress,
  saveUploadedDocument,
  calculateProgress,
  getDocumentStatus,
};
