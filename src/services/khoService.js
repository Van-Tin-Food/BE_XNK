const { kho } = require('../config/businessModels');
const { createBusinessService } = require('./businessCrudService');
module.exports = createBusinessService(kho);
