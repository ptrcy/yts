// Vercel Function: Remove a video from a YouTube playlist by videoId
// Requires OAuth credentials with YouTube Data API scope (youtube.force-ssl).
// Environment variables:
// - YT_CLIENT_ID
// - YT_CLIENT_SECRET
// - YT_REFRESH_TOKEN (refresh token with playlist modify permissions)

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PLAYLIST_ITEMS_URL = "https://www.googleapis.com/youtube/v3/playlistItems";
const DELETE_URL = "https://www.googleapis.com/youtube/v3/playlistItems";

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

async function exchangeRefreshToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetchWithRetry(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  }, 3, 'OAuth/token');

  if (!res.ok) {
    const detail = await res.text();
    const error = new Error(`Failed to refresh token: ${detail}`);
    error.statusCode = res.status;
    throw error;
  }

  const data = await res.json();
  if (!data.access_token) {
    const error = new Error("No access_token in response");
    error.statusCode = 500;
    throw error;
  }
  return data.access_token;
}

async function findPlaylistItemId({ playlistId, videoId, accessToken }) {
  let pageToken = null;

  while (true) {
    const url = new URL(PLAYLIST_ITEMS_URL);
    url.searchParams.set("part", "id,snippet");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetchWithRetry(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    }, 3, `YouTube/playlistItems[${playlistId}]`);

    if (!res.ok) {
      const detail = await res.text();
      const error = new Error(`Failed to fetch playlist items: ${detail}`);
      error.statusCode = res.status;
      throw error;
    }

    const data = await res.json();
    const match = (data.items || []).find(
      (item) => item?.snippet?.resourceId?.videoId === videoId
    );
    if (match) return match.id;

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return null;
}

async function deletePlaylistItem({ playlistItemId, accessToken }) {
  const url = new URL(DELETE_URL);
  url.searchParams.set("id", playlistItemId);

  const res = await fetchWithRetry(url.toString(), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  }, 3, `YouTube/delete[${playlistItemId}]`);

  if (!res.ok) {
    const detail = await res.text();
    const error = new Error(`Failed to delete playlist item: ${detail}`);
    error.statusCode = res.status;
    throw error;
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

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const videoId = req.body?.videoId || req.body?.video_id;
  const playlistId = req.body?.playlistId || req.body?.playlist_id;

  if (!videoId) return res.status(400).json({ error: "Missing videoId" });
  if (!playlistId) return res.status(400).json({ error: "Missing playlistId" });

  const clientId = process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_CLIENT_SECRET;
  const refreshToken = process.env.YT_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(500).json({ error: "Server missing YouTube OAuth env vars" });
  }

  try {
    const accessToken = await exchangeRefreshToken({ clientId, clientSecret, refreshToken });
    const playlistItemId = await findPlaylistItemId({ playlistId, videoId, accessToken });

    if (!playlistItemId) {
      return res.status(404).json({ error: "Video not found in playlist" });
    }

    await deletePlaylistItem({ playlistItemId, accessToken });

    return res.status(200).json({ success: true, playlistItemId });
  } catch (error) {
    console.error("delete-video error", error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Unexpected error" });
  }
}
