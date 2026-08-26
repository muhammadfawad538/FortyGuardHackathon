import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';

const ZIP_COORDS = {
  '85001': [33.4484, -112.0740],
  '85008': [33.4787, -112.0476],
  '85015': [33.5117, -112.1449],
  '85018': [33.5008, -111.9805],
  '85041': [33.3435, -112.1004],
};
const PHOENIX_CENTER = [33.45, -112.07];

function riskColor(score) {
  if (score >= 70) return '#ef4444';
  if (score >= 50) return '#f59e0b';
  return '#22c55e';
}
function riskLabel(score) {
  if (score >= 70) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  return 'LOW';
}
function backendCalculate(temperature, elderlyPct, lowIncomePct) {
  return +(0.61 * temperature + 0.24 * elderlyPct + 0.15 * lowIncomePct).toFixed(2);
}

export default function App() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [simStep, setSimStep] = useState(0);
  const [alert, setAlert] = useState(null);
  const [weights, setWeights] = useState({ temp: 0.61, elderly: 0.24, income: 0.15 });
  const [selectedZip, setSelectedZip] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [correlation, setCorrelation] = useState(null);

  const API_BASE = process.env.REACT_APP_API_URL || '';

  const fetchScores = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await axios.get(`${API_BASE}/api/risk-scores`);
      return res.data;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [API_BASE]);

  useEffect(() => {
    let cancelled = false;
    fetchScores().then((d) => { if (!cancelled) setData(d); });
    const interval = setInterval(() => {
      fetchScores().then((d) => { if (!cancelled) setData(d); });
    }, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [fetchScores]);

  useEffect(() => {
    if (!data.length) return;
    const recalculated = data
      .map((d) => ({ ...d, risk_score: backendCalculate(d.temperature, d.elderly_pct, d.low_income_pct) }))
      .sort((a, b) => b.risk_score - a.risk_score);
    setData(recalculated);
  }, [weights]);

  const [prevTopZip, setPrevTopZip] = useState(null);
  useEffect(() => {
    if (!data.length) return;
    const top = data[0];
    if (prevTopZip && (top.zip_code !== prevTopZip || top.risk_score >= 70)) {
      setAlert({ zip: top.zip_code, neighborhood: top.neighborhood, score: top.risk_score });
    }
    setPrevTopZip(top.zip_code);
  }, [data]);

  // Fetch correlation data
  const fetchCorrelation = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/correlation`);
      setCorrelation(res.data);
    } catch (err) {
      console.error('Correlation fetch failed:', err);
    }
  }, [API_BASE]);

  useEffect(() => {
    if (activeTab === 'analysis') {
      fetchCorrelation();
    }
  }, [activeTab, fetchCorrelation]);

  const startSimulation = useCallback(async () => {
    setSimulating(true);
    setSimStep(0);
    setAlert(null);
    const baseData = await fetchScores();
    const sorted = baseData.sort((a, b) => b.risk_score - a.risk_score);
    setData(sorted);
    setPrevTopZip(sorted[0]?.zip_code || null);
    const steps = [0, 3, 6, 9, 12];
    for (let i = 0; i < steps.length; i++) {
      setSimStep(i);
      await new Promise((r) => setTimeout(r, 1000));
      const bumped = sorted.map((d) => ({
        ...d,
        temperature: +(d.temperature + steps[i]).toFixed(1),
        risk_score: backendCalculate(d.temperature + steps[i], d.elderly_pct, d.low_income_pct),
      }));
      bumped.sort((a, b) => b.risk_score - a.risk_score);
      setData(bumped);
    }
    setSimulating(false);
  }, [fetchScores]);

  const handleWeightChange = (key, value) => {
    const num = parseFloat(value);
    setWeights((prev) => {
      const next = { ...prev, [key]: num };
      const total = next.temp + next.elderly + next.income;
      if (total > 0 && Math.abs(total - 1) > 0.001) {
        next.temp = +(next.temp / total).toFixed(2);
        next.elderly = +(next.elderly / total).toFixed(2);
        next.income = +(next.income / total).toFixed(2);
      }
      return next;
    });
  };

  const topZone = data[0] || null;
  const avgTemp = data.length ? (data.reduce((s, d) => s + d.temperature, 0) / data.length).toFixed(1) : '--';
  const highRiskCount = data.filter((d) => d.risk_score >= 70).length;

  // ─── SVG Scatter Plot ───
  const ScatterPlot = ({ points, xLabel, yLabel, color = '#8b5cf6' }) => {
    const width = 500, height = 300;
    const padding = { top: 20, right: 30, bottom: 50, left: 60 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    if (!points || points.length === 0) return <div className="chart-placeholder">Loading chart data…</div>;

    const xVals = points.map((p) => p.x);
    const yVals = points.map((p) => p.y);
    const xMin = Math.min(...xVals) - 2;
    const xMax = Math.max(...xVals) + 2;
    const yMin = Math.min(...yVals) - 5;
    const yMax = Math.max(...yVals) + 5;

    const toSvgX = (x) => padding.left + ((x - xMin) / (xMax - xMin)) * plotW;
    const toSvgY = (y) => padding.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

    const circles = points.map((p, i) => (
      <circle
        key={i}
        cx={toSvgX(p.x)}
        cy={toSvgY(p.y)}
        r={7}
        fill={color}
        fillOpacity={0.7}
        stroke="#fff"
        strokeWidth={1.5}
      >
        <title>{p.neighborhood} ({p.zip_code})\n{xLabel}: {p.x}  {yLabel}: {p.y}</title>
      </circle>
    ));

    const xTicks = [];
    for (let v = Math.ceil(xMin); v <= Math.floor(xMax); v += 5) {
      xTicks.push(
        <g key={v}>
          <line x1={toSvgX(v)} y1={padding.top + plotH} x2={toSvgX(v)} y2={padding.top + plotH + 5} stroke="#64748b" />
          <text x={toSvgX(v)} y={padding.top + plotH + 20} fill="#94a3b8" fontSize="11" textAnchor="middle">{v}</text>
        </g>
      );
    }
    const yTicks = [];
    for (let v = Math.ceil(yMin / 10) * 10; v <= Math.floor(yMax / 10) * 10; v += 10) {
      yTicks.push(
        <g key={v}>
          <line x1={padding.left - 5} y1={toSvgY(v)} x2={padding.left} y2={toSvgY(v)} stroke="#64748b" />
          <text x={padding.left - 10} y={toSvgY(v) + 4} fill="#94a3b8" fontSize="11" textAnchor="end">{v}</text>
        </g>
      );
    }

    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', maxHeight: '320px' }}>
        <rect x={padding.left} y={padding.top} width={plotW} height={plotH} fill="rgba(255,255,255,0.02)" rx="4" />
        {xTicks}
        {yTicks}
        <line x1={padding.left} y1={padding.top + plotH} x2={padding.left + plotW} y2={padding.top + plotH} stroke="#2a3550" />
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + plotH} stroke="#2a3550" />
        {circles}
        <text x={width / 2} y={height - 5} fill="#94a3b8" fontSize="12" textAnchor="middle" fontWeight="600">{xLabel}</text>
        <text transform={`translate(15, ${height / 2}) rotate(-90)`} fill="#94a3b8" fontSize="12" textAnchor="middle" fontWeight="600">{yLabel}</text>
      </svg>
    );
  };

  // ─── Correlation Bar Chart ───
  const CorrBarChart = ({ correlations }) => {
    const width = 500, height = 200;
    const padding = { top: 10, right: 20, bottom: 60, left: 50 };
    const barW = (width - padding.left - padding.right) / correlations.length - 20;

    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', maxHeight: '240px' }}>
        {correlations.map((c, i) => {
          const x = padding.left + i * ((width - padding.left - padding.right) / correlations.length) + 10;
          const barH = Math.abs(c.coefficient) * (height - padding.top - padding.bottom - 40);
          const y = c.coefficient >= 0 ? padding.top + (height - padding.top - padding.bottom - 40) - barH : padding.top + (height - padding.top - padding.bottom - 40) / 2;
          const color = c.coefficient >= 0.5 ? '#ef4444' : c.coefficient >= 0.3 ? '#f59e0b' : '#64748b';
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} fill={color} rx="4" opacity="0.85" />
              <text x={x + barW / 2} y={y - 6} fill={color} fontSize="13" fontWeight="700" textAnchor="middle">
                {c.coefficient.toFixed(2)}
              </text>
              <text x={x + barW / 2} y={height - 10} fill="#94a3b8" fontSize="10" textAnchor="middle">
                {c.factor.split(' ')[0]}
              </text>
              <text x={x + barW / 2} y={height - 0} fill="#64748b" fontSize="9" textAnchor="middle">
                {c.factor.split(' ')[1] || ''}
              </text>
            </g>
          );
        })}
        <line x1={padding.left} y1={padding.top + (height - padding.top - padding.bottom - 40) / 2} x2={width - padding.right} y2={padding.top + (height - padding.top - padding.bottom - 40) / 2} stroke="#2a3550" />
        <text x={width / 2} y={height - 0} fill="#94a3b8" fontSize="12" textAnchor="middle" fontWeight="600">Correlation Strength</text>
      </svg>
    );
  };

  return (
    <div className="app-root">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-logo">🔥</span>
          <div>
            <h1>Heat Triage</h1>
            <p className="sidebar-subtitle">Phoenix Heat Response System</p>
          </div>
        </div>

        {/* Tab Nav */}
        <div className="tab-nav">
          <button className={`tab-btn ${activeTab === 'dashboard' ? 'tab-active' : ''}`} onClick={() => setActiveTab('dashboard')}>📊 Dashboard</button>
          <button className={`tab-btn ${activeTab === 'analysis' ? 'tab-active' : ''}`} onClick={() => setActiveTab('analysis')}>📈 Analysis</button>
        </div>

        {activeTab === 'dashboard' && (
          <>
            <div className="sidebar-section">
              <h3>Scoring Weights</h3>
              <div className="weight-control">
                <div className="weight-header">
                  <span className="weight-label">Temperature</span>
                  <span className="weight-value">{(weights.temp * 100).toFixed(0)}%</span>
                </div>
                <input type="range" min="0" max="1" step="0.01" value={weights.temp} onChange={(e) => handleWeightChange('temp', e.target.value)} />
                <div className="weight-bar" style={{ width: `${weights.temp * 100}%` }} />
              </div>
              <div className="weight-control">
                <div className="weight-header">
                  <span className="weight-label">Elderly Population</span>
                  <span className="weight-value">{(weights.elderly * 100).toFixed(0)}%</span>
                </div>
                <input type="range" min="0" max="1" step="0.01" value={weights.elderly} onChange={(e) => handleWeightChange('elderly', e.target.value)} />
                <div className="weight-bar" style={{ width: `${weights.elderly * 100}%` }} />
              </div>
              <div className="weight-control">
                <div className="weight-header">
                  <span className="weight-label">Low Income</span>
                  <span className="weight-value">{(weights.income * 100).toFixed(0)}%</span>
                </div>
                <input type="range" min="0" max="1" step="0.01" value={weights.income} onChange={(e) => handleWeightChange('income', e.target.value)} />
                <div className="weight-bar" style={{ width: `${weights.income * 100}%` }} />
              </div>
            </div>

            <div className="sidebar-section">
              <h3>Demo Controls</h3>
              <button className="sim-btn" onClick={startSimulation} disabled={simulating}>
                {simulating ? `🌡️ Simulating… Step ${simStep + 1}/5` : '🌡️ Simulate Heatwave'}
              </button>
              {simulating && <p className="sim-status">Raising +{simStep * 3}°F across all zones</p>}
            </div>
          </>
        )}

        {activeTab === 'analysis' && (
          <div className="sidebar-section">
            <h3>Heat Equity Analysis</h3>
            <p className="analysis-desc">
              This analysis tests whether temperature and social vulnerability factors correlate with heat risk scores across Phoenix zip codes.
            </p>
            <button className="sim-btn" onClick={fetchCorrelation} style={{ marginBottom: '12px' }}>
              🔄 Refresh Analysis
            </button>
            {correlation && (
              <div className="corr-summary">
                {correlation.correlations.map((c, i) => (
                  <div key={i} className="corr-item">
                    <span className="corr-factor">{c.factor}</span>
                    <span className={`corr-value ${c.coefficient >= 0.5 ? 'corr-strong' : c.coefficient >= 0.3 ? 'corr-moderate' : 'corr-weak'}`}>
                      r = {c.coefficient.toFixed(3)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="sidebar-section sidebar-footer">
          <p>Data: FortyGuard Temperature API</p>
          <p>Vulnerability: Census ACS (static)</p>
          <p className="sidebar-updated">{loading ? 'Updating…' : 'Live · Refreshes every 60s'}</p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main">
        {activeTab === 'dashboard' && (
          <>
            {/* Stat Cards */}
            <div className="stat-cards">
              <div className="stat-card">
                <span className="stat-icon">🌡️</span>
                <div>
                  <p className="stat-label">Avg Temperature</p>
                  <p className="stat-value">{avgTemp}°F</p>
                </div>
              </div>
              <div className="stat-card stat-card--danger">
                <span className="stat-icon">🚨</span>
                <div>
                  <p className="stat-label">High Risk Zones</p>
                  <p className="stat-value">{highRiskCount} / {data.length}</p>
                </div>
              </div>
              <div className="stat-card stat-card--warning">
                <span className="stat-icon">📍</span>
                <div>
                  <p className="stat-label">Top Priority</p>
                  <p className="stat-value">{topZone ? topZone.neighborhood : '--'}</p>
                </div>
              </div>
              <div className="stat-card stat-card--score">
                <span className="stat-icon">📊</span>
                <div>
                  <p className="stat-label">Top Risk Score</p>
                  <p className="stat-value">{topZone ? topZone.risk_score : '--'}</p>
                </div>
              </div>
            </div>

            {/* Map + Table */}
            <div className="content-grid">
              <div className="panel map-panel">
                <div className="panel-header">
                  <h2>🗺️ Phoenix Heat Map</h2>
                  <div className="legend">
                    <span className="legend-item"><span className="legend-dot" style={{background:'#ef4444'}} />HIGH</span>
                    <span className="legend-item"><span className="legend-dot" style={{background:'#f59e0b'}} />MEDIUM</span>
                    <span className="legend-item"><span className="legend-dot" style={{background:'#22c55e'}} />LOW</span>
                  </div>
                </div>
                <div className="map-container">
                  <MapContainer center={PHOENIX_CENTER} zoom={12} style={{ height: '100%', width: '100%' }}>
                    <TileLayer attribution='&copy; <a href="https://carto.com/">CARTO</a>' url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                    {data.map((d) => {
                      const pos = ZIP_COORDS[d.zip_code];
                      if (!pos) return null;
                      const isSelected = selectedZip === d.zip_code;
                      return (
                        <CircleMarker key={d.zip_code} center={pos} radius={isSelected ? 18 : 14}
                          pathOptions={{ color: isSelected ? '#fff' : riskColor(d.risk_score), fillColor: riskColor(d.risk_score), fillOpacity: isSelected ? 0.9 : 0.7, weight: isSelected ? 3 : 2 }}
                          eventHandlers={{ click: () => setSelectedZip(d.zip_code) }}>
                          <Popup><strong>{d.neighborhood}</strong> ({d.zip_code})<br />Temp: {d.temperature}°F<br />Elderly: {d.elderly_pct}% · Low Income: {d.low_income_pct}%<br />Tree Canopy: {d.tree_canopy_pct}%<br /><strong>Risk Score: {d.risk_score}</strong></Popup>
                        </CircleMarker>
                      );
                    })}
                  </MapContainer>
                </div>
              </div>

              <div className="panel table-panel">
                <h2>📊 Ranked Risk Scores</h2>
                {error && <p className="error-text">{error}</p>}
                {loading && data.length === 0 && <p className="loading-text">Loading risk scores…</p>}
                {!loading && !error && (
                  <table className="rank-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Zip</th>
                        <th>Neighborhood</th>
                        <th>Temp</th>
                        <th>Risk</th>
                        <th>Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((d, i) => (
                        <tr key={d.zip_code} className={selectedZip === d.zip_code ? 'row-selected' : ''} onClick={() => setSelectedZip(d.zip_code)}>
                          <td className="rank-num">{i + 1}</td>
                          <td className="neighborhood-cell">{d.neighborhood}</td>
                          <td>{d.zip_code}</td>
                          <td>{d.temperature}°F</td>
                          <td>
                            <span className="risk-badge" style={{ background: riskColor(d.risk_score), color: d.risk_score >= 50 ? '#fff' : '#000' }}>
                              {riskLabel(d.risk_score)}
                            </span>
                          </td>
                          <td className="score-cell">{d.risk_score}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === 'analysis' && (
          <div className="analysis-panel">
            <div className="analysis-header">
              <h2>📈 From Heat Data to Real Signal: Data Correlation Analysis</h2>
              <p className="analysis-subtitle">
                Testing whether temperature and social vulnerability factors correlate with heat risk across Phoenix zip codes
              </p>
            </div>

            {correlation && (
              <>
                {/* Interpretation */}
                <div className="analysis-card">
                  <h3>📋 Key Findings</h3>
                  <p className="interpretation-text">{correlation.interpretation}</p>
                </div>

                {/* Correlation Coefficients */}
                <div className="analysis-card">
                  <h3>📊 Pearson Correlation Coefficients</h3>
                  <p className="card-desc">Measuring the linear relationship between each factor and risk score (r = -1 to +1, where |r| ≥ 0.7 is strong)</p>
                  <div className="corr-chart-wrapper">
                    <CorrBarChart correlations={correlation.correlations} />
                  </div>
                  <div className="corr-details">
                    {correlation.correlations.map((c, i) => (
                      <div key={i} className="corr-detail-item">
                        <span className="corr-detail-name">{c.factor}</span>
                        <span className={`corr-detail-val ${c.coefficient >= 0.7 ? 'strong' : c.coefficient >= 0.4 ? 'moderate' : 'weak'}`}>
                          r = {c.coefficient.toFixed(3)}
                        </span>
                        <p className="corr-detail-desc">{c.description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Scatter Plot: Temperature vs Risk Score */}
                <div className="analysis-card">
                  <h3>🌡️ Temperature vs Risk Score</h3>
                  <p className="card-desc">Each point represents a Phoenix zip code. Hover to see details.</p>
                  <div className="chart-wrapper">
                    <ScatterPlot points={correlation.scatter_data} xLabel="Temperature (°F)" yLabel="Risk Score" color="#ef4444" />
                  </div>
                </div>

                {/* Methodology */}
                <div className="analysis-card">
                  <h3>🔬 Methodology</h3>
                  <div className="methodology-grid">
                    <div className="method-item">
                      <h4>Formula</h4>
                      <code>Risk = (Temp × 0.61) + (Elderly% × 0.24) + (Low-Income% × 0.15)</code>
                    </div>
                    <div className="method-item">
                      <h4>Correlation Test</h4>
                      <p>Pearson correlation coefficient (r) measures linear relationship between each input factor and the resulting risk score.</p>
                    </div>
                    <div className="method-item">
                      <h4>Data Sources</h4>
                      <p>Temperatures from FortyGuard API. Vulnerability data from Census ACS (static dataset).</p>
                    </div>
                    <div className="method-item">
                      <h4>Sample Size</h4>
                      <p>n = {correlation.scatter_data?.length || 5} zip codes (Phoenix, AZ)</p>
                    </div>
                  </div>
                </div>
              </>
            )}

            {!correlation && (
              <div className="analysis-placeholder">
                <p>Click "Refresh Analysis" in the sidebar to load correlation data.</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Alert Banner */}
      {alert && (
        <div className="alert-banner" onClick={() => setAlert(null)}>
          <div className="alert-content">
            <span className="alert-icon">🚨</span>
            <div>
              <strong>URGENT: {alert.neighborhood} ({alert.zip})</strong> has reached extreme heat risk (score: {alert.score}).<br />
              Recommend immediate cooling center deployment.
            </div>
            <button className="alert-close" onClick={() => setAlert(null)}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}
