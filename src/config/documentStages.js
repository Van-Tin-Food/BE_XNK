const DOCUMENT_STAGES = [
  { key: 'GIAI_DOAN_1', stage: 1, label: 'L\u00ean \u0111\u01a1n h\u00e0ng', documents: ['PI', 'PKL', 'INV'] },
  { key: 'GIAI_DOAN_2', stage: 2, label: '\u0110ang v\u1eadn chuy\u1ec3n bi\u1ec3n', documents: ['BL', 'CO', 'HC'] },
  { key: 'GIAI_DOAN_3', stage: 3, label: '\u0110\u00e3 \u0111\u1ebfn c\u1ea3ng', documents: ['DON_KD'] },
  { key: 'GIAI_DOAN_4', stage: 4, label: 'N\u1ed9p t\u1edd khai', documents: ['TK', 'BB_LM', 'PHI_TK', 'THUE_NK'] },
  { key: 'GIAI_DOAN_5', stage: 5, label: 'M\u1eabu 15B', documents: ['15B'] },
  { key: 'GIAI_DOAN_6', stage: 6, label: 'Th\u00f4ng quan', documents: ['QDTQ', 'MV'] },
  { key: 'GIAI_DOAN_7', stage: 7, label: 'Giao h\u00e0ng th\u00e0nh c\u00f4ng', documents: ['TRA_CONG'] },
];

const DOCUMENT_COLUMN_BY_CODE = {
  PI: 'pi', INV: 'inv', BL: 'bl', PKL: 'pkl', CO: 'co', HC: 'hc',
  DON_KD: 'don_kd', TK: 'tk', BB_LM: 'bb_lm', PHI_TK: 'phi_tk', THUE_NK: 'thue_nk',
  '15B': '15b', QDTQ: 'qdtq', MV: 'mv', TRA_CONG: 'tra_cong',
};

module.exports = { DOCUMENT_STAGES, DOCUMENT_COLUMN_BY_CODE };
