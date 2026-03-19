// Escape HTML entities to prevent XSS and broken rendering
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Sanitize rendered HTML to prevent script execution from model/API output.
function sanitizeHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;

    const blockedTags = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'];
    blockedTags.forEach((tag) => {
        template.content.querySelectorAll(tag).forEach((el) => el.remove());
    });

    template.content.querySelectorAll('*').forEach((el) => {
        for (const attr of [...el.attributes]) {
            const name = attr.name.toLowerCase();
            const value = (attr.value || '').trim().toLowerCase();

            if (name.startsWith('on')) {
                el.removeAttribute(attr.name);
                continue;
            }

            if ((name === 'href' || name === 'src' || name === 'xlink:href') &&
                (value.startsWith('javascript:') || value.startsWith('data:text/html') || value.startsWith('data:image/svg'))) {
                el.removeAttribute(attr.name);
            }
        }
    });

    return template.innerHTML;
}

// ---------------------------------------------------------------------------
// Debug logging - persists to localStorage for post-mortem investigation.
// View logs by appending ?debug=1 to the page URL.
// ---------------------------------------------------------------------------
const DEBUG_LOG_KEY = 'yps_debug_log';
const DEBUG_MAX_ENTRIES = 100;

function debugLog(category, data) {
    try {
        const existing = localStorage.getItem(DEBUG_LOG_KEY);
        const logs = existing ? JSON.parse(existing) : [];
        logs.push({ ts: new Date().toISOString(), cat: category, data });
        if (logs.length > DEBUG_MAX_ENTRIES) logs.splice(0, logs.length - DEBUG_MAX_ENTRIES);
        localStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(logs));
    } catch (_) { /* ignore quota/parse errors */ }
}

