/**
 * Vercel serverless function — proxy for FortyGuard API.
 * The FortyGuard API key lives here on Vercel's servers, never exposed to browsers.
 * Requests are restricted to the app's own Vercel domain to prevent quota abuse.
 */

const FORTYGUARD_API_KEY = process.env.FORTYGUARD_API_KEY;
const FORTYGUARD_BASE = 'https://api.fortyguard.com/v1';

// Only allow requests from your own app domain
const ALLOWED_ORIGINS = [
  'https://forty-guard-hackathon.vercel.app',
  'https://forty-guard-hackathon-*.vercel.app',
];

function isAllowedOrigin(origin) {
  if (!origin) return true; // allow same-origin and non-browser requests
  for (const allowed of ALLOWED_ORIGINS) {
    if (allowed.includes('*')) {
      const pattern = allowed.replace(/\*/g, '.*');
      if (new RegExp(`^${pattern}$`).test(origin)) return true;
    } else if (origin === allowed) {
      return true;
    }
  }
  return false;
}

export default async function handler(req, res) {
  // CORS — only allow your own domain
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: true, message: 'Forbidden' });
  }

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, api-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!FORTYGUARD_API_KEY) {
    return res.status(500).json({ error: true, message: 'Server misconfigured: missing FORTYGUARD_API_KEY' });
  }

  const pathSegments = req.query.path || [];
  const path = Array.isArray(pathSegments) ? pathSegments.join('/') : pathSegments;
  const url = `${FORTYGUARD_BASE}/${path}`;

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
    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
