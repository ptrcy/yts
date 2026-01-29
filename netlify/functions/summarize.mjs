// Netlify serverless function for YouTube Playlist Summarizer
// Uses YouTube Data API and Claude API to fetch and summarize videos

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

// Helper to fetch YouTube transcript using innertube API
async function fetchTranscript(videoId) {
  try {
    // First, get the video page to extract necessary tokens
    const videoPageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!videoPageResponse.ok) {
      throw new Error('Failed to fetch video page');
    }

    const html = await videoPageResponse.text();

    // Extract the captions track URL from the page
    const captionTrackMatch = html.match(/"captionTracks":\s*(\[.*?\])/);
    if (!captionTrackMatch) {
      // Try alternative pattern for caption data
      const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
      if (playerResponseMatch) {
        try {
          const playerResponse = JSON.parse(playerResponseMatch[1]);
          const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (captions && captions.length > 0) {
            // Prefer English, then any available
            const track = captions.find(t => t.languageCode?.startsWith('en')) || captions[0];
            const captionUrl = track.baseUrl;

            const captionResponse = await fetch(captionUrl);
            if (captionResponse.ok) {
              const captionXml = await captionResponse.text();
              // Parse XML transcript
              const textMatches = captionXml.matchAll(/<text[^>]*>([^<]*)<\/text>/g);
              const texts = [];
              for (const match of textMatches) {
                const text = match[1]
                  .replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&quot;/g, '"')
                  .replace(/&#39;/g, "'")
                  .replace(/\n/g, ' ')
                  .trim();
                if (text) texts.push(text);
              }
              if (texts.length > 0) {
                return texts.join(' ');
              }
            }
          }
        } catch (e) {
          console.error('Failed to parse player response:', e);
        }
      }
      return null;
    }

    const captionTracks = JSON.parse(captionTrackMatch[1]);
    if (!captionTracks || captionTracks.length === 0) {
      return null;
    }

    // Prefer English transcript
    const englishTrack = captionTracks.find(t => t.languageCode?.startsWith('en'));
    const track = englishTrack || captionTracks[0];
    const captionUrl = track.baseUrl;

    const captionResponse = await fetch(captionUrl);
    if (!captionResponse.ok) {
      return null;
    }

    const captionXml = await captionResponse.text();

    // Parse XML transcript
    const textMatches = captionXml.matchAll(/<text[^>]*>([^<]*)<\/text>/g);
    const texts = [];
    for (const match of textMatches) {
      const text = match[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n/g, ' ')
        .trim();
      if (text) texts.push(text);
    }

    return texts.length > 0 ? texts.join(' ') : null;
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
async function summarizeTranscript(transcript, title, claudeApiKey) {
  const prompt = `Please provide a comprehensive summary of this YouTube video transcript in Markdown format.
Focus on the main points, key takeaways, and important details.
Use bullet points, headers, and formatting to make the summary easy to read.

Video Title: ${title}

Transcript:
${transcript.substring(0, 50000)}`; // Limit transcript length

  const response = await fetch('https://api.anthropic.com/v1/messages', {
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
async function processVideo(video, claudeApiKey) {
  console.log(`Processing: ${video.title}`);

  const transcript = await fetchTranscript(video.videoId);

  if (!transcript) {
    return {
      ...video,
      summary: 'No transcript available for this video.',
      status: 'failed'
    };
  }

  console.log(`  Got transcript (${transcript.length} chars)`);

  try {
    const summary = await summarizeTranscript(transcript, video.title, claudeApiKey);
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
    const { playlistId, hoursBack, youtubeApiKey, claudeApiKey } = JSON.parse(event.body);

    // Validate inputs
    if (!playlistId || !youtubeApiKey || !claudeApiKey) {
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
      const result = await processVideo(video, claudeApiKey);
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
