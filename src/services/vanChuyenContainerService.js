const { vanChuyenContainer } = require('../config/businessModels');
const { createBusinessService } = require('./businessCrudService');
module.exports = createBusinessService(vanChuyenContainer);
