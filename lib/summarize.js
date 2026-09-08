// Shared business logic for Playlist & Video Summarizer
// Used by api/summarize.js (Vercel)

import OpenAI from 'openai';

export const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

// Safe JSON parser with detailed error logging
export async function safeParseJson(response, context) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (e) {
    const preview = text.substring(0, 200);
    console.error(`[${context}] JSON parse failed - Status: ${response.status}, Preview: ${preview}`);
    throw new Error(`${context}: Invalid JSON response (status ${response.status}) - ${preview}`);
  }
}

// Retry logic for fetch requests
export async function fetchWithRetry(url, options, maxRetries = 3, context = '') {
  const retryable = new Set([408, 429, 503]);
  let lastStatus = null;

  for (let i = 0; i < maxRetries; i++) {
    let res;
    try {
      res = await fetch(url, options);
      lastStatus = res.status;
    } catch (err) {
      const isLastAttempt = i === maxRetries - 1;
      const delayMs = Math.min(5, Math.pow(2, i)) * 1000;
      console.warn(
        `[${context || 'Fetch'}] Network error on attempt ${i + 1}/${maxRetries}: ${err?.message || err}`
      );
      if (isLastAttempt) break;
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }

    if (!retryable.has(res.status)) return res;

    const raHeader = res.headers.get('Retry-After');

    // 429 without a Retry-After header means the server won't accept us soon —
    // fail fast so the caller can try a fallback immediately.
    if (res.status === 429 && !raHeader) return res;

    // Retry-After may be delta-seconds or an HTTP-date; only trust a finite number.
    const ra = Number(raHeader);
    const delaySec = Number.isFinite(ra) && ra > 0 ? ra : Math.pow(2, i); // 1,2,4...
    const delayMs = Math.min(5, delaySec) * 1000;
    // Release the socket before retrying (undici won't reuse it otherwise).
    await res.body?.cancel().catch(() => {});
    console.warn(
      `[${context || 'Fetch'}] Retryable status ${res.status}, attempt ${i + 1}/${maxRetries}, waiting ${delayMs}ms`
    );
    await new Promise(r => setTimeout(r, delayMs));
  }

  console.error(`[${context || 'Fetch'}] Max retries (${maxRetries}) exceeded`);
  if (lastStatus === 429) {
    throw new Error(`${context ? context + ': ' : ''}Rate limit exceeded (HTTP 429, retry limit of ${maxRetries} reached)`);
  }
  if (lastStatus === 503) {
    throw new Error(`${context ? context + ': ' : ''}Service temporarily unavailable (HTTP 503, retry limit of ${maxRetries} reached)`);
  }
  throw new Error(`${context ? context + ': ' : ''}Max retries exceeded`);
}

// Platform detection from URL
export function detectPlatform(url) {
  if (!url) return 'generic';
  const lower = String(url).toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('instagram.com') || lower.includes('instagr.am')) return 'instagram';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com')) return 'facebook';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter';
  return 'video';
}

// Extract YouTube video ID from URL or ID string
export function extractYouTubeId(urlOrId) {
  if (!urlOrId) return null;
  const str = String(urlOrId).trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
  const match = str.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|v\/|live\/))([a-zA-Z0-9_-]{11})/i);
  return match ? match[1] : null;
}

