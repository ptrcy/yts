// Vercel serverless function for YouTube Playlist Summarizer
// Uses YouTube Data API, TranscriptAPI for transcripts, and Vercel AI SDK with Google Gemini for summaries

import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const VERCEL_API_BASE = 'https://api.vercel.ai/v1';

// Safe JSON parser with detailed error logging
async function safeParseJson(response, context) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    const preview = text.substring(0, 200);
    console.error(`[${context}] JSON parse failed - Status: ${response.status}, Preview: ${preview}`);
    throw new Error(`${context}: Invalid JSON response (status ${response.status}) - ${preview}`);
  }
}

// Retry logic for fetch requests
async function fetchWithRetry(url, options, maxRetries = 3, context = '') {
  const retryable = new Set([408, 429, 503]);

  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url, options);

    if (!retryable.has(res.status)) return res;

    // 429 may include Retry-After; otherwise exponential backoff
    const ra = res.headers.get("Retry-After");
    const delaySec = ra ? Number(ra) : Math.pow(2, i); // 1,2,4...
    const delayMs = Math.min(5, delaySec) * 1000;
    console.warn(`[${context || 'Fetch'}] Retryable status ${res.status}, attempt ${i + 1}/${maxRetries}, waiting ${delayMs}ms`);
    await new Promise(r => setTimeout(r, delayMs));
  }

  console.error(`[${context || 'Fetch'}] Max retries (${maxRetries}) exceeded`);
  throw new Error(`${context ? context + ': ' : ''}Max retries exceeded`);
}

// Fetch transcript using TranscriptAPI
async function fetchTranscript(videoId, transcriptApiKey) {
  const params = new URLSearchParams({
    video_url: videoId,
    format: 'text',
    include_timestamp: 'false',
    send_metadata: 'true'
  });

  const response = await fetchWithRetry(
    `https://transcriptapi.com/api/v2/youtube/transcript?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${transcriptApiKey}`
      }
    },
    3,
    `TranscriptAPI[${videoId}]`
  );

  const data = await safeParseJson(response, `TranscriptAPI[${videoId}]`);

  if (!response.ok) {
    console.error(`[TranscriptAPI] Error for ${videoId}:`, data);
    throw new Error(data.message || `Transcript API error: ${response.status}`);
  }

  if (data.transcript) {
    return {
      text: data.transcript,
      language: data.language || null
    };
  }

  console.error(`[TranscriptAPI] No transcript in response for ${videoId}:`, data);
  throw new Error('No transcript available');
}

// Fetch playlist info
async function getPlaylistTitle(playlistId, apiKey) {
  const url = `${YOUTUBE_API_BASE}/playlists?part=snippet&id=${playlistId}&key=${apiKey}`;
  const response = await fetchWithRetry(url, {}, 3, `YouTube/playlists[${playlistId}]`);
  const data = await safeParseJson(response, `YouTube/playlists[${playlistId}]`);

  if (!response.ok) {
    console.error(`[YouTube/playlists] Error for ${playlistId}:`, data);
    throw new Error(data.error?.message || 'Failed to fetch playlist info');
  }

  return data.items?.[0]?.snippet?.title || 'Unknown Playlist';
}

// Fetch recent videos from playlist
async function getRecentVideos(playlistId, apiKey, hoursBack) {
  const cutoffDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const videos = [];
  let nextPageToken = null;

  do {
    const url = new URL(`${YOUTUBE_API_BASE}/playlistItems`);
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('key', apiKey);
    if (nextPageToken) {
      url.searchParams.set('pageToken', nextPageToken);
    }

    const response = await fetchWithRetry(url.toString(), {}, 3, `YouTube/playlistItems[${playlistId}]`);
    const data = await safeParseJson(response, `YouTube/playlistItems[${playlistId}]`);

    if (!response.ok) {
      console.error(`[YouTube/playlistItems] Error for ${playlistId}:`, data);
      throw new Error(data.error?.message || 'Failed to fetch playlist items');
    }

    for (const item of data.items || []) {
      const publishedAt = new Date(item.snippet.publishedAt);

      if (publishedAt >= cutoffDate) {
        videos.push({
          videoId: item.contentDetails.videoId,
          title: item.snippet.title,
          channel: item.snippet.channelTitle,
          publishedAt: item.snippet.publishedAt
        });
      }
    }

    nextPageToken = data.nextPageToken;

    // Stop if we've gone past the cutoff date
    if (data.items && data.items.length > 0) {
      const lastDate = new Date(data.items[data.items.length - 1].snippet.publishedAt);
      if (lastDate < cutoffDate) {
        break;
      }
    }
  } while (nextPageToken && videos.length < 50);

  return videos;
}

