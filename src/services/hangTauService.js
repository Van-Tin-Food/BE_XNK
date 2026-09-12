const { hangTau } = require('../config/businessModels');
const { createBusinessService } = require('./businessCrudService');
module.exports = createBusinessService(hangTau);