// Generate fallback metadata based on platform heuristics
export function getFallbackMetadata(url, platform) {
  const detected = platform || detectPlatform(url);
  const nowIso = new Date().toISOString();

  if (detected === 'youtube') {
    const ytid = extractYouTubeId(url);
    return {
      title: ytid ? `YouTube Video (${ytid})` : 'YouTube Video',
      channel: 'YouTube Creator',
      platform: 'youtube',
      thumbnail: ytid ? `https://img.youtube.com/vi/${ytid}/mqdefault.jpg` : null,
      publishedAt: nowIso,
    };
  }

  if (detected === 'instagram') {
    return {
      title: 'Instagram Reel',
      channel: 'Instagram Creator',
      platform: 'instagram',
      thumbnail: null,
      publishedAt: nowIso,
    };
  }

  if (detected === 'tiktok') {
    const userMatch = String(url).match(/tiktok\.com\/@([^/?#]+)/i);
    const author = userMatch ? `@${userMatch[1]}` : 'TikTok Creator';
    return {
      title: 'TikTok Video',
      channel: author,
      platform: 'tiktok',
      thumbnail: null,
      publishedAt: nowIso,
    };
  }

  if (detected === 'facebook') {
    return {
      title: 'Facebook Reel',
      channel: 'Facebook Creator',
      platform: 'facebook',
      thumbnail: null,
      publishedAt: nowIso,
    };
  }

  return {
    title: 'Video',
    channel: 'Creator',
    platform: detected || 'video',
    thumbnail: null,
    publishedAt: nowIso,
  };
}

// Fetch metadata using Supadata metadata API
export async function fetchMetadataFromSupadata(url, transcriptApiKey) {
  if (!url || !transcriptApiKey) return null;
  try {
    const params = new URLSearchParams({ url });
    const response = await fetchWithRetry(
      `https://api.supadata.ai/v1/metadata?${params.toString()}`,
      { headers: { 'x-api-key': transcriptApiKey } },
      2,
      `Supadata/metadata[${url}]`
    );

    if (!response.ok) {
      console.warn(`[Supadata/metadata] HTTP ${response.status} for ${url}`);
      return null;
    }

    const data = await safeParseJson(response, `Supadata/metadata[${url}]`);
    return data;
  } catch (err) {
    console.warn(`[Supadata/metadata] Error for ${url}:`, err?.message || err);
    return null;
  }
}

// Resolve complete metadata for a video item (combining input, Supadata metadata, and fallbacks)
export async function resolveVideoMetadata(urlOrVideo, transcriptApiKey) {
  const isString = typeof urlOrVideo === 'string';
  const url = isString
    ? urlOrVideo.trim()
    : (urlOrVideo.url || (urlOrVideo.videoId ? `https://www.youtube.com/watch?v=${urlOrVideo.videoId}` : '')).trim();
  const rawVideo = isString ? {} : urlOrVideo;

  const platform = rawVideo.platform || detectPlatform(url);
  const fallback = getFallbackMetadata(url, platform);

  let title = rawVideo.title && rawVideo.title !== 'Untitled Video' ? rawVideo.title : null;
  let channel = rawVideo.channel && rawVideo.channel !== 'Unknown Channel' ? rawVideo.channel : null;
  let thumbnail = rawVideo.thumbnail || (platform === 'youtube' && extractYouTubeId(url) ? `https://img.youtube.com/vi/${extractYouTubeId(url)}/mqdefault.jpg` : null);
  let publishedAt = rawVideo.publishedAt || fallback.publishedAt;

  // If missing title or thumbnail or channel, try Supadata metadata API
  if ((!title || !thumbnail || !channel) && transcriptApiKey) {
    const meta = await fetchMetadataFromSupadata(url, transcriptApiKey);
    if (meta) {
      if (!title) {
        title = meta.title || (meta.description ? meta.description.slice(0, 100).trim() : null);
      }
      if (!channel) {
        channel = meta.author?.displayName || meta.author?.username || null;
      }
      if (!thumbnail) {
        thumbnail = meta.media?.thumbnailUrl || meta.media?.url || null;
      }
      if (meta.createdAt) {
        publishedAt = meta.createdAt;
      }
    }
  }

  const videoId = rawVideo.videoId || extractYouTubeId(url);

  return {
    ...rawVideo,
    url,
    videoId: videoId || null,
    title: title || fallback.title,
    channel: channel || fallback.channel,
    platform: platform || fallback.platform,
    thumbnail: thumbnail || fallback.thumbnail,
    publishedAt: publishedAt || fallback.publishedAt,
  };
}

// Parse multiline string or array of URLs into clean video item objects
export function parseUrlList(text) {
  if (!text) return [];
  const lines = Array.isArray(text) ? text : String(text).split(/[\r\n]+/);
  const urls = [];
  const seen = new Set();

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/https?:\/\/[^\s]+/i);
    const url = match ? match[0] : (trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);

    try {
      const parsed = new URL(url);
      const cleanUrl = parsed.href;
      if (!seen.has(cleanUrl)) {
        seen.add(cleanUrl);
        const platform = detectPlatform(cleanUrl);
        const fallback = getFallbackMetadata(cleanUrl, platform);
        urls.push({
          url: cleanUrl,
          videoId: extractYouTubeId(cleanUrl),
          platform,
          title: fallback.title,
          channel: fallback.channel,
          thumbnail: fallback.thumbnail,
          publishedAt: fallback.publishedAt,
        });
      }
    } catch (_) {
      // Ignore invalid URLs
    }
  }

  return urls;
}

// Helper to parse Supadata API error responses and clearly identify limit vs auth errors
export function handleSupadataApiError(data, status, context = '') {
  const rawMsg = data?.message || data?.error || '';
  const details = data?.details ? ` (${data.details})` : '';
  const isLimit =
    status === 429 ||
    status === 402 ||
    data?.error === 'limit-exceeded' ||
    /limit[ -]?exceeded|quota|too many requests|rate[ -]?limit/i.test(rawMsg) ||
    /limit[ -]?exceeded|quota/i.test(data?.details || '');

  if (isLimit) {
    throw new Error(
      `Supadata API limit exceeded: Rate or monthly quota limit reached for transcript fetching${details}. Please check your Supadata plan and credits at supadata.ai.`
    );
  }

  if (status === 401 || data?.error === 'unauthorized' || /unauthorized|invalid.*key/i.test(rawMsg)) {
    throw new Error(`Supadata API key invalid: ${details || rawMsg || 'Check your Supadata API Key in Settings.'}`);
  }

  throw new Error(`Supadata API error (${status}): ${rawMsg || 'Failed to fetch transcript'}${details}`);
}

// Fetch transcript using Supadata (handles both immediate and async job responses for any supported platform)
export async function fetchTranscriptFromSupadata(urlOrVideoId, transcriptApiKey) {
  const supadataHeaders = { 'x-api-key': transcriptApiKey };

  let targetUrl = String(urlOrVideoId || '').trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `https://www.youtube.com/watch?v=${targetUrl}`;
  }

  const params = new URLSearchParams({
    url: targetUrl,
    text: 'true',
    mode: 'auto',
  });

  const response = await fetchWithRetry(
    `https://api.supadata.ai/v1/transcript?${params.toString()}`,
    { headers: supadataHeaders },
    3,
    `Supadata[${targetUrl}]`
  );

  const data = await safeParseJson(response, `Supadata[${targetUrl}]`);

  if (!response.ok) {
    console.error(`[Supadata] Error for ${targetUrl}:`, data);
    handleSupadataApiError(data, response.status, targetUrl);
  }

  // Immediate response
  if (data?.content) {
    const content = data.content;
    const text = Array.isArray(content)
      ? content.map(seg => seg?.text || '').join('\n').trim()
      : String(content).trim();
    return { text, language: data.lang || null, source: 'supadata' };
  }

  // Async job response - poll for result
  const jobId = data?.jobId || data?.job_id;
  if (!jobId) {
    console.error(`[Supadata] No content or jobId in response for ${targetUrl}:`, data);
    throw new Error('No transcript available');
  }

  const MAX_POLLS = 45;
  const POLL_INTERVAL_MS = 2000;

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const pollResponse = await fetchWithRetry(
      `https://api.supadata.ai/v1/transcript/${encodeURIComponent(jobId)}`,
      { headers: supadataHeaders },
      3,
      `Supadata/job[${jobId}]`
    );

    const pollData = await safeParseJson(pollResponse, `Supadata/job[${jobId}]`);

    if (!pollResponse.ok) {
      console.error(`[Supadata] Poll error for job ${jobId}:`, pollData);
      handleSupadataApiError(pollData, pollResponse.status, `job ${jobId}`);
    }

    if (pollData?.status === 'completed' && pollData?.content) {
      const content = pollData.content;
      const text = Array.isArray(content)
        ? content.map(seg => seg?.text || '').join('\n').trim()
        : String(content).trim();
      return { text, language: pollData.lang || null, source: 'supadata' };
    }

    if (pollData?.status === 'failed') {
      const failMsg = pollData?.message || pollData?.error || jobId;
      if (/limit[ -]?exceeded|quota|rate[ -]?limit/i.test(failMsg)) {
        throw new Error(`Supadata API limit exceeded: ${failMsg}. Please check your Supadata credits at supadata.ai.`);
      }
      throw new Error(`Supadata transcript job failed: ${failMsg}`);
    }

    console.log(`[Supadata] Job ${jobId} status: ${pollData?.status} (poll ${i + 1}/${MAX_POLLS})`);
  }

  throw new Error('Supadata timed out waiting for transcript');
}

