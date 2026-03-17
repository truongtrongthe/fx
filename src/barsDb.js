/**
 * OHLC bars persistence in Supabase. Used by datafeed to avoid reloading history from API.
 * Bars are shared (no device_id) — same market data for all clients.
 */

import { supabase } from "./supabaseClient.js";

const TABLE = "ohlc_bars";
const DEFAULT_SYMBOL = "XAU/USD";

/**
 * Fetch bars from DB for a symbol and timeframe, oldest first.
 * @param {string} symbol
 * @param {string} tf - e.g. "1m", "5m", "4H"
 * @param {number} [limit=150]
 * @returns {Promise<Array<{t: number, o: number, h: number, l: number, c: number}>>}
 */
export async function fetchBarsFromDb(symbol = DEFAULT_SYMBOL, tf, limit = 150) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select("t, o, h, l, c")
    .eq("symbol", symbol)
    .eq("tf", tf)
    .order("t", { ascending: true })
    .limit(limit);
  if (error) {
    console.warn("[barsDb] fetchBarsFromDb error", error);
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.map((row) => ({
    t: Number(row.t),
    o: Number(row.o),
    h: Number(row.h),
    l: Number(row.l),
    c: Number(row.c),
  }));
}

/**
 * Upsert bars into DB (insert or update on conflict).
 * @param {string} symbol
 * @param {string} tf
 * @param {Array<{t: number, o: number, h: number, l: number, c: number}>} bars
 * @returns {Promise<boolean>}
 */
export async function upsertBarsToDb(symbol, tf, bars) {
  if (!supabase || !bars || bars.length === 0) return false;
  const rows = bars.map((b) => ({
    symbol,
    tf,
    t: b.t,
    o: b.o,
    h: b.h,
    l: b.l,
    c: b.c,
  }));
  const { error } = await supabase.from(TABLE).upsert(rows, {
    onConflict: "symbol,tf,t",
    ignoreDuplicates: false,
  });
  if (error) {
    console.warn("[barsDb] upsertBarsToDb error", error);
    return false;
  }
  return true;
}
