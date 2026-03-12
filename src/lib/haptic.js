/**
 * Short haptic/vibration feedback for mobile. Uses Vibration API where supported
 * (e.g. Android). No-op on unsupported browsers (e.g. iOS Safari).
 */
export function hapticTap() {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(10);
  } catch (_) {}
}
