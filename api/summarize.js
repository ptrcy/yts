// Vercel serverless function for YouTube Playlist Summarizer
import {
  fetchTranscript,
  getPlaylistTitle,
  getRecentVideos,
  summarizeTranscript,
} from '../lib/transcript.js';

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

    // ACTION: LIST - Get playlist videos (fast)
    if (action === 'list') {
      const { playlistId, hoursBack, youtubeApiKey } = req.body || {};

      if (!playlistId || !youtubeApiKey) {
        return res.status(400).json({ error: 'Missing playlistId or youtubeApiKey' });
      }

      const parsedHours = Number(hoursBack);
      const hours = Number.isInteger(parsedHours) && parsedHours > 0 ? parsedHours : 168;

      const playlistTitle = await getPlaylistTitle(playlistId, youtubeApiKey);
      const videos = await getRecentVideos(playlistId, youtubeApiKey, hours);

      return res.status(200).json({ playlistTitle, videos });
    }

    // ACTION: PROCESS - Process a single video
    if (action === 'process') {
      const { video, openaiApiKey, openaiBaseUrl, openaiModel, transcriptApiKey } = req.body || {};

      if (!video || !openaiApiKey || !transcriptApiKey) {
        return res.status(400).json({ error: 'Missing video, openaiApiKey, or transcriptApiKey' });
      }

      try {
        const { text: transcript, language, source: transcriptSource } = await fetchTranscript(video.videoId, transcriptApiKey);
        const summary = await summarizeTranscript(transcript, video.title, openaiApiKey, openaiBaseUrl, openaiModel, language);

        return res.status(200).json({ ...video, summary, language, transcriptSource, status: 'success' });
      } catch (err) {
        console.error(`[Process] Failed for video ${video?.videoId} "${video?.title}":`, err?.message || err);
        return res.status(200).json({
          ...video,
          summary: `Error: ${err?.message || 'Unknown error'}`,
          status: 'failed',
        });
      }
    }

    return res.status(400).json({ error: 'Invalid action. Use "list" or "process".' });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error?.message || 'Internal server error' });
  }
}
