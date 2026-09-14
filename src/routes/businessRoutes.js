const express = require('express');
const router = express.Router();
const documentProgressController = require('../controllers/documentProgressController');

const resources = [
  ['nha-cung-cap', 'nhaCungCapController'],
  ['hang-tau', 'hangTauController'],
  ['kho', 'khoController'],
  ['mua-hang', 'muaHangController'],
  ['chi-tiet-mua-hang', 'chiTietMuaHangController'],
  ['chi-tiet-mua-hang-item-code', 'chiTietMuaHangItemCodeController'],
  ['xnk', 'xnkController'],
  ['container', 'containerController'],
  ['chi-tiet-container', 'chiTietContainerController'],
  ['van-chuyen-container', 'vanChuyenContainerController'],
  ['chung-tu-drive', 'chungTuDriveController'],
  ['thong-bao', 'thongBaoController'],
];

router.post('/document-progress/check', documentProgressController.checkProgress);

for (const [path, controllerName] of resources) {
  const controller = require(`../controllers/${controllerName}`);
  router.get(`/${path}`, controller.getAll);
  router.get(`/${path}/:id`, controller.getById);
  router.post(`/${path}`, controller.create);
  router.patch(`/${path}/:id`, controller.update);
  router.put(`/${path}/:id`, controller.update);
}

module.exports = router;
