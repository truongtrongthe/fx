/**
 * Trading algorithm: indicators, indicator-based signals, and expert (SMC/ICT) logic.
 * Pure JS — no React. Used by RichAI.jsx for signalling and chart data.
 * Thresholds and weights are read from algorithmConfig.js (LLM-tunable).
 */

import { getAlgorithmConfig } from "./algorithmConfig.js";

// ═══════════════════════════════════════════════════════════════════════
//  TIMEFRAMES & STRATEGY PARAMS
// ═══════════════════════════════════════════════════════════════════════
export const TIMEFRAMES = [
  { key: "1m", label: "1M", ms: 60_000, strategy: "Scalp", rr: 1.5, pipVol: 0.8 },
  { key: "5m", label: "5M", ms: 300_000, strategy: "Scalp", rr: 2.0, pipVol: 1.8 },
  { key: "15m", label: "15M", ms: 900_000, strategy: "Intraday", rr: 2.0, pipVol: 3.2 },
  { key: "30m", label: "30M", ms: 1_800_000, strategy: "Intraday", rr: 2.5, pipVol: 5.0 },
  { key: "1H", label: "1H", ms: 3_600_000, strategy: "Swing", rr: 2.5, pipVol: 7.5 },
  { key: "4H", label: "4H", ms: 14_400_000, strategy: "Swing", rr: 3.0, pipVol: 15.0 },
  { key: "1D", label: "1D", ms: 86_400_000, strategy: "Position", rr: 3.0, pipVol: 30.0 },
];

// ═══════════════════════════════════════════════════════════════════════
//  INDICATORS
// ═══════════════════════════════════════════════════════════════════════
export function ema(arr, p) {
  if (!arr || arr.length < 2) return (arr && arr[0]) || 0;
  const k = 2 / (p + 1);
  let e = arr[0];
  for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
}

export function rsi(C, p = 14) {
  if (C.length < p + 1) return 50;
  let g = 0, l = 0;
  for (let i = C.length - p; i < C.length; i++) {
    const d = C[i] - C[i - 1];
    d > 0 ? (g += d) : (l -= d);
  }
  return +(100 - 100 / (1 + g / (l || 1e-9))).toFixed(1);
}

export function boll(C, p = 20) {
  if (C.length < p) return null;
  const sl = C.slice(-p), m = sl.reduce((a, b) => a + b) / p;
  const std = Math.sqrt(sl.reduce((a, b) => a + (b - m) ** 2, 0) / p);
  return { upper: m + 2 * std, mid: m, lower: m - 2 * std };
}

export function stoch(bars, k = 14) {
  if (bars.length < k) return 50;
  const sl = bars.slice(-k), hi = Math.max(...sl.map(b => b.h)), lo = Math.min(...sl.map(b => b.l));
  return +((bars[bars.length - 1].c - lo) / (hi - lo || 1) * 100).toFixed(1);
}

export function atr(bars, p = 14) {
  const sl = bars.slice(-Math.min(p + 1, bars.length));
  if (sl.length < 2) return 1;
  let s = 0, n = 0;
  for (let i = 1; i < sl.length; i++) {
    s += Math.max(sl[i].h - sl[i].l, Math.abs(sl[i].h - sl[i - 1].c), Math.abs(sl[i].l - sl[i - 1].c));
    n++;
  }
  return s / (n || 1);
}

export function macd(C) {
  if (C.length < 26) return { v: 0, h: 0 };
  const mv = ema(C, 12) - ema(C, 26);
  const ms = C.slice(-9).map((_, i) =>
    ema(C.slice(0, C.length - 9 + i + 1), 12) - ema(C.slice(0, C.length - 9 + i + 1), 26)
  );
  return { v: +mv.toFixed(2), h: +(mv - ema(ms, 9)).toFixed(2) };
}

