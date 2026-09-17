const express = require('express');
const evergreenTrackingController = require('../controllers/evergreenTrackingController');
const cklineTrackingController = require('../controllers/cklineTrackingController');
const carrierTrackingController = require('../controllers/carrierTrackingController');

const router = express.Router();

router.post('/evergreen/launch', evergreenTrackingController.launchEvergreenTracking);
router.post('/ckline', cklineTrackingController.trackCKLine);

// Registry chung cho các hãng còn lại (MSC, COSCO, Yang Ming, Hapag-Lloyd,
// Maersk, PIL, ONE, CMA, CK Line).
router.get('/carriers', carrierTrackingController.getCarriers);
router.post('/carriers/link', carrierTrackingController.getCarrierLink);
router.post('/carriers/lookup', carrierTrackingController.lookupCarrier);

module.exports = router;
