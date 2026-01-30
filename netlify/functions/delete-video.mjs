// Netlify Function: Remove a video from a YouTube playlist by videoId
// Requires OAuth credentials with YouTube Data API scope (youtube.force-ssl).
// Environment variables:
// - YT_CLIENT_ID
// - YT_CLIENT_SECRET
// - YT_REFRESH_TOKEN (refresh token with playlist modify permissions)

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PLAYLIST_ITEMS_URL = "https://www.googleapis.com/youtube/v3/playlistItems";
const DELETE_URL = "https://www.googleapis.com/youtube/v3/playlistItems";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return respond(405, { error: "Method not allowed" });
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return respond(400, { error: "Invalid JSON body" });
  }

  const videoId = payload.videoId || payload.video_id;
  const playlistId = payload.playlistId || payload.playlist_id;

  if (!videoId) return respond(400, { error: "Missing videoId" });
  if (!playlistId) return respond(400, { error: "Missing playlistId" });

  const clientId = process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_CLIENT_SECRET;
  const refreshToken = process.env.YT_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return respond(500, { error: "Server missing YouTube OAuth env vars" });
  }

  try {
    const accessToken = await exchangeRefreshToken({ clientId, clientSecret, refreshToken });
    const playlistItemId = await findPlaylistItemId({ playlistId, videoId, accessToken });

    if (!playlistItemId) {
      return respond(404, { error: "Video not found in playlist" });
    }

    await deletePlaylistItem({ playlistItemId, accessToken });

    return respond(200, { success: true, playlistItemId });
  } catch (error) {
    console.error("delete-video error", error);
    return respond(error.statusCode || 500, { error: error.message || "Unexpected error" });
  }
}

async function exchangeRefreshToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

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

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

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

  const res = await fetch(url.toString(), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const detail = await res.text();
    const error = new Error(`Failed to delete playlist item: ${detail}`);
    error.statusCode = res.status;
    throw error;
  }
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}
