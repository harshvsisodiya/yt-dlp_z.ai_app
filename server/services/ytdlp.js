const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const { broadcast } = require('./ws');
const history = require('./history');

const DOWNLOADS_DIR = path.join(__dirname, '..', '..', 'downloads');
const TEMP_DIR = path.join(__dirname, '..', '..', 'temp');

// Track active downloads
const activeJobs = new Map();

// Cache yt-dlp version
let cachedVersion = null;

// ─── Get yt-dlp version ─────────────────────────────────────
async function getVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    cachedVersion = await execYtdlp(['--version']);
    return cachedVersion;
  } catch {
    return 'unknown';
  }
}

// ─── Fetch available formats ─────────────────────────────────
async function fetchFormats(url, cookiePath) {
  const args = [
    '--dump-json',
    '--no-playlist',
    '--no-download',
    '--ignore-errors',
    '--js-runtimes', 'node'
  ];

  if (cookiePath) {
    args.push('--cookies', cookiePath);
  }

  args.push(url);

  const result = await execYtdlp(args);
  if (!result) throw new Error('No data returned from yt-dlp');

  return JSON.parse(result);
}

// ─── Process formats for table ────────────────────────────────
function categorizeFormats(formats, duration = 0) {
  const allFormats = [];
  const seen = new Set();

  for (const fmt of formats) {
    if (!fmt.format_id) continue;

    const key = fmt.format_id;
    if (seen.has(key)) continue;
    seen.add(key);

    const vC = fmt.vcodec ? String(fmt.vcodec).toLowerCase() : 'none';
    const aC = fmt.acodec ? String(fmt.acodec).toLowerCase() : 'none';
    const vExt = fmt.video_ext ? String(fmt.video_ext).toLowerCase() : 'none';
    const aExt = fmt.audio_ext ? String(fmt.audio_ext).toLowerCase() : 'none';

    const isImages = vC === 'images' || fmt.ext === 'mhtml' || fmt.format_note === 'storyboard';
    if (isImages) continue;

    const hasVideo = vC !== 'none' || vExt !== 'none';
    const hasAudio = aC !== 'none' || aExt !== 'none';

    let type = 'unknown';
    if (isImages) type = 'images';
    else if (hasVideo && hasAudio) type = 'combined';
    else if (hasVideo) type = 'video';
    else if (hasAudio) type = 'audio';

    let protocol = fmt.protocol || 'unknown';
    if (protocol.includes('m3u8')) protocol = 'm3u8';
    else if (protocol.includes('http')) protocol = 'https';

    let resolution = fmt.resolution || '';
    if (isImages && resolution === 'audio only') resolution = '';
    if (!resolution && fmt.width && fmt.height) resolution = `${fmt.width}x${fmt.height}`;
    if (!resolution && !hasVideo && hasAudio) resolution = 'audio only';

    let sizeBytes = fmt.filesize || fmt.filesize_approx;
    if (!sizeBytes && fmt.tbr && duration) {
       sizeBytes = (fmt.tbr * 1000 / 8) * duration;
    }

    const entry = {
      id: fmt.format_id,
      ext: fmt.ext || 'unknown',
      resolution: resolution,
      fps: fmt.fps ? Math.round(fmt.fps) : '',
      filesizeHuman: humanSize(sizeBytes),
      tbr: fmt.tbr ? `${Math.round(fmt.tbr)}k` : '',
      protocol: protocol,
      vcodec: isImages ? 'images' : (hasVideo ? (fmt.vcodec || 'unknown') : 'audio only'),
      vbr: fmt.vbr ? `${Math.round(fmt.vbr)}k` : '',
      acodec: hasAudio ? (fmt.acodec || 'unknown') : 'video only',
      abr: fmt.abr ? `${Math.round(fmt.abr)}k` : '',
      moreInfo: fmt.format_note ? fmt.format_note : (fmt.language ? fmt.language : ''),
      type: type
    };

    allFormats.push(entry);
  }

  return { formats: allFormats };
}

