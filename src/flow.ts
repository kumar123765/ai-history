import {
  wikiOnThisDay,
  wikiSummaryByTitle,
  articleDateAuditISO,
  pickTitleFromPage,
  pageUrlFromItem,
  OnThisDayEvents,
  OnThisDayBirths,
  OnThisDayDeaths,
} from "./helpers/wiki.js";
import {
  monthsFull,
  parseISODateUTC,
  norm,
  stripKnownPrefixAll,
  jaccard,
  trimSummary,
  isIndianText,
  indianSignalScore,
  isoToDisplay,
  stripHtml,
} from "./helpers/utils.js";

type Kind = "event" | "birth" | "death";

type Unified = {
  kind: Kind;
  year: number | null;
  title: string;
  text: string;
  pageUrl: string | null;
};

type OutputEvent = {
  title: string;
  summary: string;
  date_iso: string | null;
  year: string | null;
  kind: Kind;
  is_indian: boolean;
  verified_day: boolean;
  score: number;
  sources: { wikipedia_page: string | null };
};

const DEFAULT_TARGET = 25;
const BIRTH_DEATH_MAX = 6;
const BATTLE_MAX = 3;
const INDIAN_LOW = 0.60;  // 60%
const INDIAN_HIGH = 0.70; // 70%

function semanticTitle(kind: Kind, rawTitle: string, rawText: string) {
  const base = stripKnownPrefixAll(rawTitle).replace(/\s+/g, " ").trim();
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

/** accept string | number | null to avoid TS errors */
function baseScore(e: {
  title: string;
  summary: string;
  kind: Kind;
  year: number | string | null;
  is_indian: boolean;
}): number {
  let s = 45;

  // Coerce year if needed
  const y = typeof e.year === "string" ? parseInt(e.year, 10) : e.year;

  s += indianSignalScore(`${e.title} ${e.summary}`);
  if (e.summary.length > 180) s += 4;
  if (y && y < 1900) s += 2;
  if (e.kind === "birth" || e.kind === "death") s -= 4;

  const isBattle =
    /\b(battle|siege|crusade|skirmish)\b/i.test(e.title) ||
    /\b(battle|siege|crusade|skirmish)\b/i.test(e.summary);
  if (isBattle && !e.is_indian) s -= 8;

  return Math.max(0, Math.min(100, s));
}

function enforceCaps(items: OutputEvent[], limit: number): OutputEvent[] {
  // birth/death cap
  const birthsDeaths = items.filter((e) => e.kind === "birth" || e.kind === "death");
  if (birthsDeaths.length > BIRTH_DEATH_MAX) {
    const toRemove = birthsDeaths.sort((a, b) => a.score - b.score).slice(0, birthsDeaths.length - BIRTH_DEATH_MAX);
    const rm = new Set(toRemove.map((e) => e.title + "|" + e.year));
    items = items.filter((e) => !rm.has(e.title + "|" + e.year));
  }
  // battle cap
  const battles = items.filter(
    (e) => /\b(battle|siege|crusade|skirmish)\b/i.test(e.title) || /\b(battle|siege|crusade|skirmish)\b/i.test(e.summary)
  );
  if (battles.length > BATTLE_MAX) {
    const toRemove = battles.sort((a, b) => a.score - b.score).slice(0, battles.length - BATTLE_MAX);
    const rm = new Set(toRemove.map((e) => e.title + "|" + e.year));
    items = items.filter((e) => !rm.has(e.title + "|" + e.year));
  }
  return items.slice(0, limit);
}

function retargetIndianShare(items: OutputEvent[], limit: number, low = INDIAN_LOW, high = INDIAN_HIGH): OutputEvent[] {
  const targetLow = Math.round(limit * low);
  const targetHigh = Math.round(limit * high);

  const indian = items.filter((e) => e.is_indian).sort((a, b) => b.score - a.score);
  const global = items.filter((e) => !e.is_indian).sort((a, b) => b.score - a.score);

  let out: OutputEvent[] = [];

  // Aim mid-band
  const desiredIndian = Math.min(Math.max(targetLow, Math.round(limit * ((low + high) / 2))), targetHigh);
  out.push(...indian.slice(0, Math.min(desiredIndian, indian.length)));
  out.push(...global.slice(0, limit - out.length));

  // If still below low, top-up with Indian replacing weakest globals
  while (out.filter((e) => e.is_indian).length < targetLow) {
    const next = indian.find((x) => !out.includes(x));
    if (!next) break;
    const weakestGlobalIdx = out.findIndex((e) => !e.is_indian);
    if (weakestGlobalIdx >= 0) out.splice(weakestGlobalIdx, 1, next);
    else out.push(next);
    if (out.length > limit) out = out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // If above high, swap weakest Indian for next global
  while (out.filter((e) => e.is_indian).length > targetHigh) {
    const weakestIndianIdx =
      out
        .map((e, i) => ({ e, i }))
        .filter((x) => x.e.is_indian)
        .sort((a, b) => a.e.score - b.e.score)[0]?.i ?? -1;
    const nextGlobal = global.find((g) => !out.includes(g));
    if (weakestIndianIdx >= 0 && nextGlobal) out.splice(weakestIndianIdx, 1, nextGlobal);
    else break;
  }

  return out.slice(0, limit);
}

async function fetchAllWiki(mm: string, dd: string) {
  const [ev, br, de] = await Promise.all([
    wikiOnThisDay(mm, dd, "events") as Promise<OnThisDayEvents>,
    wikiOnThisDay(mm, dd, "births") as Promise<OnThisDayBirths>,
    wikiOnThisDay(mm, dd, "deaths") as Promise<OnThisDayDeaths>,
  ]);

  const uni: Unified[] = [];

  (ev.events ?? []).forEach((it) => {
    uni.push({
      kind: "event",
      year: typeof it.year === "number" ? it.year : null,
      title: pickTitleFromPage(it),
      text: String(it.text || ""),
      pageUrl: pageUrlFromItem(it),
    });
  });

  (br.births ?? []).forEach((it) => {
    uni.push({
      kind: "birth",
      year: typeof it.year === "number" ? it.year : null,
      title: pickTitleFromPage(it),
      text: String(it.text || ""),
      pageUrl: pageUrlFromItem(it),
    });
  });

  (de.deaths ?? []).forEach((it) => {
    uni.push({
      kind: "death",
      year: typeof it.year === "number" ? it.year : null,
      title: pickTitleFromPage(it),
      text: String(it.text || ""),
      pageUrl: pageUrlFromItem(it),
    });
  });

  return uni;
}

export async function runFlow(input: { date?: string; limit?: number }) {
  const dateStr = input.date || new Date().toISOString().slice(0, 10);
  const limit = Math.max(10, Math.min(input.limit || DEFAULT_TARGET, 30));
  const d = parseISODateUTC(dateStr);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const readable = `${monthsFull[d.getUTCMonth()]} ${d.getUTCDate()}`;

  const wiki = await fetchAllWiki(mm, dd);

  // Normalize + enrich
  const enriched: OutputEvent[] = [];
  for (const w of wiki) {
    const semTitle = semanticTitle(w.kind, w.title, w.text);
    const isIndian = isIndianText(`${w.title} ${w.text}`) || indianSignalScore(`${w.title} ${w.text}`) >= 15;

    // Try to verify exact day (best-effort)
    let date_iso: string | null = null;
    let verified_day = false;
    if (w.title) {
      const aud = await articleDateAuditISO(stripHtml(stripKnownPrefixAll(w.title)));
      if (aud.iso) {
        if (aud.iso.slice(5, 7) === mm && aud.iso.slice(8, 10) === dd) {
          date_iso = aud.iso;
          verified_day = true;
        }
      }
    }
    // Fallback YYYY-mm-dd if year is known (not verified)
    if (!date_iso && w.year && w.year > 0) {
      date_iso = `${String(w.year).padStart(4, "0")}-${mm}-${dd}`;
    }

    let summary = trimSummary(w.text);
    // Prefer Wikipedia summary if longer/better
    const baseTitleGuess = stripKnownPrefixAll(w.title);
    const sum = await wikiSummaryByTitle(baseTitleGuess).catch(() => null);
    if (sum && sum.length > summary.length) summary = trimSummary(sum);

    const e: OutputEvent = {
      title: semTitle,
      summary,
      date_iso,
      year: w.year != null ? String(w.year) : null,
      kind: w.kind,
      is_indian: isIndian,
      verified_day,
      score: 0,
      sources: { wikipedia_page: w.pageUrl },
    };
    e.score = baseScore(e);
    enriched.push(e);
  }

  // Sort by score desc
  let sorted = enriched.sort((a, b) => b.score - a.score);

  // Keep wider pool before enforcing mix
  sorted = sorted.slice(0, Math.max(limit * 2, limit + 10));

  // Enforce caps
  sorted = enforceCaps(sorted, Math.max(limit * 2, limit + 10));

  // Retarget to Indian share (60–70%)
  const selected = retargetIndianShare(sorted, limit, INDIAN_LOW, INDIAN_HIGH);

  const totals = {
    returned: selected.length,
    indian: selected.filter((x) => x.is_indian).length,
    global: selected.filter((x) => !x.is_indian).length,
    births_deaths: selected.filter((x) => x.kind === "birth" || x.kind === "death").length,
    battles: selected.filter((x) => /\b(battle|siege|crusade|skirmish)\b/i.test(x.title)).length,
  };

  return {
    success: true,
    date: dateStr,
    totals,
    events: selected,
  };
}

// Back-compat name if your caller imports runEventsFlow
export async function runEventsFlow(input: { date?: string; limit?: number }) {
  return runFlow(input);
}

export default runFlow;
