/**
 * Vercel serverless function — POST /api/heatmap
 * Proxies to FortyGuard heatmap endpoint with the API key.
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
  if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'Method not allowed' });
  if (!FORTYGUARD_API_KEY) return res.status(500).json({ error: true, message: 'Server misconfigured' });

  const maskedKey = FORTYGUARD_API_KEY.slice(0, 4) + '...' + FORTYGUARD_API_KEY.slice(-4);
  console.log(`[proxy/heatmap] Forwarding to FortyGuard with key: ${maskedKey}`);
  console.log(`[proxy/heatmap] Request body: ${JSON.stringify(req.body).slice(0, 500)}`);

  try {
    const response = await fetch(`${FORTYGUARD_BASE}/heatmap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': FORTYGUARD_API_KEY },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    console.log(`[proxy/heatmap] Status: ${response.status}`, JSON.stringify(data));
    return res.status(response.status).json(data);
  } catch (err) {
    console.error('[proxy/heatmap] Error:', err);
    return res.status(500).json({ error: true, message: err.message });
  }
}