// ═══════════════════════════════════════════════════════════════════════
//  INDICATOR-BASED SIGNAL
// ═══════════════════════════════════════════════════════════════════════
export function computeSig(bars, tf) {
  if (!bars || bars.length < 25) return null;
  const cfg = getAlgorithmConfig();
  const C = bars.map(b => b.c), P = C[C.length - 1];
  const e8 = ema(C, 8), e21 = ema(C, 21), e55 = ema(C, 55);
  const pe8 = ema(C.slice(0, -1), 8), pe21 = ema(C.slice(0, -1), 21);
  const R = rsi(C), B = boll(C), St = stoch(bars), A = atr(bars), M = macd(C);
  const xUp = pe8 <= pe21 && e8 > e21, xDn = pe8 >= pe21 && e8 < e21;
  const up = e8 > e21 && e21 > e55, dn = e8 < e21 && e21 < e55;

  const rsiOS = cfg.rsiOversold, rsiOB = cfg.rsiOverbought, rsiML = cfg.rsiMomentumLow, rsiMH = cfg.rsiMomentumHigh;
  const stOS = cfg.stochOversold, stOB = cfg.stochOverbought;
  const thL = cfg.scoreThresholdLong, thS = cfg.scoreThresholdShort;

  let sc = 0, reasons = [];
  if (xUp) { sc += 3; reasons.push({ t: "EMA 8×21 BULL CROSS", c: "#059669", w: "+3" }); }
  else if (xDn) { sc -= 3; reasons.push({ t: "EMA 8×21 BEAR CROSS", c: "#dc2626", w: "-3" }); }
  else if (up) { sc += 1; reasons.push({ t: "EMA UPTREND STACK", c: "#059669", w: "+1" }); }
  else if (dn) { sc -= 1; reasons.push({ t: "EMA DOWNTREND STACK", c: "#dc2626", w: "-1" }); }
  if (R < rsiOS) { sc += 2; reasons.push({ t: `RSI OVERSOLD ${R}`, c: "#059669", w: "+2" }); }
  else if (R > rsiOB) { sc -= 2; reasons.push({ t: `RSI OVERBOUGHT ${R}`, c: "#dc2626", w: "-2" }); }
  else if (R > rsiML && R < rsiMH && up) { sc += 1; reasons.push({ t: `RSI MOMENTUM ${R}`, c: "#b45309", w: "+1" }); }
  if (B) {
    if (P <= B.lower) { sc += 2; reasons.push({ t: "BB LOWER BOUNCE", c: "#059669", w: "+2" }); }
    else if (P >= B.upper) { sc -= 2; reasons.push({ t: "BB UPPER REJECT", c: "#dc2626", w: "-2" }); }
    else if (P > B.mid && up) { sc += 1; reasons.push({ t: "ABOVE BB MID", c: "#b45309", w: "+1" }); }
    else if (P < B.mid && dn) { sc -= 1; reasons.push({ t: "BELOW BB MID", c: "#ff9d00", w: "-1" }); }
  }
  if (St < stOS) { sc += 1; reasons.push({ t: `STOCH OS ${St}`, c: "#059669", w: "+1" }); }
  else if (St > stOB) { sc -= 1; reasons.push({ t: `STOCH OB ${St}`, c: "#dc2626", w: "-1" }); }
  if (M.h > 0 && M.v > 0) { sc += 1; reasons.push({ t: "MACD BULL", c: "#059669", w: "+1" }); }
  else if (M.h < 0 && M.v < 0) { sc -= 1; reasons.push({ t: "MACD BEAR", c: "#dc2626", w: "-1" }); }

  const conf = Math.min(97, (Math.abs(sc) / 10) * 100 + cfg.confBase + Math.random() * cfg.confScale);
  const sig = sc >= thL ? "LONG" : sc <= -thS ? "SHORT" : "WAIT";
  const slD = atr(bars) * cfg.atrSlMultiplier, tpD = slD * tf.rr;
  return {
    price: P, e8, e21, e55, rsi: R, bb: B, stoch: St, atr: A, macd: M,
    signal: sig, score: sc, conf: +conf.toFixed(1),
    sl: +(sig === "LONG" ? P - slD : P + slD).toFixed(2),
    tp1: +(sig === "LONG" ? P + tpD : P - tpD).toFixed(2),
    tp2: +(sig === "LONG" ? P + tpD * 1.8 : P - tpD * 1.8).toFixed(2),
    slPips: +(slD / 0.1).toFixed(1), tpPips: +(tpD / 0.1).toFixed(1),
    reasons, up, dn,
  };
}

