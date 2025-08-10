export const monthsFull = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

export function parseISODateUTC(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("date must be YYYY-MM-DD");
  const d = new Date(s + "T00:00:00Z");
  if (isNaN(d.getTime())) throw new Error("invalid date");
  return d;
}

export function norm(s: string) {
  return String(s || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function stripParens(s: string) {
  return String(s || "").replace(/\s*\(.*?\)\s*/g, "").trim();
}

export function stripKnownPrefixAll(s: string) {
  let out = stripParens(String(s || "")).trim();
  const rx = /^(?:birthday of|birth of|death of|event:|launch of|founding of|start of|independence of|treaty of|victory:|swearing-in\/election of)\s+/i;
  while (rx.test(out)) out = out.replace(rx, "").trim();
  return out;
}

export function jaccard(a: string, b: string) {
  const A = new Set(norm(a).split(" ").filter(t => t.length > 2));
  const B = new Set(norm(b).split(" ").filter(t => t.length > 2));
  const inter = [...A].filter(x => B.has(x)).length;
  return inter / (A.size + B.size - inter || 1);
}

export function toISO(y: number, m: number, d: number) {
  return `${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

export function sameMonthDay(iso: string | null, mm: string, dd: string) {
  return !!iso && iso.slice(5,7) === mm && iso.slice(8,10) === dd;
}

export function trimSummary(text: string, max = 560) {
  if (!text) return "";
  let clean = text.replace(/\s+/g, " ").trim();
  if (clean.length > max) {
    const soft = Math.max(clean.lastIndexOf(". ", max - 30), clean.lastIndexOf(". ", Math.floor(max * 0.7)));
    clean = clean.slice(0, soft > 80 ? soft + 1 : max);
  }
  return clean;
}
