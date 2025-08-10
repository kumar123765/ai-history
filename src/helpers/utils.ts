export const monthsFull = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

export const MONTHS = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december"
];

export function toISO(y: number, m: number, d: number) {
  const yy = String(y).padStart(4, "0");
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function parseISODateUTC(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("date must be YYYY-MM-DD");
  const d = new Date(s + "T00:00:00Z");
  if (isNaN(d.getTime())) throw new Error("invalid date");
  return d;
}

export function isoToDisplay(iso?: string | null) {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, yyyy, mm, dd] = m;
  return `${monthsFull[Number(mm) - 1]} ${Number(dd)}, ${yyyy}`;
}

export function norm(s: string) {
  return String(s || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function stripParens(s: string) {
  return String(s || "").replace(/\s*\(.*?\)\s*/g, "").trim();
}

export function stripKnownPrefixAll(s: string) {
  let out = stripParens(String(s || "")).trim();
  const rx = /^(?:birthday of|birth of|death of|event:|launch of|founding of|start of|independence of|treaty of|victory:|swearing-in\/election of|major event:)\s+/i;
  while (rx.test(out)) out = out.replace(rx, "").trim();
  return out;
}

export function stripHtml(s: string) {
  return String(s || "").replace(/<[^>]+>/g, "").trim();
}

export function jaccard(a: string, b: string) {
  const A = new Set(norm(a).split(" ").filter((t) => t.length > 2));
  const B = new Set(norm(b).split(" ").filter((t) => t.length > 2));
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / (A.size + B.size - inter || 1);
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

export function includesAny(t: string, list: string[]) {
  const x = norm(t);
  return list.some((k) => x.includes(k));
}

/** -------- Indian signals (compact but strong) -------- */
const INDIA_TERMS = [
  "india","indian","hindu","muslim league","congress","delhi","new delhi","mumbai","bombay","kolkata","calcutta",
  "chennai","madras","bengal","punjab","gujarat","maharashtra","uttar pradesh","bihar","jharkhand","odisha",
  "kerala","tamil nadu","karnataka","andhra","telangana","assam","isro","drdo","iit","iisc","mughal","british raj",
  "nehru","gandhi","tagore","ambedkar","patel","bose","kalam","dhoni","tendulkar","bollywood","ipl","swadeshi",
  "quit india","azad hind","independence","constitution of india","jai hind","ram mandir","parliament of india",
  "narendra modi","jawaharlal nehru","mahatma gandhi","sardar patel","subhas chandra bose","ms dhoni","sachin tendulkar",
  "lok sabha","rajya sabha","eci","election commission of india","article 370","gst","reserve bank of india","rbi",
  "supreme court of india","constitution bench","aadhaar","niti aayog","planning commission","kargil","pokhran"
];

const HIGH_IMPORTANCE_KEYWORDS = [
  "article 370","goods and services tax","gst","section 377","right to privacy","demonetisation","demonetization",
  "chandrayaan","mangalyaan","mars orbiter mission","pokhran","kargil","constitution of india","ram mandir","ipl","asian games"
];

export function isIndianText(t: string) {
  return includesAny(t, INDIA_TERMS);
}

export function indianSignalScore(t: string) {
  const x = norm(t);
  let score = 0;
  if (includesAny(x, ["parliament","supreme court","election commission","constitutional","constitution bench"])) score += 16;
  if (includesAny(x, ["rbi","budget","gst","demonet"])) score += 12;
  if (includesAny(x, ["isro","chandrayaan","mangalyaan","pslv","gslv","satellite"])) score += 14;
  if (includesAny(x, ["indian army","indian navy","indian air force","kargil","pokhran"])) score += 10;
  if (includesAny(x, ["reservation","aadhaar","privacy"])) score += 8;
  if (includesAny(x, ["bollywood","cricket","world cup","ipl"])) score += 8;
  if (includesAny(x, HIGH_IMPORTANCE_KEYWORDS)) score += 10;
  if (isIndianText(x)) score += 8;
  return score; // 0..~70
}