// Languages that should keep their original language in summaries
const NATIVE_LANGUAGE_NAMES = {
  fr: 'French',
  es: 'Spanish',
  ar: 'Arabic'
};

// Summarize transcript using Vercel AI SDK with Google Gemini
async function summarizeTranscript(transcript, title, claudeApiKey, claudeBaseUrl, language) {
  // Use Vercel API key from environment, fall back to claudeApiKey for compatibility
  const vercelApiKey = process.env.VERCEL_API_KEY || claudeApiKey;

  const nativeLang = NATIVE_LANGUAGE_NAMES[language];
  const langInstruction = nativeLang
    ? `IMPORTANT: Write your entire summary in ${nativeLang}. Do NOT translate to English.`
    : '';

  const prompt = `${langInstruction}

Please provide a comprehensive summary of this YouTube video transcript in Markdown format.
Focus on the main points, key takeaways, and important details.
Use bullet points, headers, and formatting to make the summary easy to read.

Video Title: ${title}

Transcript:
${transcript.substring(0, 70000)}`;

  // Create Vercel OpenAI-compatible client for Google models
  const vercel = createOpenAI({
    baseURL: VERCEL_API_BASE,
    apiKey: vercelApiKey,
  });

  try {
    const { text } = await generateText({
      model: vercel('google/gemini-3-flash'),
      maxTokens: 2000,
      prompt: prompt,
    });

    return text;
  } catch (error) {
    console.error(`[Vercel AI] Error for "${title}":`, error);
    throw new Error(error.message || 'Failed to generate summary');
  }
}

// Set CORS headers
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Main handler
export default async function handler(req, res) {
  setCorsHeaders(res);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action } = req.body;

    // ACTION: LIST - Get playlist videos (fast)
    if (action === 'list') {
      const { playlistId, hoursBack, youtubeApiKey } = req.body;

      if (!playlistId || !youtubeApiKey) {
        return res.status(400).json({ error: 'Missing playlistId or youtubeApiKey' });
      }

      const hours = parseInt(hoursBack) || 168;
      const playlistTitle = await getPlaylistTitle(playlistId, youtubeApiKey);
      const videos = await getRecentVideos(playlistId, youtubeApiKey, hours);

      return res.status(200).json({ playlistTitle, videos });
    }

    // ACTION: PROCESS - Process a single video
    if (action === 'process') {
      const { video, claudeApiKey, claudeBaseUrl, transcriptApiKey } = req.body;

      if (!video || !claudeApiKey || !transcriptApiKey) {
        return res.status(400).json({ error: 'Missing video, claudeApiKey, or transcriptApiKey' });
      }

      try {
        const { text: transcript, language } = await fetchTranscript(video.videoId, transcriptApiKey);
        const summary = await summarizeTranscript(transcript, video.title, claudeApiKey, claudeBaseUrl, language);

        return res.status(200).json({
          ...video,
          summary,
          language,
          status: 'success'
        });
      } catch (err) {
        console.error(`[Process] Failed for video ${video.videoId} "${video.title}":`, err.message);
        return res.status(200).json({
          ...video,
          summary: `Error: ${err.message}`,
          status: 'failed'
        });
      }
    }

    return res.status(400).json({ error: 'Invalid action. Use "list" or "process".' });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
