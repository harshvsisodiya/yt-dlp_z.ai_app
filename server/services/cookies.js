const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');

const COOKIES_DIR = path.join(__dirname, '..', '..', 'temp', 'cookies');

// Ensure cookies directory exists
if (!fs.existsSync(COOKIES_DIR)) {
  fs.mkdirSync(COOKIES_DIR, { recursive: true });
}

// In-memory store of cookie metadata
const cookieStore = new Map();

// ─── Validate a cookies.txt file ─────────────────────────────
function validate(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));

    if (lines.length === 0) {
      return { valid: false, error: 'File is empty or contains only comments', count: 0, domains: [] };
    }

    // Validate Netscape cookie format
    let validCount = 0;
    const domains = new Set();
    const errors = [];

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].trim().split('\t');
      if (parts.length >= 7) {
        const domain = parts[0];
        const name = parts[5];
        const value = parts[6];

        if (domain && name) {
          validCount++;
          domains.add(domain);
        }
      } else {
        // Tolerate malformed lines (don't break)
        errors.push(`Line ${i + 1}: malformed (expected 7 tab-separated fields, got ${parts.length})`);
      }
    }

    if (validCount === 0) {
      return {
        valid: false,
        error: 'No valid cookies found in file',
        count: 0,
        domains: [],
        details: errors.slice(0, 5)
      };
    }

    return {
      valid: true,
      count: validCount,
      domains: Array.from(domains),
      warnings: errors.length > 0 ? `${errors.length} malformed line(s) skipped` : null,
      malformedLines: errors.length
    };
  } catch (err) {
    return { valid: false, error: `Failed to read file: ${err.message}`, count: 0, domains: [] };
  }
}

// ─── Save uploaded cookies and return an ID ──────────────────
function save(tempPath, originalName) {
  const cookieId = uuid();
  const cookiePath = path.join(COOKIES_DIR, `${cookieId}.txt`);

  fs.renameSync(tempPath, cookiePath);

  const info = {
    id: cookieId,
    originalName,
    path: cookiePath,
    uploadedAt: Date.now()
  };

  cookieStore.set(cookieId, info);
  return cookieId;
}

// ─── Get the file path for a cookie ID ───────────────────────
function getCookiePath(cookieId) {
  const info = cookieStore.get(cookieId);
  if (!info) return null;
  if (!fs.existsSync(info.path)) {
    cookieStore.delete(cookieId);
    return null;
  }
  return info.path;
}

// ─── Get cookie metadata ─────────────────────────────────────
function getInfo(cookieId) {
  const info = cookieStore.get(cookieId);
  if (!info) return null;

  return {
    id: info.id,
    originalName: info.originalName,
    uploadedAt: info.uploadedAt,
    exists: fs.existsSync(info.path)
  };
}

// ─── Remove a cookie file ────────────────────────────────────
function remove(cookieId) {
  const info = cookieStore.get(cookieId);
  if (!info) return false;

  try {
    if (fs.existsSync(info.path)) fs.unlinkSync(info.path);
  } catch (e) { /* ignore */ }

  cookieStore.delete(cookieId);
  return true;
}

module.exports = {
  validate,
  save,
  getCookiePath,
  getInfo,
  remove
};
