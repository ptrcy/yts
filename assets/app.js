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

// Sanitize rendered HTML using DOMPurify
function sanitizeHtml(html) {
    if (typeof DOMPurify !== 'undefined') {
        return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    }
    console.warn('DOMPurify not loaded, falling back to escaping');
    return `<pre style="white-space:pre-wrap">${escapeHtml(html)}</pre>`;
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
        try {
            localStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(logs));
        } catch (e) {
            if (logs.length > 20) {
                logs.splice(0, logs.length - 20);
                try { localStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(logs)); } catch (_) {}
            }
        }
    } catch (_) { /* ignore format errors */ }
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

// API base path - Vercel endpoints
const API_BASE = '/api';

// Storage keys
const STORAGE_KEYS = {
    playlistId: 'yps_playlist_id',
    hoursBack: 'yps_hours_back',
    youtubeKey: 'yps_youtube_key',
    openaiKey: 'yps_openai_key',
    openaiBaseUrl: 'yps_openai_base_url',
    openaiModel: 'yps_openai_model',
    transcriptKey: 'yps_transcript_key',
    theme: 'yps_theme',
    cloudName: 'yps_cloud_name',
    cloudPassword: 'yps_cloud_password',
    activeMode: 'yps_active_mode',
    savedLinks: 'yps_saved_links'
};

// Current title for HTML export
let currentPlaylistTitle = 'Summaries';

// DOM Elements
const elements = {
    settingsBtn: document.getElementById('settingsBtn'),
    themeToggle: document.getElementById('themeToggle'),
    modalOverlay: document.getElementById('modalOverlay'),
    modalClose: document.getElementById('modalClose'),
    cancelBtn: document.getElementById('cancelBtn'),
    saveBtn: document.getElementById('saveBtn'),
    // Mode tabs & views
    tabLinks: document.getElementById('tabLinks'),
    tabPlaylist: document.getElementById('tabPlaylist'),
    viewLinks: document.getElementById('viewLinks'),
    viewPlaylist: document.getElementById('viewPlaylist'),
    // Link List controls
    linksInput: document.getElementById('linksInput'),
    linksCounter: document.getElementById('linksCounter'),
    pasteLinksBtn: document.getElementById('pasteLinksBtn'),
    clearLinksBtn: document.getElementById('clearLinksBtn'),
    summarizeLinksBtn: document.getElementById('summarizeLinksBtn'),
    // Playlist controls
    playlistBadge: document.getElementById('playlistBadge'),
    playlistStatus: document.getElementById('playlistStatus'),
    summarizePlaylistBtn: document.getElementById('summarizePlaylistBtn'),
    // Progress & Results
    progressSection: document.getElementById('progressSection'),
    progressText: document.getElementById('progressText'),
    progressDetail: document.getElementById('progressDetail'),
    resultsHeader: document.getElementById('resultsHeader'),
    resultsTitle: document.getElementById('resultsTitle'),
    resultsMeta: document.getElementById('resultsMeta'),
    resultsGrid: document.getElementById('resultsGrid'),
    downloadHtmlBtn: document.getElementById('downloadHtmlBtn'),
    toastContainer: document.getElementById('toastContainer'),
    // Settings inputs
    playlistIdInput: document.getElementById('playlistIdInput'),
    hoursBackInput: document.getElementById('hoursBackInput'),
    youtubeKeyInput: document.getElementById('youtubeKeyInput'),
    openaiKeyInput: document.getElementById('openaiKeyInput'),
    openaiBaseUrlInput: document.getElementById('openaiBaseUrlInput'),
    openaiModelInput: document.getElementById('openaiModelInput'),
    transcriptKeyInput: document.getElementById('transcriptKeyInput'),
    // Cloud sync
    cloudNameInput: document.getElementById('cloudNameInput'),
    cloudPasswordInput: document.getElementById('cloudPasswordInput'),
    saveToServerBtn: document.getElementById('saveToServerBtn'),
    loadFromServerBtn: document.getElementById('loadFromServerBtn')
};

// Extract URLs from multiline string
function extractUrls(text) {
    if (!text) return [];
    const lines = text.split(/[\r\n]+/);
    const urls = [];
    const seen = new Set();

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        const match = line.match(/https?:\/\/[^\s]+/i);
        const urlCandidate = match ? match[0] : (line.startsWith('http') ? line : `https://${line}`);

        try {
            const parsed = new URL(urlCandidate);
            const cleanUrl = parsed.href;
            if (!seen.has(cleanUrl)) {
                seen.add(cleanUrl);
                urls.push(cleanUrl);
            }
        } catch (_) {
            // Skip invalid URL strings
        }
    }
    return urls;
}

