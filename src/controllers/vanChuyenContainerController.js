const { createBusinessController } = require('./businessCrudController');
module.exports = createBusinessController(require('../services/vanChuyenContainerService'));
