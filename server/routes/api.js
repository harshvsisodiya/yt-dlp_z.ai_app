const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const ytdlp = require('../services/ytdlp');
const cookies = require('../services/cookies');
const history = require('../services/history');

// ─── Multer config for cookie uploads ────────────────────────
const upload = multer({
  dest: path.join(__dirname, '..', '..', 'temp'),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    // Allow .txt and no-extension files (Netscape cookies)
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.txt' || ext === '' || file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Only .txt files accepted for cookies'));
    }
  }
});

// ─── POST /api/fetch-formats ─────────────────────────────────
// Fetches all available formats for a given URL
router.post('/fetch-formats', async (req, res) => {
  try {
    const { url, cookieId } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const cookiePath = cookieId ? cookies.getCookiePath(cookieId) : null;
    const info = await ytdlp.fetchFormats(url, cookiePath);

    // Extract thumbnail and title
    const videoInfo = {
      id: info.id,
      title: info.title,
      thumbnail: info.thumbnail || '',
      duration: info.duration,
      duration_string: info.duration_string || formatDuration(info.duration),
      uploader: info.uploader || '',
      description: (info.description || '').substring(0, 300)
    };

    // Process formats
    const { formats } = ytdlp.categorizeFormats(info.formats || [], info.duration);

    res.json({ info: videoInfo, formats });
  } catch (err) {
    console.error('[Fetch Formats Error]', err.message);
    res.status(500).json({ error: formatError(err.message) });
  }
});

// ─── POST /api/download ──────────────────────────────────────
// Starts a download with selected formats
router.post('/download', async (req, res) => {
  try {
    const { url, videoFormatId, audioFormatId, cookieId, subtitleLangs, subtitleFormat } = req.body;

    if (!url) return res.status(400).json({ error: 'URL is required' });
    if (!videoFormatId && !audioFormatId) {
      return res.status(400).json({ error: 'Select at least one format (video or audio)' });
    }

    // Prevent duplicate downloads for the same URL
    const recentDownload = history.findByUrl(url);
    if (recentDownload && recentDownload.status === 'downloading') {
      return res.status(409).json({ error: 'A download is already in progress for this URL' });
    }

    const cookiePath = cookieId ? cookies.getCookiePath(cookieId) : null;

    // Start the download asynchronously
    const jobId = ytdlp.startDownload({
      url,
      videoFormatId: videoFormatId || null,
      audioFormatId: audioFormatId || null,
      cookiePath,
      subtitleLangs: subtitleLangs || [],
      subtitleFormat: subtitleFormat || 'srt',
      onProgress: (progress) => { /* handled via WebSocket */ },
      onComplete: (result) => { /* handled via WebSocket */ },
      onError: (error) => { /* handled via WebSocket */ }
    });

    res.json({ jobId, message: 'Download started' });
  } catch (err) {
    console.error('[Download Error]', err.message);
    res.status(500).json({ error: formatError(err.message) });
  }
});

// ─── POST /api/cookies/upload ────────────────────────────────
router.post('/cookies/upload', upload.single('cookies'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { path: tempPath, originalname } = req.file;
    const validation = cookies.validate(tempPath);

    if (!validation.valid) {
      // Clean up invalid file
      fs.unlinkSync(tempPath);
      return res.status(400).json({
        error: `Invalid cookies file: ${validation.error}`,
        details: validation.details
      });
    }

    const cookieId = cookies.save(tempPath, originalname);

    res.json({
      cookieId,
      cookieCount: validation.count,
      domains: validation.domains,
      message: `Loaded ${validation.count} cookies from ${validation.domains.length} domain(s)`
    });
  } catch (err) {
    console.error('[Cookie Upload Error]', err.message);
    res.status(500).json({ error: formatError(err.message) });
  }
});

// ─── GET /api/cookies/:id ────────────────────────────────────
router.get('/cookies/:id', (req, res) => {
  const info = cookies.getInfo(req.params.id);
  if (!info) return res.status(404).json({ error: 'Cookie file not found' });
  res.json(info);
});

// ─── DELETE /api/cookies/:id ─────────────────────────────────
router.delete('/cookies/:id', (req, res) => {
  const deleted = cookies.remove(req.params.id);
  res.json({ deleted });
});

// ─── GET /api/history ────────────────────────────────────────
router.get('/history', (req, res) => {
  const items = history.getAll();
  res.json(items);
});

// ─── DELETE /api/history ─────────────────────────────────────
router.delete('/history', (req, res) => {
  history.clear();
  res.json({ message: 'History cleared' });
});

// ─── GET /api/status ─────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const version = await ytdlp.getVersion();
    res.json({
      ytDlpVersion: version,
      activeDownloads: ytdlp.getActiveCount(),
      serverTime: new Date().toISOString()
    });
  } catch (e) {
    res.json({
      ytDlpVersion: 'unknown',
      activeDownloads: ytdlp.getActiveCount(),
      serverTime: new Date().toISOString()
    });
  }
});

// ─── Helpers ─────────────────────────────────────────────────
function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function formatError(msg) {
  return msg;
}

module.exports = router;
