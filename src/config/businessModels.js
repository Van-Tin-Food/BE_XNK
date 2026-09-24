module.exports = {
  nhaCungCap: {
    table: 'nha_cung_cap', idColumn: 'id_ncc',
    columns: ['id_ncc', 'ten_ncc', 'quoc_gia', 'dia_chi', 'so_dien_thoai', 'email'],
  },
  hangTau: {
    table: 'hang_tau', idColumn: 'id_hang_tau',
    columns: ['id_hang_tau', 'ten_hang_tau'],
  },
  kho: {
    table: 'kho', idColumn: 'id_kho',
    columns: ['id_kho', 'ten_kho', 'so_dien_thoai', 'dia_chi'],
  },
  muaHang: {
    table: 'mua_hang', idColumn: 'ma_hop_dong',
    columns: ['ma_hop_dong', 'ngay_hop_dong', 'ma_inv', 'ngay_inv', 'id_ncc', 'is_deleted'],
    required: ['ma_hop_dong', 'id_ncc'],
  },
  chiTietMuaHang: {
    table: 'chi_tiet_mua_hang', idColumn: 'id_chi_tiet',
    columns: ['id_chi_tiet', 'ma_hop_dong', 'ten_hang', 'net_weight', 'so_kien', 'don_vi_kien', 'don_gia', 'tong_gia'],
  },
  chiTietMuaHangItemCode: {
    table: 'chi_tiet_mua_hang_item_code', idColumn: 'id_item_code',
    columns: ['id_item_code', 'id_chi_tiet', 'ma_nha_may', 'item_code'],
    fieldAliases: {
      idItemCode: 'id_item_code',
      idChiTiet: 'id_chi_tiet',
      maNhaMay: 'ma_nha_may',
      itemCode: 'item_code',
    },
  },
  xnk: {
    table: 'xnk', idColumn: 'ma_bl',
    columns: ['ma_bl', 'ma_hop_dong', 'id_hang_tau', 'cang_di', 'cang_den', 'etd', 'eta', 'ata'],
  },
  container: {
    table: 'container', idColumn: 'id_bl_container',
    columns: ['id_bl_container', 'ma_bl', 'ma_container'],
  },
  chiTietContainer: {
    table: 'chi_tiet_container', idColumn: 'id_chi_tiet_container',
    columns: ['id_chi_tiet_container', 'id_bl_container', 'id_item_code', 'so_kien', 'don_vi_kien', 'net_weight'],
  },
  vanChuyenContainer: {
    table: 'van_chuyen_container', idColumn: 'id_van_chuyen',
    columns: ['id_van_chuyen', 'id_bl_container', 'ngay_van_chuyen', 'nha_xe', 'ten_tai_xe', 'bien_so_xe', 'noi_di', 'id_kho', 'noi_tra_container', 'ghi_chu'],
  },
  chungTuDrive: {
    table: 'chung_tu_drive', idColumn: 'order_code',
    columns: ['order_code', 'pi', 'inv', 'bl', 'pkl', 'co', 'hc', 'don_kd', 'tk', 'bb_lm', 'phi_tk', 'thue_nk', '15b', 'qdtq', 'mv', 'tra_cong', 'status', 'date_time'],
  },
  thongBao: {
    table: 'thong_bao', idColumn: 'id_thong_bao',
    columns: ['id_thong_bao', 'name', 'order_code', 'type', 'mss_docs', 'status', 'update_by', 'date_time'],
  },
};
