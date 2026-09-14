const pool = require('../config/database');

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

const CARRIER_ALIASES = {
  EVERGREEN: ['EVERGREEN MARINE', 'EVERGREEN LINE', 'SHIPMENTLINK'],
  MSC: ['MEDITERRANEAN SHIPPING', 'MEDITERRANEAN SHIPPING COMPANY'],
  YML: ['YANG MING', 'YANGMING'],
  'HAPAG-LLOYD': ['HAPAG LLOYD', 'HAPAG'],
  'CK LINE': ['CKLINE', 'CKL'],
  'CMA CGM': ['CMA'],
};

function matchesName(value, name, aliases = []) {
  const source = normalizeText(value);
  const candidates = [name, ...aliases].map(normalizeText).filter(Boolean);
  return candidates.some((candidate) => source === candidate
    || source.includes(candidate)
    || candidate.includes(source));
}

async function normalizeOcrReferences(ocrResult) {
  const data = ocrResult?.data;
  if (!data || typeof data !== 'object') return ocrResult;
  const items = Array.isArray(data) ? data : [data];

  const [carrierResult, supplierResult] = await Promise.all([
    pool.query('SELECT id_hang_tau, ten_hang_tau FROM public.hang_tau ORDER BY ten_hang_tau'),
    pool.query('SELECT id_ncc, ten_ncc FROM public.nha_cung_cap ORDER BY ten_ncc'),
  ]);

  items.forEach((item) => {
    const carrier = carrierResult.rows.find((row) => matchesName(
      item['Hãng tàu'],
      row.ten_hang_tau,
      CARRIER_ALIASES[row.ten_hang_tau] || [],
    ));
    if (carrier) {
      item['Hãng tàu'] = carrier.ten_hang_tau;
      item.id_hang_tau = carrier.id_hang_tau;
    }

    const supplier = supplierResult.rows.find((row) => matchesName(item['Nhà cung cấp'], row.ten_ncc));
    if (supplier) {
      item['Nhà cung cấp'] = supplier.ten_ncc;
      item.id_ncc = supplier.id_ncc;
    }
  });

  return ocrResult;
}

module.exports = { normalizeOcrReferences };
