const { xnk } = require('../config/businessModels');
const { createBusinessService } = require('./businessCrudService');
module.exports = createBusinessService(xnk);
