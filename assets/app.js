// Storage keys
const STORAGE_KEYS = {
    playlistId: 'yps_playlist_id',
    hoursBack: 'yps_hours_back',
    youtubeKey: 'yps_youtube_key',
    claudeKey: 'yps_claude_key',
    claudeBaseUrl: 'yps_claude_base_url',
    transcriptKey: 'yps_transcript_key',
    theme: 'yps_theme'
};

// Current playlist title for PDF export
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
    claudeKeyInput: document.getElementById('claudeKeyInput'),
    claudeBaseUrlInput: document.getElementById('claudeBaseUrlInput'),
    transcriptKeyInput: document.getElementById('transcriptKeyInput')
};

// Load settings from localStorage
function loadSettings() {
    const settings = {
        playlistId: localStorage.getItem(STORAGE_KEYS.playlistId) || '',
        hoursBack: localStorage.getItem(STORAGE_KEYS.hoursBack) || '168',
        youtubeKey: localStorage.getItem(STORAGE_KEYS.youtubeKey) || '',
        claudeKey: localStorage.getItem(STORAGE_KEYS.claudeKey) || '',
        claudeBaseUrl: localStorage.getItem(STORAGE_KEYS.claudeBaseUrl) || '',
        transcriptKey: localStorage.getItem(STORAGE_KEYS.transcriptKey) || ''
    };

    elements.playlistIdInput.value = settings.playlistId;
    elements.hoursBackInput.value = settings.hoursBack;
    elements.youtubeKeyInput.value = settings.youtubeKey;
    elements.claudeKeyInput.value = settings.claudeKey;
    elements.claudeBaseUrlInput.value = settings.claudeBaseUrl;
    elements.transcriptKeyInput.value = settings.transcriptKey;

    updatePlaylistBadge(settings.playlistId);
    return settings;
}

// Save settings to localStorage
function saveSettings() {
    const playlistId = elements.playlistIdInput.value.trim();
    const hoursBack = elements.hoursBackInput.value || '168';
    const youtubeKey = elements.youtubeKeyInput.value.trim();
    const claudeKey = elements.claudeKeyInput.value.trim();
    const claudeBaseUrl = elements.claudeBaseUrlInput.value.trim();
    const transcriptKey = elements.transcriptKeyInput.value.trim();

    if (!playlistId || !youtubeKey || !claudeKey || !transcriptKey) {
        showToast('Please fill in all required fields', 'error');
        return false;
    }

    localStorage.setItem(STORAGE_KEYS.playlistId, playlistId);
    localStorage.setItem(STORAGE_KEYS.hoursBack, hoursBack);
    localStorage.setItem(STORAGE_KEYS.youtubeKey, youtubeKey);
    localStorage.setItem(STORAGE_KEYS.claudeKey, claudeKey);
    localStorage.setItem(STORAGE_KEYS.claudeBaseUrl, claudeBaseUrl);
    localStorage.setItem(STORAGE_KEYS.transcriptKey, transcriptKey);

    updatePlaylistBadge(playlistId);
    showToast('Settings saved successfully', 'success');
    return true;
}

// Update playlist badge
function updatePlaylistBadge(playlistId) {
    if (playlistId) {
        elements.playlistBadge.classList.add('configured');
        elements.playlistStatus.textContent = `Playlist: ${playlistId.substring(0, 20)}...`;
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
        claudeKey: localStorage.getItem(STORAGE_KEYS.claudeKey) || '',
        claudeBaseUrl: localStorage.getItem(STORAGE_KEYS.claudeBaseUrl) || '',
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
        const validKeys = ['playlistId', 'hoursBack', 'youtubeKey', 'claudeKey', 'claudeBaseUrl', 'transcriptKey'];
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
        if (config.claudeKey !== undefined) {
            localStorage.setItem(STORAGE_KEYS.claudeKey, config.claudeKey);
        }
        if (config.claudeBaseUrl !== undefined) {
            localStorage.setItem(STORAGE_KEYS.claudeBaseUrl, config.claudeBaseUrl);
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
    toast.innerHTML = `
        <svg width="18" height="18"><use href="#icon-${type === 'error' ? 'error' : 'success'}"/></svg>
        ${message}
    `;
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

    // Convert LaTeX to Unicode before markdown parsing
    const summaryWithUnicode = latexAllToUnicode(video.summary || 'No summary available');
    const summaryHtml = marked.parse(summaryWithUnicode);
    const thumbnailUrl = `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`;
    const isRtl = video.language === 'ar';

    return `
        <article class="video-card" data-video-id="${video.videoId}">
            <div class="video-header">
                <a href="https://www.youtube.com/watch?v=${video.videoId}" target="_blank" class="video-thumbnail">
                    <img src="${thumbnailUrl}" alt="${video.title}" loading="lazy">
                    <div class="play-icon">
                        <svg><use href="#icon-play"/></svg>
                    </div>
                </a>
                <div class="video-info">
                    <h3 class="video-title">
                        <a href="https://www.youtube.com/watch?v=${video.videoId}" target="_blank">
                            ${video.title}
                        </a>
                    </h3>
                    <div class="video-meta">
                        <span>
                            <svg><use href="#icon-user"/></svg>
                            ${video.channel}
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
        claudeApiKey: localStorage.getItem(STORAGE_KEYS.claudeKey),
        claudeBaseUrl: localStorage.getItem(STORAGE_KEYS.claudeBaseUrl) || '',
        transcriptApiKey: localStorage.getItem(STORAGE_KEYS.transcriptKey)
    };

    if (!settings.playlistId || !settings.youtubeApiKey || !settings.claudeApiKey || !settings.transcriptApiKey) {
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

        const listResponse = await fetch('/.netlify/functions/summarize', {
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
                const processResponse = await fetch('/.netlify/functions/summarize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'process',
                        video,
                        claudeApiKey: settings.claudeApiKey,
                        claudeBaseUrl: settings.claudeBaseUrl,
                        transcriptApiKey: settings.transcriptApiKey
                    })
                });

                const result = await processResponse.json();
                results.push(result);

                // Update UI immediately with this result
                elements.resultsGrid.innerHTML = results.map(createVideoCard).join('');
                const successCount = results.filter(v => v.status === 'success').length;
                elements.resultsMeta.textContent = `${successCount} of ${videos.length} videos summarized`;

            } catch (err) {
                console.error(`Error processing ${video.title}:`, err);
                results.push({
                    ...video,
                    summary: `Error: ${err.message}`,
                    status: 'failed'
                });
                elements.resultsGrid.innerHTML = results.map(createVideoCard).join('');
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
                const response = await fetch('/.netlify/functions/delete-video', {
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
    <title>${currentPlaylistTitle}</title>
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
                <h1>${currentPlaylistTitle}</h1>
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
    if (!settings.playlistId || !settings.youtubeKey || !settings.claudeKey || !settings.transcriptKey) {
        setTimeout(openModal, 500);
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elements.modalOverlay.classList.contains('active')) {
        closeModal();
    }
});
