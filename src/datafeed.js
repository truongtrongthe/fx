/**
 * Twelve Data feed for XAU/USD (gold): REST only for history (cached when possible),
 * WebSocket only for live price. No REST price polling.
 *
 * REST: history (time_series) when cache miss.
 * WebSocket: wss://ws.twelvedata.com/v1/quotes/price (đúng theo tài liệu Twelve Data).
 * Subscribe: { action: "subscribe", params: { symbols: "XAU/USD" } }.
 *
 * Lưu ý tần số cập nhật: Theo tài liệu Twelve Data, WebSocket push "real-time" nhưng tần số
 * phụ thuộc plan (demo có thể bị throttle; nhiều nhà cung cấp forex/commodity không push từng tick
 * mà gộp theo giây hoặc vài trăm ms). Nếu giá không nhảy nhanh, có thể do:
 * - Gói demo/ Basic bị giới hạn tần số WebSocket.
 * - Twelve Data quotes/price không phải feed tick-by-tick cho XAU/USD.
 * Có thể cân nhắc fallback: poll REST /price mỗi 1–2s khi cần cập nhật nhanh hơn (tốn credit).
 */

import { useState, useEffect } from "react";
import { TIMEFRAMES } from "./algorithm.js";

// ═══════════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════════
const TWELVEDATA_API_BASE = "https://api.twelvedata.com";
const TWELVEDATA_WS_URL = "wss://ws.twelvedata.com/v1/quotes/price";
const XAUUSD_SYMBOL = "XAU/USD";
const SPREAD_PIPS = 0.2;
const MAX_BARS_PER_TF = 150;
/** Delay between each history request (one credit each) to stay under 8/min */
const HISTORY_REQUEST_DELAY_MS = 8_000;
const WS_RECONNECT_DELAY_MS = 5_000;

/** History cache: reload within TTL uses cache and skips API calls */
const CACHE_KEY_PREFIX = "richai_hist_";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

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

function getCachedBars(tfKey) {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + tfKey);
    if (!raw) return null;
    const { bars, fetchedAt } = JSON.parse(raw);
    if (!Array.isArray(bars) || typeof fetchedAt !== "number") return null;
    if (Date.now() - fetchedAt >= CACHE_TTL_MS) return null;
    return bars;
  } catch {
    return null;
  }
}

function setCachedBars(tfKey, bars) {
  try {
    localStorage.setItem(
      CACHE_KEY_PREFIX + tfKey,
      JSON.stringify({ bars, fetchedAt: Date.now() })
    );
  } catch {
    // localStorage full or disabled; treat as cache miss on next load
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  HOOK
// ═══════════════════════════════════════════════════════════════════════
/**
 * WebSocket for real-time price; REST for history and 30s fallback.
 * @returns {{ allBars, livePrice, spread, tickCount, feedStatus, feedError, feedSource }}
 *   feedSource: "ws" | "rest" | null — last price update source.
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
  const [feedSource, setFeedSource] = useState(null); // "ws" | "rest" | null

  useEffect(() => {
    let cancelled = false;
    let ws = null;
    let reconnectTimeoutId = null;

    function applyPrice(mid, source) {
      if (mid == null || !Number.isFinite(mid) || mid <= 0) return;
      const bid = +(mid - SPREAD_PIPS / 2).toFixed(2);
      const ask = +(mid + SPREAD_PIPS / 2).toFixed(2);
      setFeedStatus("open");
      setFeedError(null);
      if (source) setFeedSource(source);
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

    function connectWs() {
      if (cancelled) return;
      const apiKey = getApiKey();
      const url = `${TWELVEDATA_WS_URL}?apikey=${encodeURIComponent(apiKey)}`;
      try {
        ws = new WebSocket(url);
        ws.onopen = () => {
          if (cancelled || !ws) return;
          ws.send(JSON.stringify({ action: "subscribe", params: { symbols: XAUUSD_SYMBOL } }));
          setFeedStatus("open");
          setFeedError(null);
        };
        ws.onmessage = (event) => {
          if (cancelled) return;
          try {
            const msg = JSON.parse(event.data);
            if (!msg) return;
            // Subscription status: { status: "ok", success: ["XAU/USD"], fails: [] } — bỏ qua
            if (msg.status && msg.success) return;
            // Giá: tài liệu mẫu là { timestamp, currency, symbol, price }; một số API dùng event_data hoặc close
            const price = typeof msg.price === "number" ? msg.price
              : (msg.event_data && typeof msg.event_data.price === "number") ? msg.event_data.price
              : (typeof msg.close === "number") ? msg.close
              : null;
            if (price != null && Number.isFinite(price)) {
              applyPrice(price, "ws");
            }
          } catch {
            // ignore non-JSON or malformed
          }
        };
        ws.onclose = () => {
          if (cancelled) return;
          setFeedStatus("connecting");
          if (!cancelled && reconnectTimeoutId == null) {
            reconnectTimeoutId = setTimeout(connectWs, WS_RECONNECT_DELAY_MS);
          }
        };
        ws.onerror = () => {
          if (!cancelled) setFeedStatus("connecting");
        };
      } catch (err) {
        if (!cancelled) {
          setFeedStatus("error");
          setFeedError(err?.message || "WebSocket failed");
        }
      }
    }

    const delay = (ms) => new Promise((r) => setTimeout(r, ms));

    async function init() {
      try {
        // 1) Load historical candles: use cache when valid, else fetch (rate-limited)
        let lastWasFetch = false;
        for (let i = 0; i < TIMEFRAMES.length; i++) {
          if (cancelled) return;
          const tf = TIMEFRAMES[i];
          const cached = getCachedBars(tf.key);
          if (cached != null) {
            setAllBars((prev) => ({ ...prev, [tf.key]: cached }));
            lastWasFetch = false;
            continue;
          }
          try {
            const bars = await fetchHistoryForTf(tf);
            if (cancelled) return;
            setCachedBars(tf.key, bars);
            setAllBars((prev) => ({ ...prev, [tf.key]: bars }));
            lastWasFetch = true;
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn(`[TwelveData REST] history failed for ${tf.key}`, e);
            lastWasFetch = true;
          }
          if (lastWasFetch && i < TIMEFRAMES.length - 1) await delay(HISTORY_REQUEST_DELAY_MS);
        }
        if (cancelled) return;
        setFeedStatus("connecting");
        setFeedError(null);
      } catch (e) {
        if (!cancelled) {
          setFeedStatus("error");
          setFeedError(e?.message || "Failed to load history");
        }
      }
      if (cancelled) return;
      // 2) Live price via WebSocket only (no REST price API)
      connectWs();
    }

    init();

    return () => {
      cancelled = true;
      if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
      if (ws) {
        ws.close();
        ws = null;
      }
    };
  }, []);

  return { allBars, livePrice, spread, tickCount, feedStatus, feedError, feedSource };
}
