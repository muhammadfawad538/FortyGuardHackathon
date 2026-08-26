/**
 * FortyGuard API client — runs entirely in the browser.
 * No backend needed.
 */

const FORTYGUARD_BASE_URL = 'https://api.fortyguard.com/v1';
const FORTYGUARD_API_KEY = '4536cc0c45783b70c235fb81050e8718';

const CACHE_TTL_MS = 60 * 1000;

// Fallback temperatures (Fahrenheit)
const FALLBACK_TEMPS = {
  '85001': 105.0,
  '85008': 108.0,
  '85015': 112.0,
  '85018': 100.0,
  '85041': 107.0,
};

const TARGET_ZIPS = Object.keys(FALLBACK_TEMPS);

// Zip code centers (lng, lat) for tile lookup
const ZIP_CENTERS = {
  '85001': [-112.0740, 33.4484],
  '85008': [-112.0476, 33.4787],
  '85015': [-112.1449, 33.5117],
  '85018': [-111.9805, 33.5008],
  '85041': [-112.1004, 33.3435],
};

// Phoenix bounding box
const PHOENIX_POLYGON = [
  [-112.18, 33.30],
  [-111.90, 33.30],
  [-111.90, 33.55],
  [-112.18, 33.55],
  [-112.18, 33.30],
];

// In-memory cache
let tempCache = {};
let lastHeatmapTime = 0;
const HEATMAP_COOLDOWN = 55 * 1000;

function headers() {
  return {
    'Content-Type': 'application/json',
    'api-key': FORTYGUARD_API_KEY,
  };
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

  const resp = await fetch(`${FORTYGUARD_BASE_URL}/heatmap`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    throw new Error(`Heatmap submit failed: ${resp.status}`);
  }

  const data = await resp.json();
  return data?.data?.activity_id;
}

async function pollHeatmap(activityId) {
  const url = `${FORTYGUARD_BASE_URL}/status/${activityId}`;

  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const resp = await fetch(url, { headers: headers() });
      if (!resp.ok) {
        throw new Error(`Status poll failed: ${resp.status}`);
      }
      const data = await resp.json();
      const status = data?.data?.status?.toLowerCase();

      if (status === 'completed' || status === 'succeeded') {
        return data.data.result || data.data;
      }
      if (status === 'failed' || status === 'error') {
        console.error('Heatmap task failed:', data);
        return null;
      }
    } catch (err) {
      console.warn(`Poll error (attempt ${attempt + 1}):`, err);
    }

    await new Promise((r) => setTimeout(r, 3000));
  }

  console.error('Heatmap task timed out');
  return null;
}

function extractTemperatures(result) {
  const temps = {};
  TARGET_ZIPS.forEach((z) => { temps[z] = null; });

  const features = result?.map_data?.features || result?.features || [];

  for (const feature of features) {
    const avgC = feature?.properties?.average_temperature;
    if (avgC == null) continue;

    const geom = feature?.geometry;
    if (geom?.type !== 'Polygon') continue;
    const polygon = geom.coordinates[0];

    for (const [zip, center] of Object.entries(ZIP_CENTERS)) {
      if (temps[zip] != null) continue;
      if (pointInPolygon(center, polygon)) {
        temps[zip] = cToF(parseFloat(avgC));
      }
    }
  }

  return temps;
}

async function fetchHeatmapTemps() {
  const activityId = await submitHeatmap();
  if (!activityId) return null;

  const result = await pollHeatmap(activityId);
  if (!result) return null;

  return extractTemperatures(result);
}

export async function fetchTemperature(zipCode) {
  const now = Date.now();
  const cached = tempCache[zipCode];

  // Return fresh cache hit
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.temp;
  }

  // Decide whether to submit a new heatmap task
  const needNewHeatmap = !FORTYGUARD_API_KEY || now - lastHeatmapTime > HEATMAP_COOLDOWN;

  if (needNewHeatmap) {
    try {
      const temps = await fetchHeatmapTemps();
      if (temps) {
        const t = Date.now();
        for (const [z, temp] of Object.entries(temps)) {
          if (temp != null) {
            tempCache[z] = { temp, ts: t };
          }
        }
        lastHeatmapTime = t;
        if (temps[zipCode] != null) return temps[zipCode];
      }
    } catch (err) {
      console.warn(`Temperature fetch failed for ${zipCode}:`, err);
    }
  }

  // Fallback: stale cache or default
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

// Vulnerability data (embedded so no backend needed)
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