function showDebugPanel() {
    const existing = document.getElementById('debugPanel');
    if (existing) { existing.remove(); return; }

    let logs = [];
    try { logs = JSON.parse(localStorage.getItem(DEBUG_LOG_KEY) || '[]'); } catch (_) { }

    const panel = document.createElement('div');
    panel.id = 'debugPanel';
    panel.style.cssText = [
        'position:fixed', 'top:10px', 'right:10px', 'width:640px', 'max-width:92vw',
        'height:80vh', 'background:#111', 'color:#e0e0e0', 'border:1px solid #555',
        'border-radius:8px', 'padding:12px', 'z-index:9999', 'display:flex',
        'flex-direction:column', 'font-family:monospace', 'font-size:11px', 'box-shadow:0 4px 24px #0008'
    ].join(';');

    const copyAll = `navigator.clipboard.writeText(localStorage.getItem('${DEBUG_LOG_KEY}')||'[]').then(()=>alert('Copied to clipboard'))`;
    const clearAll = `localStorage.removeItem('${DEBUG_LOG_KEY}');document.getElementById('debugPanel').remove()`;
    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-shrink:0">
            <strong>YPS Debug Logs &mdash; ${logs.length} entries</strong>
            <div style="display:flex;gap:6px">
                <button onclick="${copyAll}" style="padding:3px 8px;cursor:pointer;border-radius:4px">Copy all</button>
                <button onclick="${clearAll}" style="padding:3px 8px;cursor:pointer;border-radius:4px">Clear</button>
                <button onclick="document.getElementById('debugPanel').remove()" style="padding:3px 8px;cursor:pointer;border-radius:4px">&#x2715;</button>
            </div>
        </div>
        <pre id="debugLogContent" style="overflow:auto;flex:1;margin:0;white-space:pre-wrap;word-break:break-all;line-height:1.5">${
            logs.length
                ? logs.map(l => `[${l.ts}] [${l.cat}]\n${JSON.stringify(l.data, null, 2)}`).join('\n\n---\n\n')
                : 'No logs yet. Run a summarization and check back.'
        }</pre>`;

    document.body.appendChild(panel);
}

// API base path - auto-detect platform (Vercel vs Netlify)
// Netlify uses /.netlify/functions, Vercel uses /api
// Default to Vercel (/api) unless we detect Netlify hostname
const API_BASE = window.location.hostname.includes('netlify')
    ? '/.netlify/functions'
    : '/api';

// Storage keys
const STORAGE_KEYS = {
    playlistId: 'yps_playlist_id',
    hoursBack: 'yps_hours_back',
    youtubeKey: 'yps_youtube_key',
    openaiKey: 'yps_openai_key',
    openaiBaseUrl: 'yps_openai_base_url',
    openaiModel: 'yps_openai_model',
    transcriptKey: 'yps_transcript_key',
    theme: 'yps_theme'
};

// Current playlist title for HTML export
let currentPlaylistTitle = 'Summaries';

// DOM Elements
const elements = {
    settingsBtn: document.getElementById('settingsBtn'),
    themeToggle: document.getElementById('themeToggle'),
    exportConfigBtn: document.getElementById('exportConfigBtn'),
    importConfigBtn: document.getElementById('importConfigBtn'),
    modalOverlay: document.getElementById('modalOverlay'),
    modalClose: document.getElementById('modalClose'),
    cancelBtn: document.getElementById('cancelBtn'),
    saveBtn: document.getElementById('saveBtn'),
    summarizeBtn: document.getElementById('summarizeBtn'),
    playlistBadge: document.getElementById('playlistBadge'),
    playlistStatus: document.getElementById('playlistStatus'),
    progressSection: document.getElementById('progressSection'),
    progressText: document.getElementById('progressText'),
    progressDetail: document.getElementById('progressDetail'),
    heroSection: document.getElementById('heroSection'),
    resultsHeader: document.getElementById('resultsHeader'),
    resultsTitle: document.getElementById('resultsTitle'),
    resultsMeta: document.getElementById('resultsMeta'),
    resultsGrid: document.getElementById('resultsGrid'),
    downloadHtmlBtn: document.getElementById('downloadHtmlBtn'),
    toastContainer: document.getElementById('toastContainer'),
    // Inputs
    playlistIdInput: document.getElementById('playlistIdInput'),
    hoursBackInput: document.getElementById('hoursBackInput'),
    youtubeKeyInput: document.getElementById('youtubeKeyInput'),
    openaiKeyInput: document.getElementById('openaiKeyInput'),
    openaiBaseUrlInput: document.getElementById('openaiBaseUrlInput'),
    openaiModelInput: document.getElementById('openaiModelInput'),
    transcriptKeyInput: document.getElementById('transcriptKeyInput')
};

// Load settings from localStorage
function loadSettings() {
    const settings = {
        playlistId: localStorage.getItem(STORAGE_KEYS.playlistId) || '',
        hoursBack: localStorage.getItem(STORAGE_KEYS.hoursBack) || '168',
        youtubeKey: localStorage.getItem(STORAGE_KEYS.youtubeKey) || '',
        openaiKey: localStorage.getItem(STORAGE_KEYS.openaiKey) || '',
        openaiBaseUrl: localStorage.getItem(STORAGE_KEYS.openaiBaseUrl) || '',
        openaiModel: localStorage.getItem(STORAGE_KEYS.openaiModel) || '',
        transcriptKey: localStorage.getItem(STORAGE_KEYS.transcriptKey) || ''
    };

    elements.playlistIdInput.value = settings.playlistId;
    elements.hoursBackInput.value = settings.hoursBack;
    elements.youtubeKeyInput.value = settings.youtubeKey;
    elements.openaiKeyInput.value = settings.openaiKey;
    elements.openaiBaseUrlInput.value = settings.openaiBaseUrl;
    elements.openaiModelInput.value = settings.openaiModel;
    elements.transcriptKeyInput.value = settings.transcriptKey;

    updatePlaylistBadge(settings.playlistId);
    return settings;
}

// Save settings to localStorage
function saveSettings() {
    const playlistId = elements.playlistIdInput.value.trim();
    const hoursBack = elements.hoursBackInput.value || '168';
    const youtubeKey = elements.youtubeKeyInput.value.trim();
    const openaiKey = elements.openaiKeyInput.value.trim();
    const openaiBaseUrl = elements.openaiBaseUrlInput.value.trim();
    const openaiModel = elements.openaiModelInput.value.trim();
    const transcriptKey = elements.transcriptKeyInput.value.trim();

    if (!playlistId || !youtubeKey || !openaiKey || !transcriptKey) {
        showToast('Please fill in all required fields', 'error');
        return false;
    }

    localStorage.setItem(STORAGE_KEYS.playlistId, playlistId);
    localStorage.setItem(STORAGE_KEYS.hoursBack, hoursBack);
    localStorage.setItem(STORAGE_KEYS.youtubeKey, youtubeKey);
    localStorage.setItem(STORAGE_KEYS.openaiKey, openaiKey);
    localStorage.setItem(STORAGE_KEYS.openaiBaseUrl, openaiBaseUrl);
    localStorage.setItem(STORAGE_KEYS.openaiModel, openaiModel);
    localStorage.setItem(STORAGE_KEYS.transcriptKey, transcriptKey);

    updatePlaylistBadge(playlistId);
    showToast('Settings saved successfully', 'success');
    return true;
}

// Update playlist badge
function updatePlaylistBadge(playlistId) {
    if (playlistId) {
        elements.playlistBadge.classList.add('configured');
        const label = playlistId.length > 20 ? `${playlistId.substring(0, 20)}...` : playlistId;
        elements.playlistStatus.textContent = `Playlist: ${label}`;
    } else {
        elements.playlistBadge.classList.remove('configured');
        elements.playlistStatus.textContent = 'No playlist configured';
    }
}

// Theme toggle
function initTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.theme) || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem(STORAGE_KEYS.theme, newTheme);
}

// Export config to JSON
function exportConfig() {
    const config = {
        playlistId: localStorage.getItem(STORAGE_KEYS.playlistId) || '',
        hoursBack: localStorage.getItem(STORAGE_KEYS.hoursBack) || '168',
        youtubeKey: localStorage.getItem(STORAGE_KEYS.youtubeKey) || '',
        openaiKey: localStorage.getItem(STORAGE_KEYS.openaiKey) || '',
        openaiBaseUrl: localStorage.getItem(STORAGE_KEYS.openaiBaseUrl) || '',
        openaiModel: localStorage.getItem(STORAGE_KEYS.openaiModel) || '',
        transcriptKey: localStorage.getItem(STORAGE_KEYS.transcriptKey) || ''
    };

    const jsonString = JSON.stringify(config, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'playlist-summarizer-config.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Config exported successfully', 'success');
}

// Import config from clipboard
async function importConfig() {
    try {
        const text = await navigator.clipboard.readText();
        let config;

        try {
            config = JSON.parse(text);
        } catch (e) {
            showToast('Invalid JSON format in clipboard', 'error');
            return;
        }

        // Validate config structure
        const validKeys = ['playlistId', 'hoursBack', 'youtubeKey', 'openaiKey', 'openaiBaseUrl', 'openaiModel', 'transcriptKey'];
        const hasValidKey = validKeys.some(key => key in config);

        if (!hasValidKey) {
            showToast('Invalid config format: no recognized fields', 'error');
            return;
        }

        // Import valid fields
        if (config.playlistId !== undefined) {
            localStorage.setItem(STORAGE_KEYS.playlistId, config.playlistId);
        }
        if (config.hoursBack !== undefined) {
            localStorage.setItem(STORAGE_KEYS.hoursBack, String(config.hoursBack));
        }
        if (config.youtubeKey !== undefined) {
            localStorage.setItem(STORAGE_KEYS.youtubeKey, config.youtubeKey);
        }
        if (config.openaiKey !== undefined) {
            localStorage.setItem(STORAGE_KEYS.openaiKey, config.openaiKey);
        }
        if (config.openaiBaseUrl !== undefined) {
            localStorage.setItem(STORAGE_KEYS.openaiBaseUrl, config.openaiBaseUrl);
        }
        if (config.openaiModel !== undefined) {
            localStorage.setItem(STORAGE_KEYS.openaiModel, config.openaiModel);
        }
        if (config.transcriptKey !== undefined) {
            localStorage.setItem(STORAGE_KEYS.transcriptKey, config.transcriptKey);
        }

        // Reload settings in the form
        loadSettings();
        showToast('Config imported successfully', 'success');

    } catch (e) {
        if (e.name === 'NotAllowedError') {
            showToast('Clipboard access denied. Please allow clipboard permissions.', 'error');
        } else {
            showToast('Failed to read clipboard', 'error');
        }
    }
}

// Show toast notification
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('width', '18');
    icon.setAttribute('height', '18');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#icon-${type === 'error' ? 'error' : 'success'}`);
    icon.appendChild(use);
    toast.appendChild(icon);
    toast.appendChild(document.createTextNode(String(message)));
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Open/close modal
function openModal() {
    loadSettings();
    elements.modalOverlay.classList.add('active');
}

