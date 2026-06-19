import { useEffect, useState } from "react";
import { getRunDetails } from "../api/api";
import { useParams, useNavigate } from "react-router-dom";
import { Activity, ArrowLeft, TerminalSquare, AlertTriangle } from "lucide-react";

export default function RunDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetchRawDetail();
  }, [id, page]);

  const fetchRawDetail = async () => {
    try {
      const res = await getRunDetails(id);
      setPayload(res.data);
    } catch(err) {
      setError("Failed to locate isolated execution block.");
    } finally {
      setLoading(false);
    }
  };

  const getLabelColor = (rName) => {
    if (rName === 'high') return "bg-rose-100 text-rose-700 border-rose-200";
    if (rName === 'volatile') return "bg-amber-100 text-amber-700 border-amber-200";
    return "bg-emerald-100 text-emerald-700 border-emerald-200";
  };

  if (loading) {
     return (
        <div className="p-10 bg-[#FBFCFF] min-h-[calc(100vh-73px)] flex items-center justify-center">
            <Activity className="w-10 h-10 text-indigo-500 animate-spin" />
        </div>
     );
  }

  if (error) {
     return (
        <div className="p-10 bg-[#FBFCFF] min-h-[calc(100vh-73px)] text-slate-800">
           <div className="bg-rose-50 p-6 rounded-xl border border-rose-100 text-rose-700 font-bold flex items-center gap-3">
              <AlertTriangle size={20}/> {error}
           </div>
        </div>
     );
  }

  const { meta, data } = payload;

  return (
    <div className="p-12 bg-[#FBFCFF] min-h-[calc(100vh-73px)] text-slate-800 font-sans max-w-[1500px] mx-auto pb-24 border-l border-slate-100 shadow-[0_0_40px_rgba(0,0,0,0.01)]">
      
      <button onClick={() => navigate('/history')} className="flex items-center gap-2 text-slate-400 hover:text-slate-800 font-bold mb-8 transition-colors">
         <ArrowLeft size={16} strokeWidth={3}/> Back to Audit Logs
      </button>

      <div className="mb-10 flex justify-between items-end border-b border-slate-200 pb-8">
         <div>
            <div className="flex items-center gap-3 mb-2 text-indigo-500">
               <TerminalSquare size={20} strokeWidth={2.5}/>
               <span className="text-[11px] font-black uppercase tracking-widest leading-none">Execution Hex</span>
            </div>
            <h1 className="text-[32px] font-black text-slate-900 tracking-tight leading-none">
               {meta.run_id.split("-")[0].toUpperCase()}
            </h1>
         </div>

         <div className="flex flex-wrap gap-8 justify-end">
            <div className="text-right pl-8 border-l border-slate-200">
               <span className="block text-[11px] font-black tracking-widest text-slate-400 uppercase mb-1">Target Base</span>
               <span className="text-[14px] font-bold text-slate-800 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">{meta.dataset_name}</span>
            </div>
            <div className="text-right pl-8 border-l border-slate-200">
               <span className="block text-[11px] font-black tracking-widest text-slate-400 uppercase mb-1">Total Prediction Rows</span>
               <span className="text-[14px] font-bold text-slate-800 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">{meta.total_rows} Rows</span>
            </div>
            <div className="text-right pl-8 border-l border-slate-200">
               <span className="block text-[11px] font-black tracking-widest text-slate-400 uppercase mb-1">Run Peak AQI</span>
               <span className="text-[14px] font-bold text-slate-800 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">{meta.peak_aqi} AQI</span>
            </div>
            <div className="text-right pl-8 border-l border-slate-200">
               <span className="block text-[11px] font-black tracking-widest text-slate-400 uppercase mb-1">Stable / Volatile / High</span>
               <span className="text-[14px] font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                   {meta.stable_pct}% / {meta.volatile_pct}% / {meta.high_pct}%
               </span>
            </div>
         </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
         <div className="p-6 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <h3 className="text-[15px] font-black text-slate-800 tracking-tight">Post-Execution Time Series Mappings</h3>
            <span className="text-[11px] font-bold text-slate-500 bg-white px-3 py-1 border border-slate-200 rounded-full">Viewing Live Pagination Bounds</span>
         </div>
         <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
               <thead>
                  <tr className="bg-white">
                     <th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Index ID</th>
                     <th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Temporal Timestamp</th>
                     <th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 text-right">Raw Obs. Value (AQI)</th>
                     <th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 text-center">Unsupervised Cluster Matrix</th>
                     <th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Mapped Logical Regime bounds</th>
                  </tr>
               </thead>
               <tbody className="bg-white">
                  {data.map((row, idx) => (
                     <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-3.5 text-[13px] font-bold text-slate-400">#{String(((page - 1) * 100) + idx + 1).padStart(3, '0')}</td>
                        <td className="px-6 py-3.5 text-[14px] font-bold text-slate-600">{row.timestamp.split(".")[0].replace("T", " ")}</td>
                        <td className="px-6 py-3.5 text-[14px] font-black text-slate-800 text-right font-mono">{row.observed_value.toFixed(2)}</td>
                        <td className="px-6 py-3.5 text-[14px] font-bold text-slate-500 text-center">State {row.predicted_state}</td>
                        <td className="px-6 py-3.5 flex items-center gap-2">
                           <span className={`inline-block px-3 py-1 rounded-[6px] text-[10px] font-black uppercase tracking-wider border ${getLabelColor(row.regime)}`}>
                              {row.regime}
                           </span>
                           {row.confidence && (
                               <span className="text-[11px] font-bold text-slate-400">{(row.confidence * 100).toFixed(1)}% Conf</span>
                           )}
                        </td>
                     </tr>
                  ))}
                  {data.length === 0 && (
                     <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-sm font-bold text-slate-400">No predictions successfully preserved in isolated memory structure.</td>
                     </tr>
                  )}
               </tbody>
            </table>
         </div>
         <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center text-sm font-bold text-slate-500">
            <span>Showing Page {page} (Max 100 per page)</span>
            <div className="flex gap-2">
               <button 
                   disabled={page === 1} 
                   onClick={() => setPage(page - 1)}
                   className="px-4 py-2 bg-white border border-slate-200 rounded-lg disabled:opacity-50 hover:bg-slate-50 transition-colors"
               >
                   Previous
               </button>
               <button 
                   disabled={data.length < 100}
                   onClick={() => setPage(page + 1)}
                   className="px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50 hover:bg-indigo-700 transition-colors"
               >
                   Next Page
               </button>
            </div>
         </div>
      </div>

    </div>
  );
}
