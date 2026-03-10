/**
 * Twelve Data REST API feed for XAU/USD (gold) price.
 * Loads historic OHLC then polls price. Stays under free-tier limit (8 credits/min).
 *
 * REST API: https://twelvedata.com/docs
 * Free tier: 8 requests/min — history loaded one TF per 8s, then price every 10s (6/min).
 */

import { useState, useEffect } from "react";
import { TIMEFRAMES } from "./algorithm.js";

// ═══════════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════════
const TWELVEDATA_API_BASE = "https://api.twelvedata.com";
const XAUUSD_SYMBOL = "XAU/USD";
const SPREAD_PIPS = 0.2;
const MAX_BARS_PER_TF = 150;
/** Delay between each history request (one credit each) to stay under 8/min */
const HISTORY_REQUEST_DELAY_MS = 8_000;
/** Live price poll interval — 6/min (every 10s) */
const POLL_INTERVAL_MS = 10_000;

const getApiKey = () =>
  typeof import.meta !== "undefined" && import.meta.env?.VITE_TWELVEDATA_API_KEY
    ? import.meta.env.VITE_TWELVEDATA_API_KEY
    : "demo";

// Map our timeframe keys to Twelve Data interval strings
const INTERVAL_MAP = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1H": "1h",
  "4H": "4h",
  "1D": "1day",
};

async function fetchHistoryForTf(tf) {
  const apiKey = getApiKey();
  const interval = INTERVAL_MAP[tf.key] || "5min";
  const url = `${TWELVEDATA_API_BASE}/time_series?symbol=${encodeURIComponent(
    XAUUSD_SYMBOL
  )}&interval=${encodeURIComponent(interval)}&outputsize=${MAX_BARS_PER_TF}&apikey=${encodeURIComponent(
    apiKey
  )}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.values) {
    const msg = data.message || data.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  // Twelve Data returns most-recent first; reverse to oldest→newest
  const values = Array.isArray(data.values) ? [...data.values].reverse() : [];
  const bars = values
    .map((v) => {
      const t = Date.parse(v.datetime);
      const o = Number(v.open);
      const h = Number(v.high);
      const l = Number(v.low);
      const c = Number(v.close);
      if (!Number.isFinite(t) || ![o, h, l, c].every(Number.isFinite)) return null;
      return { t, o, h, l, c };
    })
    .filter(Boolean);
  return bars.slice(-MAX_BARS_PER_TF);
}

// ═══════════════════════════════════════════════════════════════════════
//  HOOK
// ═══════════════════════════════════════════════════════════════════════
/**
 * Polls Twelve Data REST price API, builds OHLC bars per timeframe,
 * and returns live price, spread, feed status, and bars.
 * @returns {{ allBars, livePrice, spread, tickCount, feedStatus, feedError }}
 */
export function useDataFeed() {
  const [allBars, setAllBars] = useState(() => {
    const b = {};
    TIMEFRAMES.forEach((tf) => { b[tf.key] = []; });
    return b;
  });
  const [livePrice, setLivePrice] = useState(null);
  const [spread, setSpread] = useState(null);
  const [tickCount, setTickCount] = useState(0);
  const [feedStatus, setFeedStatus] = useState("connecting");
  const [feedError, setFeedError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    function applyPrice(mid) {
      if (mid == null || !Number.isFinite(mid) || mid <= 0) return;
      const bid = +(mid - SPREAD_PIPS / 2).toFixed(2);
      const ask = +(mid + SPREAD_PIPS / 2).toFixed(2);
      setFeedStatus("open");
      setFeedError(null);
      setLivePrice({ bid, ask, mid });
      setSpread(+(SPREAD_PIPS / 0.1).toFixed(1));
      setTickCount((c) => c + 1);
      setAllBars((prev) => {
        const next = {};
        TIMEFRAMES.forEach((tf) => {
          const bars = prev[tf.key] || [];
          const barTime = Math.floor(Date.now() / tf.ms) * tf.ms;
          const last = bars[bars.length - 1];
          if (last && last.t === barTime) {
            const updated = { ...last, c: mid, h: Math.max(last.h, mid), l: Math.min(last.l, mid) };
            next[tf.key] = [...bars.slice(0, -1), updated];
          } else {
            next[tf.key] = [...bars, { t: barTime, o: mid, h: mid, l: mid, c: mid }].slice(-MAX_BARS_PER_TF);
          }
        });
        return next;
      });
    }

    async function poll() {
      if (cancelled) return;
      const apiKey = getApiKey();
      const url = `${TWELVEDATA_API_BASE}/price?symbol=${encodeURIComponent(XAUUSD_SYMBOL)}&apikey=${encodeURIComponent(apiKey)}`;
      try {
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          const msg = data.message || data.error?.message || `HTTP ${res.status}`;
          setFeedStatus("error");
          setFeedError(msg);
          return;
        }
        const raw = data.price;
        const mid = raw != null ? Number(raw) : NaN;
        if (Number.isFinite(mid)) {
          applyPrice(mid);
        } else {
          setFeedStatus("error");
          setFeedError(data.message || "No price in response");
        }
      } catch (err) {
        if (!cancelled) {
          setFeedStatus("error");
          setFeedError(err?.message || "Network error");
        }
      }
    }

    const delay = (ms) => new Promise((r) => setTimeout(r, ms));

    async function init() {
      try {
        // 1) Load historical candles one timeframe at a time (1 credit per request)
        const history = {};
        for (let i = 0; i < TIMEFRAMES.length; i++) {
          if (cancelled) return null;
          const tf = TIMEFRAMES[i];
          try {
            const bars = await fetchHistoryForTf(tf);
            if (cancelled) return null;
            history[tf.key] = bars;
            setAllBars((prev) => ({ ...prev, [tf.key]: bars }));
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn(`[TwelveData REST] history failed for ${tf.key}`, e);
            history[tf.key] = [];
          }
          if (i < TIMEFRAMES.length - 1) await delay(HISTORY_REQUEST_DELAY_MS);
        }
        if (cancelled) return null;
        setFeedStatus("connecting");
        setFeedError(null);
      } catch (e) {
        if (!cancelled) {
          setFeedStatus("error");
          setFeedError(e?.message || "Failed to load history");
        }
      }
      if (cancelled) return null;
      // 2) Start live polling (2 requests/min)
      await poll();
      if (cancelled) return null;
      const id = setInterval(poll, POLL_INTERVAL_MS);
      return id;
    }

    let intervalId = null;
    init().then((id) => {
      if (!cancelled) intervalId = id;
    });

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  return { allBars, livePrice, spread, tickCount, feedStatus, feedError };
}