function closeModal() {
    elements.modalOverlay.classList.remove('active');
}

// Create video card HTML
function createVideoCard(video) {
    const publishedDate = new Date(video.publishedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });

    // Escape HTML in title and channel to prevent broken rendering
    const safeTitle = escapeHtml(video.title) || 'Untitled Video';
    const safeChannel = escapeHtml(video.channel) || 'Unknown Channel';

    // Handle summary - escape error messages to prevent HTML injection
    let summaryText = video.summary || 'No summary available';
    if (summaryText.startsWith('Error:')) {
        // Error messages may contain raw HTML from failed API responses - escape it
        summaryText = escapeHtml(summaryText);
    }

    // Convert LaTeX to Unicode before markdown parsing
    const summaryWithUnicode = latexAllToUnicode(summaryText);
    let summaryHtml;
    try {
        if (typeof marked === 'undefined' || typeof marked.parse !== 'function') {
            throw new Error(`marked not available (typeof marked="${typeof marked}")`);
        }
        const parsed = marked.parse(summaryWithUnicode);
        debugLog('render_ok', {
            videoId: video.videoId,
            inputLen: summaryWithUnicode.length,
            outputLen: parsed ? parsed.length : 0,
            inputPreview: summaryWithUnicode.substring(0, 200)
        });
        summaryHtml = sanitizeHtml(parsed);
    } catch (renderErr) {
        debugLog('render_error', {
            videoId: video.videoId,
            error: renderErr.message,
            markedType: typeof marked,
            markedParseFn: typeof marked !== 'undefined' ? typeof marked.parse : 'n/a',
            inputLen: summaryWithUnicode.length,
            inputPreview: summaryWithUnicode.substring(0, 200)
        });
        // Fallback: display raw text in a preformatted block so content is still readable
        summaryHtml = `<pre style="white-space:pre-wrap;word-break:break-word">${escapeHtml(summaryWithUnicode)}</pre>`;
    }
    const thumbnailUrl = `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`;
    const isRtl = video.language === 'ar';

    return `
        <article class="video-card" data-video-id="${video.videoId}">
            <div class="video-header">
                <a href="https://www.youtube.com/watch?v=${video.videoId}" target="_blank" class="video-thumbnail">
                    <img src="${thumbnailUrl}" alt="${safeTitle}" loading="lazy">
                    <div class="play-icon">
                        <svg><use href="#icon-play"/></svg>
                    </div>
                </a>
                <div class="video-info">
                    <h3 class="video-title">
                        <a href="https://www.youtube.com/watch?v=${video.videoId}" target="_blank">
                            ${safeTitle}
                        </a>
                    </h3>
                    <div class="video-meta">
                        <span>
                            <svg><use href="#icon-user"/></svg>
                            ${safeChannel}
                        </span>
                        <span>
                            <svg><use href="#icon-calendar"/></svg>
                            ${publishedDate}
                        </span>
                        <span class="video-status ${video.status}">${video.status}</span>
                    </div>
                </div>
            </div>
            <div class="video-summary">
                <h4>Summary</h4>
                <div class="summary-content${isRtl ? ' rtl' : ''}">${summaryHtml}</div>
                <button class="delete-btn" title="Remove from list">
                    <svg><use href="#icon-trash"/></svg>
                    Delete Summary
                </button>
            </div>
        </article>
    `;
}