// Update the link counter and button state
function updateLinksCounter() {
    const text = elements.linksInput.value;
    const urls = extractUrls(text);
    const count = urls.length;

    if (count === 0) {
        elements.linksCounter.textContent = '0 links detected';
        elements.linksCounter.classList.remove('has-links');
        elements.summarizeLinksBtn.querySelector('span').textContent = 'Summarize Video Links';
    } else if (count === 1) {
        elements.linksCounter.textContent = '1 link detected';
        elements.linksCounter.classList.add('has-links');
        elements.summarizeLinksBtn.querySelector('span').textContent = 'Summarize 1 Video Link';
    } else {
        elements.linksCounter.textContent = `${count} links detected`;
        elements.linksCounter.classList.add('has-links');
        elements.summarizeLinksBtn.querySelector('span').textContent = `Summarize ${count} Video Links`;
    }

    // Persist textarea contents for convenience
    try {
        localStorage.setItem(STORAGE_KEYS.savedLinks, text);
    } catch (_) {}
}

// Mode tab switching
function setMode(mode) {
    const isLinks = mode === 'links';
    elements.tabLinks.classList.toggle('active', isLinks);
    elements.tabLinks.setAttribute('aria-selected', isLinks ? 'true' : 'false');
    elements.tabPlaylist.classList.toggle('active', !isLinks);
    elements.tabPlaylist.setAttribute('aria-selected', !isLinks ? 'true' : 'false');

    elements.viewLinks.classList.toggle('active', isLinks);
    elements.viewPlaylist.classList.toggle('active', !isLinks);

    try {
        localStorage.setItem(STORAGE_KEYS.activeMode, mode);
    } catch (_) {}
}

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
    elements.cloudNameInput.value = localStorage.getItem(STORAGE_KEYS.cloudName) || '';
    elements.cloudPasswordInput.value = localStorage.getItem(STORAGE_KEYS.cloudPassword) || '';

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

    if (!openaiKey || !transcriptKey) {
        showToast('Please enter both OpenAI API Key and Supadata API Key', 'error');
        return false;
    }

    try {
        localStorage.setItem(STORAGE_KEYS.playlistId, playlistId);
        localStorage.setItem(STORAGE_KEYS.hoursBack, hoursBack);
        localStorage.setItem(STORAGE_KEYS.youtubeKey, youtubeKey);
        localStorage.setItem(STORAGE_KEYS.openaiKey, openaiKey);
        localStorage.setItem(STORAGE_KEYS.openaiBaseUrl, openaiBaseUrl);
        localStorage.setItem(STORAGE_KEYS.openaiModel, openaiModel);
        localStorage.setItem(STORAGE_KEYS.transcriptKey, transcriptKey);
    } catch (e) {
        showToast('Storage quota exceeded. Please clear some browser data.', 'error');
        return false;
    }

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

// Platform helpers
function getPlatformInfo(platform, url = '') {
    const p = String(platform || '').toLowerCase();
    if (p === 'youtube' || url.includes('youtube.com') || url.includes('youtu.be')) {
        return { name: 'YouTube', icon: 'youtube', cls: 'youtube' };
    }
    if (p === 'instagram' || url.includes('instagram.com') || url.includes('instagr.am')) {
        return { name: 'Instagram', icon: 'instagram', cls: 'instagram' };
    }
    if (p === 'tiktok' || url.includes('tiktok.com')) {
        return { name: 'TikTok', icon: 'tiktok', cls: 'tiktok' };
    }
    if (p === 'facebook' || url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com')) {
        return { name: 'Facebook', icon: 'facebook', cls: 'facebook' };
    }
    return { name: 'Video', icon: 'video', cls: 'video' };
}

