import axios from "axios";
import { API_BASE_URL, API_ENDPOINTS } from "./endpoints";

const API = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

/** Same value as backend SETTINGS_API_KEY when APP_ENV=production (Vite injects at build time). */
function settingsWriteHeaders() {
  const k = import.meta.env.VITE_SETTINGS_WRITE_KEY;
  return k ? { "X-API-KEY": String(k) } : {};
}

const isDev = import.meta.env.DEV;

API.interceptors.request.use((config) => {
  if (isDev) {
    console.debug("[API REQUEST]", config.method?.toUpperCase(), config.url, config.params || "");
  }
  return config;
});

API.interceptors.response.use(
  (response) => {
    if (isDev) {
      console.debug("[API RESPONSE]", response.config.url, response.status);
    }
    return response;
  },
  (error) => {
    console.error("[API ERROR]", error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export const trainModel = (n_states, dataset_id) => {
  return API.post(API_ENDPOINTS.train, null, {
    params: { n_states, dataset_id },
    // Training can take minutes; don't fail the UI at 15s.
    timeout: 5 * 60 * 1000,
  });
};

export const getPredictions = (limit = 1000, regime = "") => {
  const params = { limit };
  if (regime) params.regime = regime;
  return API.get(API_ENDPOINTS.predict, { params });
};

export const getHistory = () => {
  return API.get(`${API_ENDPOINTS.modelInfo.replace("/info", "")}/history`);
};

export const getRunDetails = (runId, page = 1) => {
  return API.get(
    `${API_ENDPOINTS.modelInfo.replace("/info", "")}/history/${runId}?page=${page}&limit=100`
  );
};

export const getDashboardLatest = () => {
  return API.get("/model/dashboard/latest");
};

export const deleteHistoryRun = (id) => {
  return API.delete(`${API_ENDPOINTS.history}/${id}`);
};

export const getSettings = () => {
  return API.get("/settings/");
};

export const putSettings = (payload) => {
  return API.put("/settings/", payload, { headers: settingsWriteHeaders() });
};

export const resetSettings = () => {
  return API.post("/settings/reset", null, { headers: settingsWriteHeaders() });
};

export const getModelInfo = () => {
  return API.get(API_ENDPOINTS.modelInfo);
};

export const getAdvancedAnalytics = (days = null) => {
  const query = days != null ? `?days=${days}` : "";
  return API.get(`${API_ENDPOINTS.modelInfo.replace("/info", "")}/advanced-analytics${query}`);
};

export const uploadFile = (formData, onProgress) => {
  return API.post(API_ENDPOINTS.upload, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
    onUploadProgress: onProgress,
  });
};

/** Lightweight probe for Navbar / diagnostics (same origin as API). */
export const fetchHealth = () => API.get("/health", { timeout: 5000 });

export default API;
