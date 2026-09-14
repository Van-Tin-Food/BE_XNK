const express = require('express');
const controller = require('../controllers/appsScriptController');

const router = express.Router();

// Apps Script chi thao tac file tren Google Drive.
router.post('/uploadDocument', controller.uploadDocument);
router.get('/getArchivedDocuments', controller.getArchivedDocuments);
router.post('/moveCompletedOrder', controller.moveCompletedOrder);

// Email khong phai Apps Script nhung van giu endpoint hien tai cho Frontend.
router.post('/sendMissingDocumentEmail', controller.sendMissingDocumentEmail);

module.exports = router;