export function mtfBias(sigs) {
  let l = 0, s = 0, w = 0;
  TIMEFRAMES.forEach(tf => {
    const sg = sigs[tf.key];
    if (!sg) { w++; return; }
    sg.signal === "LONG" ? l++ : sg.signal === "SHORT" ? s++ : w++;
  });
  const tot = l + s + w || 1;
  if (l / tot >= 0.7) return { label: "STRONG BULL", col: "#059669", l, s, w };
  if (l / tot >= 0.5) return { label: "BULLISH ↑", col: "#059669", l, s, w };
  if (s / tot >= 0.7) return { label: "STRONG BEAR", col: "#dc2626", l, s, w };
  if (s / tot >= 0.5) return { label: "BEARISH ↓", col: "#dc2626", l, s, w };
  return { label: "NEUTRAL ↔", col: "#64748b", l, s, w };
}

// ═══════════════════════════════════════════════════════════════════════
//  EXPERT (SMC/ICT) — structure, POI, FVG, sweep, W-SHS
//  H4/1H = trend + POI (cung/cầu). M1/M5/M15 = canh điểm vào (entry watch).
// ═══════════════════════════════════════════════════════════════════════
const PIVOT_LEFT = 2, PIVOT_RIGHT = 2;
export const MIN_BARS_EXPERT = 35;

/** TFs used to determine trend and supply/demand (POI). */
export const TREND_POI_TF_KEYS = ["4H", "1H"];
/** TFs used to watch for entry (signal only when aligned with HTF trend). */
export const ENTRY_WATCH_TF_KEYS = ["1m", "5m", "15m"];

function getSwingHighs(bars, n = 8) {
  if (!bars || bars.length < PIVOT_LEFT + PIVOT_RIGHT + 1) return [];
  const out = [];
  for (let i = PIVOT_LEFT; i < bars.length - PIVOT_RIGHT; i++) {
    const h = bars[i].h;
    let isHigh = true;
    for (let j = 1; j <= PIVOT_LEFT; j++) if (bars[i - j].h >= h) isHigh = false;
    for (let j = 1; j <= PIVOT_RIGHT; j++) if (bars[i + j].h >= h) isHigh = false;
    if (isHigh) out.push({ i, price: h });
  }
  return out.slice(-n);
}

function getSwingLows(bars, n = 8) {
  if (!bars || bars.length < PIVOT_LEFT + PIVOT_RIGHT + 1) return [];
  const out = [];
  for (let i = PIVOT_LEFT; i < bars.length - PIVOT_RIGHT; i++) {
    const l = bars[i].l;
    let isLow = true;
    for (let j = 1; j <= PIVOT_LEFT; j++) if (bars[i - j].l <= l) isLow = false;
    for (let j = 1; j <= PIVOT_RIGHT; j++) if (bars[i + j].l <= l) isLow = false;
    if (isLow) out.push({ i, price: l });
  }
  return out.slice(-n);
}

function detectBOS(bars, swingHighs, swingLows) {
  if (!bars.length || !swingHighs.length || !swingLows.length) return null;
  const last = bars[bars.length - 1];
  const lastSH = swingHighs[swingHighs.length - 1];
  const lastSL = swingLows[swingLows.length - 1];
  if (last.c > lastSH.price) return { dir: "bull", level: lastSH.price };
  if (last.c < lastSL.price) return { dir: "bear", level: lastSL.price };
  return null;
}

function getTrendFromStructure(swingHighs, swingLows) {
  if (swingHighs.length < 2 || swingLows.length < 2) return null;
  const h0 = swingHighs[swingHighs.length - 2].price, h1 = swingHighs[swingHighs.length - 1].price;
  const l0 = swingLows[swingLows.length - 2].price, l1 = swingLows[swingLows.length - 1].price;
  if (h1 > h0 && l1 > l0) return "bull";
  if (h1 < h0 && l1 < l0) return "bear";
  return null;
}

function findFVG(bars) {
  if (!bars || bars.length < 3) return [];
  const zones = [];
  for (let i = 0; i < bars.length - 2; i++) {
    if (bars[i].h < bars[i + 2].l) zones.push({ type: "bull", zone: [bars[i].h, bars[i + 2].l], barIndex: i });
    if (bars[i].l > bars[i + 2].h) zones.push({ type: "bear", zone: [bars[i + 2].h, bars[i].l], barIndex: i });
  }
  return zones;
}

