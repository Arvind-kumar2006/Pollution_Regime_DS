import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getDashboardLatest, getModelInfo } from "../api/api";

const Landing = () => {
  const [modelInfo, setModelInfo] = useState(null);
  const [latestPrediction, setLatestPrediction] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const infoRes = await getModelInfo();
        if (!cancelled) setModelInfo(infoRes.data || infoRes);
      } catch {
        // ignore
      }

      try {
        const dashRes = await getDashboardLatest();
        const payload = dashRes.data;
        const last = payload?.summary
          ? {
              aqi: payload.summary.current_aqi,
              regime: payload.summary.current_regime,
              confidence: payload.summary.confidence,
            }
          : null;
        if (!cancelled) setLatestPrediction(last);
      } catch {
        // ignore
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, []);

  const normalizeRegime = (raw) => {
    const r = String(raw || "").toLowerCase();
    if (r === "stable") return "stable";
    if (r === "high" || r === "high_volatile") return "high";
    if (r === "volatile" || r === "unstable_low" || r === "moderate") return "volatile";
    if (r.includes("high")) return "high";
    if (r.includes("volatile")) return "volatile";
    return "stable";
  };

  const confidencePct =
    latestPrediction?.confidence !== undefined && latestPrediction?.confidence !== null
      ? `${Number(latestPrediction.confidence).toFixed(1)}%`
      : "—";
  const currentAqi =
    latestPrediction?.aqi !== undefined && latestPrediction?.aqi !== null
      ? Number(latestPrediction.aqi).toFixed(0)
      : "—";

  return (
    <div className="bg-slate-50 text-slate-900 min-h-screen font-sans">

      {/* ================= NAVBAR ================= */}
      <div className="w-full border-b border-slate-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/80 px-5 md:px-10 xl:px-20 py-4 flex justify-between items-center">

        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-blue-600 rounded-md shadow-sm"></div>
          <span className="text-[18px] font-semibold text-blue-600">
            Pollution Regime
          </span>
        </div>

        {/* Center Links */}
        <div className="hidden lg:flex gap-10 text-[14px] text-slate-500">
          <span className="hover:text-slate-900 cursor-pointer">Docs</span>
          <span className="hover:text-slate-900 cursor-pointer">Methodology</span>
          <span className="hover:text-slate-900 cursor-pointer">Contact</span>
        </div>

        {/* Right */}
        <div className="flex items-center gap-6">
          <span className="hidden md:inline text-slate-500 text-[14px]">API Reference</span>
          <Link
            to="/dashboard"
            className="bg-white border border-slate-200 shadow-sm px-5 py-2 rounded-md text-sm text-slate-900 hover:shadow-md transition"
          >
            Get Started
          </Link>
        </div>
      </div>

      {/* ================= HERO ================= */}
      <div className="px-5 md:px-10 xl:px-20 pt-12 md:pt-20 pb-16 md:pb-24 flex flex-col lg:flex-row gap-10 lg:gap-16 justify-between items-start lg:items-center">

        {/* LEFT */}
        <div className="max-w-2xl">

          <div className="inline-block border border-blue-200 bg-white text-blue-600 text-xs px-4 py-1 rounded-full mb-6">
            ⚡ Powered by HMM Technology
          </div>

          <h1 className="text-4xl md:text-6xl xl:text-7xl leading-tight font-bold mb-6 tracking-tight">
            Pollution Regime
            <br />
            Detection using{" "}
            <span className="text-blue-500">AI</span>
          </h1>

          <p className="text-slate-500 text-[16px] leading-7 mb-8">
            Analyze time-series air pollution data using Hidden Markov Models
            to detect stable and volatile regimes. Turn raw CSV sensor exports
            into actionable environmental insights.
          </p>

          <div className="flex flex-wrap gap-4 mb-8">
            <Link
              to="/upload"
              className="bg-blue-600 text-white border border-blue-600 shadow-sm px-6 py-3 rounded-lg text-sm hover:bg-blue-700 transition"
            >
              Upload Dataset
            </Link>

            <Link
              to="/dashboard"
              className="border border-slate-200 bg-white px-6 py-3 rounded-lg text-sm hover:border-blue-300 transition"
            >
              View Dashboard
            </Link>
            <Link
              to="/history"
              className="border border-slate-200 bg-white px-6 py-3 rounded-lg text-sm hover:border-blue-300 transition"
            >
              View History
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
              <p className="text-xs text-slate-500">Current AQI</p>
              <p className="text-xl font-bold text-slate-900">{currentAqi}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
              <p className="text-xs text-slate-500">Latest Regime</p>
              <p className="text-xl font-bold text-slate-900 capitalize">
                {normalizeRegime(latestPrediction?.regime || latestPrediction?.state)}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
              <p className="text-xs text-slate-500">Confidence</p>
              <p className="text-xl font-bold text-slate-900">{confidencePct}</p>
            </div>
          </div>
        </div>

        {/* RIGHT CARD */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-lg shadow-xl">

          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="text-sm font-semibold">
                HMM-based Regime Detection
              </h3>
              <p className="text-xs text-slate-500">
                Sample PM2.5 time-series analysis
              </p>
            </div>

            <div className="flex gap-3 text-xs">
              <span className="text-blue-400">● Stable</span>
              <span className="text-red-400">● Volatile</span>
            </div>
          </div>

          <div className="h-[220px] bg-slate-50 rounded-xl flex flex-col items-center justify-center text-slate-700 text-sm p-6 text-center">
            {modelInfo ? (
              <>
                <div className="text-[11px] font-bold uppercase text-slate-500 mb-2">Latest Trained Model</div>
                <div className="text-[18px] font-extrabold text-slate-900 mb-2">
                  HMM ({modelInfo.n_states} States)
                </div>
                <div className="text-slate-600">
                  {latestPrediction ? (
                    <>
                      Latest Regime:{" "}
                      <span className="font-bold capitalize">
                        {normalizeRegime(latestPrediction?.regime || latestPrediction?.state)}
                      </span>
                    </>
                  ) : (
                    "Run predictions to see the latest regime"
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="text-[11px] font-bold uppercase text-slate-500 mb-2">No Trained Model</div>
                <div className="text-[16px] font-extrabold text-slate-900 mb-2">Upload & Train to begin</div>
                <div className="text-slate-600">Your chart and regimes will appear here automatically.</div>
              </>
            )}
          </div>

          <div className="flex justify-between text-xs text-slate-500 mt-4">
            <span>{modelInfo ? `Log Likelihood: ${Number(modelInfo.log_likelihood).toFixed(2)}` : "Log Likelihood: —"}</span>
            <span>Confidence: {confidencePct}</span>
          </div>
        </div>
      </div>

      {/* ================= FEATURES ================= */}
      <div className="bg-white px-5 md:px-10 xl:px-20 py-16 md:py-20 border-y border-slate-200">

        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">

          {/* CARD 1 */}
          <div>
            <div className="w-12 h-12 bg-blue-600/20 flex items-center justify-center rounded-lg mb-4">
              ⬆
            </div>
            <h3 className="text-lg font-semibold mb-3">Upload Dataset</h3>
            <p className="text-slate-500 text-sm mb-3 leading-6">
              Securely upload your CSV formatted pollution data. Supports PM2.5,
              PM10, NO2, and SO2 time-series without needing active sensor
              connections.
            </p>
            <Link to="/upload" className="text-blue-500 text-sm cursor-pointer font-medium hover:text-blue-700 transition">
              Upload CSV →
            </Link>
          </div>

          {/* CARD 2 */}
          <div>
            <div className="w-12 h-12 bg-blue-600/20 flex items-center justify-center rounded-lg mb-4">
              ⚙
            </div>
            <h3 className="text-lg font-semibold mb-3">Train Model</h3>
            <p className="text-slate-500 text-sm mb-3 leading-6">
              Configure your Hidden Markov Model with custom states. Our engine
              automatically optimizes transition probabilities for your dataset.
            </p>
            <Link to="/settings" className="text-blue-500 text-sm cursor-pointer font-medium hover:text-blue-700 transition">
              Configure & Train →
            </Link>
          </div>

          {/* CARD 3 */}
          <div>
            <div className="w-12 h-12 bg-blue-600/20 flex items-center justify-center rounded-lg mb-4">
              📊
            </div>
            <h3 className="text-lg font-semibold mb-3">
              Visualize Predictions
            </h3>
            <p className="text-slate-500 text-sm mb-3 leading-6">
              Instantly view regime transitions. Identify persistent 'Stable'
              periods and risky 'Volatile' bursts with high-confidence mapping.
            </p>
            <Link to="/advanced" className="text-blue-500 text-sm cursor-pointer font-medium hover:text-blue-700 transition">
              Explore Visuals →
            </Link>
          </div>
        </div>
      </div>

      {/* ================= TAG BAR ================= */}
      <div className="border-t border-slate-200 border-b border-slate-200 py-6 px-5 md:px-10 xl:px-20 flex flex-wrap gap-3 md:gap-0 justify-between text-slate-500 text-sm">
        <span>📁 CSV_INPUT</span>
        <span>🧠 HMM_INFERENCE</span>
        <span>⬇ EXPORTABLE_REPORTS</span>
        <span>🔒 DATA_INTEGRITY</span>
      </div>

      {/* ================= FOOTER ================= */}
      <div className="px-5 md:px-10 xl:px-20 py-14">

        <div className="flex flex-col lg:flex-row gap-8 justify-between items-start mb-10">

          <div>
            <h2 className="text-blue-500 font-semibold mb-2">
              Pollution Regime
            </h2>
            <p className="text-slate-500 text-sm">
              Built for professional environmental data analysis.
            </p>
          </div>

          <div className="flex flex-wrap gap-6 text-slate-500 text-sm">
            <span>About</span>
            <span>Privacy Policy</span>
            <span>Terms of Service</span>
            <span>Source Code</span>
          </div>

          <div className="text-right text-slate-500 text-sm">
            <p>Developed by AeroMetrics</p>
            <p className="text-xs">Version 2.4.0-stable</p>
          </div>
        </div>

        <div className="border-t border-[#E2E8F0] pt-6 text-center text-slate-500 text-xs">
          © 2026 POLLUTION REGIME DETECTION TOOL. ALL RIGHTS RESERVED.
        </div>
      </div>
    </div>
  );
};

export default Landing;