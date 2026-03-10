/**
 * Central algorithm configuration. Used by algorithm.js and by the LLM service.
 * LLM-generated patches are merged here; optional localStorage persistence.
 */

const STORAGE_KEY = "rich-ai-algorithm-config";

const DEFAULT_CONFIG = {
  rsiOversold: 30,
  rsiOverbought: 70,
  rsiMomentumLow: 45,
  rsiMomentumHigh: 60,
  stochOversold: 20,
  stochOverbought: 80,
  scoreThresholdLong: 3,
  scoreThresholdShort: 3,
  atrSlMultiplier: 1.2,
  confBase: 12,
  confScale: 4,
};

let currentConfig = { ...DEFAULT_CONFIG };

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        currentConfig = { ...DEFAULT_CONFIG, ...parsed };
      }
    }
  } catch (_) {
    // ignore
  }
}

function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentConfig));
  } catch (_) {
    // ignore
  }
}

// Load persisted config on module load
loadFromStorage();

/**
 * @returns {object} Current algorithm config (read-only copy).
 */
export function getAlgorithmConfig() {
  return { ...currentConfig };
}

/**
 * Merge a patch into current config. Only allowed keys are applied.
 * @param {object} patch - Partial config (e.g. from LLM). Unknown keys are ignored.
 */
export function updateAlgorithmConfig(patch) {
  if (!patch || typeof patch !== "object") return;
  const allowed = new Set(Object.keys(DEFAULT_CONFIG));
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (allowed.has(key) && typeof value === "number" && !Number.isNaN(value)) {
      currentConfig[key] = value;
      changed = true;
    }
  }
  if (changed) saveToStorage();
}

/**
 * Reset config to defaults and clear persisted overlay.
 */
export function resetAlgorithmConfig() {
  currentConfig = { ...DEFAULT_CONFIG };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
}

export { DEFAULT_CONFIG };
