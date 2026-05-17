// Vercel Function: Save/load named settings profiles for cross-device sync.
// Storage: Vercel Blob (persistent, private).
// Requires BLOB_READ_WRITE_TOKEN — add "Vercel Blob" to your project in the
// Vercel dashboard (choose Private when asked) to get this env var automatically.
// Set YPS_SETTINGS_PASSWORD to require a password for all operations.
//
// Blob pathnames are SHA-256(password:name) so profiles are isolated per password.

import { createHash } from 'crypto';
import { put, get } from '@vercel/blob';

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

function sanitizeName(name) {
  return (name || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
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
  const safeName = sanitizeName(name);

  if (!safeName) return res.status(400).json({ error: 'Invalid or missing name' });
  if (!checkAuth(password)) return res.status(401).json({ error: 'Invalid password' });

  const pathname = getBlobPathname(safeName, password);

  if (action === 'save') {
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Missing settings object' });
    }
    await put(pathname, JSON.stringify(settings), {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'application/json',
    });
    return res.status(200).json({ success: true });
  }

  if (action === 'load') {
    try {
      const blob = await get(pathname, { access: 'private' });
      if (!blob) return res.status(404).json({ error: 'Profile not found' });
      const data = await blob.json();
      return res.status(200).json({ settings: data });
    } catch (e) {
      if (e.name === 'BlobNotFoundError') return res.status(404).json({ error: 'Profile not found' });
      throw e;
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