// ─── Start a download job ────────────────────────────────────
function startDownload({ url, videoFormatId, audioFormatId, cookiePath, subtitleLangs, subtitleFormat, onProgress, onComplete, onError }) {
  const jobId = uuid();

  const job = {
    id: jobId,
    url,
    videoFormatId,
    audioFormatId,
    status: 'starting',
    progress: 0,
    speed: '',
    eta: 0,
    filename: null,
    startTime: Date.now()
  };

  activeJobs.set(jobId, job);

  // Add to history
  history.add({
    id: jobId,
    url,
    videoFormatId,
    audioFormatId,
    status: 'starting',
    startTime: job.startTime
  });

  // Run download asynchronously
  runDownload(job, { cookiePath, subtitleLangs, subtitleFormat })
    .then((result) => {
      job.status = 'completed';
      job.filename = result.filename;
      job.filesize = result.filesize;
      history.update(jobId, {
        status: 'completed',
        filename: result.filename,
        filesize: result.filesize,
        completedAt: Date.now()
      });
      broadcast({ type: 'download_complete', job: getPublicJob(job) });
    })
    .catch((err) => {
      job.status = 'error';
      job.error = err.message;
      history.update(jobId, {
        status: 'error',
        error: err.message,
        completedAt: Date.now()
      });
      broadcast({ type: 'download_error', job: getPublicJob(job) });
    })
    .finally(() => {
      // Clean up temp files
      cleanupTemp(jobId);
    });

  return jobId;
}