function getTrendFromFVG(fvgs) {
  if (!fvgs || fvgs.length === 0) return null;
  const recent = fvgs.slice(-4);
  const bulls = recent.filter(z => z.type === "bull").length;
  const bears = recent.filter(z => z.type === "bear").length;
  if (bulls >= 2 && bulls > bears) return "bull";
  if (bears >= 2 && bears > bulls) return "bear";
  const last = fvgs[fvgs.length - 1];
  return last.type === "bull" ? "bull" : "bear";
}

/**
 * Returns true if the zone has been mitigated by price (bull: low <= zone[1]; bear: high >= zone[0]).
 * When excludeLastBar is true (default), the current (incomplete) bar is ignored so LIMIT signals
 * don't flicker to WAIT when the live candle touches the FVG — signal stays until candle closes.
 */
function isZoneMitigated(bars, zone, type, fromIndex, excludeLastBar = true) {
  const end = excludeLastBar && bars.length > 1 ? bars.length - 1 : bars.length;
  for (let i = fromIndex; i < end; i++) {
    if (type === "bull" && bars[i].l <= zone[1]) return true;
    if (type === "bear" && bars[i].h >= zone[0]) return true;
  }
  return false;
}

function detectSweep(bars, level, direction) {
  if (!bars || bars.length < 3) return false;
  const recent = bars.slice(-5);
  if (direction === "bull") return recent.some(b => b.l < level && b.c > level);
  return recent.some(b => b.h > level && b.c < level);
}

function detectWOrSHS(bars, direction) {
  if (!bars || bars.length < 15) return false;
  const lows = getSwingLows(bars, 5);
  const highs = getSwingHighs(bars, 5);
  if (direction === "long" && lows.length >= 2) {
    const l0 = lows[lows.length - 2].price, l1 = lows[lows.length - 1].price;
    const tol = (bars[bars.length - 1].h - Math.min(...bars.slice(-20).map(b => b.l))) * 0.15;
    if (Math.abs(l0 - l1) <= tol) return true;
  }
  if (direction === "short" && highs.length >= 2) {
    const h0 = highs[highs.length - 2].price, h1 = highs[highs.length - 1].price;
    const tol = (Math.max(...bars.slice(-20).map(b => b.h)) - bars[bars.length - 1].l) * 0.15;
    if (Math.abs(h0 - h1) <= tol) return true;
  }
  return false;
}

/**
 * Trend + POI from H4 then 1H. Used so M1/M5 only signal when aligned with HTF.
 * @param {Record<string, import('./datafeed.js').Bar[]>} allBars - Bars keyed by tf key (e.g. "4H", "1H").
 * @returns {{ trend: 'bull'|'bear'|null, poi: { zone: number[], type: string, direction: 'long'|'short' }|null, lastBOS: object|null, fromTf: string|null }}
 */
export function getTrendAndPOIFromHigherTF(allBars) {
  const out = { trend: null, poi: null, lastBOS: null, fromTf: null };
  for (const tfKey of TREND_POI_TF_KEYS) {
    const bars = allBars && allBars[tfKey];
    if (!bars || bars.length < MIN_BARS_EXPERT) continue;
    const swingHighs = getSwingHighs(bars);
    const swingLows = getSwingLows(bars);
    const structureTrend = getTrendFromStructure(swingHighs, swingLows);
    const lastBOS = detectBOS(bars, swingHighs, swingLows);
    const fvgs = findFVG(bars);
    const fvgTrend = getTrendFromFVG(fvgs);
    const trend = fvgTrend || structureTrend;
    if (!trend || !lastBOS || lastBOS.dir !== trend || !fvgs.length) continue;
    const lastSH = swingHighs[swingHighs.length - 1];
    const lastSL = swingLows[swingLows.length - 1];
    let poi = null;
    if (trend === "bull") {
      const unmitigated = fvgs.filter(z => z.type === "bull" && !isZoneMitigated(bars, z.zone, "bull", z.barIndex + 3));
      if (unmitigated.length) {
        const z = unmitigated[unmitigated.length - 1];
        poi = { zone: z.zone, type: "unmitigated", direction: "long" };
      } else {
        poi = { zone: [lastSL.price - 2, lastSL.price + 2], type: "liquidity", direction: "long" };
      }
    } else {
      const unmitigated = fvgs.filter(z => z.type === "bear" && !isZoneMitigated(bars, z.zone, "bear", z.barIndex + 3));
      if (unmitigated.length) {
        const z = unmitigated[unmitigated.length - 1];
        poi = { zone: z.zone, type: "unmitigated", direction: "short" };
      } else {
        poi = { zone: [lastSH.price - 2, lastSH.price + 2], type: "liquidity", direction: "short" };
      }
    }
    out.trend = trend;
    out.poi = poi;
    out.lastBOS = lastBOS;
    out.fromTf = tfKey;
    break;
  }
  return out;
}

