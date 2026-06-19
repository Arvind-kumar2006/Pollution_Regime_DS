import { useEffect, useState } from "react";
import { getSettings, putSettings, resetSettings } from "../api/api";
import {
  Settings as SettingsIcon,
  Save,
  Activity,
  Check,
  RotateCcw,
  AlertCircle,
} from "lucide-react";

function formatApiError(err) {
  const d = err?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d.map((e) => e.msg || JSON.stringify(e)).join("; ");
  }
  return err?.message || "Request failed";
}

function validateLocal(s) {
  const e = {};
  const n = Number(s.n_states);
  if (!Number.isInteger(n) || n < 2 || n > 10) e.n_states = "Use an integer from 2 to 10.";
  const pm = Number(s.pm25_threshold);
  if (!(pm > 0) || pm > 500) e.pm25_threshold = "Must be greater than 0 and at most 500.";
  const vr = Number(s.volatility_ratio);
  if (vr < 0.01 || vr > 1) e.volatility_ratio = "Must be between 0.01 and 1.";
  const high = Number(s.regime_high_aqi);
  if (!(high > 0) || high > 600) e.regime_high_aqi = "Must be between 0 and 600 (exclusive of 0).";
  const stable = Number(s.regime_stable_max_aqi);
  if (!(stable > 0) || stable > 500)
    e.regime_stable_max_aqi = "Must be between 0 and 500 (exclusive of 0).";
  if (stable >= high) e.regime_stable_max_aqi = "Must be less than regime high AQI.";
  const dwell = Number(s.min_dwell_hours);
  if (dwell < 1 || dwell > 168) e.min_dwell_hours = "Must be between 1 and 168 hours.";
  return e;
}

function mapResponseToState(data) {
  const inner = data.settings ?? data;
  return {
    n_states: inner.n_states,
    pm25_threshold: inner.pm25_threshold,
    volatility_ratio: inner.volatility_ratio,
    regime_high_aqi: inner.regime_high_aqi,
    regime_stable_max_aqi: inner.regime_stable_max_aqi,
    min_dwell_hours: inner.min_dwell_hours,
    smoothing_enabled: Boolean(inner.smoothing_enabled),
  };
}