// ─── Run the actual download ─────────────────────────────────
async function runDownload(job, { cookiePath, subtitleLangs, subtitleFormat }) {
  const args = [
    '--no-playlist',
    '--newline',           // Output progress on new lines
    '--progress',          // Show progress bar
    '--no-warnings',       // Suppress warnings (we capture stderr separately)
    '-o', path.join(DOWNLOADS_DIR, '%(title).120s [%(id)s].%(ext)s'),
    '--print', 'after_move:filepath',
    '--concurrent-fragments', '4', // Faster downloads
    '--js-runtimes', 'node'
  ];

  if (cookiePath) {
    args.push('--cookies', cookiePath);
  }

  // Build format string
  if (job.videoFormatId && job.audioFormatId) {
    // Merge video + audio
    args.push('-f', `${job.videoFormatId}+${job.audioFormatId}`);
    args.push('--merge-output-format', 'mp4');
  } else if (job.videoFormatId) {
    args.push('-f', job.videoFormatId);
  } else if (job.audioFormatId) {
    args.push('-f', job.audioFormatId);
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  }

  // Subtitles
  if (subtitleLangs && subtitleLangs.length > 0) {
    args.push('--sub-langs', subtitleLangs.join(','));
    args.push('--sub-format', subtitleFormat || 'srt');
    args.push('--embed-subs');
  }

  // Embed thumbnail
  args.push('--embed-thumbnail');

  // Write metadata
  args.push('--add-metadata');

  args.push(job.url);

  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, {
      cwd: DOWNLOADS_DIR,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    let lastProgress = {};
    let outputFiles = [];

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      const lines = text.split('\n');

      for (const line of lines) {
        // Parse progress from yt-dlp output
        // yt-dlp output examples:
        // [download]   0.0% of   15.42MiB at    1.50MiB/s ETA 00:10
        // [download]  15.2% of ~ 12.30MiB at   1.23MiB/s ETA 00:08
        const progressMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+([~\s]*[\d.]+[a-zA-Z]+)\s+at\s+([^ ]+)\s+ETA\s+([^ \n\r]+)/i);
        if (progressMatch) {
          const pct = parseFloat(progressMatch[1]);
          const currentSize = progressMatch[2].trim();
          const speed = progressMatch[3];
          const eta = parseEta(progressMatch[4]);

          lastProgress = { progress: pct, speed, eta, size: currentSize };
          job.progress = pct;
          job.speed = speed;
          job.eta = eta;
          job.size = currentSize;
          job.status = 'downloading';

          broadcast({
            type: 'download_progress',
            job: getPublicJob(job)
          });
        }

        // Detect merging stage
        if (line.includes('Merging formats')) {
          job.status = 'merging';
          job.progress = 95;
          broadcast({ type: 'download_progress', job: getPublicJob(job) });
        }

        // Capture output filepath
        if (line.startsWith('after_move:')) {
          outputFiles.push(line.replace('after_move:', '').trim());
        }
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      // yt-dlp writes progress to stderr too
      const progressMatch = text.match(/(\d+(?:\.\d+)?)%\s+of\s+/);
      if (progressMatch) {
        const pct = parseFloat(progressMatch[1]);
        job.progress = Math.max(job.progress, pct);
        job.status = 'downloading';
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}`));
        return;
      }

      // Find the output file
      let filename = null;
      let filesize = 0;

      if (outputFiles.length > 0) {
        const fp = outputFiles[outputFiles.length - 1];
        filename = path.basename(fp);
        try {
          const stat = fs.statSync(fp);
          filesize = stat.size;
        } catch (e) { /* ignore */ }
      }

      if (!filename) {
        // Fallback: look for files modified recently
        const files = fs.readdirSync(DOWNLOADS_DIR)
          .filter(f => {
            const stat = fs.statSync(path.join(DOWNLOADS_DIR, f));
            return stat.mtimeMs > job.startTime - 5000;
          })
          .sort((a, b) => {
            return fs.statSync(path.join(DOWNLOADS_DIR, b)).mtimeMs -
                   fs.statSync(path.join(DOWNLOADS_DIR, a)).mtimeMs;
          });

        if (files.length > 0) {
          filename = files[0];
          try {
            filesize = fs.statSync(path.join(DOWNLOADS_DIR, filename)).size;
          } catch (e) { /* ignore */ }
        }
      }

      if (!filename) {
        reject(new Error('Download completed but output file not found'));
        return;
      }

      resolve({ filename, filesize });
    });
  });
}

// ─── Get active download count ───────────────────────────────
function getActiveCount() {
  return activeJobs.size;
}

// ─── Get public job info (safe to send to client) ────────────
function getPublicJob(job) {
  return {
    id: job.id,
    url: job.url,
    status: job.status,
    progress: Math.round(job.progress * 10) / 10,
    speed: job.speed || '',
    size: job.size || '',
    eta: job.eta || 0,
    etaHuman: formatEta(job.eta),
    filename: job.filename,
    filesize: job.filesize,
    filesizeHuman: humanSize(job.filesize || 0),
    error: job.error
  };
}

// ─── Cleanup temporary files ─────────────────────────────────
function cleanupTemp(jobId) {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    for (const f of files) {
      if (f.includes(jobId.substring(0, 8))) {
        fs.unlinkSync(path.join(TEMP_DIR, f));
      }
    }
    // Also clean temp files older than 1 hour
    const oneHourAgo = Date.now() - 3600000;
    for (const f of files) {
      const stat = fs.statSync(path.join(TEMP_DIR, f));
      if (stat.mtimeMs < oneHourAgo) {
        fs.unlinkSync(path.join(TEMP_DIR, f));
      }
    }
  } catch (e) { /* ignore */ }
}

// ─── Execute yt-dlp and return stdout ────────────────────────
function execYtdlp(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      } else {
        resolve(stdout.trim());
      }
    });

    // Timeout after 30 seconds for metadata operations
    setTimeout(() => {
      proc.kill();
      reject(new Error('yt-dlp timed out'));
    }, 30000);
  });
}

// ─── Utility helpers ─────────────────────────────────────────
function humanSize(bytes) {
  if (!bytes || bytes === 0) return 'N/A';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

function parseEta(str) {
  if (!str || str === 'unknown') return 0;
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function formatEta(seconds) {
  if (!seconds) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Automated Cleanup ───────────────────────────────────────
function startReaper() {
  console.log('🧹 [Download Reaper] Started - Cleaning up old files every 2 minutes');
  
  setInterval(() => {
    try {
      if (!fs.existsSync(DOWNLOADS_DIR)) return;
      
      const files = fs.readdirSync(DOWNLOADS_DIR);
      // Delete files older than 2 minutes
      const threshold = Date.now() - (2 * 60 * 1000); 

      for (const f of files) {
        // Don't delete hidden history file
        if (f === '.history.json') continue;
        
        const filePath = path.join(DOWNLOADS_DIR, f);
        const stat = fs.statSync(filePath);
        
        if (stat.mtimeMs < threshold) {
          fs.unlink(filePath, (err) => {
            if (!err) console.log(`🧹 [Reaper] Purged abandoned file: ${f}`);
          });
        }
      }
    } catch (e) {
      console.error('🧹 [Reaper Error]', e.message);
    }
  }, 60 * 1000); // Check every 1 minute
}

// Start reaper on module load
startReaper();

module.exports = {
  getVersion,
  fetchFormats,
  categorizeFormats,
  startDownload,
  getActiveCount,
  getPublicJob
};
