const pool = require('../config/database');
const { DOCUMENT_STAGES, DOCUMENT_COLUMN_BY_CODE } = require('../config/documentStages');

function hasDocument(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function resolveDocumentCode(value) {
  const input = String(value || '').trim().toUpperCase();
  const withoutPrefix = input.replace(/^\d+\s*[.)_-]?\s*/, '');
  if (withoutPrefix === 'BILL') return 'BL';
  return DOCUMENT_COLUMN_BY_CODE[withoutPrefix] ? withoutPrefix : '';
}

function parseDocumentValue(value) {
  if (!hasDocument(value)) return { files: [], legacyPass: false };
  if (Array.isArray(value)) return { files: value.filter((item) => item && typeof item === 'object'), legacyPass: false };

  const text = String(value).trim();
  if (text.toUpperCase() === 'PASS') return { files: [], legacyPass: true };
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return { files: parsed.filter((item) => item && typeof item === 'object'), legacyPass: false };
    }
  } catch (_) {
    // A legacy URL/plain text value is handled as one file.
  }
  return { files: [{ fileUrl: text }], legacyPass: false };
}

function serializeDocumentValue(files, legacyPass = false) {
  if (legacyPass && files.length === 0) return 'PASS';
  return JSON.stringify(files);
}

function uniqueDocumentFiles(files) {
  const seen = new Set();
  return files.filter((file) => {
    const key = file.fileId
      ? `id:${file.fileId}`
      : file.requestId
        ? `request:${file.requestId}`
        : file.fileUrl
          ? `url:${file.fileUrl}`
          : `file:${file.fileName || JSON.stringify(file)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function documentFiles(value) {
  return parseDocumentValue(value).files.filter((file) => (
    hasDocument(file.fileId) || hasDocument(file.fileUrl) || hasDocument(file.fileName)
  ));
}

function getDocumentStatus(row) {
  return Object.fromEntries(Object.entries(DOCUMENT_COLUMN_BY_CODE).map(([documentCode, column]) => {
    const parsed = parseDocumentValue(row?.[column]);
    const files = documentFiles(row?.[column]);
    return [documentCode, {
      status: parsed.legacyPass || files.length > 0 ? 1 : 0,
      value: parsed.legacyPass ? 'PASS' : files,
      files,
      fileUrl: files[0]?.fileUrl || null,
      updatedAt: row?.date_time || null,
    }];
  }));
}

function calculateProgress(documentStatus) {
  const currentStage = DOCUMENT_STAGES.find((stage) => stage.documents.some(
    (code) => documentStatus[code].status === 0,
  ));
  if (!currentStage) return {
    currentStage: null, missingDocuments: [], exceededDocuments: [], isExceeded: false,
  };

  const missingDocuments = currentStage.documents.filter((code) => documentStatus[code].status === 0);
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

function normalizeUploadMetadata(metadata) {
  const file = {};
  for (const key of ['fileId', 'fileName', 'fileUrl', 'referenceCode', 'idChiTiet', 'requestId']) {
    if (hasDocument(metadata?.[key])) file[key] = String(metadata[key]).trim();
  }
  file.uploadedAt = metadata?.uploadedAt || new Date().toISOString();
  if (!file.fileId && !file.fileName && !file.fileUrl) {
    throw Object.assign(new Error('Thieu fileId, fileName hoac fileUrl'), { statusCode: 400 });
  }
  return file;
}

async function addUploadedDocument(client, orderCode, documentCode, metadata) {
  const normalizedOrderCode = String(orderCode || '').trim();
  const normalizedDocumentCode = resolveDocumentCode(documentCode);
  const column = DOCUMENT_COLUMN_BY_CODE[normalizedDocumentCode];
  if (!normalizedOrderCode || !column) {
    throw Object.assign(new Error('Thieu orderCode hoac documentCode'), { statusCode: 400 });
  }

  const uploadedFile = normalizeUploadMetadata(metadata);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`chung_tu_drive:${normalizedOrderCode}`]);
  const columns = Object.values(DOCUMENT_COLUMN_BY_CODE).map((item) => `"${item}"`).join(', ');
  const selected = await client.query(
    `SELECT order_code, ${columns}, date_time FROM public.chung_tu_drive
     WHERE order_code = $1 FOR UPDATE`,
    [normalizedOrderCode],
  );
  const row = selected.rows[0];
  const parsed = parseDocumentValue(row?.[column]);
  const existingFiles = uniqueDocumentFiles(parsed.files);
  const duplicate = existingFiles.find((item) => (
    (uploadedFile.fileId && item.fileId === uploadedFile.fileId)
    || (uploadedFile.requestId && item.requestId === uploadedFile.requestId)
    || (uploadedFile.fileUrl && item.fileUrl === uploadedFile.fileUrl)
  ));
  const files = uniqueDocumentFiles(duplicate
    ? existingFiles
    : [...existingFiles, uploadedFile]);
  const storedValue = serializeDocumentValue(files, parsed.legacyPass && files.length === 0);

  const result = await client.query(
    `INSERT INTO public.chung_tu_drive (order_code, "${column}", date_time)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (order_code) DO UPDATE SET
       "${column}" = EXCLUDED."${column}", date_time = CURRENT_TIMESTAMP
     RETURNING order_code`,
    [normalizedOrderCode, storedValue],
  );
  return { orderCode: result.rows[0].order_code, documentCode: normalizedDocumentCode, files, duplicate };
}

async function saveUploadedDocument(orderCode, documentCode, metadataOrUrl) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const metadata = typeof metadataOrUrl === 'string' ? { fileUrl: metadataOrUrl } : (metadataOrUrl || {});
    const saved = await addUploadedDocument(client, orderCode, documentCode, metadata);
    await client.query('COMMIT');
    return checkDocumentProgress(saved.orderCode, {
      refreshNotification: !saved.duplicate,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function findDocumentStatus(orderCode, executor = pool) {
  const columns = Object.values(DOCUMENT_COLUMN_BY_CODE).map((column) => `"${column}"`).join(', ');
  const result = await executor.query(
    `SELECT order_code, ${columns}, date_time FROM public.chung_tu_drive WHERE order_code = $1`,
    [String(orderCode).trim()],
  );
  return result.rows[0] || null;
}

async function syncExceededNotification(orderCode, progress, refreshNotification = false) {
  const completed = progress.currentStage === null;
  const type = completed ? 'HOAN_THANH' : 'THIEU_CHUNG_TU';
  const missing = completed ? '' : progress.missingDocuments.join(', ');
  const name = completed
    ? '\u0110\u01a1n ho\u00e0n th\u00e0nh'
    : `\u0110\u01a1n thi\u1ebfu ch\u1ee9ng t\u1eeb - ${progress.currentStageLabel}`;

  // Chuẩn hóa dữ liệu cũ về đúng hai loại thông báo hiện tại.
  await pool.query(
    `UPDATE public.thong_bao
     SET type = 'THIEU_CHUNG_TU'
     WHERE order_code = $1 AND type = 'VUOT_LO_TRINH'`,
    [orderCode],
  );

  // Khi trạng thái chuyển sang dạng còn lại, đóng thông báo cũ của đơn.
  await pool.query(
    `UPDATE public.thong_bao SET status = 1, date_time = CURRENT_TIMESTAMP
     WHERE order_code = $1
       AND type IN ('THIEU_CHUNG_TU', 'HOAN_THANH')
       AND type <> $2 AND status = 0`,
    [orderCode, type],
  );

  const existing = await pool.query(
    `SELECT id_thong_bao, name, order_code, type, mss_docs, status
     FROM public.thong_bao WHERE order_code = $1 AND type = $2
     ORDER BY date_time DESC LIMIT 1`, [orderCode, type],
  );
  const old = existing.rows[0];
  if (old && old.name === name && old.mss_docs === missing && !refreshNotification) return old;

  if (old && old.name === name && old.mss_docs === missing && refreshNotification) {
    const refreshed = await pool.query(
      `UPDATE public.thong_bao
       SET status = 0, update_by = 'Backend', date_time = CURRENT_TIMESTAMP
       WHERE id_thong_bao = $1
       RETURNING id_thong_bao, name, order_code, type, mss_docs, status, update_by, date_time`,
      [old.id_thong_bao],
    );
    return refreshed.rows[0];
  }
  const notificationId = old?.id_thong_bao || `TB-${type}-${Date.now()}`;
  const result = await pool.query(
    `INSERT INTO public.thong_bao
       (id_thong_bao, name, order_code, type, mss_docs, status, update_by, date_time)
     VALUES ($1, $2, $3, $4, $5, 0, 'Backend', CURRENT_TIMESTAMP)
     ON CONFLICT (id_thong_bao) DO UPDATE SET
       name = EXCLUDED.name, mss_docs = EXCLUDED.mss_docs, status = 0,
       update_by = EXCLUDED.update_by, date_time = CURRENT_TIMESTAMP
     RETURNING id_thong_bao, name, order_code, type, mss_docs, status, update_by, date_time`,
     [notificationId, name, orderCode, type, missing],
  );
  return result.rows[0];
}

async function checkDocumentProgress(orderCode, options = {}) {
  const normalizedOrderCode = String(orderCode || '').trim();
  if (!normalizedOrderCode) throw Object.assign(new Error('Thieu orderCode'), { statusCode: 400 });
  const row = await findDocumentStatus(normalizedOrderCode);
  if (!row) throw Object.assign(new Error('Khong tim thay trang thai chung tu'), { statusCode: 404 });
  const documents = getDocumentStatus(row);
  const progress = calculateProgress(documents);
  const notification = await syncExceededNotification(
    normalizedOrderCode,
    progress,
    options.refreshNotification === true,
  );
  return { success: true, orderCode: normalizedOrderCode, ...progress, documents, notification };
}

module.exports = {
  checkDocumentProgress,
  saveUploadedDocument,
  resolveDocumentCode,
  parseDocumentValue,
  serializeDocumentValue,
  getDocumentStatus,
  calculateProgress,
};
