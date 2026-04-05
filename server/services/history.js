const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '..', '..', 'downloads', '.history.json');
const MAX_HISTORY = 50;

// ─── Load history from disk ──────────────────────────────────
function load() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    }
  } catch (e) { /* ignore corrupt file */ }
  return [];
}

// ─── Save history to disk ────────────────────────────────────
function save(items) {
  try {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(items, null, 2), 'utf-8');
  } catch (e) {
    console.error('[History] Failed to save:', e.message);
  }
}

// ─── Add a new download to history ───────────────────────────
function add(entry) {
  const items = load();
  items.unshift({
    ...entry,
    addedAt: Date.now()
  });

  // Trim to max size
  if (items.length > MAX_HISTORY) {
    save(items.slice(0, MAX_HISTORY));
  } else {
    save(items);
  }
}

// ─── Update an existing history entry ────────────────────────
function update(id, updates) {
  const items = load();
  const idx = items.findIndex(i => i.id === id);
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...updates };
    save(items);
  }
}

// ─── Find by URL (for duplicate detection) ───────────────────
function findByUrl(url) {
  const items = load();
  return items.find(i => i.url === url && ['starting', 'downloading', 'merging'].includes(i.status));
}

// ─── Get all history items ───────────────────────────────────
function getAll() {
  return load();
}

// ─── Clear history ───────────────────────────────────────────
function clear() {
  save([]);
}

module.exports = {
  add,
  update,
  findByUrl,
  getAll,
  clear
};
