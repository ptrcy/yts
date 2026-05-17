// Netlify Function: Save/load named settings profiles for cross-device sync.
// Storage: Netlify Blobs (persistent across invocations).
// Set YPS_SETTINGS_PASSWORD env var to require a password for all operations.

import { getStore } from '@netlify/blobs';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function checkAuth(password) {
  const serverPassword = process.env.YPS_SETTINGS_PASSWORD;
  if (!serverPassword) return true;
  return password === serverPassword;
}

function sanitizeName(name) {
  return (name || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { action, name, password, settings } = body;
  const safeName = sanitizeName(name);

  if (!safeName) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid or missing name' }) };
  if (!checkAuth(password)) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid password' }) };

  const store = getStore('yps-settings');

  if (action === 'save') {
    if (!settings || typeof settings !== 'object') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing settings object' }) };
    }
    await store.setJSON(safeName, settings);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  if (action === 'load') {
    const data = await store.get(safeName, { type: 'json' });
    if (data === null) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Profile not found' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ settings: data }) };
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
}
