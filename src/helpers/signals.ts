import { norm } from "./utils.js";

const INDIA_TERMS = ["india","indian","isro","constitution","parliament","supreme court","delhi","mumbai","kolkata","chennai","bengal","punjab","gujarat","uttar pradesh","bihar","odisha","kerala","tamil nadu","karnataka","andhra","telangana","assam","mughal","british raj","nehru","gandhi","tagore","ambedkar","patel","bose","kalam","dhoni","tendulkar","bollywood","ipl","swadeshi","quit india","independence","partition","article 370","gst","reserve bank","rbi","aadhaar","niti aayog","planning commission","kargil","pokhran","ram mandir","lok sabha","rajya sabha"];

const GLOBAL_TERMS = ["world war","treaty","armistice","nato","united nations","apollo","sputnik","moon landing","nobel","revolution","cold war","olympics","pandemic","constitution","independence"];

const ENHANCED = {
  political: ['parliament','supreme court','election commission','constitutional','article 370','constitution bench','prime minister of india','president of india'],
  economic: ['rbi','budget','gst','demonetisation','demonetization','liberalisation','liberalization','disinvestment','economic policy'],
  space: ['isro','chandrayaan','mangalyaan','mars orbiter mission','satellite','pslv','gslv'],
  defense: ['indian army','indian navy','indian air force','border','surgical strike','kargil','pokhran','nuclear test'],
  social: ['reservation','women rights','education','healthcare','aadhaar','right to privacy'],
  culture:['bollywood','cricket','festivals','heritage','hindi cinema','ipl','world cup']
};

const HIGH_IMPORT = ['article 370','gst','section 377','right to privacy','chandrayaan','mangalyaan','pokhran','kargil','constitution of india','ram mandir','supreme court'];

const NEWSWORTHY = ['apollo','sputnik','chandrayaan','mangalyaan','isro','nasa','satellite','nobel prize','world war','treaty','independence','constitution','supreme court','budget','earthquake','cyclone','flood','olympic','world cup'];

export function isIndianText(t: string) {
  const x = norm(t);
  return INDIA_TERMS.some(k => x.includes(k));
}
export function isGlobalSignal(t: string) {
  const x = norm(t);
  return GLOBAL_TERMS.some(k => x.includes(k));
}
function includesAny(t: string, list: string[]) {
  const x = norm(t);
  return list.some(k => x.includes(k));
}
function newsworthyBoost(t: string) {
  return includesAny(t, NEWSWORTHY) ? 10 : 0;
}
function indianSignalScore(t: string) {
  const x = norm(t); let s = 0;
  const add = (arr: string[], w: number) => { if (arr.some(k => x.includes(k))) s += w; };
  add(ENHANCED.political, 18);
  add(ENHANCED.economic, 14);
  add(ENHANCED.space, 16);
  add(ENHANCED.defense, 10);
  add(ENHANCED.social, 9);
  add(ENHANCED.culture, 8);
  if (includesAny(t, HIGH_IMPORT)) s += 10;
  if (isIndianText(t)) s += 8;
  return s;
}

export function scoreEvent(e: { title: string; summary?: string; year?: string; kind?: string; px_rank?: number }) {
  let s = 45;
  const blob = `${e.title} ${e.summary || ""}`;
  s += indianSignalScore(blob);
  if (isGlobalSignal(blob)) s += 6;
  if ((e.summary || "").length > 180) s += 6;
  const y = Number(e.year || "0");
  if (y && y < 1900) s += 3;
  if (e.px_rank) s += Math.max(0, 10 - Math.floor((e.px_rank - 1) / 3));
  s += newsworthyBoost(blob);
  if (e.kind === "birth" || e.kind === "death") s -= 3;
  const isBattle = /\b(battle|siege|crusade|skirmish)\b/i.test(blob);
  if (isBattle && !isIndianText(blob)) s -= 10;
  return Math.max(0, Math.min(100, s));
}

export function semanticTitle(kind: string, rawTitle: string, rawText: string) {
  const base = rawTitle.replace(/\s+/g," ").trim();
  const text = norm(rawText);
  if (kind === "birth") return `Birthday of ${base}`;
  if (kind === "death") return `Death of ${base}`;
  if (/treaty|accord|agreement/i.test(base) || /treaty|accord|agreement|signed/i.test(text)) {
    return /signed/.test(text) ? `${base} signed` : base;
  }
  if (/independence|declared independence|proclaimed/i.test(text) || /independence/i.test(base)) {
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