// Create video card HTML
function createVideoCard(video) {
    const publishedDate = video.publishedAt
        ? new Date(video.publishedAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
          })
        : 'Recent';

    const safeTitle = escapeHtml(video.title) || 'Untitled Video';
    const safeChannel = escapeHtml(video.channel) || 'Creator';
    const targetUrl = video.url || (video.videoId ? `https://www.youtube.com/watch?v=${video.videoId}` : '#');
    const platInfo = getPlatformInfo(video.platform, targetUrl);

    // Handle summary - escape error messages to prevent HTML injection
    let summaryText = video.summary || 'No summary available';
    if (summaryText.startsWith('Error:')) {
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
        summaryHtml = sanitizeHtml(parsed);
    } catch (renderErr) {
        debugLog('render_error', {
            videoId: video.videoId || video.url,
            error: renderErr.message,
            summaryPreview: summaryWithUnicode.substring(0, 200)
        });
        summaryHtml = `<pre style="white-space:pre-wrap;word-break:break-word">${escapeHtml(summaryWithUnicode)}</pre>`;
    }

    const isRtl = video.language === 'ar';
    const hasThumbnail = Boolean(video.thumbnail);

    const thumbnailHtml = hasThumbnail
        ? `<img src="${escapeHtml(video.thumbnail)}" alt="${safeTitle}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
           <div class="platform-fallback-thumb ${platInfo.cls}" style="display:none">
               <svg><use href="#icon-${platInfo.icon}"/></svg>
               <span>${platInfo.name}</span>
           </div>`
        : `<div class="platform-fallback-thumb ${platInfo.cls}">
               <svg><use href="#icon-${platInfo.icon}"/></svg>
               <span>${platInfo.name}</span>
           </div>`;

    return `
        <article class="video-card" data-video-id="${escapeHtml(video.videoId || '')}" data-video-url="${escapeHtml(video.url || '')}">
            <div class="video-header">
                <a href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener noreferrer" class="video-thumbnail">
                    ${thumbnailHtml}
                    <div class="play-icon">
                        <svg><use href="#icon-play"/></svg>
                    </div>
                </a>
                <div class="video-info">
                    <h3 class="video-title">
                        <a href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener noreferrer">
                            ${safeTitle}
                        </a>
                    </h3>
                    <div class="video-meta">
                        <span class="platform-badge ${platInfo.cls}">
                            <svg width="12" height="12"><use href="#icon-${platInfo.icon}"/></svg>
                            ${platInfo.name}
                        </span>
                        <span>
                            <svg><use href="#icon-user"/></svg>
                            ${safeChannel}
                        </span>
                        <span>
                            <svg><use href="#icon-calendar"/></svg>
                            ${publishedDate}
                        </span>
                        <span class="video-status ${video.status || 'success'}">${video.status || 'success'}</span>
                        ${video.transcriptSource ? `<span class="transcript-source">${escapeHtml(video.transcriptSource)}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="video-summary">
                <h4>Summary</h4>
                <div class="summary-content${isRtl ? ' rtl' : ''}">${summaryHtml}</div>
                <button class="delete-btn" title="Remove video card">
                    <svg><use href="#icon-trash"/></svg>
                    Remove
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