// Fetch transcript using Supadata (alias for multi-platform)
export async function fetchTranscript(urlOrVideoId, transcriptApiKey) {
  return await fetchTranscriptFromSupadata(urlOrVideoId, transcriptApiKey);
}

// Helper to parse YouTube API error responses and clearly identify quota/rate limit errors
export function handleYouTubeApiError(data, status, actionContext = '') {
  const errorObj = data?.error;
  const message = errorObj?.message || `YouTube API HTTP ${status}`;
  const firstError = errorObj?.errors?.[0];
  const reason = firstError?.reason || '';

  if (
    reason === 'quotaExceeded' ||
    reason === 'dailyLimitExceeded' ||
    reason === 'rateLimitExceeded' ||
    reason === 'userRateLimitExceeded' ||
    status === 429 ||
    /quota|limit[ -]?exceeded|rate[ -]?limit/i.test(message)
  ) {
    throw new Error(
      `YouTube Data API quota exceeded: ${message}. Daily quota resets at midnight Pacific Time (PT). Check your quota in Google Cloud Console.`
    );
  }

  if (reason === 'keyInvalid' || (status === 400 && /api key not valid|key.*invalid/i.test(message))) {
    throw new Error(`YouTube Data API key invalid: ${message}. Check your YouTube API Key in Settings.`);
  }

  throw new Error(`YouTube Data API error (${actionContext}): ${message}`);
}

