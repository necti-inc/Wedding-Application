/**
 * Simple session: store phone number in localStorage so we can associate uploads
 * and allow delete-only-own. Not Firebase Auth — just a persistent identifier for the visit.
 */

const STORAGE_KEY = "wedding_app_phone";

export function getSessionPhone() {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setSessionPhone(phone) {
  if (typeof window === "undefined") return;
  try {
    const trimmed = phone && String(phone).trim();
    if (trimmed) localStorage.setItem(STORAGE_KEY, trimmed);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function clearSession() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** Normalize for comparison (digits only) — must match backend. */
export function normalizePhone(value) {
  if (value == null || typeof value !== "string") return "";
  return value.replace(/\D/g, "");
}

export function isOwner(photo, currentPhone) {
  if (!currentPhone) return false;
  return normalizePhone(photo.ownerPhone) === normalizePhone(currentPhone);
}
