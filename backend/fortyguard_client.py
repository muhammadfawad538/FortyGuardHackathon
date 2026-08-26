"""FortyGuard Enterprise API client.

Uses the heatmap endpoint:
  1. POST /v1/heatmap  ->  returns activity_id
  2. GET  /v1/status/{activity_id}  ->  poll until Completed
  3. Parse GeoJSON tiles -> extract temperature per zip code

Temperatures are cached; falls back to defaults on any failure.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Optional

import requests
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_BACKEND_DIR, ".env"))

FORTYGUARD_BASE_URL = os.getenv(
    "FORTYGUARD_BASE_URL", "https://api.fortyguard.com/v1"
)
FORTYGUARD_API_KEY = os.getenv("FORTYGUARD_API_KEY", "")

CACHE_TTL_SECONDS = 60

# Pre-seeded fallback temperatures (Fahrenheit)
FALLBACK_TEMPERATURES: dict[str, float] = {
    "85001": 105.0,
    "85008": 108.0,
    "85015": 112.0,
    "85018": 100.0,
    "85041": 107.0,
}

TARGET_ZIP_CODES = list(FALLBACK_TEMPERATURES.keys())

# Phoenix bounding box for the heatmap polygon
PHOENIX_POLYGON = [
    [-112.18, 33.30],
    [-111.90, 33.30],
    [-111.90, 33.55],
    [-112.18, 33.55],
    [-112.18, 33.30],
]

# Approximate center of each zip code (for tile lookup)
ZIP_CENTERS: dict[str, tuple[float, float]] = {
    "85001": (-112.0740, 33.4484),
    "85008": (-112.0476, 33.4787),
    "85015": (-112.1449, 33.5117),
    "85018": (-111.9805, 33.5008),
    "85041": (-112.1004, 33.3435),
}

# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------
_temperature_cache: dict[str, dict] = {}


def _init_cache() -> None:
    now = time.time()
    global _temperature_cache
    _temperature_cache = {
        z: {"temp": t, "ts": now - CACHE_TTL_SECONDS - 1}
        for z, t in FALLBACK_TEMPERATURES.items()
    }


_init_cache()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _headers() -> dict:
    h = {"Content-Type": "application/json"}
    if FORTYGUARD_API_KEY:
        h["api-key"] = FORTYGUARD_API_KEY
    return h


def _point_in_polygon(point: tuple[float, float], polygon: list) -> bool:
    """Ray-casting point-in-polygon test. point = (lng, lat)."""
    x, y = point
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def _celsius_to_fahrenheit(c: float) -> float:
    return round(c * 9 / 5 + 32, 1)


# ---------------------------------------------------------------------------
# Heatmap workflow
# ---------------------------------------------------------------------------
_last_heatmap_ts: float = 0
_HEATMAP_COOLDOWN = 55  # seconds before re-submitting (under the 60s cache)


def _submit_heatmap() -> Optional[str]:
    """Submit a Phoenix-area heatmap task. Returns activity_id or None."""
    if not FORTYGUARD_API_KEY:
        return None

    payload = {
        "polygon_aoi": {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [PHOENIX_POLYGON],
                    },
                }
            ],
        },
        "date_time": {
            "start_date": time.strftime("%Y-%m-%d"),
            "start_time": "14:00",
            "filter_type": 1,
        },
        "granularity": 100,
    }

    try:
        resp = requests.post(
            f"{FORTYGUARD_BASE_URL}/heatmap",
            headers=_headers(),
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        activity_id = data.get("data", {}).get("activity_id")
        if activity_id:
            logger.info("Heatmap submitted, activity_id=%s", activity_id)
            return activity_id
        logger.warning("No activity_id in heatmap response: %s", data)
        return None
    except Exception as exc:
        logger.warning("Heatmap submission failed: %s", exc)
        return None


def _poll_heatmap(activity_id: str) -> Optional[dict]:
    """Poll the status endpoint until Completed. Returns the result dict or None."""
    status_url = f"{FORTYGUARD_BASE_URL}/status/{activity_id}"
    for attempt in range(20):
        try:
            resp = requests.get(status_url, headers=_headers(), timeout=15)
            resp.raise_for_status()
            data = resp.json().get("data", {})
            status = data.get("status", "").lower()

            if status in ("completed", "succeeded"):
                logger.info("Heatmap task completed after %d polls", attempt + 1)
                return data.get("result", data)
            elif status in ("failed", "error"):
                logger.error("Heatmap task failed: %s", data)
                return None

            logger.info("Heatmap still processing (poll %d)", attempt + 1)
        except Exception as exc:
            logger.warning("Poll error (attempt %d): %s", attempt + 1, exc)

        time.sleep(3)

    logger.error("Heatmap task timed out")
    return None


def _extract_temperatures(result: dict) -> dict[str, Optional[float]]:
    """Extract average temperature per zip code from GeoJSON heatmap result.

    Finds the tile polygon that contains each zip code's center point
    and returns its average_temperature in Celsius.
    """
    temps: dict[str, Optional[float]] = {z: None for z in TARGET_ZIP_CODES}

    features = result.get("map_data", {}).get("features", [])
    if not features:
        # Result might be the features list directly
        features = result.get("features", [])

    for feature in features:
        props = feature.get("properties", {})
        avg_c = props.get("average_temperature")
        if avg_c is None:
            continue

        geom = feature.get("geometry", {})
        coords = geom.get("coordinates", [])
        # Flatten polygon rings
        if geom.get("type") == "Polygon":
            polygon = coords[0]  # outer ring
        else:
            continue

        for zip_code, center in ZIP_CENTERS.items():
            if temps[zip_code] is not None:
                continue
            if _point_in_polygon(center, polygon):
                temps[zip_code] = _celsius_to_fahrenheit(float(avg_c))

    return temps


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def fetch_temperature(zip_code: str) -> Optional[float]:
    """Return the live temperature for *zip_code* in Fahrenheit.

    1. Return cached value if it's younger than ``CACHE_TTL_SECONDS``.
    2. Submit heatmap task if cooldown has passed.
    3. Poll for results and extract temperatures for all zip codes.
    4. Cache all results.
    5. On failure, return cached/fallback value.
    """
    global _temperature_cache

    now = time.time()
    cached = _temperature_cache.get(zip_code)
    if cached and (now - cached["ts"]) < CACHE_TTL_SECONDS:
        return cached["temp"]

    # Decide whether to submit a new heatmap task
    need_new_heatmap = (
        not FORTYGUARD_API_KEY
        or (now - _last_heatmap_ts) > _HEATMAP_COOLDOWN
    )

    if need_new_heatmap:
        activity_id = _submit_heatmap()
        if activity_id:
            result = _poll_heatmap(activity_id)
            if result:
                raw_temps = _extract_temperatures(result)
                for z, t_celsius in raw_temps.items():
                    if t_celsius is not None:
                        _temperature_cache[z] = {"temp": t_celsius, "ts": now}
                # Return whatever we got for this zip
                if raw_temps.get(zip_code) is not None:
                    return raw_temps[zip_code]

    # Fall back to cache or default
    if cached:
        return cached["temp"]
    return FALLBACK_TEMPERATURES.get(zip_code)


def prefetch_all() -> dict[str, Optional[float]]:
    """Warm the cache for every target zip code."""
    results: dict[str, Optional[float]] = {}
    for z in TARGET_ZIP_CODES:
        try:
            results[z] = fetch_temperature(z)
        except Exception:
            results[z] = None
    return results
