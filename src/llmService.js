/**
 * LLM service: calls Anthropic API to generate algorithm config patches from natural language.
 * Uses VITE_ANTHROPIC_KEY from env. For production, consider a backend proxy to avoid exposing the key.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-3-5-sonnet-20241022";
const MAX_TOKENS = 1024;

function getApiKey() {
  return (typeof import.meta !== "undefined" && import.meta.env?.VITE_ANTHROPIC_KEY) || "";
}

/**
 * Schema of allowed config keys for the algorithm. LLM must return a JSON object with only these (or a subset).
 */
export const ALGORITHM_CONFIG_SCHEMA = {
  rsiOversold: { type: "number", min: 0, max: 50, default: 30, description: "RSI level below which is oversold (bullish)" },
  rsiOverbought: { type: "number", min: 50, max: 100, default: 70, description: "RSI level above which is overbought (bearish)" },
  rsiMomentumLow: { type: "number", min: 0, max: 60, default: 45, description: "RSI lower bound for momentum zone" },
  rsiMomentumHigh: { type: "number", min: 40, max: 100, default: 60, description: "RSI upper bound for momentum zone" },
  stochOversold: { type: "number", min: 0, max: 40, default: 20, description: "Stochastic below this = oversold" },
  stochOverbought: { type: "number", min: 60, max: 100, default: 80, description: "Stochastic above this = overbought" },
  scoreThresholdLong: { type: "number", min: 1, max: 10, default: 3, description: "Min score for LONG signal" },
  scoreThresholdShort: { type: "number", min: 1, max: 10, default: 3, description: "Min abs score for SHORT signal" },
  atrSlMultiplier: { type: "number", min: 0.5, max: 3, default: 1.2, description: "ATR multiplier for stop-loss distance" },
  confBase: { type: "number", min: 0, max: 50, default: 12, description: "Base confidence percentage" },
  confScale: { type: "number", min: 0, max: 20, default: 4, description: "Random confidence spread" },
};

const SCHEMA_DESC = Object.entries(ALGORITHM_CONFIG_SCHEMA)
  .map(([k, v]) => `  ${k}: ${v.description} (number, default ${v.default})`)
  .join("\n");

function buildSystemPrompt(currentConfig) {
  return `You are a trading algorithm tuner. The user will describe desired changes to a gold (XAU/USD) trading algorithm in plain English.

The algorithm uses: RSI, Stochastic, MACD, Bollinger Bands, EMAs (8/21/55), and ATR for stops/targets. Signals are LONG, SHORT, or WAIT based on a score.

You must respond with ONLY a valid JSON object: a subset of the following keys. Do not include any other text, markdown, or code fences. Only the raw JSON object.

Allowed keys (all numbers):
${SCHEMA_DESC}

Current config (user may want to change these):
${JSON.stringify(currentConfig, null, 2)}

Interpret the user's request and output a JSON object with only the keys you want to change. Use the same key names. For example: {"rsiOversold": 25, "rsiOverbought": 75}`;
}

/**
 * Parse LLM response and extract first JSON object. Returns null if invalid.
 */
function extractConfigPatch(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  // Strip markdown code block if present
  let raw = trimmed;
  const codeMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) raw = codeMatch[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Validate and clamp a config patch against ALGORITHM_CONFIG_SCHEMA. Returns a safe patch (only allowed keys, clamped values).
 */
export function validateConfigPatch(patch) {
  if (!patch || typeof patch !== "object") return null;
  const out = {};
  for (const [key, schema] of Object.entries(ALGORITHM_CONFIG_SCHEMA)) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (typeof v !== "number" || Number.isNaN(v)) continue;
    const min = schema.min ?? -Infinity;
    const max = schema.max ?? Infinity;
    out[key] = Math.max(min, Math.min(max, v));
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Call Anthropic API to get a config patch from the user's natural language request.
 * @param {string} userPrompt - Natural language description of desired algorithm change
 * @param {object} currentConfig - Current algorithm config (will be sent as context)
 * @returns {Promise<{ success: boolean, configPatch?: object, error?: string, rawMessage?: string }>}
 */
export async function askLLMForConfig(userPrompt, currentConfig) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { success: false, error: "VITE_ANTHROPIC_KEY is not set in .env" };
  }

  const system = buildSystemPrompt(currentConfig);
  const body = {
    model: DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: userPrompt }],
  };

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    const rawMessage = data.content?.[0]?.text ?? data.error?.message ?? "";

    if (!res.ok) {
      return {
        success: false,
        error: data.error?.message || `HTTP ${res.status}`,
        rawMessage: rawMessage || undefined,
      };
    }

    const patch = extractConfigPatch(rawMessage);
    const validated = validateConfigPatch(patch);
    if (!validated || Object.keys(validated).length === 0) {
      return {
        success: false,
        error: "LLM did not return a valid config patch (expected JSON with allowed keys)",
        rawMessage: rawMessage || undefined,
      };
    }

    return { success: true, configPatch: validated, rawMessage };
  } catch (err) {
    return {
      success: false,
      error: err?.message || "Network or request failed",
      rawMessage: undefined,
    };
  }
}
