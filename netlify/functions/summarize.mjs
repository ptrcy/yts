// Netlify serverless function for YouTube Playlist Summarizer
import {
  fetchTranscript,
  getPlaylistTitle,
  getRecentVideos,
  summarizeTranscript,
} from '../../lib/summarize.js';

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

// Main handler
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { action } = body;

    // ACTION: LIST - Get playlist videos (fast)
    if (action === 'list') {
      const { playlistId, hoursBack, youtubeApiKey } = body;

      if (!playlistId || !youtubeApiKey) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing playlistId or youtubeApiKey' }),
        };
      }

      const parsedHours = Number(hoursBack);
      const hours = Number.isInteger(parsedHours) && parsedHours > 0 ? parsedHours : 168;
      const playlistTitle = await getPlaylistTitle(playlistId, youtubeApiKey);
      const videos = await getRecentVideos(playlistId, youtubeApiKey, hours);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ playlistTitle, videos }),
      };
    }

    // ACTION: PROCESS - Process a single video
    if (action === 'process') {
      const { video, openaiApiKey, openaiBaseUrl, openaiModel, transcriptApiKey } = body;

      if (!video || !openaiApiKey || !transcriptApiKey) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing video, openaiApiKey, or transcriptApiKey' }),
        };
      }

      try {
        const { text: transcript, language, source: transcriptSource } = await fetchTranscript(video.videoId, transcriptApiKey);
        const summary = await summarizeTranscript(transcript, video.title, openaiApiKey, openaiBaseUrl, openaiModel, language);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ ...video, summary, language, transcriptSource, status: 'success' }),
        };
      } catch (err) {
        console.error(`[Process] Failed for video ${video?.videoId} "${video?.title}":`, err?.message || err);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            ...video,
            summary: `Error: ${err?.message || 'Unknown error'}`,
            status: 'failed',
          }),
        };
      }
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid action. Use "list" or "process".' }),
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error?.message || 'Internal server error' }),
    };
  }
}
