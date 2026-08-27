/**
 * FortyGuard API client — runs entirely in the browser.
 * No backend needed.
 */

// All requests go through the Vercel serverless proxy (no CORS, no exposed key)
const PROXY_BASE = '/api';

const CACHE_TTL_MS = 60 * 1000;

// Fallback temperatures (Fahrenheit) — shown when API is unreachable
const FALLBACK_TEMPS = {
  '85001': 105.0,
  '85008': 108.0,
  '85015': 112.0,
  '85018': 100.0,
  '85041': 107.0,
};

const TARGET_ZIPS = Object.keys(FALLBACK_TEMPS);

const ZIP_CENTERS = {
  '85001': [-112.0740, 33.4484],
  '85008': [-112.0476, 33.4787],
  '85015': [-112.1449, 33.5117],
  '85018': [-111.9805, 33.5008],
  '85041': [-112.1004, 33.3435],
};

const PHOENIX_POLYGON = [
  [-112.18, 33.30],
  [-111.90, 33.30],
  [-111.90, 33.55],
  [-112.18, 33.55],
  [-112.18, 33.30],
];

let tempCache = {};
let lastHeatmapTime = 0;
const HEATMAP_COOLDOWN = 55 * 1000;
const FETCH_TIMEOUT = 15_000; // 15s timeout for each fetch

function headers() {
  return {
    'Content-Type': 'application/json',
  };
}

// Fetch with timeout using AbortController
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function pointInPolygon(point, polygon) {
  const [x, y] = point;
  const n = polygon.length;
  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

function cToF(c) {
  return Math.round(c * 9 / 5 + 32);
}

async function submitHeatmap() {
  const payload = {
    polygon_aoi: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [PHOENIX_POLYGON],
        },
      }],
    },
    date_time: {
      start_date: new Date().toISOString().slice(0, 10),
      start_time: '14:00',
      filter_type: 1,
    },
    granularity: 100,
  };

  const resp = await fetchWithTimeout(
    `${PROXY_BASE}/heatmap`,
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(payload),
    }
  );

  if (!resp.ok) {
    throw new Error(`Heatmap submit failed: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const activityId = data?.data?.activity_id;
  if (activityId) {
    console.log('Heatmap submitted, activity_id:', activityId);
    return activityId;
  }
  throw new Error('No activity_id in response: ' + JSON.stringify(data));
}

async function pollHeatmap(activityId) {
  const url = `${PROXY_BASE}/status/${activityId}`;

  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const resp = await fetchWithTimeout(url, { headers: headers() }, 10_000);
      if (!resp.ok) {
        throw new Error(`Status poll failed: HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const status = data?.data?.status?.toLowerCase();

      if (status === 'completed' || status === 'succeeded') {
        console.log('Heatmap completed after', attempt + 1, 'polls');
        return data.data.result || data.data;
      }
      if (status === 'failed' || status === 'error') {
        console.error('Heatmap task failed:', data);
        return null;
      }
      console.log(`Heatmap processing... (poll ${attempt + 1})`);
    } catch (err) {
      console.warn(`Poll error (attempt ${attempt + 1}):`, err.message);
    }

    await new Promise((r) => setTimeout(r, 3000));
  }

  console.error('Heatmap task timed out after 20 polls');
  return null;
}

function extractTemperatures(result) {
  const temps = {};
  TARGET_ZIPS.forEach((z) => { temps[z] = null; });

  // Try multiple possible locations for features
  const features = result?.map_data?.features || result?.features || result?.data?.features || [];

  console.log('Heatmap result keys:', Object.keys(result || {}));
  console.log('Features count:', features.length);
  if (features.length > 0) {
    console.log('First feature keys:', Object.keys(features[0]));
    console.log('First feature props:', JSON.stringify(features[0].properties).slice(0, 200));
    console.log('First feature geom type:', features[0].geometry?.type);
  }

  for (const feature of features) {
    const avgC = feature?.properties?.average_temperature;
    if (avgC == null) continue;

    const geom = feature?.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') {
      const polygon = geom.coordinates[0];
      for (const [zip, center] of Object.entries(ZIP_CENTERS)) {
        if (temps[zip] != null) continue;
        if (pointInPolygon(center, polygon)) {
          temps[zip] = cToF(parseFloat(avgC));
        }
      }
    } else if (geom.type === 'Point') {
      // If it's a point, assign to nearest zip
      const [lng, lat] = geom.coordinates;
      let nearestZip = null;
      let nearestDist = Infinity;
      for (const [zip, center] of Object.entries(ZIP_CENTERS)) {
        const dist = Math.sqrt((center[0] - lng) ** 2 + (center[1] - lat) ** 2);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestZip = zip;
        }
      }
      if (nearestZip && temps[nearestZip] == null) {
        temps[nearestZip] = cToF(parseFloat(avgC));
      }
    }
  }

  console.log('Extracted temperatures:', temps);
  return temps;
}

