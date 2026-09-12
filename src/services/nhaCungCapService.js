const { nhaCungCap } = require('../config/businessModels');
const { createBusinessService } = require('./businessCrudService');
module.exports = createBusinessService(nhaCungCap);
