// src/helpers/utils.ts

/** Full month names for display */
export const monthsFull = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

/** Lowercase month names for parsing/regex (used by wiki date extract) */
export const MONTHS = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december"
];

/** Parse YYYY-MM-DD as a UTC date object */
export function parseISODateUTC(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("date must be YYYY-MM-DD");
  const d = new Date(s + "T00:00:00Z");
  if (isNaN(d.getTime())) throw new Error("invalid date");
  return d;
}

/** Convert Y/M/D to ISO YYYY-MM-DD (zero-padded) */
export function toISO(year: number, month: number, day: number) {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Best-effort display for an ISO date like 1947-08-15 → "August 15, 1947" */
export function isoToDisplay(iso?: string | null) {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || "";
  const [, yyyy, mm, dd] = m;
  return `${monthsFull[Number(mm) - 1]} ${Number(dd)}, ${yyyy}`;
}

/** Normalize text for fuzzy matching */
export function norm(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Remove parenthetical segments */
export function stripParens(s: string) {
  return String(s || "").replace(/\s*\(.*?\)\s*/g, "").trim();
}

/** Remove known prefixes like "Birthday of", "Event:", etc. (repeat-safe) */
export function stripKnownPrefixAll(s: string) {
  let out = stripParens(String(s || "")).trim();
  const rx =
    /^(?:birthday of|birth of|death of|event:|launch of|founding of|start of|independence of|treaty of|victory:|swearing-in\/election of|major event:)\s+/i;
  while (rx.test(out)) out = out.replace(rx, "").trim();
  return out;
}

/** Token Jaccard similarity (ignores ≤2-char tokens) */
export function jaccard(a: string, b: string) {
  const A = new Set(norm(a).split(" ").filter((t) => t.length > 2));
  const B = new Set(norm(b).split(" ").filter((t) => t.length > 2));
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / (A.size + B.size - inter || 1);
}

/** Trim summary to ~N chars with soft sentence break */
export function trimSummary(text: string, max = 560) {
  if (!text) return "";
  let clean = text.replace(/\s+/g, " ").trim();
  if (clean.length > max) {
    const soft =
      Math.max(clean.lastIndexOf(". ", max - 30), clean.lastIndexOf(". ", Math.floor(max * 0.7)));
    clean = clean.slice(0, soft > 80 ? soft + 1 : max);
  }
  return clean;
}
