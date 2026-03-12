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
    <div style={{ background: "#ffffff", border: "1px solid #dde0e4", borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 12, color: "#1a1a1a", letterSpacing: 2, marginBottom: 10, fontWeight: 700 }}>
        Chỉnh thuật toán (LLM · Anthropic)
      </div>
      {!hasKey && (
        <div style={{ marginBottom: 10 }}>
          <a
            href="https://form.typeform.com/to/gSQXL263"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-block",
              padding: "10px 14px",
              fontSize: 12,
              fontWeight: 600,
              color: "#1a1a1a",
              background: "#f8fafc",
              border: "1px solid #dde0e4",
              borderRadius: 8,
              textDecoration: "none",
              cursor: "pointer",
            }}
          >
            Đăng nhập / Đăng ký
          </a>
        </div>
      )}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="VD: Làm RSI nhạy hơn với vùng oversold/overbought"
        disabled={!hasKey || loading}
        style={{
          width: "100%",
          minHeight: 60,
          padding: "10px 12px",
          fontSize: 13,
          fontFamily: "inherit",
          border: "1px solid #dde0e4",
          borderRadius: 6,
          resize: "vertical",
          background: "#f8fafc",
          color: "#1a1a1a",
          boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={handleAskLLM}
          disabled={!hasKey || loading || !prompt.trim()}
          style={{
            padding: "10px 16px",
            fontSize: 13,
            fontFamily: "inherit",
            fontWeight: 700,
            background: loading ? "#cbd5e1" : "#f8fafc",
            color: "#1a1a1a",
            border: "1px solid #dde0e4",
            borderRadius: 8,
            cursor: loading ? "not-allowed" : "pointer",
            minHeight: 44,
          }}
        >
          {loading ? "Đang gọi LLM…" : "Hỏi LLM"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={loading}
          style={{
            padding: "10px 16px",
            fontSize: 13,
            fontFamily: "inherit",
            background: "#f8fafc",
            color: "#5c5c5c",
            border: "1px solid #dde0e4",
            borderRadius: 8,
            cursor: loading ? "not-allowed" : "pointer",
            minHeight: 44,
          }}
        >
          Đặt lại mặc định
        </button>
      </div>
      {lastResult && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 8,
            fontSize: 12,
            background: lastResult.success ? "#ecfdf5" : "#fef2f2",
            border: lastResult.success ? "1px solid #a7f3d0" : "1px solid #fecaca",
            color: lastResult.success ? "#065f46" : "#b91c1c",
          }}
        >
          {lastResult.reset
            ? "Đã đặt lại cấu hình mặc định."
            : lastResult.success
              ? "Đã áp dụng: " + (lastResult.applied ? Object.entries(lastResult.applied).map(([k, v]) => `${k}=${v}`).join(", ") : "")
              : lastResult.error}
        </div>
      )}
    </div>
  );
}
