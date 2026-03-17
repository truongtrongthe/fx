/**
 * Limit plans CRUD via Supabase. Scoped by device_id (localStorage).
 * One active limit per timeframe (1M, 5M, 15M, 30M, 1H, 4H).
 */

import { supabase, getDeviceId } from "./supabaseClient.js";

const TABLE = "limit_plans";

/** Timeframes that can each have one independent limit plan. */
export const LIMIT_TF_KEYS = ["1m", "5m", "15m", "30m", "1H", "4H"];

/**
 * @typedef {Object} LimitPlanRow
 * @property {string} id
 * @property {string} device_id
 * @property {string} tf
 * @property {string} direction
 * @property {number} limit_price
 * @property {number|null} tp1
 * @property {number|null} tp2
 * @property {number|null} sl
 * @property {string} created_at
 * @property {string} status
 */

/**
 * Fetch all limit plans for the current device, newest first.
 * @returns {Promise<LimitPlanRow[]>}
 */
export async function fetchLimitPlans() {
  if (!supabase) return [];
  const deviceId = getDeviceId();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[limitPlans] fetchLimitPlans error", error);
    return [];
  }
  return data || [];
}

/**
 * Insert a new limit plan.
 * @param {{ tf: string, direction: string, limit_price: number, tp1?: number, tp2?: number, sl?: number }} plan
 * @returns {Promise<LimitPlanRow|null>}
 */
export async function insertLimitPlan(plan) {
  if (!supabase) return null;
  const deviceId = getDeviceId();
  const row = {
    device_id: deviceId,
    tf: plan.tf,
    direction: plan.direction,
    limit_price: plan.limit_price,
    tp1: plan.tp1 ?? null,
    tp2: plan.tp2 ?? null,
    sl: plan.sl ?? null,
    status: "active",
  };
  const { data, error } = await supabase.from(TABLE).insert(row).select().single();
  if (error) {
    console.warn("[limitPlans] insertLimitPlan error", error);
    return null;
  }
  return data;
}

/**
 * Update a limit plan by id (same device).
 * @param {string} id
 * @param {{ status?: string }} updates
 * @returns {Promise<boolean>}
 */
export async function updateLimitPlan(id, updates) {
  if (!supabase) return false;
  const deviceId = getDeviceId();
  const { error } = await supabase
    .from(TABLE)
    .update(updates)
    .eq("id", id)
    .eq("device_id", deviceId);
  if (error) {
    console.warn("[limitPlans] updateLimitPlan error", error);
    return false;
  }
  return true;
}

/**
 * Set plan status to 'cancelled'.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function cancelLimitPlan(id) {
  return updateLimitPlan(id, { status: "cancelled" });
}

/**
 * Cancel any active limit plan for the given timeframe (same device).
 * @param {string} tf
 * @returns {Promise<boolean>}
 */
export async function cancelActiveLimitForTf(tf) {
  if (!supabase) return false;
  const deviceId = getDeviceId();
  const { error } = await supabase
    .from(TABLE)
    .update({ status: "cancelled" })
    .eq("device_id", deviceId)
    .eq("tf", tf)
    .eq("status", "active");
  if (error) {
    console.warn("[limitPlans] cancelActiveLimitForTf error", error);
    return false;
  }
  return true;
}

/**
 * Get the active limit plan for a timeframe (same device), if any.
 * @param {string} tf
 * @returns {Promise<LimitPlanRow|null>}
 */
export async function getActiveLimitForTf(tf) {
  if (!supabase) return null;
  const deviceId = getDeviceId();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("device_id", deviceId)
    .eq("tf", tf)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[limitPlans] getActiveLimitForTf error", error);
    return null;
  }
  return data;
}

/**
 * Ensure at most one active limit for this TF: cancel existing then insert.
 * Use when the algorithm shows a limit for this TF (current price driven).
 * @param {string} tf
 * @param {{ direction: string, limit_price: number, tp1?: number, tp2?: number, sl?: number }} plan
 * @returns {Promise<LimitPlanRow|null>}
 */
export async function upsertLimitForTf(tf, plan) {
  if (!supabase) return null;
  await cancelActiveLimitForTf(tf);
  return insertLimitPlan({ tf, ...plan });
}