async function fetchHeatmapTemps() {
  console.log('Submitting heatmap task to FortyGuard...');
  const activityId = await submitHeatmap();
  if (!activityId) return null;

  console.log('Polling for results...');
  const result = await pollHeatmap(activityId);
  if (!result) return null;

  const temps = extractTemperatures(result);
  console.log('Extracted temperatures:', temps);

  // If no zip codes matched any polygon, use the average for all
  const hasAny = Object.values(temps).some((v) => v != null);
  if (!hasAny && features.length > 0) {
    const allTemps = [];
    for (const feature of features) {
      const avgC = feature?.properties?.average_temperature;
      if (avgC != null) allTemps.push(cToF(parseFloat(avgC)));
    }
    if (allTemps.length > 0) {
      const avg = Math.round(allTemps.reduce((a, b) => a + b, 0) / allTemps.length);
      TARGET_ZIPS.forEach((z) => { temps[z] = avg; });
      console.log('Using average temperature for all zips:', avg);
    }
  }

  console.log('Final temperatures:', temps);
  return temps;
}

export async function fetchTemperature(zipCode) {
  const now = Date.now();
  const cached = tempCache[zipCode];

  // Return fresh cache hit
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.temp;
  }

  // Decide whether to submit a new heatmap task
  const needNewHeatmap = now - lastHeatmapTime > HEATMAP_COOLDOWN;

  if (needNewHeatmap) {
    try {
      const temps = await fetchHeatmapTemps();
      if (temps) {
        const t = Date.now();
        let hasAny = false;
        for (const [z, temp] of Object.entries(temps)) {
          if (temp != null) {
            tempCache[z] = { temp, ts: t };
            hasAny = true;
          }
        }
        if (hasAny) {
          lastHeatmapTime = t;
          if (temps[zipCode] != null) return temps[zipCode];
        }
      }
    } catch (err) {
      console.error(`Temperature fetch failed for ${zipCode}:`, err);
    }
  }

  // Fallback: stale cache or default fallback
  console.log(`Using fallback temperature for ${zipCode}:`, cached ? cached.temp : FALLBACK_TEMPS[zipCode]);
  if (cached) return cached.temp;
  return FALLBACK_TEMPS[zipCode] || 100;
}

export function getCachedTemps() {
  return { ...tempCache };
}

export function getFallbackTemps() {
  return { ...FALLBACK_TEMPS };
}

export const TARGET_ZIP_CODES = TARGET_ZIPS;
export const ZIP_COORDS = {
  '85001': [33.4484, -112.0740],
  '85008': [33.4787, -112.0476],
  '85015': [33.5117, -112.1449],
  '85018': [33.5008, -111.9805],
  '85041': [33.3435, -112.1004],
};

export const VULNERABILITY = {
  '85001': { neighborhood: 'Downtown Phoenix', elderly_pct: 8.2, low_income_pct: 34.5, tree_canopy_pct: 6.1 },
  '85008': { neighborhood: 'East Phoenix (Villa de Paz)', elderly_pct: 12.7, low_income_pct: 41.2, tree_canopy_pct: 9.3 },
  '85015': { neighborhood: 'Maryvale', elderly_pct: 10.4, low_income_pct: 46.8, tree_canopy_pct: 7.5 },
  '85018': { neighborhood: 'Arcadia', elderly_pct: 15.9, low_income_pct: 11.3, tree_canopy_pct: 22.4 },
  '85041': { neighborhood: 'Laveen Village', elderly_pct: 9.1, low_income_pct: 28.6, tree_canopy_pct: 12.8 },
};

export function calculateRiskScore(temperature, elderlyPct, lowIncomePct) {
  return +(0.61 * temperature + 0.24 * elderlyPct + 0.15 * lowIncomePct).toFixed(2);
}

export function pearsonCorrelation(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);
  const sumY2 = ys.reduce((s, y) => s + y * y, 0);
  const denom = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
  if (denom === 0) return 0;
  return +((n * sumXY - sumX * sumY) / denom).toFixed(4);
}
