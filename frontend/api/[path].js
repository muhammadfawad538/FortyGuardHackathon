/**
 * Vercel serverless function — proxy for FortyGuard API.
 * Use: /api/proxy/heatmap, /api/proxy/status/xxx, etc.
 * Eliminates CORS by making the request server-side.
 */

const FORTYGUARD_API_KEY = '4536cc0c45783b70c235fb81050e8718';
const FORTYGUARD_BASE = 'https://api.fortyguard.com/v1';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, api-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Build the target URL from the path segments
  const pathSegments = req.query.path || [];
  const path = Array.isArray(pathSegments) ? pathSegments.join('/') : pathSegments;
  const url = `${FORTYGUARD_BASE}/${path}${req.query.s ? '?' + new URLSearchParams(req.query).toString() : ''}`;

  try {
    const headers = {
      'Content-Type': 'application/json',
      'api-key': FORTYGUARD_API_KEY,
    };

    const fetchOptions = {
      method: req.method,
      headers,
    };

    if (req.method === 'POST' && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(url, fetchOptions);

    // Forward the response
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
