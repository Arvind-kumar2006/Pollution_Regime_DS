import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceArea,
  Brush
} from "recharts";
import { getDashboardLatest } from "../api/api";
import { TrendingUp, CheckCircle, Activity, Info, AlertTriangle, Clock, Database, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

/* ---------------- HELPERS ---------------- */

function getAQILabel(aqi) {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Satisfactory";
  if (aqi <= 200) return "Moderate";
  if (aqi <= 300) return "Poor";
  if (aqi <= 400) return "Very Poor";
  return "Severe";
}

const REGIME_BG = {
  stable: "#D1FAE5",    
  volatile: "#FEF3C7",  
  high: "#FEE2E2"       
};

/* ---------------- MAIN ---------------- */

export default function Dashboard() {
  const navigate = useNavigate();
  const [dataPayload, setDataPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showConfTooltip, setShowConfTooltip] = useState(false);
  const [showAllTransitions, setShowAllTransitions] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await getDashboardLatest();
      const payload = res.data;
      
      if (!payload || !payload.chart || payload.chart.length === 0) {
        setDataPayload(null);
        return;
      }

      // Compute Smoothed Chart Data Natively inside React
      const rawChart = payload.chart || [];
      const computedChart = rawChart.map((pt, i, arr) => {
         let sum = 0;
         let count = 0;
         for (let j = Math.max(0, i - 2); j <= Math.min(arr.length - 1, i + 2); j++) {
             sum += arr[j].value;
             count++;
         }
         return {
            ...pt,
            smoothedValue: sum / count
         };
      });
      // Generate Background Bands strictly for Recharts visual mapping
      const backgroundBands = [];
      if (computedChart.length > 0) {
          let startPoint = computedChart[0];
          for (let i = 1; i < computedChart.length; i++) {
            if (computedChart[i].regime !== startPoint.regime) {
               backgroundBands.push({
                  start: startPoint.timeStr,
                  end: computedChart[i].timeStr,
                  regime: startPoint.regime
               });
               startPoint = computedChart[i];
            }
          }
          backgroundBands.push({
             start: startPoint.timeStr,
             end: computedChart[computedChart.length - 1].timeStr,
             regime: startPoint.regime
          });
      }

      setDataPayload({
         ...payload,
         chart: computedChart,
         bands: backgroundBands
      });

    } catch (err) {
      console.error("DASHBOARD SYNC ERROR:", err);
      setError("Failed to synchronize analytical payload. Please check your backend connection.");
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- UI STATES ---------------- */

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-73px)] bg-slate-50 text-slate-500">
         <RefreshCw size={32} className="animate-spin mb-4 text-indigo-500" />
         <p className="font-bold text-lg text-slate-800">Analyzing data...</p>
         <p className="text-sm">Fetching timeseries regimes and calculating metrics.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-73px)] bg-slate-50 text-rose-500 px-6">
         <AlertTriangle size={48} className="mb-4" />
         <p className="font-bold text-xl text-slate-800 mb-2">System Interruption</p>
         <p className="text-sm font-medium">{error}</p>
      </div>
    );
  }

  if (!dataPayload) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-73px)] bg-[#FFFF]">
         <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 mb-6">
            <Database size={32} />
         </div>
         <h2 className="text-xl font-bold text-slate-800 mb-2">No active analysis dataset</h2>
         <p className="text-sm text-slate-500 mb-8 max-w-sm text-center">
            Upload an environmental dataset or select a historical run to populate the analytical engines.
         </p>
         <button onClick={() => navigate('/upload')} className="bg-[#6366F1] hover:bg-indigo-600 text-white font-bold px-6 py-3 rounded-xl shadow-md shadow-indigo-200 transition-all">
            Upload Dataset to Start 
         </button>
      </div>
    );
  }

  const { chart, bands, summary, recent_transitions, insights, generated_at, stats, run_id } = dataPayload;
  const lastRunDate = generated_at ? new Date(generated_at) : null;
  const lastRunDateStr =
    lastRunDate && !isNaN(lastRunDate.getTime())
      ? lastRunDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute:"2-digit" })
      : "—";

  return (
    <div className="p-8 bg-white min-h-[calc(100vh-73px)] text-slate-800 font-sans max-w-7xl mx-auto border-l border-r border-slate-100 shadow-[0_0_40px_rgba(0,0,0,0.02)]">
      
      {/* HEADER BAR */}
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-[28px] font-bold text-slate-900 tracking-tight mb-2">
            Environmental Dashboard
          </h1>
          <p className="text-[15px] font-medium text-slate-500">
            Real-time Rule Engine + Model Classifications
          </p>
          <p className="text-[12px] font-medium text-slate-500 mt-3 max-w-3xl leading-relaxed">
            Current AQI, regime, and confidence use the last row of the full time series for the run below.
            The chart brush highlights a recent window; it may not include that final row.
          </p>
        </div>

        <div className="flex gap-3 items-center flex-wrap justify-end">
          {stats?.peak_aqi > 400 && (
            <div className="px-3 py-1.5 rounded-full border border-red-200 bg-red-100 shadow-sm flex items-center justify-center animate-pulse">
              <AlertTriangle size={14} className="text-red-600 mr-2" />
              <span className="text-[11px] font-extrabold text-red-700 uppercase tracking-widest">
                SEVERE PEAK DETECTED ({stats.peak_aqi})
              </span>
            </div>
          )}
          {run_id && (
            <div className="px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 shadow-sm flex items-center justify-center">
              <span className="text-[11px] font-mono font-bold text-slate-600 tracking-tight">
                Run {String(run_id).slice(0, 8)}…
              </span>
            </div>
          )}
          <div className="px-3 py-1.5 rounded-full border border-indigo-100 bg-indigo-50 shadow-sm flex items-center justify-center">
            <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-widest">
              <span className="text-indigo-400 mr-2">Last Updated:</span> {lastRunDateStr}
            </span>
          </div>
        </div>
      </div>

      {/* STATS SECTION */}
      <div className="grid grid-cols-3 gap-6 mb-8">
        
        {/* Card 1: Actual AQI */}
        <div className="bg-[#F8FAFC] border border-slate-200 p-6 rounded-[20px] shadow-sm relative overflow-hidden">
          <div className="flex justify-between items-start mb-6">
            <span className="text-[11px] font-black tracking-widest text-slate-500 uppercase">Current AQI</span>
            <div className="p-1.5 rounded-md bg-indigo-100 text-indigo-600">
              <TrendingUp size={16} strokeWidth={2.5} />
            </div>
          </div>
          <h3 className="text-[34px] font-extrabold text-slate-900 tracking-tight leading-none mb-2">
            {summary.current_aqi.toFixed(0)}
          </h3>
          <p className="text-[13px] font-bold text-slate-500 uppercase tracking-wide">{getAQILabel(summary.current_aqi)}</p>
        </div>

        {/* Card 2: Current Regime */}
        <div className={`border p-6 rounded-[20px] shadow-sm relative overflow-hidden ${summary.current_regime === 'high' ? 'bg-rose-50 border-rose-100' : summary.current_regime === 'volatile' ? 'bg-amber-50 border-amber-100' : 'bg-emerald-50 border-emerald-100'}`}>
          <div className="flex justify-between items-start mb-6">
            <span className="text-[11px] font-black tracking-widest text-[#1E293B] uppercase opacity-60">Current Regime</span>
            <div className={`p-1.5 rounded-md bg-white shadow-sm ${summary.current_regime === 'high' ? 'text-rose-500' : summary.current_regime === 'volatile' ? 'text-amber-500' : 'text-emerald-500'}`}>
              <CheckCircle size={16} strokeWidth={2.5} />
            </div>
          </div>
          <h3 className="text-[32px] font-extrabold text-slate-900 tracking-tight leading-none mb-2 capitalize">
            {summary.current_regime}
          </h3>
          <p className="text-[13px] font-bold text-slate-600 uppercase tracking-wide">Classification confirmed</p>
        </div>

        {/* Card 3: Confidence */}
        <div 
           className="bg-[#F8FAFC] border border-slate-200 p-6 rounded-[20px] shadow-sm relative overflow-visible"
           onMouseEnter={() => setShowConfTooltip(true)}
           onMouseLeave={() => setShowConfTooltip(false)}
        >
            <div className="flex justify-between items-start mb-6">
            <span className="text-[11px] font-black tracking-widest text-slate-500 uppercase flex items-center gap-1.5 cursor-help border-b border-dashed border-slate-300 pb-0.5">
              Confidence Score <Info size={12} className="text-sky-500" />
            </span>
            <div className="p-1.5 rounded-md bg-sky-100 text-sky-600">
              <Activity size={16} strokeWidth={2.5} />
            </div>
          </div>
          <h3 className="text-[34px] font-extrabold text-slate-900 tracking-tight leading-none mb-2">
            {(summary.confidence * 100).toFixed(1)}%
          </h3>
          <p className="text-[13px] font-bold text-slate-500 uppercase tracking-wide">
            {summary.confidence > 0.8 ? "High Confidence" : summary.confidence > 0.5 ? "Medium Confidence" : "Low Confidence"}
          </p>
          
          {showConfTooltip && (
            <div className="absolute top-[85px] left-6 z-50 w-64 bg-slate-900 shadow-xl border border-slate-700 p-4 rounded-xl text-white animate-in fade-in slide-in-from-bottom-2">
               <p className="text-[12px] font-medium leading-relaxed opacity-90 text-left">
                  <span className="font-bold text-sky-400">HMM Posterior Probability:</span> Confidence = certainty of current regime classification.
               </p>
               <div className="absolute -top-2 left-8 w-4 h-4 bg-slate-900 border-t border-l border-slate-700 transform rotate-45"></div>
            </div>
          )}
        </div>
      </div>

      {/* MAIN CHART SECTION */}
      <div className="bg-white rounded-[20px] p-8 border border-slate-200 shadow-sm mb-6 relative">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h3 className="text-lg font-bold text-slate-900 tracking-tight">
              Timeseries & Regime Mapping
            </h3>
            <p className="text-sm text-slate-500 mt-1 font-medium">
              Background colors represent the dominant regime at that exact timestamp.
            </p>
          </div>
          <div className="flex gap-5 items-center">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-[#D1FAE5] border border-[#10B981]"></div>
              <span className="text-xs font-bold text-slate-600">Stable</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-[#FEF3C7] border border-[#F59E0B]"></div>
              <span className="text-xs font-bold text-slate-600">Volatile</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-[#FEE2E2] border border-[#EF4444]"></div>
              <span className="text-xs font-bold text-slate-600">High</span>
            </div>
          </div>
        </div>

        {/* Main chart — NO Brush here */}
        <div style={{ width: "100%", height: 360 }}>
          <ResponsiveContainer>
            <LineChart data={chart} margin={{ top: 20, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid stroke="#E2E8F0" strokeDasharray="6 6" vertical={false} />
              <XAxis 
                dataKey="timeStr" 
                stroke="#94A3B8" 
                tick={{ fontSize: 11, fontWeight: 700 }} 
                tickLine={false} 
                axisLine={false} 
                dy={10} 
                minTickGap={60}
                interval="preserveStartEnd"
              />
              <YAxis 
                stroke="#94A3B8" 
                tick={{ fontSize: 11, fontWeight: 700 }} 
                tickLine={false} 
                axisLine={false} 
                tickCount={5}
                domain={['dataMin - 10', 'dataMax + 15']}
              />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}
                labelStyle={{ fontWeight: "bold", color: "#64748B", marginBottom: "4px" }}
                itemStyle={{ fontWeight: "900", color: "#1E293B" }}
                formatter={(val, name) => {
                  if (name === "value") return [`${val.toFixed(1)} AQI`, "Value"];
                  if (name === "confidence") return [`${(val * 100).toFixed(1)}%`, "Confidence"];
                  return [val, name];
                }}
              />
              {bands.map((b, i) => (
                <ReferenceArea key={i} x1={b.start} x2={b.end} fill={REGIME_BG[b.regime]} fillOpacity={1} />
              ))}
              <Line name="Raw Value" type="monotone" dataKey="value" stroke="#94A3B8" strokeWidth={1.5} strokeOpacity={0.4} dot={false} activeDot={false} isAnimationActive={false} />
              <Line name="Smoothed Trend" type="monotone" dataKey="smoothedValue" stroke="#1E293B" strokeWidth={2.5} dot={{ r: 1.5, stroke: "#1E293B", strokeWidth: 1, fill: "white" }} activeDot={{ r: 5, fill: "#000", stroke: "white", strokeWidth: 2 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* ── Real HTML gap between x-axis labels and the range slider ── */}
        <div style={{ height: 20 }} />

        {/* Standalone range slider — separate chart so gap is HTML-controlled */}
        <div style={{ width: "100%", height: 48 }}>
          <ResponsiveContainer>
            <LineChart data={chart} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
              <XAxis dataKey="timeStr" hide />
              <Brush
                dataKey="timeStr"
                height={44}
                y={2}
                stroke="#6366F1"
                fill="#F8FAFC"
                travellerWidth={12}
                tickFormatter={() => ""}
                startIndex={Math.max(0, chart.length - 24)}
                endIndex={chart.length - 1}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* LOWER GRIDS */}
      <div className="grid grid-cols-2 gap-6">
        
        {/* MODEL INSIGHTS - REAL ONES */}
        <div className="bg-white border border-slate-200 p-8 rounded-[20px] shadow-sm">
           <div className="flex items-center gap-3 mb-6">
             <Activity size={20} className="text-slate-800" />
             <h3 className="text-lg font-bold text-slate-900 tracking-tight">System Insights</h3>
           </div>
           
           <div className="space-y-3">
             {insights.map((insight, idx) => (
               <div key={idx} className="bg-slate-50 border border-slate-100 rounded-lg p-4 flex gap-3 items-start">
                 <div className="mt-0.5 text-indigo-500 shrink-0">
                   <Info size={16} />
                 </div>
                 <p className="text-[13px] text-slate-700 font-semibold">{insight}</p>
               </div>
             ))}
             {insights.length === 0 && (
                <p className="text-sm text-slate-500 italic">No significant insights generated during this window.</p>
             )}
           </div>
        </div>

        {/* REAL TRANSITIONS LOG */}
        <div className="bg-white border border-slate-200 p-8 rounded-[20px] shadow-sm">
           <div className="flex items-center gap-3 mb-6">
             <Clock size={20} className="text-slate-800" />
             <h3 className="text-lg font-bold text-slate-900 tracking-tight">State Transitions</h3>
           </div>

           <div className="space-y-0">
             {recent_transitions.length > 0 ? recent_transitions.slice(0, showAllTransitions ? undefined : 8).map((t, i) => {
               const getLabelColor = (rName) => {
                 if (rName === 'high') return "bg-rose-100 text-rose-700";
                 if (rName === 'volatile') return "bg-amber-100 text-amber-700";
                 return "bg-emerald-100 text-emerald-700";
               };

               return (
                <div key={i} className="flex justify-between items-center py-4 border-b border-slate-100 last:border-0">
                  <div className="flex items-center gap-3">
                     <span className={`px-2.5 py-1 rounded-[6px] text-[10px] font-black uppercase tracking-wider ${getLabelColor(t.from)}`}>
                        {t.from}
                     </span>
                     <span className="text-slate-300">
                        →
                     </span>
                     <span className={`px-2.5 py-1 rounded-[6px] text-[10px] font-black uppercase tracking-wider ${getLabelColor(t.to)}`}>
                        {t.to}
                     </span>
                  </div>

                  <div className="text-right">
                     <p className="text-[12px] font-bold text-slate-800">{t.timeStr}</p>
                     <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-wide">{(t.confidence * 100).toFixed(1)}% Conf</p>
                  </div>
                </div>
               );
             }) : (
                <div className="py-8 text-center border-b border-slate-100">
                   <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">No Transitions Detected</p>
                </div>
             )}
             
             {recent_transitions.length > 8 && (
                <div 
                   className="py-4 text-center mt-2 group cursor-pointer transition-colors hover:bg-slate-50 rounded-lg"
                   onClick={() => setShowAllTransitions(!showAllTransitions)}
                >
                   <p className="text-[12px] font-bold text-indigo-500 uppercase tracking-widest group-hover:text-indigo-600">
                      {showAllTransitions ? "Collapse History" : `View Full History (${recent_transitions.length})`}
                   </p>
                </div>
             )}
           </div>
        </div>
      </div>

    </div>
  );
}