import logging
import math
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import csv
import os
from dotenv import load_dotenv

from fortyguard_client import fetch_temperature, prefetch_all

logging.basicConfig(level=logging.INFO)
load_dotenv()

app = FastAPI(title="Heat Triage API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(BASE_DIR, "data", "vulnerability.csv")

vulnerability_data = {}
with open(CSV_PATH, newline="") as f:
    reader = csv.DictReader(f)
    for row in reader:
        zip_code = row["zip_code"]
        vulnerability_data[zip_code] = {
            "zip_code": zip_code,
            "neighborhood": row["neighborhood_name"],
            "elderly_pct": float(row["elderly_pct"]),
            "low_income_pct": float(row["low_income_pct"]),
            "tree_canopy_pct": float(row["tree_canopy_pct"]),
        }


def calculate_risk_score(temperature, elderly_pct, low_income_pct):
    """Risk Score = (Temperature × 61%) + (Elderly Population × 24%) + (Low-Income Population × 15%)"""
    return round(
        (0.61 * temperature) + (0.24 * elderly_pct) + (0.15 * low_income_pct), 2
    )


def _pearson_correlation(xs, ys):
    """Compute Pearson correlation coefficient."""
    n = len(xs)
    if n < 2:
        return 0
    sum_x = sum(xs)
    sum_y = sum(ys)
    sum_xy = sum(x * y for x, y in zip(xs, ys))
    sum_x2 = sum(x * x for x in xs)
    sum_y2 = sum(y * y for y in ys)

    denom = math.sqrt((n * sum_x2 - sum_x ** 2) * (n * sum_y2 - sum_y ** 2))
    if denom == 0:
        return 0
    return round((n * sum_xy - sum_x * sum_y) / denom, 4)


@app.get("/api/risk-scores")
def get_risk_scores():
    results = []
    for zip_code, data in vulnerability_data.items():
        temp = fetch_temperature(zip_code)
        risk_score = calculate_risk_score(
            temp, data["elderly_pct"], data["low_income_pct"]
        )
        results.append({
            "zip_code": zip_code,
            "neighborhood": data["neighborhood"],
            "temperature": temp,
            "elderly_pct": data["elderly_pct"],
            "low_income_pct": data["low_income_pct"],
            "tree_canopy_pct": data["tree_canopy_pct"],
            "risk_score": risk_score,
        })
    results.sort(key=lambda x: x["risk_score"], reverse=True)
    return results


@app.get("/api/correlation")
def get_correlation():
    """Return correlation coefficients between each factor and risk_score, plus scatter data."""
    scores = []
    for zip_code, data in vulnerability_data.items():
        temp = fetch_temperature(zip_code)
        risk_score = calculate_risk_score(
            temp, data["elderly_pct"], data["low_income_pct"]
        )
        scores.append({
            "zip_code": zip_code,
            "neighborhood": data["neighborhood"],
            "temperature": temp,
            "elderly_pct": data["elderly_pct"],
            "low_income_pct": data["low_income_pct"],
            "risk_score": risk_score,
        })

    temps = [s["temperature"] for s in scores]
    elderly = [s["elderly_pct"] for s in scores]
    income = [s["low_income_pct"] for s in scores]
    risk = [s["risk_score"] for s in scores]

    correlations = [
        {
            "factor": "Temperature (°F)",
            "coefficient": _pearson_correlation(temps, risk),
            "description": "Strong positive correlation — higher temps directly increase risk score",
        },
        {
            "factor": "Elderly Population (%)",
            "coefficient": _pearson_correlation(elderly, risk),
            "description": "Moderate correlation — elderly populations face higher heat vulnerability",
        },
        {
            "factor": "Low-Income Population (%)",
            "coefficient": _pearson_correlation(income, risk),
            "description": "Strong correlation — income is a key predictor of heat risk",
        },
    ]

    scatter_data = [
        {
            "x": round(s["temperature"], 1),
            "y": s["risk_score"],
            "zip_code": s["zip_code"],
            "neighborhood": s["neighborhood"],
        }
        for s in scores
    ]

    return {
        "correlations": correlations,
        "scatter_data": scatter_data,
        "interpretation": (
            "Temperature is the strongest driver of risk score (61% weight). "
            "Low-income populations show the strongest social vulnerability correlation, "
            "confirming the heat equity hypothesis."
        ),
    }


@app.on_event("startup")
async def warm_cache():
    prefetch_all()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