// Fetch playlist info
export async function getPlaylistTitle(playlistId, apiKey) {
  const url = `${YOUTUBE_API_BASE}/playlists?part=snippet&id=${playlistId}&key=${apiKey}`;
  const response = await fetchWithRetry(url, {}, 3, `YouTube/playlists[${playlistId}]`);
  const data = await safeParseJson(response, `YouTube/playlists[${playlistId}]`);

  if (!response.ok) {
    console.error(`[YouTube/playlists] Error for ${playlistId}:`, data);
    handleYouTubeApiError(data, response.status, 'fetching playlist info');
  }

  return data?.items?.[0]?.snippet?.title || 'Unknown Playlist';
}

// Fetch recent videos from playlist
export async function getRecentVideos(playlistId, apiKey, hoursBack) {
  const cutoffDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const videos = [];
  let nextPageToken = null;

  do {
    const url = new URL(`${YOUTUBE_API_BASE}/playlistItems`);
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('key', apiKey);
    if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);

    const response = await fetchWithRetry(url.toString(), {}, 3, `YouTube/playlistItems[${playlistId}]`);
    const data = await safeParseJson(response, `YouTube/playlistItems[${playlistId}]`);

    if (!response.ok) {
      console.error(`[YouTube/playlistItems] Error for ${playlistId}:`, data);
      handleYouTubeApiError(data, response.status, 'fetching playlist items');
    }

    for (const item of data?.items || []) {
      const videoId = item.contentDetails?.videoId;
      const title = item.snippet?.title;

      if (!videoId || !title || title === 'Private video' || title === 'Deleted video') continue;

      const publishedAt = new Date(item.snippet.publishedAt);
      if (publishedAt >= cutoffDate) {
        videos.push({
          videoId,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          title,
          channel: item.snippet.channelTitle,
          platform: 'youtube',
          thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          publishedAt: item.snippet.publishedAt,
        });
      }
    }

    nextPageToken = data?.nextPageToken;

    if (data?.items?.length) {
      const lastDate = new Date(data.items[data.items.length - 1].snippet.publishedAt);
      if (lastDate < cutoffDate) break;
    }
  } while (nextPageToken);

  return videos;
}

