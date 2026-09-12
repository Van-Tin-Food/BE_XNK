const { chiTietMuaHang } = require('../config/businessModels');
const { createBusinessService } = require('./businessCrudService');
module.exports = createBusinessService(chiTietMuaHang);
