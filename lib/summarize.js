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

  for (let i = 0; i < maxRetries; i++) {
    let res;
    try {
      res = await fetch(url, options);
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

    const ra = res.headers.get('Retry-After');

    // 429 without a Retry-After header means the server won't accept us soon —
    // fail fast so the caller can try a fallback immediately.
    if (res.status === 429 && !ra) return res;

    const delaySec = ra ? Number(ra) : Math.pow(2, i); // 1,2,4...
    const delayMs = Math.min(5, delaySec) * 1000;
    console.warn(
      `[${context || 'Fetch'}] Retryable status ${res.status}, attempt ${i + 1}/${maxRetries}, waiting ${delayMs}ms`
    );
    await new Promise(r => setTimeout(r, delayMs));
  }

  console.error(`[${context || 'Fetch'}] Max retries (${maxRetries}) exceeded`);
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
    throw new Error(data?.message || `Transcript API error: ${response.status}`);
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
      throw new Error(pollData?.message || `Transcript job poll error: ${pollResponse.status}`);
    }

    if (pollData?.status === 'completed' && pollData?.content) {
      const content = pollData.content;
      const text = Array.isArray(content)
        ? content.map(seg => seg?.text || '').join('\n').trim()
        : String(content).trim();
      return { text, language: pollData.lang || null, source: 'supadata' };
    }

    if (pollData?.status === 'failed') {
      throw new Error(`Supadata transcript job failed: ${pollData?.message || jobId}`);
    }

    console.log(`[Supadata] Job ${jobId} status: ${pollData?.status} (poll ${i + 1}/${MAX_POLLS})`);
  }

  throw new Error('Supadata timed out waiting for transcript');
}

// Fetch transcript using Supadata (alias for multi-platform)
export async function fetchTranscript(urlOrVideoId, transcriptApiKey) {
  return await fetchTranscriptFromSupadata(urlOrVideoId, transcriptApiKey);
}

// Fetch playlist info
export async function getPlaylistTitle(playlistId, apiKey) {
  const url = `${YOUTUBE_API_BASE}/playlists?part=snippet&id=${playlistId}&key=${apiKey}`;
  const response = await fetchWithRetry(url, {}, 3, `YouTube/playlists[${playlistId}]`);
  const data = await safeParseJson(response, `YouTube/playlists[${playlistId}]`);

  if (!response.ok) {
    console.error(`[YouTube/playlists] Error for ${playlistId}:`, data);
    throw new Error(data?.error?.message || 'Failed to fetch playlist info');
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
      throw new Error(data?.error?.message || 'Failed to fetch playlist items');
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

  const nativeLang = NATIVE_LANGUAGE_NAMES[language];
  const langInstruction = nativeLang
    ? `IMPORTANT: Write your entire summary in ${nativeLang}. Do NOT translate to English.`
    : '';

  const platformName = platform
    ? (platform === 'youtube' ? 'YouTube' :
       platform === 'instagram' ? 'Instagram Reel' :
       platform === 'tiktok' ? 'TikTok' :
       platform === 'facebook' ? 'Facebook Reel' :
       platform.charAt(0).toUpperCase() + platform.slice(1))
    : 'video';

  const prompt = `${langInstruction}

Please summarize this ${platformName} video transcript in Markdown format.
Start with a short executive summary (3-5 sentences capturing the essence).
Then provide a more detailed summary with the main points, key takeaways, and important details.
Use bullet points, headers, and formatting to make the summary easy to read.

Video Title: ${title || 'Video'}

Transcript:
${transcript.substring(0, 70000)}`;

  const response = await client.chat.completions.create({
    model: resolvedModel,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.choices?.[0]?.message?.content;
  if (content) {
    return content.replace(/^```(?:markdown)?\n([\s\S]*)\n```\s*$/, '$1').trim();
  }

  throw new Error('No summary generated');
}
