const { chungTuDrive } = require('../config/businessModels');
const { createBusinessService } = require('./businessCrudService');
const {
  parseDocumentValue,
  checkDocumentProgress,
} = require('./documentProgressService');

const baseService = createBusinessService(chungTuDrive);
const documentColumns = [
  'pi', 'inv', 'bl', 'pkl', 'co', 'hc', 'don_kd', 'tk', 'bb_lm',
  'phi_tk', 'thue_nk', '15b', 'qdtq', 'mv', 'tra_cong',
];

function parseDocumentColumns(row) {
  if (!row) return row;
  const parsed = { ...row };
  for (const column of documentColumns) {
    const value = parseDocumentValue(row[column]);
    parsed[column] = value.legacyPass ? 'PASS' : value.files;
  }
  return parsed;
}

module.exports = {
  ...baseService,
  async getAll() {
    return (await baseService.getAll()).map(parseDocumentColumns);
  },
  async getById(id) {
    return parseDocumentColumns(await baseService.getById(id));
  },
  async create(body) {
    const row = await baseService.create(body);
    await checkDocumentProgress(row.order_code, { refreshNotification: true });
    return row;
  },
  async update(id, body) {
    const row = await baseService.update(id, body);
    if (row) await checkDocumentProgress(row.order_code, { refreshNotification: true });
    return row;
  },
};
