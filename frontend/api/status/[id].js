/**
 * Vercel serverless function — GET /api/status/:id
 * Proxies to FortyGuard status endpoint with the API key.
 */

const FORTYGUARD_API_KEY = process.env.FORTYGUARD_API_KEY;
const FORTYGUARD_BASE = 'https://api.fortyguard.com/v1';

const ALLOWED_ORIGINS = [
  'https://forty-guard-hackathon.vercel.app',
  'https://forty-guard-hackathon-*.vercel.app',
];

function isAllowedOrigin(origin) {
  if (!origin) return true;
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
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: true, message: 'Forbidden' });
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Method not allowed' });
  if (!FORTYGUARD_API_KEY) return res.status(500).json({ error: true, message: 'Server misconfigured' });

  const activityId = req.query.id;
  if (!activityId) return res.status(400).json({ error: true, message: 'Missing activity id' });

  try {
    const response = await fetch(`${FORTYGUARD_BASE}/status/${activityId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'api-key': FORTYGUARD_API_KEY },
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
