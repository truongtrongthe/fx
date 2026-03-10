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
    <div style={{ background: "#ffffff", border: "1px solid #c8d1e0", borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 9, color: "#1a3050", letterSpacing: 2, marginBottom: 8 }}>
        LLM ALGORITHM TUNER · ANTHROPIC
      </div>
      {!hasKey && (
        <div style={{ background: "#fff7e6", border: "1px solid #ffd591", borderRadius: 6, padding: "6px 10px", fontSize: 9, color: "#ad6800", marginBottom: 8 }}>
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
          border: "1px solid #c8d1e0",
          borderRadius: 6,
          resize: "vertical",
          background: "#fafbfc",
          color: "#223047",
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
            background: loading ? "#c3ccdd" : "#e8eef5",
            color: "#1a3050",
            border: "1px solid #8bb6e8",
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
            background: "#f5f7ff",
            color: "#5f6b7a",
            border: "1px solid #c8d1e0",
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
            background: lastResult.success ? "#e6fffb" : "#fff1f0",
            border: lastResult.success ? "1px solid #87e8de" : "1px solid #ffa39e",
            color: lastResult.success ? "#0d5c52" : "#cf1322",
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
