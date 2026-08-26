# Heat Triage

**"A tool that tells cities who to help first during a heatwave — not just where it's hot."**

Phoenix neighborhood heat risk ranking system combining live temperature data (FortyGuard API) with social vulnerability data to produce a prioritized action list for emergency management.

## 🏆 Hackathon

**FortyGuard Global AI Hackathon** — Track: Government & Environment  
Aug 18–30, 2026

## ✨ Features

- **Live Temperature Data** — Fetches real-time temperatures via FortyGuard's Heatmap API
- **Vulnerability Scoring** — Combines temperature (61%), elderly population (24%), and low-income population (15%)
- **Interactive Map** — Leaflet.js dark-themed map with color-coded risk markers
- **Heatwave Simulation** — Animated temperature rise with live re-sorting of risk rankings
- **Auto-Generated Alerts** — Public safety alerts when zones reach extreme risk thresholds
- **Adjustable Weights** — Real-time slider controls to tune the scoring formula
- **Correlation Analysis** — Pearson correlation analysis of heat data vs. social vulnerability

## 🚀 Quick Start

### Backend (FastAPI)

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env  # Add your FORTYGUARD_API_KEY
python app.py
# → http://localhost:5000
```

### Frontend (React)

```bash
cd frontend
npm install
npm start
# → http://localhost:3000
```

## 📊 Scoring Formula

```
Risk Score = (Temperature × 0.61) + (Elderly Population % × 0.24) + (Low-Income Population % × 0.15)
```

Weights are adjustable via the sidebar sliders in the UI.

## 🗂️ Project Structure

```
heat-triage/
├── backend/
│   ├── app.py                    # FastAPI server with endpoints
│   ├── fortyguard_client.py      # FortyGuard API client (heatmap tasks)
│   ├── requirements.txt          # Python dependencies
│   ├── .env                      # API keys (not in git)
│   ├── .env.example              # Template for environment variables
│   └── data/
│       └── vulnerability.csv     # Phoenix zip code vulnerability data
├── frontend/
│   ├── src/
│   │   ├── App.js                # Main React component (dashboard)
│   │   ├── index.js              # React entry point
│   │   └── index.css             # Professional dark theme styling
│   ├── public/
│   │   └── index.html
│   ├── package.json
│   ├── vercel.json               # Vercel deployment config
│   └── .env.production           # Production API URL
├── CLAUDE.md                     # Project instructions
└── README.md
```

## 🔌 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/risk-scores` | GET | Returns ranked list of neighborhoods with risk scores |
| `/api/correlation` | GET | Returns correlation analysis between factors and risk scores |

## 🌐 Deployment

### Frontend — Vercel

1. Push this repo to GitHub
2. Go to [Vercel](https://vercel.com/new) and import the repo
3. Set **Root Directory** to `frontend`
4. Add environment variable: `REACT_APP_API_URL` = your backend URL
5. Deploy

### Backend — Render

1. Go to [Render](https://render.com/new) and select **Web Service**
2. Connect your GitHub repo
3. Settings:
   - **Root Directory**: `backend`
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app --bind 0.0.0.0:$PORT`
4. Add environment variable: `FORTYGUARD_API_KEY` = your key
5. Deploy

## 🛠️ Tech Stack

- **Frontend**: React 18 + Leaflet.js + Axios
- **Backend**: FastAPI + Python
- **Data**: Static CSV (Census ACS)
- **API**: FortyGuard Temperature API (heatmap tasks)
- **Deployment**: Vercel (frontend) + Render (backend)

## 📝 Demo Flow

1. **Hook** (10s): "Phoenix hit 118°F for 31 days last summer..."
2. **Problem** (20s): Cities have heat data but no way to prioritize
3. **Live Demo** (90s): Simulation → re-sorting list → alert generation
4. **Impact** (30s): Who this helps and why it beats existing tools
5. **Close** (20s): What you'd build next with more time

## 👥 Team Roles

- **Person 1 — API/Backend**: FortyGuard integration, scoring formula, data pipeline
- **Person 2 — Frontend/Map**: Dashboard UI, live-updating map, simulation animation
- **Person 3 — Data+Story**: Vulnerability dataset, correlation analysis, pitch deck

## 📄 License

MIT — Hackathon project for FortyGuard Global AI Hackathon 2026
