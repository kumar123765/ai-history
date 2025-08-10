import { norm, stripParens } from "./utils.js";
import type { EventItem } from "../types.js";

/** ---- Indian detection ---- */
const INDIA_TERMS = [
  "india","indian","hindu","muslim league","congress","delhi","new delhi","mumbai","bombay",
  "kolkata","calcutta","chennai","madras","bengal","punjab","gujarat","maharashtra",
  "uttar pradesh","bihar","jharkhand","odisha","kerala","tamil nadu","karnataka","andhra","telangana","assam",
  "isro","drdo","iit","iisc","mughal","british raj","nehru","gandhi","tagore","ambedkar","patel","bose","kalam",
  "dhoni","tendulkar","bollywood","ipl","swadeshi","quit india","azad hind","independence","partition",
  "constitution of india","jai hind","ram mandir","parliament of india",
  "narendra modi","jawaharlal nehru","mahatma gandhi","sardar patel","subhas chandra bose","ms dhoni","sachin tendulkar",
  "lok sabha","rajya sabha","eci","election commission of india","article 370","gst","reserve bank of india","rbi",
  "supreme court of india","constitution bench","aadhaar","niti aayog","planning commission","operation flood",
  "green revolution","panchayati raj"
];

const GLOBAL_TERMS = [
  "world war","treaty","armistice","nato","united nations","apollo","sputnik","moon landing","nobel",
  "revolution","cold war","eu","olympics","world record","pandemic","stock market crash","constitution","declaration"
];

const ENHANCED_INDIAN_SIGNALS = {
  political: ['parliament','supreme court','election commission','constitutional','article 370','article-370','constitution bench','president of india','prime minister of india'],
  economic: ['rbi','budget','gst','demonetisation','demonetization','liberalisation','liberalization','disinvestment','economic policy','industrial policy','license raj'],
  space: ['isro','chandrayaan','mangalyaan','mars orbiter mission','satellite','launch vehicle','pslv','gslv'],
  defense: ['indian army','indian navy','indian air force','border','surgical strike','kargil','pokhran','nuclear test'],
  social: ['reservation','women rights','women’s rights','education','healthcare','aadhaar','right to privacy'],
  culture: ['bollywood','cricket','festivals','heritage','hindi cinema','ipl','world cup'],
};

const HIGH_IMPORTANCE_KEYWORDS = [
  "article 370","goods and services tax","gst","section 377","right to privacy","demonetisation","demonetization",
  "chandrayaan","mangalyaan","mars orbiter mission","pokhran","kargil","republic day","independence day",
  "constitution of india","ram mandir","supreme court","constitution bench","nationalisation","nationalization"
];

const NEWSWORTHY_BOOST_TERMS = [
  "apollo","sputnik","chandrayaan","mangalyaan","isro","nasa","spacecraft","satellite","mars","moon landing",
  "nobel prize","treaty","accord","agreement","independence","constitution","amendment","supreme court","verdict","judgment",
  "stock market","crash","recession","bank","budget","earthquake","cyclone","flood","tsunami",
  "olympic","world cup","record","asian games"
];

export function isIndianText(t: string) {
  const x = norm(t);
  return INDIA_TERMS.some((k) => x.includes(k));
}
export function isGlobalSignal(t: string) {
  const x = norm(t);
  return GLOBAL_TERMS.some((k) => x.includes(k));
}
function includesAny(t: string, list: string[]) {
  const x = norm(t);
  return list.some((k) => x.includes(k));
}
function newsworthyBoost(t: string) {
  return includesAny(t, NEWSWORTHY_BOOST_TERMS) ? 10 : 0;
}
export function indianSignalScore(t: string) {
  const x = norm(t);
  let score = 0;
  const add = (arr: string[], w: number) => {
    if (arr.some((k) => x.includes(k))) score += w;
  };
  add(ENHANCED_INDIAN_SIGNALS.political, 18);
  add(ENHANCED_INDIAN_SIGNALS.economic, 14);
  add(ENHANCED_INDIAN_SIGNALS.space, 16);
  add(ENHANCED_INDIAN_SIGNALS.defense, 10);
  add(ENHANCED_INDIAN_SIGNALS.social, 9);
  add(ENHANCED_INDIAN_SIGNALS.culture, 8);
  if (includesAny(t, HIGH_IMPORTANCE_KEYWORDS)) score += 10;
  if (isIndianText(t)) score += 8;
  return score;
}

/** ---- Scoring + semantic titles ---- */
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
  if (isBattle && !isIndianText(blob) && !includesAny(blob, HIGH_IMPORTANCE_KEYWORDS)) s -= 10;
  return Math.max(0, Math.min(100, s));
}

export function semanticTitle(kind: "event"|"birth"|"death", rawTitle: string, rawText: string) {
  const base = stripParens(rawTitle).replace(/\s+/g, " ").trim();
  const text = norm(rawText);
  if (kind === "birth") return `Birthday of ${base}`;
  if (kind === "death") return `Death of ${base}`;
  if (/battle of/i.test(rawTitle)) return stripParens(rawTitle);
  if (/treaty|accord|agreement/i.test(rawTitle) || /treaty|accord|agreement|signed/i.test(text)) {
    return /signed/.test(text) ? `${stripParens(base)} signed` : stripParens(base);
  }
  if (/independence|declared independence|proclaimed/i.test(text) || /independence/i.test(rawTitle)) {
    return `Independence of ${base}`.replace(/^Independence of Independence of/i, "Independence of");
  }
  if (/assassin|assassinated|assassination/.test(text)) return `Assassination of ${base}`;
  if (/launched?|launch|inaugurat/.test(text)) return `Launch of ${base}`;
  if (/founded|establish|formed|create/.test(text)) return `Founding of ${base}`;
  if (/begins|began|start|started|commence/.test(text)) return `Start of ${base}`;
  if (/wins|won|victory|defeat/.test(text)) return `Victory: ${base}`;
  if (/elected|sworn in|inaugurat/.test(text)) return `Swearing-in/Election of ${base}`;
  if (/earthquake|cyclone|flood|tsunami|explosion|bomb/.test(text)) return `Major event: ${base}`;
  return `Event: ${base}`;
}
