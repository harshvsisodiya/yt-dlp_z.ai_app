const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const { initWebSocket } = require('./server/services/ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ─── Middleware ───────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── WebSocket ───────────────────────────────────────────────
initWebSocket(wss);

// ─── API Routes ──────────────────────────────────────────────
app.use('/api', require('./server/routes/api'));
app.use('/api/download', require('./server/routes/download'));

// ─── Serve downloads as static files ─────────────────────────
app.use('/files', express.static(path.join(__dirname, 'downloads'), {
  maxAge: '1h',
  dotfiles: 'allow'
}));

// ─── SPA fallback ────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Error handler ───────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Express Error]', err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🟢 yt-dlp GUI running at http://localhost:${PORT}`);
  console.log(`   WebSocket server active on ws://localhost:${PORT}`);
});

module.exports = { app, server };
