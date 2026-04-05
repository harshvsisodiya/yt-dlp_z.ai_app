const express = require('express');
const router = express.Router();
const path = require('path');

// ─── GET /api/download/:filename ─────────────────────────────
// Serves a downloaded file for the user
router.get('/:filename', (req, res) => {
  const filePath = path.join(__dirname, '..', '..', 'downloads', req.params.filename);
  const fs = require('fs');

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Use res.download with a callback to delete the file after transfer attempts
  res.download(filePath, req.params.filename, (err) => {
    if (err && !res.headersSent) {
      console.error('[Download Stream Error]', err);
    }
    
    // Always attempt to delete the file to save disk space, 
    // even if the download was cancelled or failed.
    fs.unlink(filePath, (unlinkErr) => {
      if (unlinkErr && unlinkErr.code !== 'ENOENT') {
        console.error('[File Deletion Error]', unlinkErr);
      } else {
        console.log(`[File Cleanup] Handled ${req.params.filename}`);
      }
    });
  });
});

module.exports = router;
