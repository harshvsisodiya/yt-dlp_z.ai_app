# yt-dlp GUI — Universal Media Downloader

A lightweight, modern web GUI for [yt-dlp](https://github.com/yt-dlp/yt-dlp) with glassmorphism design, cookie support, and advanced media selection.

## Features

- 🌐 **1000+ Sites Supported** — YouTube, Instagram, Twitter/X, Facebook, and more
- 🎬 **Video + Audio Selection** — Pick one video and/or one audio stream, auto-merge with FFmpeg
- 🍪 **Cookie Support** — Upload `cookies.txt` for private/premium content
- 📊 **Real-time Progress** — Live download percentage, speed, ETA via WebSocket
- 🎨 **Glassmorphism UI** — Modern dark theme with emerald green palette
- 📱 **Responsive** — Works on desktop and mobile
- 📜 **Download History** — Track recent downloads with one-click re-download
- ⚡ **Fast** — Minimal dependencies, concurrent fragment downloads

## Prerequisites

| Dependency | Required | Install |
|---|---|---|
| **Node.js** ≥ 18 | ✅ | [nodejs.org](https://nodejs.org) |
| **yt-dlp** | ✅ | `curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp` |
| **FFmpeg** | ✅ (for merging) | `apt install ffmpeg` / `brew install ffmpeg` / `choco install ffmpeg` |

## Quick Start

```bash
# 1. Clone / enter project
cd yt-dlp-gui

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

Open **http://localhost:3000** in your browser.

### Development (auto-restart on file changes)

```bash
npm run dev
```

### Custom Port

```bash
PORT=8080 npm start
```

## How It Works

### 1. yt-dlp Integration

The backend spawns `yt-dlp` as a child process. Two main operations:

- **Format Fetching**: `yt-dlp --dump-json <url>` returns all metadata including available formats (codecs, resolution, bitrate, file size). The JSON is parsed and categorized into video-only and audio-only streams on the server, then sent to the frontend.

- **Downloading**: `yt-dlp -f <format_id> <url>` handles the actual download. When both video and audio are selected, the format string becomes `video_id+audio_id`, and yt-dlp automatically invokes FFmpeg to merge them into a single MP4 file.

### 2. Format Selection Logic

Formats are categorized server-side:

| Category | Contains | Selection Rule |
|---|---|---|
| **Video** | Any format with a video codec | Max **1** at a time |
| **Audio** | Any format with only audio codec | Max **1** at a time |

Valid combinations:
- ✅ One video only → downloaded as-is
- ✅ One audio only → downloaded as-is (or converted to MP3)
- ✅ One video + one audio → merged via FFmpeg into MP4

Invalid (prevented by UI):
- ❌ Two videos
- ❌ Two audios

### 3. Real-time Progress (WebSocket)

Instead of HTTP polling, the app uses a persistent WebSocket connection:

1. **Client** connects to `ws://localhost:3000` on page load
2. **Server** spawns `yt-dlp` with `--newline --progress` flags
3. **yt-dlp** outputs progress lines like: ` 45.2% of 150.50MiB at 5.23MiB/s ETA 00:15`
4. **Server** parses these lines with regex and broadcasts JSON messages to all connected WebSocket clients
5. **Client** receives `download_progress`, `download_complete`, or `download_error` messages and updates the UI accordingly

Stages: `starting` → `downloading` → `merging` (if applicable) → `completed`

### 4. Cookie Handling

- Users upload a `cookies.txt` file (Netscape format)
- Server validates the file: checks for 7 tab-separated fields per line, counts valid cookies, extracts domains
- Malformed lines are silently skipped (graceful degradation)
- Valid cookies are stored with a UUID, and the path is passed to yt-dlp via `--cookies <path>`
- Cookies can be removed at any time

## Project Structure

```
yt-dlp-gui/
├── server.js              # Entry point — Express + WebSocket server
├── package.json
├── server/
│   ├── index.js           # Express app (also used as alternative entry)
│   ├── routes/
│   │   ├── api.js         # REST API endpoints
│   │   └── download.js    # File serving for downloads
│   └── services/
│       ├── ytdlp.js       # yt-dlp integration (fetch formats, download)
│       ├── cookies.js     # Cookie upload, validation, storage
│       ├── history.js     # Download history (JSON file-based)
│       └── ws.js          # WebSocket manager
├── public/
│   ├── index.html         # Single-page application
│   ├── css/
│   │   └── style.css      # Glassmorphism theme (green palette)
│   └── js/
│       └── app.js         # Frontend application logic
├── downloads/             # Output directory for downloaded files
└── temp/                  # Temporary files (auto-cleaned)
```

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/fetch-formats` | Fetch available formats for a URL |
| POST | `/api/download` | Start a download with selected formats |
| POST | `/api/cookies/upload` | Upload a cookies.txt file |
| GET | `/api/cookies/:id` | Get cookie file info |
| DELETE | `/api/cookies/:id` | Remove a cookie file |
| GET | `/api/history` | Get download history |
| DELETE | `/api/history` | Clear download history |
| GET | `/api/status` | Server status and yt-dlp version |
| GET | `/files/:filename` | Download a completed file |
| WS | `ws://localhost:3000` | Real-time download progress |

## WebSocket Messages

### Server → Client

```json
{ "type": "download_progress", "job": { "id": "...", "progress": 45.2, "speed": "5.23MiB/s", "eta": 15, "status": "downloading" } }
{ "type": "download_complete", "job": { "id": "...", "filename": "video.mp4", "filesize": 157286400, "status": "completed" } }
{ "type": "download_error", "job": { "id": "...", "error": "Video unavailable", "status": "error" } }
```

## License

MIT
