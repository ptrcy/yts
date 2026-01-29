// Netlify serverless function for YouTube Playlist Summarizer
// Uses YouTube Data API, TranscriptAPI for transcripts, and Claude API for summaries

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const DEFAULT_CLAUDE_BASE_URL = 'https://api.anthropic.com';

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// Fetch transcript using TranscriptAPI
async function fetchTranscript(videoId, transcriptApiKey) {
  const params = new URLSearchParams({
    video_url: videoId,
    format: 'text',
    include_timestamp: 'false',
    send_metadata: 'true'
  });

  const response = await fetch(
    `https://transcriptapi.com/api/v2/youtube/transcript?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${transcriptApiKey}`
      }
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || `Transcript API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.transcript) {
    return data.transcript;
  }

  throw new Error('No transcript available');
}

// Fetch playlist info
async function getPlaylistTitle(playlistId, apiKey) {
  const url = `${YOUTUBE_API_BASE}/playlists?part=snippet&id=${playlistId}&key=${apiKey}`;
  const response = await fetch(url);

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to fetch playlist info');
  }

  const data = await response.json();
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

    const response = await fetch(url.toString());

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to fetch playlist items');
    }

    const data = await response.json();

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

// Summarize transcript using Claude
async function summarizeTranscript(transcript, title, claudeApiKey, claudeBaseUrl) {
  const baseUrl = claudeBaseUrl || DEFAULT_CLAUDE_BASE_URL;

  const prompt = `Please provide a comprehensive summary of this YouTube video transcript in Markdown format.
Focus on the main points, key takeaways, and important details.
Use bullet points, headers, and formatting to make the summary easy to read.

Language instructions: If the transcript is in French, Spanish, or Arabic, write the summary in that same language. Otherwise, write the summary in English.

Video Title: ${title}

Transcript:
${transcript.substring(0, 70000)}`;

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to generate summary');
  }

  const data = await response.json();

  for (const block of data.content || []) {
    if (block.type === 'text') {
      return block.text;
    }
  }

  throw new Error('No summary generated');
}

// Main handler
export async function handler(event) {
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
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
          body: JSON.stringify({ error: 'Missing playlistId or youtubeApiKey' })
        };
      }

      const hours = parseInt(hoursBack) || 168;
      const playlistTitle = await getPlaylistTitle(playlistId, youtubeApiKey);
      const videos = await getRecentVideos(playlistId, youtubeApiKey, hours);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ playlistTitle, videos })
      };
    }

    // ACTION: PROCESS - Process a single video
    if (action === 'process') {
      const { video, claudeApiKey, claudeBaseUrl, transcriptApiKey } = body;

      if (!video || !claudeApiKey || !transcriptApiKey) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing video, claudeApiKey, or transcriptApiKey' })
        };
      }

      try {
        const transcript = await fetchTranscript(video.videoId, transcriptApiKey);
        const summary = await summarizeTranscript(transcript, video.title, claudeApiKey, claudeBaseUrl);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            ...video,
            summary,
            status: 'success'
          })
        };
      } catch (err) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            ...video,
            summary: `Error: ${err.message}`,
            status: 'failed'
          })
        };
      }
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid action. Use "list" or "process".' })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal server error' })
    };
  }
}
