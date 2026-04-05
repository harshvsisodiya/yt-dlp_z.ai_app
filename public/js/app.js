// ═══════════════════════════════════════════════════════════════
// yt-dlp GUI — Frontend Application
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─── State ───────────────────────────────────────────────
  const state = {
    url: '',
    cookieId: null,
    formats: [],
    selectedVideo: null,
    selectedAudio: null,
    currentJobId: null,
    wsConnected: false
  };

  // ─── DOM References ──────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    urlInput: $('#urlInput'),
    fetchBtn: $('#fetchBtn'),
    cookieToggle: $('#cookieToggle'),
    cookieFile: $('#cookieFile'),
    cookieLabel: $('#cookieLabel'),
    cookieStatus: $('#cookieStatus'),
    cookieInfo: $('#cookieInfo'),
    loadingState: $('#loadingState'),
    videoInfoCard: $('#videoInfoCard'),
    videoThumb: $('#videoThumb'),
    videoTitle: $('#videoTitle'),
    videoDuration: $('#videoDuration'),
    videoUploader: $('#videoUploader'),
    formatCard: $('#formatCard'),
    formatsTableBody: $('#formatsTableBody'),
    selectionSummary: $('#selectionSummary'),
    selectionText: $('#selectionText'),
    clearSelection: $('#clearSelection'),
    downloadBtn: $('#downloadBtn'),
    progressCard: $('#progressCard'),
    progressStage: $('#progressStage'),
    progressFilename: $('#progressFilename'),
    progressBar: $('#progressBar'),
    progressPercent: $('#progressPercent'),
    progressSpeed: $('#progressSpeed'),
    progressEta: $('#progressEta'),
    progressSize: $('#progressSize'),
    errorToast: $('#errorToast'),
    errorText: $('#errorText'),
    errorDismiss: $('#errorDismiss'),
    successToast: $('#successToast'),
    successText: $('#successText'),
    successDownloadLink: $('#successDownloadLink'),
    successDismiss: $('#successDismiss'),
    historyList: $('#historyList'),
    clearHistory: $('#clearHistory'),
    serverStatus: $('#serverStatus'),
    serverStatusText: $('#serverStatusText')
  };

  // ─── WebSocket ───────────────────────────────────────────
  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      state.wsConnected = true;
      dom.serverStatus.classList.add('online');
      dom.serverStatusText.textContent = 'Connected';
    };

    ws.onclose = () => {
      state.wsConnected = false;
      dom.serverStatus.classList.remove('online');
      dom.serverStatusText.textContent = 'Disconnected';
      // Reconnect after 3 seconds
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => {
      state.wsConnected = false;
      dom.serverStatus.classList.remove('online');
      dom.serverStatusText.textContent = 'Error';
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWSMessage(data);
      } catch (e) {
        // Ignore parse errors
      }
    };
  }

  function handleWSMessage(data) {
    switch (data.type) {
      case 'download_progress':
        updateProgress(data.job);
        break;
      case 'download_complete':
        handleDownloadComplete(data.job);
        break;
      case 'download_error':
        handleDownloadError(data.job);
        break;
    }
  }

  // ─── API Calls ───────────────────────────────────────────
  async function api(url, options = {}) {
    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } catch (err) {
      if (err.message.includes('Failed to fetch')) {
        throw new Error('Cannot connect to server. Is it running?');
      }
      throw err;
    }
  }

  // ─── URL Input ───────────────────────────────────────────
  dom.urlInput.addEventListener('input', () => {
    state.url = dom.urlInput.value.trim();
    dom.fetchBtn.disabled = !state.url;
  });

  dom.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && state.url) fetchFormats();
  });

  // ─── Fetch Formats ───────────────────────────────────────
  dom.fetchBtn.addEventListener('click', fetchFormats);

  async function fetchFormats() {
    if (!state.url) return;

    // Reset state
    state.selectedVideo = null;
    state.selectedAudio = null;

    // Show loading
    dom.loadingState.classList.remove('hidden');
    dom.formatCard.classList.add('hidden');
    dom.videoInfoCard.classList.add('hidden');
    dom.progressCard.classList.add('hidden');
    dom.fetchBtn.disabled = true;

    try {
      const body = { url: state.url };
      if (state.cookieId) body.cookieId = state.cookieId;

      const result = await api('/api/fetch-formats', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      state.formats = result.formats || [];

      // Show video info
      dom.videoThumb.src = result.info.thumbnail;
      dom.videoTitle.textContent = result.info.title;
      dom.videoDuration.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${result.info.duration_string}`;
      dom.videoUploader.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${result.info.uploader || 'Unknown'}`;
      dom.videoInfoCard.classList.remove('hidden');

      renderFormats();
      dom.formatCard.classList.remove('hidden');

      if (state.formats.length === 0) {
        showError('No downloadable formats found for this URL.');
      }
    } catch (err) {
      showError(err.message);
    } finally {
      dom.loadingState.classList.add('hidden');
      dom.fetchBtn.disabled = false;
    }
  }

  // ─── Render Formats ──────────────────────────────────────
  function renderFormats() {
    dom.formatsTableBody.innerHTML = '';

    state.formats.forEach((fmt) => {
      const tr = document.createElement('tr');
      tr.className = 'format-row';

      const isSelected = 
        (fmt.type === 'combined' && state.selectedVideo === fmt.id && !state.selectedAudio) ||
        ((fmt.type === 'video' || fmt.type === 'images') && state.selectedVideo === fmt.id) ||
        (fmt.type === 'audio' && state.selectedAudio === fmt.id);

      if (isSelected) tr.classList.add('selected');

      const isDisabled = 
        (fmt.type === 'combined' && (state.selectedVideo && state.selectedVideo !== fmt.id || state.selectedAudio)) ||
        ((fmt.type === 'video' || fmt.type === 'images') && state.selectedVideo && state.selectedVideo !== fmt.id) ||
        (fmt.type === 'audio' && state.selectedAudio && state.selectedAudio !== fmt.id);

      if (isDisabled) tr.classList.add('disabled');

      // ID | EXT | RESOLUTION | FPS | FILESIZE | TBR | PROTO | VCODEC | VBR | ACODEC | MORE INFO
      tr.innerHTML = `
        <td class="col-sel">
          <div class="format-radio"></div>
        </td>
        <td class="col-id">${fmt.id}</td>
        <td>${fmt.ext}</td>
        <td>${fmt.resolution}</td>
        <td>${fmt.fps}</td>
        <td class="align-right">${fmt.filesizeHuman !== 'N/A' ? '~' + fmt.filesizeHuman : ''}</td>
        <td>${fmt.tbr}</td>
        <td>${fmt.protocol}</td>
        <td>${fmt.vcodec}</td>
        <td>${fmt.vbr}</td>
        <td>${fmt.acodec}</td>
        <td>${fmt.moreInfo}</td>
      `;

      tr.addEventListener('click', () => selectFormat(fmt));
      dom.formatsTableBody.appendChild(tr);
    });

    updateSelectionSummary();
    updateDownloadButton();
  }

  // ─── Format Selection Logic ──────────────────────────────
  function selectFormat(fmt) {
    if (fmt.type === 'combined') {
      if (state.selectedVideo === fmt.id && !state.selectedAudio) {
        state.selectedVideo = null;
      } else {
        state.selectedVideo = fmt.id;
        state.selectedAudio = null;
      }
    } else if (fmt.type === 'video' || fmt.type === 'images') {
      if (state.selectedVideo === fmt.id) {
        state.selectedVideo = null;
      } else {
        state.selectedVideo = fmt.id;
        if (state.formats.find(f => f.id === fmt.id && f.type === 'combined')) {
            state.selectedAudio = null;
        }
      }
    } else if (fmt.type === 'audio') {
      if (state.selectedAudio === fmt.id) {
        state.selectedAudio = null;
      } else {
        state.selectedAudio = fmt.id;
        const selectedVid = state.formats.find(f => f.id === state.selectedVideo);
        if (selectedVid && selectedVid.type === 'combined') {
            state.selectedVideo = null;
        }
      }
    }
    renderFormats();
  }

  function updateSelectionSummary() {
    const parts = [];

    if (state.selectedVideo) {
      const v = state.formats.find(f => f.id === state.selectedVideo);
      if (v) {
        parts.push(`Video: ${v.resolution} (${v.ext})`);
      }
    }

    if (state.selectedAudio) {
      const a = state.formats.find(f => f.id === state.selectedAudio);
      if (a) {
        parts.push(`Audio: ${a.abr || a.bitrate || 'Unknown'} (${a.ext})`);
      }
    }

    if (parts.length === 0) {
      dom.selectionSummary.classList.add('hidden');
    } else {
      dom.selectionSummary.classList.remove('hidden');
      dom.selectionText.textContent = parts.join(' + ');
      if (state.selectedVideo && state.selectedAudio) {
        dom.selectionText.textContent += ' → Will be merged';
      }
    }
  }

  function updateDownloadButton() {
    dom.downloadBtn.disabled = !state.selectedVideo && !state.selectedAudio;
  }

  dom.clearSelection.addEventListener('click', () => {
    state.selectedVideo = null;
    state.selectedAudio = null;
    renderFormats();
  });

  // ─── Format Filters ──────────────────────────────────────
  // Removed filter buttons since we use a single table now

  // ─── Download ────────────────────────────────────────────
  dom.downloadBtn.addEventListener('click', startDownload);

  async function startDownload() {
    if (!state.selectedVideo && !state.selectedAudio) return;

    dom.downloadBtn.disabled = true;

    try {
      const body = {
        url: state.url,
        videoFormatId: state.selectedVideo,
        audioFormatId: state.selectedAudio
      };

      if (state.cookieId) body.cookieId = state.cookieId;

      const result = await api('/api/download', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      state.currentJobId = result.jobId;

      // Show progress card
      dom.progressCard.classList.remove('hidden');
      dom.progressStage.textContent = 'Starting...';
      dom.progressStage.className = 'stage-badge stage-downloading';
      dom.progressBar.style.width = '0%';
      dom.progressPercent.textContent = '0%';
      dom.progressSpeed.textContent = '--';
      dom.progressEta.textContent = '--:--';
      dom.progressFilename.textContent = 'Preparing download...';

      // Scroll to progress
      dom.progressCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // Load history
      loadHistory();
    } catch (err) {
      showError(err.message);
      dom.downloadBtn.disabled = false;
    }
  }

  // ─── Progress Updates ────────────────────────────────────
  function updateProgress(job) {
    if (!state.currentJobId || job.id !== state.currentJobId) return;

    dom.progressBar.style.width = `${Math.min(job.progress, 100)}%`;
    dom.progressPercent.textContent = `${Math.round(job.progress)}%`;
    dom.progressSpeed.textContent = job.speed || '--';
    dom.progressSize.textContent = job.size || '--';
    dom.progressEta.textContent = job.etaHuman || '--:--';

    if (job.status === 'downloading') {
      dom.progressStage.textContent = 'Downloading';
      dom.progressStage.className = 'stage-badge stage-downloading';
      dom.progressFilename.textContent = `Downloading ${job.progress.toFixed(1)}%...`;
    } else if (job.status === 'merging') {
      dom.progressStage.textContent = 'Merging';
      dom.progressStage.className = 'stage-badge stage-merging';
      dom.progressFilename.textContent = 'Merging audio and video streams...';
    }
  }

  function handleDownloadComplete(job) {
    if (!state.currentJobId || job.id !== state.currentJobId) return;

    dom.progressBar.style.width = '100%';
    dom.progressPercent.textContent = '100%';
    dom.progressSpeed.textContent = 'Done';
    dom.progressSize.textContent = job.size || job.filesizeHuman || '--';
    dom.progressEta.textContent = '00:00';
    dom.progressStage.textContent = 'Completed';
    dom.progressStage.className = 'stage-badge stage-completed';
    dom.progressFilename.textContent = job.filename || 'Download complete';

    // Auto-download file
    if (job.filename) {
      const a = document.createElement('a');
      a.href = `/api/download/${encodeURIComponent(job.filename)}`;
      a.download = job.filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 1000);
    }

    loadHistory();
  }

  function handleDownloadError(job) {
    if (!state.currentJobId || job.id !== state.currentJobId) return;

    dom.progressStage.textContent = 'Error';
    dom.progressStage.className = 'stage-badge stage-error';
    dom.progressFilename.textContent = job.error || 'Download failed';

    dom.downloadBtn.disabled = false;

    showError(job.error || 'Download failed');
    loadHistory();
  }

  // ─── Cookie Upload ───────────────────────────────────────
  dom.cookieToggle.addEventListener('click', () => {
    dom.cookieFile.click();
  });

  dom.cookieFile.addEventListener('change', async () => {
    const file = dom.cookieFile.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('cookies', file);

    dom.cookieLabel.textContent = 'Uploading...';

    try {
      const res = await fetch('/api/cookies/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      state.cookieId = data.cookieId;

      dom.cookieLabel.textContent = 'Upload cookies.txt';
      dom.cookieStatus.classList.remove('hidden');
      dom.cookieStatus.textContent = `${data.cookieCount} cookies`;

      dom.cookieInfo.classList.remove('hidden');
      dom.cookieInfo.innerHTML = `
        <span>${data.message} — ${data.domains.slice(0, 3).join(', ')}${data.domains.length > 3 ? ` +${data.domains.length - 3}` : ''}</span>
        <button class="remove-cookie" id="removeCookie">Remove</button>
      `;

      $('#removeCookie').addEventListener('click', removeCookies);

    } catch (err) {
      showError(err.message);
      dom.cookieLabel.textContent = 'Upload cookies.txt';
    }

    // Reset file input
    dom.cookieFile.value = '';
  });

  async function removeCookies() {
    if (!state.cookieId) return;

    try {
      await api(`/api/cookies/${state.cookieId}`, { method: 'DELETE' });
    } catch (e) { /* ignore */ }

    state.cookieId = null;
    dom.cookieStatus.classList.add('hidden');
    dom.cookieInfo.classList.add('hidden');
    dom.cookieLabel.textContent = 'Upload cookies.txt';
  }

  // ─── Download History ────────────────────────────────────
  async function loadHistory() {
    try {
      const items = await api('/api/history');
      renderHistory(items);
    } catch (e) { /* ignore */ }
  }

  function renderHistory(items) {
    if (items.length === 0) {
      dom.historyList.innerHTML = '<p class="history-empty">No downloads yet</p>';
      return;
    }

    dom.historyList.innerHTML = items.slice(0, 15).map(item => {
      const time = timeAgo(item.startTime || item.addedAt);
      const statusClass = item.status || 'unknown';
      const title = item.filename || extractFilename(item.url);

      return `
        <div class="history-item">
          <div class="history-status ${statusClass}"></div>
          <div class="history-info">
            <div class="history-title">${escapeHtml(title)}</div>
            <div class="history-url">${escapeHtml(item.url)}</div>
          </div>
          <span class="history-time">${time}</span>
        </div>
      `;
    }).join('');
  }

  dom.clearHistory.addEventListener('click', async () => {
    try {
      await api('/api/history', { method: 'DELETE' });
      renderHistory([]);
    } catch (e) { /* ignore */ }
  });

  // ─── Error / Success Toasts ──────────────────────────────
  function showError(message) {
    dom.errorText.textContent = message;
    dom.errorToast.classList.remove('hidden');
    requestAnimationFrame(() => {
      dom.errorToast.classList.add('show');
    });

    setTimeout(() => {
      dom.errorToast.classList.remove('show');
      setTimeout(() => dom.errorToast.classList.add('hidden'), 400);
    }, 6000);
  }

  function showSuccess(filename, size) {
    dom.successText.textContent = `Downloaded: ${filename} (${size || 'unknown size'})`;
    dom.successToast.classList.remove('hidden');
    requestAnimationFrame(() => {
      dom.successToast.classList.add('show');
    });

    setTimeout(() => {
      dom.successToast.classList.remove('show');
      setTimeout(() => dom.successToast.classList.add('hidden'), 400);
    }, 15000);
  }

  dom.errorDismiss.addEventListener('click', () => {
    dom.errorToast.classList.remove('show');
    setTimeout(() => dom.errorToast.classList.add('hidden'), 400);
  });

  dom.successDismiss.addEventListener('click', () => {
    dom.successToast.classList.remove('show');
    setTimeout(() => dom.successToast.classList.add('hidden'), 400);
  });

  // ─── Helpers ─────────────────────────────────────────────
  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  function extractFilename(url) {
    try {
      const u = new URL(url);
      return u.hostname + u.pathname.substring(0, 30);
    } catch (e) {
      return url.substring(0, 40);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Server Status Check ─────────────────────────────────
  async function checkServer() {
    try {
      const data = await api('/api/status');
      dom.serverStatus.classList.add('online');
      dom.serverStatusText.textContent = `Online • yt-dlp v${data.ytDlpVersion}`;
    } catch (e) {
      dom.serverStatus.classList.remove('online');
      dom.serverStatusText.textContent = 'Offline';
    }
  }

  // ─── Initialize ──────────────────────────────────────────
  function init() {
    connectWebSocket();
    checkServer();
    loadHistory();
  }

  init();
})();