// Languages that should keep their original language in summaries
export const NATIVE_LANGUAGE_NAMES = {
  fr: 'French',
  es: 'Spanish',
  ar: 'Arabic',
};

// Summarize transcript using OpenAI
export async function summarizeTranscript(transcript, title, openaiApiKey, openaiBaseUrl, model, language, platform) {
  const client = new OpenAI({
    apiKey: openaiApiKey,
    ...(openaiBaseUrl ? { baseURL: openaiBaseUrl } : {}),
  });

  const resolvedModel = model || DEFAULT_OPENAI_MODEL;
  const providerLabel = openaiBaseUrl ? 'Custom AI Provider' : 'OpenAI API';

  const nativeLang = NATIVE_LANGUAGE_NAMES[language];
  const langInstruction = nativeLang
    ? `IMPORTANT: Write your entire summary in ${nativeLang}. Do NOT translate to English.`
    : '';

  const PLATFORM_NAMES = {
    youtube: 'YouTube',
    instagram: 'Instagram Reel',
    tiktok: 'TikTok',
    facebook: 'Facebook Reel',
  };
  const platformName = platform
    ? (PLATFORM_NAMES[platform] || platform.charAt(0).toUpperCase() + platform.slice(1))
    : 'video';

  const prompt = `${langInstruction}

Please summarize this ${platformName} video transcript in Markdown format.
Start with a short executive summary (3-5 sentences capturing the essence).
Then provide a more detailed summary with the main points, key takeaways, and important details.
Use bullet points, headers, and formatting to make the summary easy to read.

Video Title: ${title || 'Video'}

Transcript:
${transcript.substring(0, 70000)}`;

  try {
    const response = await client.chat.completions.create({
      model: resolvedModel,
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.choices?.[0]?.message?.content;
    if (content) {
      return content.replace(/^```(?:markdown)?\n([\s\S]*)\n```\s*$/, '$1').trim();
    }

    throw new Error('No summary generated');
  } catch (err) {
    const rawMsg = err?.message || String(err);
    const status = err?.status || err?.statusCode;
    const isRateOrQuota =
      status === 429 ||
      err?.code === 'insufficient_quota' ||
      /quota|rate[ -]?limit|limit[ -]?exceeded|too many requests|tokens per minute|requests per minute/i.test(rawMsg);

    if (isRateOrQuota) {
      const hint = openaiBaseUrl
        ? 'Check your custom provider rate limits and balance.'
        : 'Check your OpenAI plan, billing/usage credits, and rate limits at platform.openai.com.';
      throw new Error(`${providerLabel} limit exceeded: ${rawMsg}. ${hint}`);
    }

    if (status === 401 || /invalid[ -]?api[ -]?key|unauthorized/i.test(rawMsg)) {
      throw new Error(`${providerLabel} authentication failed: Invalid API key. Check your OpenAI API key in Settings.`);
    }

    if (/context[ -]?length|maximum context|token.*limit/i.test(rawMsg)) {
      throw new Error(`${providerLabel} context limit exceeded: Video transcript is too long for model ${resolvedModel}.`);
    }

    throw new Error(`${providerLabel} summarization error: ${rawMsg}`);
  }
}