// Summarize a list of URLs from the textarea
async function summarizeLinks() {
    const settings = {
        openaiApiKey: localStorage.getItem(STORAGE_KEYS.openaiKey),
        openaiBaseUrl: localStorage.getItem(STORAGE_KEYS.openaiBaseUrl) || '',
        openaiModel: localStorage.getItem(STORAGE_KEYS.openaiModel) || '',
        transcriptApiKey: localStorage.getItem(STORAGE_KEYS.transcriptKey)
    };

    if (!settings.openaiApiKey || !settings.transcriptApiKey) {
        showToast('Please configure your OpenAI and Supadata API keys first', 'error');
        openModal();
        return;
    }

    const rawText = elements.linksInput.value.trim();
    const urls = extractUrls(rawText);

    if (urls.length === 0) {
        showToast('Please enter at least one valid video link in the textarea', 'error');
        elements.linksInput.focus();
        return;
    }

    // Show progress
    elements.summarizeLinksBtn.disabled = true;
    elements.progressSection.classList.add('active');
    elements.resultsHeader.classList.remove('active');
    elements.resultsGrid.innerHTML = '';

    try {
        updateProgress('Parsing video links...');

        const parseResponse = await fetch(`${API_BASE}/summarize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'parse-links',
                links: urls
            })
        });

        const parseData = await parseResponse.json();
        if (!parseResponse.ok) {
            throw new Error(parseData.error || 'Failed to parse video links');
        }

        const videos = parseData.videos || [];
        if (videos.length === 0) {
            elements.progressSection.classList.remove('active');
            showToast('No valid video links found', 'error');
            elements.summarizeLinksBtn.disabled = false;
            return;
        }

        // Show results header
        elements.resultsHeader.classList.add('active');
        currentPlaylistTitle = 'Video Summaries';
        elements.resultsTitle.textContent = 'Video Summaries';
        elements.resultsMeta.textContent = `0 of ${videos.length} videos summarized`;

        // Process each video one by one
        const results = [];
        for (let i = 0; i < videos.length; i++) {
            const video = videos[i];
            const displayLabel = video.title || video.url;
            updateProgress(`Processing video ${i + 1} of ${videos.length}...`, displayLabel);

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

                let result;
                try {
                    result = await processResponse.json();
                } catch (e) {
                    throw new Error(`Server returned ${processResponse.status} (invalid JSON)`);
                }

                if (!processResponse.ok) {
                    throw new Error(result.error || `Server returned ${processResponse.status}`);
                }

                debugLog('link_process', {
                    url: video.url,
                    platform: result.platform,
                    status: result.status,
                    summaryLen: result.summary ? result.summary.length : 0
                });

                results.push(result);
                elements.resultsGrid.insertAdjacentHTML('beforeend', createVideoCard(result));
                const successCount = results.filter(v => v.status === 'success').length;
                elements.resultsMeta.textContent = `${successCount} of ${videos.length} videos summarized`;

            } catch (err) {
                console.error(`Error processing ${video.url}:`, err);
                const errorResult = {
                    ...video,
                    summary: `Error: ${err.message}`,
                    status: 'failed'
                };
                results.push(errorResult);
                elements.resultsGrid.insertAdjacentHTML('beforeend', createVideoCard(errorResult));
            }
        }

        // Complete
        elements.progressSection.classList.remove('active');
        const successCount = results.filter(v => v.status === 'success').length;
        showToast(`Processed ${results.length} links (${successCount} successful)`, 'success');

    } catch (error) {
        console.error('Error:', error);
        showToast(error.message, 'error');
        elements.progressSection.classList.remove('active');
    } finally {
        elements.summarizeLinksBtn.disabled = false;
    }
}

// Summarize YouTube playlist
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
        showToast('Please configure your YouTube & API settings first', 'error');
        openModal();
        return;
    }

    // Show progress
    elements.summarizePlaylistBtn.disabled = true;
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

        let listData;
        try {
            listData = await listResponse.json();
        } catch (e) {
            throw new Error(`Failed to fetch playlist (HTTP ${listResponse.status})`);
        }

        if (!listResponse.ok) {
            throw new Error(listData.error || 'Failed to fetch playlist');
        }
        const { playlistTitle, videos } = listData;

        if (videos.length === 0) {
            elements.progressSection.classList.remove('active');
            showToast('No recent videos found in playlist', 'error');
            elements.summarizePlaylistBtn.disabled = false;
            return;
        }

        // Show results header
        elements.resultsHeader.classList.add('active');
        currentPlaylistTitle = playlistTitle || 'Playlist Summaries';
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

                let result;
                try {
                    result = await processResponse.json();
                } catch (e) {
                    throw new Error(`Server returned ${processResponse.status} (invalid JSON)`);
                }

                if (!processResponse.ok) {
                    throw new Error(result.error || `Server returned ${processResponse.status}`);
                }
                debugLog('playlist_process', {
                    videoId: video.videoId,
                    httpStatus: processResponse.status,
                    resultStatus: result.status,
                    transcriptSource: result.transcriptSource || null,
                    summaryLen: result.summary ? result.summary.length : 0
                });
                results.push(result);

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
        elements.summarizePlaylistBtn.disabled = false;
    }
}

// Save current form values to server under a named profile
async function saveToServer() {
    const name = elements.cloudNameInput.value.trim();
    const password = elements.cloudPasswordInput.value;

    if (!name) {
        showToast('Enter a profile name to save', 'error');
        return;
    }

    localStorage.setItem(STORAGE_KEYS.cloudName, name);
    if (password) localStorage.setItem(STORAGE_KEYS.cloudPassword, password);

    const settings = {
        playlistId: elements.playlistIdInput.value.trim(),
        hoursBack: elements.hoursBackInput.value || '168',
        youtubeKey: elements.youtubeKeyInput.value.trim(),
        openaiKey: elements.openaiKeyInput.value.trim(),
        openaiBaseUrl: elements.openaiBaseUrlInput.value.trim(),
        openaiModel: elements.openaiModelInput.value.trim(),
        transcriptKey: elements.transcriptKeyInput.value.trim()
    };

    const btn = elements.saveToServerBtn;
    const span = btn.querySelector('span');
    btn.disabled = true;
    const originalText = span.textContent;
    span.textContent = 'Saving…';

    try {
        const response = await fetch(`${API_BASE}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'save', name, password, settings })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to save to server');
        showToast(`Profile "${name}" saved to server`, 'success');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        btn.disabled = false;
        span.textContent = originalText;
    }
}