export default function Settings() {
  const [config, setConfig] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saveError, setSaveError] = useState("");
  const [toast, setToast] = useState("");

  const applyPayload = (resData) => {
    setConfig(mapResponseToState(resData));
    setMeta(resData.meta ?? null);
  };

  const fetchConfig = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await getSettings();
      applyPayload(res.data);
    } catch (e) {
      console.error(e);
      setLoadError(formatApiError(e));
      setConfig(null);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleSave = async () => {
    setSaveError("");
    const errs = validateLocal(config);
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      const body = {
        n_states: Number(config.n_states),
        pm25_threshold: Number(config.pm25_threshold),
        volatility_ratio: Number(config.volatility_ratio),
        regime_high_aqi: Number(config.regime_high_aqi),
        regime_stable_max_aqi: Number(config.regime_stable_max_aqi),
        min_dwell_hours: Number(config.min_dwell_hours),
        smoothing_enabled: Boolean(config.smoothing_enabled),
      };
      const res = await putSettings(body);
      applyPayload(res.data);
      setToast("Configuration updated successfully");
      setTimeout(() => setToast(""), 3000);
    } catch (e) {
      console.error(e);
      setSaveError(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaveError("");
    setResetting(true);
    try {
      const res = await resetSettings();
      applyPayload(res.data);
      setFieldErrors({});
      setToast("Configuration updated successfully");
      setTimeout(() => setToast(""), 3000);
    } catch (e) {
      console.error(e);
      setSaveError(formatApiError(e));
    } finally {
      setResetting(false);
    }
  };

  const handleNumberChange = (key, raw) => {
    const v = raw === "" ? "" : Number(raw);
    setConfig((prev) => ({ ...prev, [key]: Number.isNaN(v) ? raw : v }));
  };

  if (loading) {
    return (
      <div className="p-10 bg-[#FBFCFF] min-h-[calc(100vh-73px)] flex items-center justify-center">
        <div className="flex flex-col items-center">
          <Activity className="w-10 h-10 text-slate-400 animate-spin mb-4" />
          <p className="font-bold text-slate-500">Loading configuration…</p>
        </div>
      </div>
    );
  }

  if (loadError || !config) {
    return (
      <div className="p-10 bg-[#FBFCFF] min-h-[calc(100vh-73px)] flex items-center justify-center">
        <div className="max-w-md rounded-2xl border border-red-200 bg-white p-8 shadow-sm text-center">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-4" />
          <p className="text-slate-800 font-bold mb-2">Could not load settings</p>
          <p className="text-sm text-slate-600 mb-6">{loadError}</p>
          <button
            type="button"
            onClick={fetchConfig}
            className="rounded-xl bg-slate-900 text-white font-bold px-6 py-3 hover:bg-slate-800"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const row = (key, title, hint, inputEl) => (
    <div
      key={key}
      className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 pb-8 border-b border-slate-100 last:border-0 last:pb-0"
    >
      <div className="sm:w-[58%]">
        <h4 className="text-[16px] font-black text-slate-900 mb-1">{title}</h4>
        <p className="text-[13px] font-medium text-slate-500 leading-relaxed">{hint}</p>
        {fieldErrors[key] && (
          <p className="text-[12px] font-semibold text-red-600 mt-2">{fieldErrors[key]}</p>
        )}
      </div>
      <div className="sm:w-[160px] shrink-0">{inputEl}</div>
    </div>
  );

  return (
    <div className="p-12 bg-[#FBFCFF] min-h-[calc(100vh-73px)] text-slate-800 font-sans max-w-[1500px] mx-auto pb-24 border-l border-slate-100 shadow-[0_0_40px_rgba(0,0,0,0.01)]">
      {toast && (
        <div className="fixed bottom-8 right-8 bg-slate-900 shadow-xl rounded-xl p-4 flex items-center gap-3 z-50">
          <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-white shrink-0">
            <Check size={12} strokeWidth={3} />
          </div>
          <p className="text-[13px] font-bold text-white">{toast}</p>
        </div>
      )}

      <div className="mb-10 flex flex-col gap-4 max-w-3xl">
        <div>
          <h1 className="text-[32px] font-black text-slate-900 tracking-tight mb-2 flex items-center gap-3">
            <SettingsIcon size={28} className="text-slate-400" />
            System configuration
          </h1>
          <p className="text-[15px] font-medium text-slate-500 leading-relaxed">
            Inference parameters used by training and prediction. Values are loaded from the server
            only; changes are saved to the database and apply on the next request.
          </p>
        </div>
        {meta && (
          <p className="text-[12px] font-medium text-slate-400">
            Config version {meta.config_version}
            {meta.last_updated_at != null && meta.last_updated_at !== ""
              ? ` · Last updated ${meta.last_updated_at}`
              : ""}
          </p>
        )}

        {/* Workflow instruction banner */}
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5 mt-1">
          <p className="text-[12px] font-black text-indigo-600 uppercase tracking-widest mb-3">How to apply changes</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex items-start gap-3 flex-1 bg-white rounded-xl border border-indigo-100 px-4 py-3 shadow-sm">
              <div className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">1</div>
              <div>
                <p className="text-[13px] font-black text-slate-800">Customize Settings</p>
                <p className="text-[12px] text-slate-500 font-medium mt-0.5">Adjust the parameters below to match your desired analysis behaviour (states, thresholds, dwell time etc.)</p>
              </div>
            </div>
            <div className="flex items-start gap-3 flex-1 bg-white rounded-xl border border-indigo-100 px-4 py-3 shadow-sm">
              <div className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">2</div>
              <div>
                <p className="text-[13px] font-black text-slate-800">Save Configuration</p>
                <p className="text-[12px] text-slate-500 font-medium mt-0.5">Click <span className="font-black text-indigo-600">Save Configuration</span> below. Settings are persisted to the database immediately.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 flex-1 bg-white rounded-xl border border-indigo-100 px-4 py-3 shadow-sm">
              <div className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">3</div>
              <div>
                <p className="text-[13px] font-black text-slate-800">Re-upload &amp; Retrain</p>
                <p className="text-[12px] text-slate-500 font-medium mt-0.5">Go to <span className="font-black text-indigo-600">Upload Data</span>, re-submit your dataset, then retrain the model to get your desired output.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-10 shadow-sm max-w-3xl flex flex-col gap-8">
        {row(
          "n_states",
          "HMM hidden states",
          "Number of latent states the model uses (2–10).",
          <input
            type="number"
            min={2}
            max={10}
            value={config.n_states}
            onChange={(e) => handleNumberChange("n_states", e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[16px] font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all shadow-inner"
          />
        )}
        {row(
          "pm25_threshold",
          "PM2.5 / AQI threshold",
          "Pollution index used for physical bounds and confidence shaping (positive, max 500).",
          <input
            type="number"
            step="0.1"
            value={config.pm25_threshold}
            onChange={(e) => handleNumberChange("pm25_threshold", e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[16px] font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all shadow-inner"
          />
        )}
        {row(
          "volatility_ratio",
          "Volatility ratio",
          "Relative volatility above which the middle band is treated as unstable (0.01–1).",
          <input
            type="number"
            step="0.01"
            value={config.volatility_ratio}
            onChange={(e) => handleNumberChange("volatility_ratio", e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[16px] font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all shadow-inner"
          />
        )}
        {row(
          "regime_high_aqi",
          "Regime high AQI",
          "AQI above this maps to the high regime (must be greater than stable max).",
          <input
            type="number"
            step="0.1"
            value={config.regime_high_aqi}
            onChange={(e) => handleNumberChange("regime_high_aqi", e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[16px] font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all shadow-inner"
          />
        )}
        {row(
          "regime_stable_max_aqi",
          "Regime stable max AQI",
          "AQI below this can be classified stable when volatility is low (must be less than high AQI).",
          <input
            type="number"
            step="0.1"
            value={config.regime_stable_max_aqi}
            onChange={(e) => handleNumberChange("regime_stable_max_aqi", e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[16px] font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all shadow-inner"
          />
        )}
        {row(
          "min_dwell_hours",
          "Minimum dwell (hours)",
          "Short regime segments shorter than this (in time, inferred from your data’s timestep) are merged with neighbors.",
          <input
            type="number"
            step="0.1"
            min={1}
            value={config.min_dwell_hours}
            onChange={(e) => handleNumberChange("min_dwell_hours", e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[16px] font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all shadow-inner"
          />
        )}
        {row(
          "smoothing_enabled",
          "Post-hoc regime smoothing",
          "When enabled, very short regime runs are merged to reduce flicker.",
          <label className="flex items-center gap-3 cursor-pointer font-bold text-slate-800">
            <input
              type="checkbox"
              checked={config.smoothing_enabled}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, smoothing_enabled: e.target.checked }))
              }
              className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            Enabled
          </label>
        )}

        {saveError && (
          <p className="text-[13px] font-semibold text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            {saveError}
          </p>
        )}

        <div className="pt-4 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={handleReset}
            disabled={resetting || saving}
            className="flex items-center gap-2 border border-slate-200 bg-white text-slate-800 font-bold px-6 py-3.5 rounded-xl hover:bg-slate-50 disabled:opacity-50"
          >
            {resetting ? (
              <Activity size={18} className="animate-spin" />
            ) : (
              <RotateCcw size={18} strokeWidth={2.5} />
            )}
            Reset defaults
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || resetting}
            className="flex items-center gap-2 bg-[#6366F1] hover:bg-indigo-600 active:bg-indigo-700 disabled:bg-slate-300 text-white font-bold px-8 py-3.5 rounded-xl transition-all shadow-md shadow-indigo-200"
          >
            {saving ? (
              <Activity size={18} className="animate-spin" />
            ) : (
              <Save size={18} strokeWidth={2.5} />
            )}
            Save configuration
          </button>
        </div>
      </div>
    </div>
  );
}
