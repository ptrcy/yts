// Shared business logic for YouTube Playlist Summarizer
// Used by both api/summarize.js (Vercel) and netlify/functions/summarize.mjs (Netlify)

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

// Fetch transcript using Supadata (handles both immediate and async job responses)
export async function fetchTranscriptFromSupadata(videoId, transcriptApiKey) {
  const supadataHeaders = { 'x-api-key': transcriptApiKey };
  const params = new URLSearchParams({
    url: `https://www.youtube.com/watch?v=${videoId}`,
    text: 'true',
  });

  const response = await fetchWithRetry(
    `https://api.supadata.ai/v1/transcript?${params.toString()}`,
    { headers: supadataHeaders },
    3,
    `Supadata[${videoId}]`
  );

  const data = await safeParseJson(response, `Supadata[${videoId}]`);

  if (!response.ok) {
    console.error(`[Supadata] Error for ${videoId}:`, data);
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
    console.error(`[Supadata] No content or jobId in response for ${videoId}:`, data);
    throw new Error('No transcript available');
  }

  const MAX_POLLS = 30;
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

// Fetch transcript using YouTranscripts (fallback)
export async function fetchTranscriptFromYouTranscripts(videoId) {
  const response = await fetchWithRetry(
    'https://www.youtranscripts.com/api/transcript/',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      },
      body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` }),
    },
    3,
    `YouTranscripts[${videoId}]`
  );

  const data = await safeParseJson(response, `YouTranscripts[${videoId}]`);

  console.log(`[YouTranscripts] ${videoId} — status: ${response.status}, keys: ${data ? Object.keys(data).join(', ') : 'null'}`);

  if (!response.ok) {
    console.error(`[YouTranscripts] Error for ${videoId}:`, JSON.stringify(data));
    throw new Error(data?.message || `YouTranscripts error: ${response.status}`);
  }

  const segments = data?.transcript;
  console.log(`[YouTranscripts] ${videoId} — transcript type: ${typeof segments}, isArray: ${Array.isArray(segments)}, length: ${segments?.length ?? 'n/a'}`);

  if (!segments?.length) {
    console.error(`[YouTranscripts] ${videoId} — full response:`, JSON.stringify(data));
    throw new Error(`YouTranscripts: no transcript for ${videoId}`);
  }

  const text = segments.map(seg => seg.text).join('\n').trim();
  if (!text) {
    throw new Error(`YouTranscripts: empty transcript for ${videoId}`);
  }

  return { text, language: null, source: 'youtranscripts' };
}

// Fetch transcript: try YouTranscripts first (free), fall back to Supadata
export async function fetchTranscript(videoId, transcriptApiKey) {
  try {
    return await fetchTranscriptFromYouTranscripts(videoId);
  } catch (err) {
    console.warn(`[Transcript] YouTranscripts failed for ${videoId} (${err.message}), trying Supadata...`);
  }

  return await fetchTranscriptFromSupadata(videoId, transcriptApiKey);
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
          title,
          channel: item.snippet.channelTitle,
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
export async function summarizeTranscript(transcript, title, openaiApiKey, openaiBaseUrl, model, language) {
  const client = new OpenAI({
    apiKey: openaiApiKey,
    ...(openaiBaseUrl ? { baseURL: openaiBaseUrl } : {}),
  });

  const resolvedModel = model || DEFAULT_OPENAI_MODEL;

  const nativeLang = NATIVE_LANGUAGE_NAMES[language];
  const langInstruction = nativeLang
    ? `IMPORTANT: Write your entire summary in ${nativeLang}. Do NOT translate to English.`
    : '';

  const prompt = `${langInstruction}

Please summarize this YouTube video transcript in Markdown format.
Start with a short executive summary (3-5 sentences capturing the essence).
Then provide a more detailed summary with the main points, key takeaways, and important details.
Use bullet points, headers, and formatting to make the summary easy to read.

Video Title: ${title}

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
