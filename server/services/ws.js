// ─── WebSocket Manager ───────────────────────────────────────
// Manages WebSocket connections and broadcasts download events

let wssInstance = null;
const clients = new Set();

function initWebSocket(wss) {
  wssInstance = wss;

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[WS] Client connected (${clients.size} total)`);

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] Client disconnected (${clients.size} total)`);
    });

    ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
      clients.delete(ws);
    });

    // Send welcome message
    ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }));
  });
}

// ─── Broadcast to all connected clients ──────────────────────
function broadcast(data) {
  const message = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(message);
    }
  }
}

module.exports = { initWebSocket, broadcast };