// Load a named profile from server and apply to form + localStorage
async function loadFromServer() {
    const name = elements.cloudNameInput.value.trim();
    const password = elements.cloudPasswordInput.value;

    if (!name) {
        showToast('Enter a profile name to load', 'error');
        return;
    }

    localStorage.setItem(STORAGE_KEYS.cloudName, name);
    if (password) localStorage.setItem(STORAGE_KEYS.cloudPassword, password);

    const btn = elements.loadFromServerBtn;
    const span = btn.querySelector('span');
    btn.disabled = true;
    const originalText = span.textContent;
    span.textContent = 'Loading…';

    try {
        const response = await fetch(`${API_BASE}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'load', name, password })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to load from server');

        const { settings } = result;

        if (settings.playlistId !== undefined) elements.playlistIdInput.value = settings.playlistId;
        if (settings.hoursBack !== undefined) elements.hoursBackInput.value = settings.hoursBack;
        if (settings.youtubeKey !== undefined) elements.youtubeKeyInput.value = settings.youtubeKey;
        if (settings.openaiKey !== undefined) elements.openaiKeyInput.value = settings.openaiKey;
        if (settings.openaiBaseUrl !== undefined) elements.openaiBaseUrlInput.value = settings.openaiBaseUrl;
        if (settings.openaiModel !== undefined) elements.openaiModelInput.value = settings.openaiModel;
        if (settings.transcriptKey !== undefined) elements.transcriptKeyInput.value = settings.transcriptKey;

        try {
            localStorage.setItem(STORAGE_KEYS.playlistId, settings.playlistId || '');
            localStorage.setItem(STORAGE_KEYS.hoursBack, String(settings.hoursBack || '168'));
            localStorage.setItem(STORAGE_KEYS.youtubeKey, settings.youtubeKey || '');
            localStorage.setItem(STORAGE_KEYS.openaiKey, settings.openaiKey || '');
            localStorage.setItem(STORAGE_KEYS.openaiBaseUrl, settings.openaiBaseUrl || '');
            localStorage.setItem(STORAGE_KEYS.openaiModel, settings.openaiModel || '');
            localStorage.setItem(STORAGE_KEYS.transcriptKey, settings.transcriptKey || '');
        } catch (_) { /* quota exceeded */ }

        updatePlaylistBadge(settings.playlistId || '');
        showToast(`Profile "${name}" loaded`, 'success');
        closeModal();
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        btn.disabled = false;
        span.textContent = originalText;
    }
}

// Paste from clipboard helper
async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        if (!text) {
            showToast('Clipboard is empty', 'info');
            return;
        }
        if (elements.linksInput.value.trim()) {
            elements.linksInput.value = elements.linksInput.value.trim() + '\n' + text.trim();
        } else {
            elements.linksInput.value = text.trim();
        }
        updateLinksCounter();
        showToast('Links pasted from clipboard', 'success');
    } catch (err) {
        console.warn('Clipboard read failed:', err);
        showToast('Clipboard access denied. Please paste manually.', 'info');
        elements.linksInput.focus();
    }
}

// Clear links helper
function clearLinks() {
    elements.linksInput.value = '';
    updateLinksCounter();
}

// Event listeners
elements.settingsBtn.addEventListener('click', openModal);
elements.themeToggle.addEventListener('click', toggleTheme);
elements.modalClose.addEventListener('click', closeModal);
elements.cancelBtn.addEventListener('click', closeModal);
elements.modalOverlay.addEventListener('click', (e) => {
    if (e.target === elements.modalOverlay) closeModal();
});
elements.saveBtn.addEventListener('click', () => {
    if (saveSettings()) closeModal();
});
elements.saveToServerBtn.addEventListener('click', saveToServer);
elements.loadFromServerBtn.addEventListener('click', loadFromServer);

// Mode tab listeners
elements.tabLinks.addEventListener('click', () => setMode('links'));
elements.tabPlaylist.addEventListener('click', () => setMode('playlist'));

// Link List listeners
elements.linksInput.addEventListener('input', updateLinksCounter);
elements.pasteLinksBtn.addEventListener('click', pasteFromClipboard);
elements.clearLinksBtn.addEventListener('click', clearLinks);
elements.summarizeLinksBtn.addEventListener('click', summarizeLinks);

// Playlist listener
elements.summarizePlaylistBtn.addEventListener('click', summarizePlaylist);

// Delete/Dismiss video card handler
elements.resultsGrid.addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) {
        const videoCard = deleteBtn.closest('.video-card');
        if (videoCard && !deleteBtn.disabled) {
            const videoId = videoCard.dataset.videoId;
            const playlistId = localStorage.getItem(STORAGE_KEYS.playlistId);

            // If we have a YouTube playlist ID and a YouTube video ID, try removing from playlist
            const isYouTubePlaylistMode = elements.tabPlaylist.classList.contains('active') && videoId && playlistId;

            if (isYouTubePlaylistMode) {
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
                    } else {
                        showToast(result.error || 'Removed card from view', 'info');
                    }
                } catch (error) {
                    console.warn('Playlist delete call error:', error);
                }
            }

            // Animate card removal
            videoCard.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            videoCard.style.opacity = '0';
            videoCard.style.transform = 'scale(0.95)';
            setTimeout(() => {
                videoCard.remove();
                const remaining = elements.resultsGrid.querySelectorAll('.video-card').length;
                if (elements.resultsMeta.textContent) {
                    elements.resultsMeta.textContent = `${remaining} video${remaining === 1 ? '' : 's'} displayed`;
                }
            }, 300);
        }
    }
});

// Download HTML handler
elements.downloadHtmlBtn.addEventListener('click', async () => {
    const btn = elements.downloadHtmlBtn;
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Generating...';

    try {
        const cssResponse = await fetch('assets/shared.css');
        const sharedCss = await cssResponse.text();

        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const safeTitle = escapeHtml(currentPlaylistTitle || 'Video Summaries');

        // Remove interactive delete buttons for export
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = elements.resultsGrid.innerHTML;
        tempDiv.querySelectorAll('.delete-btn').forEach(b => b.remove());
        const cleanedResultsHtml = tempDiv.innerHTML;

        const htmlContent = `<!DOCTYPE html>
<html lang="en" data-theme="${currentTheme}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeTitle}</title>
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
                <h1>${safeTitle}</h1>
                <span class="logo-subtitle">Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
        </header>

        <div class="results-header" style="display: flex;">
            <h2 class="results-title">Summaries</h2>
            <span class="results-meta">${elements.resultsMeta.textContent}</span>
        </div>

        <div class="results-grid">
            ${cleanedResultsHtml}
        </div>
    </div>
</body>
</html>`;

        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const timeStr = now.toTimeString().slice(0, 5).replace(':', '-');
        const sanitizedFilename = (currentPlaylistTitle || 'Summaries').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
        const filename = `${sanitizedFilename}_${dateStr}_${timeStr}.html`;

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
initTheme();

document.addEventListener('DOMContentLoaded', () => {
    const settings = loadSettings();

    // Restore saved mode tab (default to 'links')
    const savedMode = localStorage.getItem(STORAGE_KEYS.activeMode) || 'links';
    setMode(savedMode);

    // Restore saved links if any
    const savedLinks = localStorage.getItem(STORAGE_KEYS.savedLinks) || '';
    if (savedLinks) {
        elements.linksInput.value = savedLinks;
        updateLinksCounter();
    }

    // Auto-prompt settings modal if core API keys are missing
    if (!settings.openaiKey || !settings.transcriptKey) {
        setTimeout(openModal, 600);
    }

    debugLog('startup', {
        markedDefined: typeof marked !== 'undefined',
        apiBase: API_BASE,
        activeMode: savedMode
    });

    document.getElementById('debugTrigger').addEventListener('click', showDebugPanel);
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elements.modalOverlay.classList.contains('active')) {
        closeModal();
    }
});
