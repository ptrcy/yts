// Netlify serverless function for YouTube Playlist Summarizer
// Uses YouTube Data API, Supadata API for transcripts, and Claude API for summaries

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const SUPADATA_API_BASE = 'https://api.supadata.ai/v1';
const DEFAULT_CLAUDE_BASE_URL = 'https://api.anthropic.com';

// Fetch transcript using Supadata API
async function fetchTranscript(videoId, supadataApiKey) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    // Request transcript from Supadata (GET request with query params)
    const url = new URL(`${SUPADATA_API_BASE}/transcript`);
    url.searchParams.set('url', videoUrl);
    url.searchParams.set('text', 'true');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-api-key': supadataApiKey
      }
    });

    // Handle async job (HTTP 202)
    if (response.status === 202) {
      const data = await response.json();
      const jobId = data.jobId || data.job_id;

      if (!jobId) {
        console.error(`Supadata returned 202 but no job ID for ${videoId}`);
        return null;
      }

      console.log(`Supadata async job started for ${videoId}: ${jobId}`);

      // Poll for results (max 20 attempts, 5 seconds apart)
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 5000));

        const jobResponse = await fetch(`${SUPADATA_API_BASE}/transcript/${jobId}`, {
          headers: {
            'x-api-key': supadataApiKey
          }
        });

        if (!jobResponse.ok) {
          continue;
        }

        const jobData = await jobResponse.json();

        if (jobData.status === 'completed' || jobData.content) {
          return jobData.content || null;
        }

        if (jobData.status === 'failed') {
          console.error(`Supadata job failed for ${videoId}: ${jobData.error}`);
          return null;
        }
      }

      console.error(`Supadata timeout waiting for transcript: ${videoId}`);
      return null;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Supadata error for ${videoId}: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();

    // Return content directly
    if (data.content) {
      return data.content;
    }

    // Fallback: check for other response formats
    if (typeof data === 'string') {
      return data;
    }

    console.error(`Unexpected Supadata response format for ${videoId}:`, JSON.stringify(data).substring(0, 200));
    return null;

  } catch (error) {
    console.error(`Error fetching transcript for ${videoId}:`, error);
    return null;
  }
}

// Fetch playlist info
async function getPlaylistTitle(playlistId, apiKey) {
  const url = `${YOUTUBE_API_BASE}/playlists?part=snippet&id=${playlistId}&key=${apiKey}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('Failed to fetch playlist info');
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
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to fetch playlist items');
    }

    const data = await response.json();

    for (const item of data.items) {
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
    if (data.items.length > 0) {
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

Video Title: ${title}

Transcript:
${transcript.substring(0, 50000)}`; // Limit transcript length

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
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to generate summary');
  }

  const data = await response.json();

  // Extract text from content blocks
  for (const block of data.content) {
    if (block.type === 'text') {
      return block.text;
    }
  }

  return 'No summary generated';
}

// Process a single video
async function processVideo(video, claudeApiKey, claudeBaseUrl, supadataApiKey) {
  console.log(`Processing: ${video.title}`);

  const transcript = await fetchTranscript(video.videoId, supadataApiKey);

  if (!transcript) {
    return {
      ...video,
      summary: 'No transcript available for this video.',
      status: 'failed'
    };
  }

  console.log(`  Got transcript (${transcript.length} chars)`);

  try {
    const summary = await summarizeTranscript(transcript, video.title, claudeApiKey, claudeBaseUrl);
    console.log(`  Summary generated`);

    return {
      ...video,
      summary,
      status: 'success'
    };
  } catch (error) {
    console.error(`  Error summarizing: ${error.message}`);
    return {
      ...video,
      summary: `Error generating summary: ${error.message}`,
      status: 'failed'
    };
  }
}

// Main handler
export async function handler(event) {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

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
    const {
      playlistId,
      hoursBack,
      youtubeApiKey,
      claudeApiKey,
      claudeBaseUrl,
      supadataApiKey
    } = JSON.parse(event.body);

    // Validate inputs
    if (!playlistId || !youtubeApiKey || !claudeApiKey || !supadataApiKey) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required parameters' })
      };
    }

    const hours = parseInt(hoursBack) || 168;

    console.log(`Fetching playlist: ${playlistId}, hours back: ${hours}`);

    // Get playlist title
    const playlistTitle = await getPlaylistTitle(playlistId, youtubeApiKey);
    console.log(`Playlist: ${playlistTitle}`);

    // Get recent videos
    const videos = await getRecentVideos(playlistId, youtubeApiKey, hours);
    console.log(`Found ${videos.length} recent videos`);

    if (videos.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          playlistTitle,
          videos: [],
          message: 'No recent videos found'
        })
      };
    }

    // Process videos (sequentially to avoid rate limits)
    const results = [];
    for (const video of videos) {
      const result = await processVideo(video, claudeApiKey, claudeBaseUrl, supadataApiKey);
      results.push(result);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        playlistTitle,
        videos: results
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
}
