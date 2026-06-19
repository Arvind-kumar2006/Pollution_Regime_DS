import { useState, useRef } from "react";
import { uploadFile, trainModel } from "../api/api";
import { useApp } from "../context/AppContext";
import { ArrowUpFromLine, File, X, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Upload() {
  const navigate = useNavigate();
  const {
    uploadedFile,
    setUploadedFile,
    lastUploadedName,
    setLastUploadedName,
    latestDatasetId,
    setLatestDatasetId,
    refreshFromBackend,
  } = useApp();

  const [loading, setLoading] = useState(false);
  const [training, setTraining] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const formatBytes = (bytes, decimals = 1) => {
    if (!+bytes) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
  };

  const extractErrorMessage = (err) => {
    const detail = err?.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail)) return detail.map((d) => d.msg).join(", ");
    return err?.message || "Upload failed";
  };

  const processFile = async (file) => {
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      setError("Only CSV files are accepted.");
      return;
    }
    setUploadedFile(file);
    setError("");
    setMessage("");
    setUploadProgress(0);

    try {
      setLoading(true);
      const formData = new FormData();
      formData.append("file", file);
      const res = await uploadFile(formData, (e) => {
        if (e.total) setUploadProgress(Math.round((e.loaded / e.total) * 100));
      });
      setUploadProgress(100);
      setMessage(res.data?.message || "Dataset uploaded successfully");
      setLastUploadedName(file.name);
      if (res?.data?.dataset_id) {
        setLatestDatasetId(res.data.dataset_id);
      }
      await refreshFromBackend();
    } catch (err) {
      setError(extractErrorMessage(err));
      setUploadProgress(0);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => processFile(e.target.files[0]);

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    processFile(e.dataTransfer.files[0]);
  };

  const handleRemove = () => {
    setUploadedFile(null);
    setMessage("");
    setError("");
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleTrain = async () => {
    try {
      setTraining(true);
      setError("");
      await trainModel(undefined, latestDatasetId || undefined);
      setMessage("Model trained successfully! Redirecting...");
      setTimeout(() => navigate("/dashboard"), 1500);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setTraining(false);
    }
  };

  const displayFile = uploadedFile || (lastUploadedName ? { name: lastUploadedName, size: null } : null);

  return (
    <div className="min-h-screen bg-white font-sans">
      <div className="max-w-4xl mx-auto px-10 py-10">

        {/* Step label */}
        <p className="text-xs font-bold text-indigo-500 tracking-widest uppercase mb-3">
          Step 1 of 3
        </p>

        {/* Header row */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-[34px] font-black text-slate-900 tracking-tight leading-none mb-3">
              Dataset Ingestion
            </h1>
            <p className="text-[15px] text-slate-500 font-medium max-w-lg leading-relaxed mb-2">
              Upload time-series air quality data and configure regime classification parameters
              before running the HMM model.
            </p>
            <a
              href="/pollution.csv"
              download="pollution.csv"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              <File size={12} />
              Download Template Dataset (pollution.csv)
            </a>
          </div>

          <button
            onClick={handleTrain}
            disabled={training || (!uploadedFile && !lastUploadedName)}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all shadow-lg ${
              training || (!uploadedFile && !lastUploadedName)
                ? "bg-slate-200 text-slate-400 shadow-none cursor-not-allowed"
                : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200 hover:-translate-y-0.5"
            }`}
          >
            <Sparkles size={16} />
            {training ? "Training..." : "Analyze & Classify"}
          </button>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 rounded-2xl p-16 flex flex-col items-center justify-center text-center transition-all mb-6 cursor-pointer ${
            isDragging
              ? "border-indigo-400 bg-indigo-50"
              : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50/50"
          }`}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileChange}
          />

          <div className={`w-14 h-14 rounded-full border-2 flex items-center justify-center mb-5 transition-colors ${
            isDragging ? "border-indigo-400 bg-indigo-100 text-indigo-600" : "border-slate-200 bg-white text-slate-400"
          }`}>
            <ArrowUpFromLine size={22} strokeWidth={2} />
          </div>

          <h3 className="text-xl font-bold text-slate-800 mb-2">
            Upload CSV / JSON / XLSX
          </h3>
          <p className="text-sm text-slate-400 font-medium mb-8">
            Drag &amp; drop your air quality dataset, or browse files.<br />
            Maximum 50MB per upload.
          </p>

          <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm px-6 py-2.5 rounded-lg shadow-md shadow-indigo-200 transition-all hover:-translate-y-0.5"
            >
              Select File
            </button>
            <span className="text-sm text-slate-400 font-medium">or drop here</span>
          </div>
        </div>

        {/* File card — shown when a file is selected OR one was previously uploaded */}
        {displayFile && (
          <div className="border border-slate-200 rounded-2xl p-5 bg-white shadow-sm">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-500 flex-shrink-0">
                <File size={18} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-bold text-slate-800 truncate">
                    {displayFile.name}
                  </span>
                  <div className="flex items-center gap-4 ml-4 flex-shrink-0">
                    {displayFile.size && (
                      <span className="text-xs font-semibold text-slate-400">
                        {formatBytes(displayFile.size)}
                      </span>
                    )}
                    {uploadedFile && (
                      <button
                        onClick={handleRemove}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-400">
                    {loading
                      ? "Uploading dataset..."
                      : message
                      ? message
                      : error || (lastUploadedName && !uploadedFile ? "Previously uploaded — ready to train" : "Ready")}
                  </p>
                  <span className="text-xs font-bold text-slate-500 ml-4">
                    {loading ? `${uploadProgress}%` : uploadProgress === 100 ? "100%" : ""}
                  </span>
                </div>

                {/* Progress bar */}
                {loading && (
                  <div className="mt-2 w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Inline error (when no file card) */}
        {error && !displayFile && (
          <div className="mt-4 px-5 py-3 bg-rose-50 border border-rose-100 rounded-xl text-sm font-semibold text-rose-600">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}