export function computeExpertSig(bars, tfKey, tfDef, lowerTfBars, higherTFContext = null) {
  if (!bars || bars.length < MIN_BARS_EXPERT || !tfDef) return null;
  const swingHighs = getSwingHighs(bars);
  const swingLows = getSwingLows(bars);
  const structureTrend = getTrendFromStructure(swingHighs, swingLows);
  const lastBOS = detectBOS(bars, swingHighs, swingLows);
  const fvgs = findFVG(bars);
  const fvgTrend = getTrendFromFVG(fvgs);
  const trend = fvgTrend || structureTrend;
  const P = bars[bars.length - 1].c;
  const A = atr(bars);

  let poi = null;
  let entryType = null;
  let limitPrice = null;
  let sweepDetected = false;
  let wOrShsOnLowerTF = false;

  // POI chỉ được kích hoạt khi:
  // 1) Có phá cấu trúc (BOS) cùng chiều xu hướng chính
  // 2) Có FVG tạo ra (mất cân bằng)
  if (lastBOS && trend && lastBOS.dir === trend && fvgs.length) {
    const lastSH = swingHighs[swingHighs.length - 1];
    const lastSL = swingLows[swingLows.length - 1];
    if (trend === "bull") {
      const unmitigatedBull = fvgs.filter(z => z.type === "bull" && !isZoneMitigated(bars, z.zone, "bull", z.barIndex + 3));
      if (unmitigatedBull.length) {
        const z = unmitigatedBull[unmitigatedBull.length - 1];
        poi = { zone: z.zone, type: "unmitigated", direction: "long" };
        entryType = "limit";
        limitPrice = (z.zone[0] + z.zone[1]) / 2;
      } else {
        poi = { zone: [lastSL.price - 2, lastSL.price + 2], type: "liquidity", direction: "long" };
        sweepDetected = detectSweep(bars, lastSL.price, "bull");
        wOrShsOnLowerTF = lowerTfBars && detectWOrSHS(lowerTfBars, "long");
        entryType = sweepDetected && wOrShsOnLowerTF ? "market" : null;
      }
    } else {
      const unmitigatedBear = fvgs.filter(z => z.type === "bear" && !isZoneMitigated(bars, z.zone, "bear", z.barIndex + 3));
      if (unmitigatedBear.length) {
        const z = unmitigatedBear[unmitigatedBear.length - 1];
        poi = { zone: z.zone, type: "unmitigated", direction: "short" };
        entryType = "limit";
        limitPrice = (z.zone[0] + z.zone[1]) / 2;
      } else {
        poi = { zone: [lastSH.price - 2, lastSH.price + 2], type: "liquidity", direction: "short" };
        sweepDetected = detectSweep(bars, lastSH.price, "bear");
        wOrShsOnLowerTF = lowerTfBars && detectWOrSHS(lowerTfBars, "short");
        entryType = sweepDetected && wOrShsOnLowerTF ? "market" : null;
      }
    }
  }

  let signal = "WAIT";
  if (poi && (entryType === "limit" || entryType === "market")) {
    const rawDir = poi.direction === "long" ? "LONG" : "SHORT";
    // H4/1H: unmitigated FVG + BOS → cho phép bắn LIMIT ngay; liquidity (market) thì không.
    if (TREND_POI_TF_KEYS.includes(tfKey)) {
      signal = entryType === "limit" ? rawDir : "WAIT";
    } else if (ENTRY_WATCH_TF_KEYS.includes(tfKey) && higherTFContext && higherTFContext.trend) {
      // M1/M5/M15 chỉ báo LONG/SHORT khi cùng chiều với trend H4/1H.
      if ((higherTFContext.trend === "bull" && rawDir === "LONG") || (higherTFContext.trend === "bear" && rawDir === "SHORT")) {
        signal = rawDir;
      }
    } else {
      signal = rawDir;
    }
  }

  const cfg = getAlgorithmConfig();
  const slD = A * cfg.atrSlMultiplier, tpD = slD * tfDef.rr;
  const slPrice = signal === "LONG" ? P - slD : P + slD;
  const tp1Price = signal === "LONG" ? P + tpD : P - tpD;
  const tp2Price = signal === "LONG" ? P + tpD * 1.8 : P - tpD * 1.8;

  const reasons = [];
  if (TREND_POI_TF_KEYS.includes(tfKey)) {
    reasons.push(signal !== "WAIT" ? { t: `LIMIT từ ${tfKey} (unmitigated FVG)`, c: "#0284c7" } : { t: "H4/1H → trend & POI only", c: "#64748b" });
  }
  if (ENTRY_WATCH_TF_KEYS.includes(tfKey) && higherTFContext && higherTFContext.fromTf) reasons.push({ t: `TREND FROM ${higherTFContext.fromTf}`, c: "#0284c7" });
  if (trend) reasons.push({ t: `TREND (FVG) ${trend.toUpperCase()}`, c: trend === "bull" ? "#059669" : "#dc2626" });
  if (structureTrend && structureTrend === trend) reasons.push({ t: "STRUCTURE ALIGNED", c: "#0284c7" });
  if (lastBOS) reasons.push({ t: `BOS ${lastBOS.dir.toUpperCase()}`, c: lastBOS.dir === "bull" ? "#059669" : "#dc2626" });
  if (poi) reasons.push({ t: `POI ${poi.type}`, c: "#b45309" });
  if (entryType === "limit") reasons.push({ t: "LIMIT @ zone", c: "#0284c7" });
  if (sweepDetected) reasons.push({ t: "Sweep", c: "#b45309" });
  if (wOrShsOnLowerTF) reasons.push({ t: "W/SHS", c: "#059669" });

  // FVG / Imbalance (cùng nghĩa): danh sách zone mất cân bằng cho UI
  const fvgList = fvgs.slice(-10).map((z) => ({
    type: z.type,
    zone: [z.zone[0], z.zone[1]],
    mitigated: isZoneMitigated(bars, z.zone, z.type, z.barIndex + 3),
  })).reverse();
  // Vùng dẫn dụ (Inducement): vùng liquidity bị sweep trước khi giá đảo chiều — tính cho mọi TF khi có sweep
  const lastSH = swingHighs.length ? swingHighs[swingHighs.length - 1] : null;
  const lastSL = swingLows.length ? swingLows[swingLows.length - 1] : null;
  let inducement = null;
  if (lastSL && detectSweep(bars, lastSL.price, "bull")) {
    inducement = { zone: [lastSL.price - 2, lastSL.price + 2], direction: "long" };
  } else if (lastSH && detectSweep(bars, lastSH.price, "bear")) {
    inducement = { zone: [lastSH.price - 2, lastSH.price + 2], direction: "short" };
  }
  if (inducement) reasons.push({ t: "Inducement (vùng dẫn dụ)", c: "#7c3aed" });

  return {
    trend,
    lastBOS,
    poi,
    entryType,
    limitPrice: limitPrice != null ? +limitPrice.toFixed(2) : null,
    sweepDetected,
    wOrShsOnLowerTF,
    fvgList,
    inducement,
    signal,
    price: +P.toFixed(2),
    sl: +(slPrice).toFixed(2),
    tp1: +(tp1Price).toFixed(2),
    tp2: +(tp2Price).toFixed(2),
    slPips: +(slD / 0.1).toFixed(1),
    tpPips: +(tpD / 0.1).toFixed(1),
    atr: A,
    conf: poi ? 72 + Math.random() * 12 : 0,
    reasons,
  };
}
