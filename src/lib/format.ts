// Format a sim-time value (seconds) for the frontend UI.
//   < 60 s  →  "Ns"        (e.g. "45s")
//   ≥ 60 s  →  "Mm Ns"     (e.g. "4m 38s")
// No leading zeros on either component. Non-finite/negative → "—".
export function formatSimTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) return "—";
  const total = Math.round(t);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}m ${s}s`;
}