// Update progress
function updateProgress(text, detail = '') {
    elements.progressText.textContent = text;
    elements.progressDetail.textContent = detail;
}

// Summarize playlist
async function summarizePlaylist() {
    const settings = {
        playlistId: localStorage.getItem(STORAGE_KEYS.playlistId),
        hoursBack: parseInt(localStorage.getItem(STORAGE_KEYS.hoursBack)) || 168,
        youtubeApiKey: localStorage.getItem(STORAGE_KEYS.youtubeKey),
        openaiApiKey: localStorage.getItem(STORAGE_KEYS.openaiKey),
        openaiBaseUrl: localStorage.getItem(STORAGE_KEYS.openaiBaseUrl) || '',
        openaiModel: localStorage.getItem(STORAGE_KEYS.openaiModel) || '',
        transcriptApiKey: localStorage.getItem(STORAGE_KEYS.transcriptKey)
    };

    if (!settings.playlistId || !settings.youtubeApiKey || !settings.openaiApiKey || !settings.transcriptApiKey) {
        showToast('Please configure your settings first', 'error');
        openModal();
        return;
    }

    // Show progress
    elements.summarizeBtn.disabled = true;
    elements.progressSection.classList.add('active');
    elements.resultsHeader.classList.remove('active');
    elements.resultsGrid.innerHTML = '';

    try {
        // Step 1: Get video list
        updateProgress('Fetching playlist videos...');

        const listResponse = await fetch(`${API_BASE}/summarize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'list',
                playlistId: settings.playlistId,
                hoursBack: settings.hoursBack,
                youtubeApiKey: settings.youtubeApiKey
            })
        });

        if (!listResponse.ok) {
            const ct = listResponse.headers.get('content-type') || '';
            if (!ct.includes('application/json')) {
                throw new Error(`Failed to fetch playlist (HTTP ${listResponse.status})`);
            }
            const error = await listResponse.json();
            throw new Error(error.error || 'Failed to fetch playlist');
        }

        const listData = await listResponse.json();
        const { playlistTitle, videos } = listData;

        if (videos.length === 0) {
            elements.progressSection.classList.remove('active');
            showToast('No recent videos found in playlist', 'error');
            elements.summarizeBtn.disabled = false;
            return;
        }

        // Show results header
        elements.resultsHeader.classList.add('active');
        currentPlaylistTitle = playlistTitle || 'Summaries';
        elements.resultsTitle.textContent = currentPlaylistTitle;
        elements.resultsMeta.textContent = `0 of ${videos.length} videos summarized`;

        // Step 2: Process each video one by one
        const results = [];
        for (let i = 0; i < videos.length; i++) {
            const video = videos[i];
            updateProgress(`Processing video ${i + 1} of ${videos.length}...`, video.title);

            try {
                const processResponse = await fetch(`${API_BASE}/summarize`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'process',
                        video,
                        openaiApiKey: settings.openaiApiKey,
                        openaiBaseUrl: settings.openaiBaseUrl,
                        openaiModel: settings.openaiModel,
                        transcriptApiKey: settings.transcriptApiKey
                    })
                });

                const contentType = processResponse.headers.get('content-type') || '';
                if (!contentType.includes('application/json')) {
                    throw new Error(`Server returned ${processResponse.status} (non-JSON response)`);
                }

                const result = await processResponse.json();
                debugLog('api_process', {
                    videoId: video.videoId,
                    httpStatus: processResponse.status,
                    resultStatus: result.status,
                    summaryLen: result.summary ? result.summary.length : 0,
                    summaryPreview: result.summary ? result.summary.substring(0, 200) : null
                });
                results.push(result);

                // Update UI immediately with this result without re-rendering existing cards
                // This prevents deleted cards from reappearing
                elements.resultsGrid.insertAdjacentHTML('beforeend', createVideoCard(result));
                const successCount = results.filter(v => v.status === 'success').length;
                elements.resultsMeta.textContent = `${successCount} of ${videos.length} videos summarized`;

            } catch (err) {
                console.error(`Error processing ${video.title}:`, err);
                const errorResult = {
                    ...video,
                    summary: `Error: ${err.message}`,
                    status: 'failed'
                };
                results.push(errorResult);
                elements.resultsGrid.insertAdjacentHTML('beforeend', createVideoCard(errorResult));
            }
        }

        // Done
        elements.progressSection.classList.remove('active');
        const successCount = results.filter(v => v.status === 'success').length;
        showToast(`Processed ${results.length} videos (${successCount} successful)`, 'success');

    } catch (error) {
        console.error('Error:', error);
        showToast(error.message, 'error');
        elements.progressSection.classList.remove('active');
    } finally {
        elements.summarizeBtn.disabled = false;
    }
}

// Event listeners
elements.settingsBtn.addEventListener('click', openModal);
elements.themeToggle.addEventListener('click', toggleTheme);
elements.exportConfigBtn.addEventListener('click', exportConfig);
elements.importConfigBtn.addEventListener('click', importConfig);
elements.modalClose.addEventListener('click', closeModal);
elements.cancelBtn.addEventListener('click', closeModal);
elements.modalOverlay.addEventListener('click', (e) => {
    if (e.target === elements.modalOverlay) closeModal();
});
elements.saveBtn.addEventListener('click', () => {
    if (saveSettings()) closeModal();
});
elements.summarizeBtn.addEventListener('click', summarizePlaylist);

// Delete video card handler (event delegation)
elements.resultsGrid.addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) {
        const videoCard = deleteBtn.closest('.video-card');
        if (videoCard && !deleteBtn.disabled) {
            const videoId = videoCard.dataset.videoId;
            const playlistId = localStorage.getItem(STORAGE_KEYS.playlistId);

            // Disable button and show loading state
            deleteBtn.disabled = true;
            deleteBtn.style.opacity = '0.5';

            try {
                const response = await fetch(`${API_BASE}/delete-video`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ videoId, playlistId })
                });

                const result = await response.json();

                if (response.ok) {
                    showToast('Video removed from playlist', 'success');

                    // Find the next or previous card before removal
                    const nextCard = videoCard.nextElementSibling;
                    const prevCard = videoCard.previousElementSibling;

                    videoCard.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                    videoCard.style.opacity = '0';
                    videoCard.style.transform = 'scale(0.95)';
                    setTimeout(() => {
                        videoCard.remove();

                        // Scroll to next card (start) or previous card (end)
                        const targetCard = nextCard || prevCard;
                        if (targetCard) {
                            targetCard.scrollIntoView({
                                behavior: 'smooth',
                                block: nextCard ? 'start' : 'end'
                            });
                        }
                    }, 300);
                } else {
                    showToast(result.error || 'Failed to delete video', 'error');
                    deleteBtn.disabled = false;
                    deleteBtn.style.opacity = '';
                }
            } catch (error) {
                showToast('Network error: ' + error.message, 'error');
                deleteBtn.disabled = false;
                deleteBtn.style.opacity = '';
            }
        }
    }
});

// Download HTML handler
elements.downloadHtmlBtn.addEventListener('click', async () => {
    const btn = elements.downloadHtmlBtn;
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Generating...';

    try {
        // Fetch shared CSS
        const cssResponse = await fetch('assets/shared.css');
        const sharedCss = await cssResponse.text();

        // Get the current theme
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const safePlaylistTitle = escapeHtml(currentPlaylistTitle);

        // Get results grid without delete buttons
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = elements.resultsGrid.innerHTML;
        tempDiv.querySelectorAll('.delete-btn').forEach(btn => btn.remove());
        const cleanedResultsHtml = tempDiv.innerHTML;

        // Create HTML content with inlined shared CSS
        const htmlContent = `<!DOCTYPE html>
<html lang="en" data-theme="${currentTheme}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safePlaylistTitle}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&display=swap" rel="stylesheet">
    <style>
${sharedCss}
    </style>
</head>
<body>
    <div class="ambient-bg"></div>
    <div class="container">
        <header>
            <div class="logo">
                <h1>${safePlaylistTitle}</h1>
                <span class="logo-subtitle">Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
        </header>

        <div class="results-header">
            <h2 class="results-title">Summaries</h2>
            <span class="results-meta">${elements.resultsMeta.textContent}</span>
        </div>

        <div class="results-grid">
            ${cleanedResultsHtml}
        </div>
    </div>
</body>
</html>`;

        // Generate filename
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const timeStr = now.toTimeString().slice(0, 5).replace(':', '-');
        const safeTitle = currentPlaylistTitle.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
        const filename = `${safeTitle}_${dateStr}_${timeStr}.html`;

        // Create and download file
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast('HTML exported successfully', 'success');
    } catch (error) {
        console.error('HTML export error:', error);
        showToast('Failed to export HTML', 'error');
    } finally {
        btn.disabled = false;
        btn.querySelector('span').textContent = 'HTML';
    }
});

// Load external SVG sprite
async function loadIconSprite() {
    try {
        const response = await fetch('assets/icons.svg');
        const svg = await response.text();
        document.getElementById('iconSprite').innerHTML = svg;
    } catch (error) {
        console.error('Failed to load icon sprite:', error);
    }
}

// Initialize
loadIconSprite();
initTheme(); // Apply theme immediately to prevent flash

document.addEventListener('DOMContentLoaded', () => {
    const settings = loadSettings();
    // Open settings modal if not configured
    if (!settings.playlistId || !settings.youtubeKey || !settings.openaiKey || !settings.transcriptKey) {
        setTimeout(openModal, 500);
    }

    // Log startup diagnostics for post-mortem debugging
    debugLog('startup', {
        markedDefined: typeof marked !== 'undefined',
        markedParseFn: typeof marked !== 'undefined' ? typeof marked.parse : 'n/a',
        markedVersion: (typeof marked !== 'undefined' && marked.defaults && marked.defaults.version) || 'unknown',
        userAgent: navigator.userAgent,
        apiBase: API_BASE,
        url: window.location.pathname
    });

    // Show debug panel if ?debug=1 is present in the URL
    if (new URLSearchParams(window.location.search).get('debug') === '1') {
        setTimeout(showDebugPanel, 300);
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elements.modalOverlay.classList.contains('active')) {
        closeModal();
    }
});
