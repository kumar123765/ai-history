import { norm, stripParens } from "./utils.js";
import type { EventItem } from "../types.js";

/** ---- Indian detection (anchor-first, no generic terms) ---- */
const INDIA_ANCHORS = [
  "india","indian",
  "isro","drdo","iit","iisc",
  "british raj","mughal",
  "lok sabha","rajya sabha","parliament of india",
  "rbi","reserve bank of india",
  "supreme court of india","constitution of india","article 370","section 377","aadhaar","niti aayog","planning commission",
  "chandrayaan","mangalyaan","mars orbiter mission","pslv","gslv",
  "kargil","pokhran",
  "ram mandir",
  // major cities and regions unique enough to imply India
  "new delhi","delhi","mumbai","bombay","kolkata","calcutta","chennai","madras",
  "bengal","punjab","gujarat","maharashtra","uttar pradesh","bihar","jharkhand","odisha",
  "kerala","tamil nadu","karnataka","andhra","telangana","assam"
];

// Kept, but ONLY for scoring (not anchor). Avoid generics in anchors.
const ENHANCED_INDIAN_SIGNALS = {
  political: [
    "president of india","prime minister of india","constitution bench","election commission of india","eci",
  ],
  economic: [
    "gst","goods and services tax","demonetisation","demonetization","budget","liberalisation","liberalization","disinvestment",
    "industrial policy","license raj",
  ],
  space: ["isro","chandrayaan","mangalyaan","mars orbiter mission","satellite","launch vehicle","pslv","gslv"],
  defense: ["indian army","indian navy","indian air force","surgical strike","kargil","pokhran","border"],
  social: ["reservation","right to privacy","women rights","women’s rights","education","healthcare","aadhaar"],
  culture: ["bollywood","hindi cinema","cricket","ipl","world cup","festivals","heritage"],
};

const HIGH_IMPORTANCE_KEYWORDS = [
  "article 370","goods and services tax","gst","section 377","right to privacy",
  "chandrayaan","mangalyaan","mars orbiter mission","pokhran","kargil",
  "constitution of india","ram mandir","supreme court of india","constitution bench",
];

const GLOBAL_TERMS = [
  "world war","treaty","armistice","nato","united nations","apollo","sputnik","moon landing","nobel",
  "revolution","cold war","eu","olympics","world record","pandemic","stock market crash","constitution","declaration"
];

export function isIndianText(t: string) {
  const x = norm(t);
  return INDIA_ANCHORS.some((k) => x.includes(k));
}
export function isGlobalSignal(t: string) {
  const x = norm(t);
  return GLOBAL_TERMS.some((k) => x.includes(k));
}
function includesAny(t: string, list: string[]) {
  const x = norm(t);
  return list.some((k) => x.includes(k));
}

export function indianSignalScore(t: string) {
  const x = norm(t);
  let score = 0;
  const add = (arr: string[], w: number) => {
    if (arr.some((k) => x.includes(k))) score += w;
  };
  add(ENHANCED_INDIAN_SIGNALS.political, 16);
  add(ENHANCED_INDIAN_SIGNALS.economic, 12);
  add(ENHANCED_INDIAN_SIGNALS.space, 14);
  add(ENHANCED_INDIAN_SIGNALS.defense, 9);
  add(ENHANCED_INDIAN_SIGNALS.social, 8);
  add(ENHANCED_INDIAN_SIGNALS.culture, 7);
  if (includesAny(t, HIGH_IMPORTANCE_KEYWORDS)) score += 10;
  return score;
}

/** Require either an explicit anchor OR a high score. */
export function classifyIndian(t: string) {
  const base = isIndianText(t);
  const score = indianSignalScore(t);
  // Threshold tuned to reduce false positives on generic global items
  return base || score >= 24;
}

/** ---- Scoring + semantic titles ---- */
function newsworthyBoost(t: string) {
  const keywords = [
    "apollo","sputnik","chandrayaan","mangalyaan","isro","nasa","spacecraft","satellite","mars","moon landing",
    "nobel prize","treaty","accord","agreement","independence","constitution","amendment","supreme court","verdict","judgment",
    "stock market","crash","recession","bank","budget","earthquake","cyclone","flood","tsunami",
    "olympic","world cup","record","asian games"
  ];
  return includesAny(t, keywords) ? 10 : 0;
}

export function scoreEvent(e: EventItem) {
  let s = 45;
  const blob = `${e.title} ${e.summary || ""}`;
  s += indianSignalScore(blob);
  if (isGlobalSignal(blob)) s += 6;
  if ((e.summary || "").length > 180) s += 6;
  const y = Number(e.year || "0");
  if (y && y < 1900) s += 3;
  if ((e as any).px_rank) s += Math.max(0, 10 - Math.floor(((e as any).px_rank - 1) / 3));
  s += newsworthyBoost(blob);
  if (e.kind === "birth" || e.kind === "death") s -= 3;
  const isBattle = /\b(battle|siege|crusade|skirmish)\b/i.test(e.title) || /\b(battle|siege|crusade|skirmish)\b/i.test(e.summary || "");
  if (isBattle && !classifyIndian(blob)) s -= 10;
  return Math.max(0, Math.min(100, s));
}

export function semanticTitle(kind: "event"|"birth"|"death", rawTitle: string, rawText: string) {
  const base = stripParens(rawTitle).replace(/\s+/g, " ").trim();
  const text = norm(rawText);
  if (kind === "birth") return `Birthday of ${base}`;
  if (kind === "death") return `Death of ${base}`;
  if (/battle of/i.test(rawTitle)) return stripParens(rawTitle);
  if (/treaty|accord|agreement/i.test(rawTitle) || /treaty|accord|agreement|signed/i.test(text)) {
    retu
