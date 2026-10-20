const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const s3Service = require('../services/s3Service');

const router = express.Router();
router.use(requireAuth);

// Ensure local uploads directory exists
const uploadsDir = path.resolve(process.cwd(), 'public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage config for local fallback uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${uuidv4()}-${safeBase}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WEBP, GIF, and PDF are allowed.'));
    }
  }
});

/**
 * Generate AWS S3 Presigned Upload URL for browser direct-upload
 */
router.post('/presign-upload', async (req, res) => {
  try {
    const { filename, contentType = 'image/jpeg' } = req.body;
    if (!filename) {
      return res.status(400).json({ error: 'Bad Request', message: 'Filename is required.' });
    }

    if (!s3Service.isConfigured()) {
      return res.json({
        s3Configured: false,
        message: 'AWS S3 is not configured. Please use local upload endpoint /api/receipts/upload-local.'
      });
    }

    const presigned = await s3Service.getPresignedUploadUrl(req.user.id, filename, contentType);
    return res.json({
      s3Configured: true,
      ...presigned
    });
  } catch (err) {
    console.error('[Receipts:Presign] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to generate presigned upload URL.' });
  }
});

/**
 * Local fallback upload for environments without S3
 */
router.post('/upload-local', upload.single('receipt'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Bad Request', message: 'No receipt file provided.' });
    }

    const relativeUrl = `/uploads/${req.file.filename}`;
    return res.status(201).json({
      message: 'Receipt uploaded locally.',
      receiptUrl: relativeUrl,
      receiptFilename: req.file.originalname,
      size: req.file.size
    });
  } catch (err) {
    console.error('[Receipts:UploadLocal] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to upload receipt locally.' });
  }
});

/**
 * Get viewing / download URL for a receipt
 * Supports either query parameter (?key=...) or route parameter (/view/:key)
 */
async function handleReceiptView(req, res) {
  try {
    const key = req.query.key || req.params.key;

    if (!key) {
      return res.status(400).json({ error: 'Bad Request', message: 'Key parameter is required.' });
    }

    if (s3Service.isConfigured() && key.startsWith('receipts/')) {
      const downloadUrl = await s3Service.getPresignedDownloadUrl(key, 3600);
      return res.redirect(downloadUrl);
    }

    // Local file fallback
    const localFile = path.resolve(uploadsDir, path.basename(key));
    if (fs.existsSync(localFile)) {
      return res.sendFile(localFile);
    }

    return res.status(404).json({ error: 'Not Found', message: 'Receipt not found.' });
  } catch (err) {
    console.error('[Receipts:View] Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch receipt view.' });
  }
}

router.get('/view', handleReceiptView);
router.get('/view/:key', handleReceiptView);

module.exports = router;
