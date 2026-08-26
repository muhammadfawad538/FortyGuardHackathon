# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Heat Triage — a hackathon project (FortyGuard Global AI Hackathon, Aug 18–30 2026) that ranks Phoenix, AZ neighborhoods by heat risk urgency.
Combines live temperature data (FortyGuard Temperature API) with vulnerability data (elderly population, low income, tree canopy)
to produce a ranked, prioritized action list for city emergency management officials.

Demo city: Phoenix, AZ. 5 zip codes: 85001, 85008, 85015, 85018, 85041.

## Tech Stack

- Backend: Python/Flask — serves `/api/risk-scores`, handles FortyGuard API calls + scoring formula
- Frontend: React — fetches risk scores, renders ranked list + Leaflet map
- Map: Leaflet.js — color-coded markers by risk_score
- Data: Static CSV of vulnerability data (no database)

## How to Run

```bash
# Backend (Flask)
cd backend
pip install -r requirements.txt
python app.py
# Serves at http://localhost:5000

# Frontend (React)
cd frontend
npm install
npm start
# Serves at http://localhost:3000
```

## Scoring Formula

`risk_score = (0.5 × normalized_temperature) + (0.3 × elderly_pct) + (0.2 × low_income_pct)`

- Each factor normalized to 0–100 before weighting.
- Cache FortyGuard API responses for 60 seconds.
- Fall back to last known value on API failure.

## Key Constraints

- No auth, no database — just API calls + static CSV.
- Keep weights explainable and tunable (government-use transparency is a pitch selling point).
- Keep the "Simulate Heatwave" animation smooth — it's the demo centerpiece.
