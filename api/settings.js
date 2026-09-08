// Vercel Function: Save/load named settings profiles for cross-device sync.
// Storage: Vercel Blob (persistent, private).
// Requires BLOB_READ_WRITE_TOKEN — add "Vercel Blob" to your project in the
// Vercel dashboard (choose Private when asked) to get this env var automatically.
// Set YPS_SETTINGS_PASSWORD to require a password for all operations.
//
// Blob pathnames are SHA-256(password:name) so profiles are isolated per password.

import { createHash } from 'crypto';
import { put, list } from '@vercel/blob';

const BLOB_PREFIX = 'yps-settings/';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function checkAuth(password) {
  const serverPassword = process.env.YPS_SETTINGS_PASSWORD;
  if (!serverPassword) return true;
  return password === serverPassword;
}

// Only accept names that are already canonical. Silently stripping characters
// would let distinct names (e.g. "my profile" / "my_profile") collapse onto the
// same blob pathname and overwrite each other.
function isValidName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(name);
}

function getBlobPathname(name, password) {
  const hash = createHash('sha256').update(`${password || ''}:${name}`).digest('hex');
  return `${BLOB_PREFIX}${hash}.json`;
}

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'Blob storage not configured — add BLOB_READ_WRITE_TOKEN env var' });
  }

  const { action, name, password, settings } = req.body || {};

  if (!isValidName(name)) {
    return res.status(400).json({
      error: 'Name must be 1-64 characters, letters/numbers/hyphens/underscores only',
    });
  }
  if (!checkAuth(password)) return res.status(401).json({ error: 'Invalid password' });

  const pathname = getBlobPathname(name, password);

  if (action === 'save') {
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Missing settings object' });
    }
    try {
      await put(pathname, JSON.stringify(settings), {
        access: 'private',
        addRandomSuffix: false,
        contentType: 'application/json',
      });
    } catch (err) {
      console.error('[settings] Failed to store profile', err);
      return res.status(500).json({ error: 'Failed to store settings profile' });
    }
    return res.status(200).json({ success: true });
  }

  if (action === 'load') {
    try {
      const { blobs } = await list({ prefix: pathname });
      const match = blobs.find(b => b.pathname === pathname);
      if (!match) return res.status(404).json({ error: 'Profile not found' });

      const blobRes = await fetch(match.url, {
        headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
      });
      if (!blobRes.ok) return res.status(500).json({ error: 'Failed to read stored settings' });
      const data = await blobRes.json();
      return res.status(200).json({ settings: data });
    } catch (err) {
      console.error('[settings] Failed to read profile', err);
      return res.status(500).json({ error: 'Failed to read settings profile' });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
