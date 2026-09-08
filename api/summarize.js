// Vercel serverless function for Playlist & Video Summarizer
import {
  fetchTranscript,
  getPlaylistTitle,
  getRecentVideos,
  parseUrlList,
  resolveVideoMetadata,
  summarizeTranscript,
} from '../lib/summarize.js';

const DEFAULT_HOURS_BACK = 24 * 7; // 7 days
const MAX_HOURS_BACK = 24 * 90; // cap look-back at 90 days
const MAX_LINKS_PER_REQUEST = 100;

// Set CORS headers
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Main handler
export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action } = req.body || {};

    // ACTION: LIST - Get playlist videos from YouTube Data API
    if (action === 'list') {
      const { playlistId, hoursBack, youtubeApiKey } = req.body || {};

      if (!playlistId || !youtubeApiKey) {
        return res.status(400).json({ error: 'Missing playlistId or youtubeApiKey' });
      }

      const parsedHours = Number(hoursBack);
      const hours =
        Number.isInteger(parsedHours) && parsedHours > 0
          ? Math.min(parsedHours, MAX_HOURS_BACK)
          : DEFAULT_HOURS_BACK;

      const [playlistTitle, videos] = await Promise.all([
        getPlaylistTitle(playlistId, youtubeApiKey),
        getRecentVideos(playlistId, youtubeApiKey, hours),
      ]);

      return res.status(200).json({ playlistTitle, videos });
    }

    // ACTION: PARSE-LINKS - Parse and validate arbitrary video URLs (YouTube, Reels, TikTok, FB, etc.)
    if (action === 'parse-links') {
      const { links } = req.body || {};
      if (!links) {
        return res.status(400).json({ error: 'Missing links parameter' });
      }

      const videos = parseUrlList(links).slice(0, MAX_LINKS_PER_REQUEST);
      return res.status(200).json({ videos, count: videos.length });
    }

    // ACTION: PROCESS - Process a single video (works with playlist item or multi-platform URL)
    if (action === 'process') {
      const { video, openaiApiKey, openaiBaseUrl, openaiModel, transcriptApiKey } = req.body || {};

      if (!video || !openaiApiKey || !transcriptApiKey) {
        return res.status(400).json({ error: 'Missing video, openaiApiKey, or transcriptApiKey' });
      }

      let resolvedVideo = video;
      try {
        // Resolve complete metadata (fetches Supadata metadata if needed, or falls back gracefully)
        resolvedVideo = await resolveVideoMetadata(video, transcriptApiKey);

        const targetUrlOrId = resolvedVideo.url || resolvedVideo.videoId;
        if (!targetUrlOrId) {
          throw new Error('No valid URL or videoId provided');
        }

        const { text: transcript, language, source: transcriptSource } = await fetchTranscript(
          targetUrlOrId,
          transcriptApiKey
        );

        if (!transcript || !transcript.trim()) {
          throw new Error('Empty transcript received');
        }

        const summary = await summarizeTranscript(
          transcript,
          resolvedVideo.title,
          openaiApiKey,
          openaiBaseUrl,
          openaiModel,
          language,
          resolvedVideo.platform
        );

        return res.status(200).json({
          ...resolvedVideo,
          summary,
          language,
          transcriptSource,
          status: 'success',
        });
      } catch (err) {
        const rawMsg = err?.message || 'Unknown error';
        console.error(`[Process] Failed for video ${resolvedVideo?.videoId || resolvedVideo?.url} "${resolvedVideo?.title}":`, rawMsg);

        let limitType = null;
        if (/supadata/i.test(rawMsg) && /limit|quota|credits/i.test(rawMsg)) {
          limitType = 'supadata';
        } else if (/(?:openai|custom ai)/i.test(rawMsg) && /limit|quota/i.test(rawMsg)) {
          limitType = 'openai';
        } else if (/youtube/i.test(rawMsg) && /limit|quota/i.test(rawMsg)) {
          limitType = 'youtube';
        } else if (/limit[ -]?exceeded|quota|rate[ -]?limit/i.test(rawMsg)) {
          limitType = 'rate_limit';
        }

        return res.status(200).json({
          ...resolvedVideo,
          summary: `Error: ${rawMsg}`,
          status: 'failed',
          limitType,
        });
      }
    }

    return res.status(400).json({ error: 'Invalid action. Use "list", "parse-links", or "process".' });

  } catch (error) {
    console.error('Error in summarize API:', error);
    return res.status(500).json({ error: error?.message || 'Internal server error' });
  }
}
