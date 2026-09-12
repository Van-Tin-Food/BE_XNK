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

  const [carrierResult, supplierResult] = await Promise.all([
    pool.query('SELECT id_hang_tau, ten_hang_tau FROM public.hang_tau ORDER BY ten_hang_tau'),
    pool.query('SELECT id_ncc, ten_ncc FROM public.nha_cung_cap ORDER BY ten_ncc'),
  ]);

  const carrier = carrierResult.rows.find((row) => matchesName(
    data['Hãng tàu'],
    row.ten_hang_tau,
    CARRIER_ALIASES[row.ten_hang_tau] || [],
  ));
  if (carrier) {
    data['Hãng tàu'] = carrier.ten_hang_tau;
    data.id_hang_tau = carrier.id_hang_tau;
  }

  const supplier = supplierResult.rows.find((row) => matchesName(data['Nhà cung cấp'], row.ten_ncc));
  if (supplier) {
    data['Nhà cung cấp'] = supplier.ten_ncc;
    data.id_ncc = supplier.id_ncc;
  }

  return ocrResult;
}

module.exports = { normalizeOcrReferences };
