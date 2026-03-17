/**
 * Supabase client for limit plans. Uses VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
 */

import { createClient } from "@supabase/supabase-js";

const url =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL
    ? import.meta.env.VITE_SUPABASE_URL
    : "";
const anonKey =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_ANON_KEY
    ? import.meta.env.VITE_SUPABASE_ANON_KEY
    : "";

export const supabase =
  url && anonKey ? createClient(url, anonKey) : null;

const DEVICE_ID_KEY = "rich-ai-device-id";

/**
 * Get or create a persistent device ID (localStorage). Used to scope limit plans per browser.
 * @returns {string}
 */
export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return `session-${Date.now()}`;
  }
}
