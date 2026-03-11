/**
 * Panel for tuning the algorithm via Anthropic LLM: user types a request, we call the API and apply the returned config patch.
 */

import { useState } from "react";
import { getAlgorithmConfig, updateAlgorithmConfig, resetAlgorithmConfig } from "./algorithmConfig.js";
import { askLLMForConfig } from "./llmService.js";

export function AlgorithmSettingsPanel({ onConfigApplied }) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState(null); // { success, applied?: object, error?: string }

  const handleAskLLM = async () => {
    const text = prompt.trim();
    if (!text) return;
    setLoading(true);
    setLastResult(null);
    try {
      const currentConfig = getAlgorithmConfig();
      const result = await askLLMForConfig(text, currentConfig);
      if (result.success && result.configPatch) {
        updateAlgorithmConfig(result.configPatch);
        setLastResult({ success: true, applied: result.configPatch });
        if (typeof onConfigApplied === "function") onConfigApplied();
      } else {
        setLastResult({ success: false, error: result.error || "Unknown error" });
      }
    } catch (err) {
      setLastResult({ success: false, error: err?.message || "Request failed" });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    resetAlgorithmConfig();
    setLastResult({ success: true, applied: null, reset: true });
    if (typeof onConfigApplied === "function") onConfigApplied();
  };

  const hasKey = !!(typeof import.meta !== "undefined" && import.meta.env?.VITE_ANTHROPIC_KEY);

  return (
    <div style={{ background: "#ffffff", border: "1px solid #dde0e4", borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 9, color: "#1a1a1a", letterSpacing: 2, marginBottom: 8, fontWeight: 700 }}>
        LLM ALGORITHM TUNER · ANTHROPIC
      </div>
      {!hasKey && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "6px 10px", fontSize: 9, color: "#b45309", marginBottom: 8 }}>
          Set VITE_ANTHROPIC_KEY in .env to use this feature.
        </div>
      )}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. Make RSI more sensitive for oversold/overbought"
        disabled={!hasKey || loading}
        style={{
          width: "100%",
          minHeight: 56,
          padding: "6px 8px",
          fontSize: 10,
          fontFamily: "inherit",
          border: "1px solid #dde0e4",
          borderRadius: 6,
          resize: "vertical",
          background: "#f8fafc",
          color: "#1a1a1a",
          boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={handleAskLLM}
          disabled={!hasKey || loading || !prompt.trim()}
          style={{
            padding: "5px 12px",
            fontSize: 9,
            fontFamily: "inherit",
            fontWeight: 700,
            background: loading ? "#cbd5e1" : "#f8fafc",
            color: "#1a1a1a",
            border: "1px solid #dde0e4",
            borderRadius: 6,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Calling LLM…" : "Ask LLM"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={loading}
          style={{
            padding: "5px 12px",
            fontSize: 9,
            fontFamily: "inherit",
            background: "#f8fafc",
            color: "#5c5c5c",
            border: "1px solid #dde0e4",
            borderRadius: 6,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          Reset to defaults
        </button>
      </div>
      {lastResult && (
        <div
          style={{
            marginTop: 8,
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 9,
            background: lastResult.success ? "#ecfdf5" : "#fef2f2",
            border: lastResult.success ? "1px solid #a7f3d0" : "1px solid #fecaca",
            color: lastResult.success ? "#065f46" : "#b91c1c",
          }}
        >
          {lastResult.reset
            ? "Config reset to defaults."
            : lastResult.success
              ? "Applied: " + (lastResult.applied ? Object.entries(lastResult.applied).map(([k, v]) => `${k}=${v}`).join(", ") : "")
              : lastResult.error}
        </div>
      )}
    </div>
  );
}
