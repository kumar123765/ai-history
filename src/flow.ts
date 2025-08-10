// src/flow.ts

import { StateGraph, END } from "@langchain/langgraph";

// Helpers
import {
  monthsFull,
  parseISODateUTC,
  norm,
  jaccard,
  trimSummary,
  stripKnownPrefixAll,
  isoToDisplay,
} from "./helpers/utils.js";

import {
  wikiOnThisDay,
  extractWikiList,
  wikiSummaryByTitle,
  requireDateConsensus,
} from "./helpers/wiki.js";

/* =========================
   Types & State
========================= */

type WikiItem = {
  kind: "event" | "birth" | "death";
  year?: string | number;
  title: string;
  page_title?: string;
  text?: string;
  sources?: { wikipedia_page?: string | null };
};

type PXItem = {
  px_rank?: number;
  title: string;
  year?: string;
  note?: string;
};

type EventOut = {
  title: string;
  summary: string;
  date_iso: string | null;
  year?: string;
  kind: "event" | "birth" | "death";
  is_indian: boolean;
  verified_day: boolean;
  score: number;
  sources: { wikipedia_page?: string | null };
};

type S = {
  // input/normalized
  date?: string;      // YYYY-MM-DD
  mm?: string;
  dd?: string;
  readableDate?: string; // e.g., "August 10"
  limit?: number;

  // fetched
  wiki?: WikiItem[];
  px?: PXItem[];
  px_india?: PXItem[];

  // processed
  merged?: any[];
  selected?: any[];
  events?: EventOut[];
};

/* =========================
   Config
========================= */

const DEFAULT_TARGET_TOTAL = 25;
const MAX_TARGET_TOTAL = 30;
const BIRTH_DEATH_MAX = 6;
const BATTLE_MAX = 3;

/* =========================
   Light India signals
   (you can swap with the hybrid WD check later)
========================= */

const INDIA_TERMS = [
  "india","indian","bharat","hindustan","delhi","new delhi","mumbai","bombay",
  "kolkata","calcutta","chennai","madras","bengal","punjab","gujarat","karnataka",
  "tamil nadu","uttar pradesh","bihar","odisha","kerala","andhra","telangana",
  "assam","isro","drdo","iit","iisc","mughal","british raj","nehru","gandhi",
  "ambedkar","patel","bose","kalam","ipl","cricket","constitution of india",
  "supreme court of india","article 370","gst","aadhaar","lok sabha","rajya sabha"
];

function isIndianText(t: string) {
  const x = norm(t);
  return INDIA_TERMS.some((k) => x.includes(k));
}

/* =========================
   Perplexity (optional)
   – Safe no-op if no key present
========================= */

async function perplexityEvents(
  readableDate: string,
  mm: string,
  dd: string,
  opts?: { indiaOnly?: boolean }
): Promise<PXItem[]> {
  try {
    const key = process.env.PERPLEXITY_API_KEY;
    if (!key) return []; // safe fallback

    const schemaHint =
      `Return MINIFIED JSON ONLY EXACTLY like:` +
      `{"events":[{"year":"YYYY or -YY","title":"...","note":"why newsworthy (no dates)"}]}`;

    const indiaClause = opts?.indiaOnly
      ? `Focus ONLY on India-related items.`
      : `Include global items too.`;

    const prompt = `${schemaHint}
Date: ${readableDate} (${mm}-${dd})
Rules:
- 20–30 items total (concise).
- Prefer high-signal: constitutional/judiciary (Article 370, Right to Privacy), ISRO (Chandrayaan/MOM), economic (GST, demonetisation), elections/milestones, sports/culture.
- Strongly de-emphasize generic medieval battles.
- ${indiaClause}`;

    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        temperature: 0.1,
        max_tokens: 2000,
        messages: [
          { role: "system", content: "You output VALID MINIFIED JSON only. No markdown, no prose." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) return [];
    const j = await res.json().catch(() => null);
    const content = j?.choices?.[0]?.message?.content?.trim() || "";
    let obj: any = null;
    try {
      obj = JSON.parse(content);
    } catch {
      obj = null;
    }
    if (!obj?.events || !Array.isArray(obj.events)) return [];
    return obj.events.slice(0, 36).map((e: any, i: number) => ({
      px_rank: i + 1,
      title: String(e?.title || "").trim(),
      year: String(e?.year ?? "").trim(),
      note: String(e?.note || "").trim(),
    })).filter((e: PXItem) => e.title);
  } catch {
    return [];
  }
}

/* =========================
   Scoring & Helpers
========================= */

function newsworthyBoost(t: string) {
  return /(isro|chandrayaan|mangalyaan|pslv|gslv|supreme court|constitution|gst|election|treaty|accord|apollo|sputnik|olympic|world cup|earthquake|cyclone|tsunami)/i.test(
    t
  )
    ? 10
    : 0;
}

function scoreEvent(e: {
  title: string;
  summary?: string;
  year?: string | number;
  kind: "event" | "birth" | "death";
  is_indian: boolean;
}) {
  let s = 45;
  const blob = `${e.title} ${e.summary || ""}`;
  if (e.is_indian) s += 8;
  s += newsworthyBoost(blob);
  const y = Number(e.year || "0");
  if (y && y < 1900) s += 2;
  if (e.kind === "birth" || e.kind === "death") s -= 3;
  const isBattle = /\b(battle|siege|skirmish)\b/i.test(blob);
  if (isBattle && !e.is_indian) s -= 8;
  return Math.max(0, Math.min(100, s));
}

function pickWithBounds(
  events: any[],
  total: number,
  indianMin: number,
  indianMax: number
) {
  const indianAll = events.filter((e) => e.is_indian).sort((a: any, b: any) => b.score - a.score);
  const globalAll = events.filter((e) => !e.is_indian).sort((a: any, b: any) => b.score - a.score);

  let indianTarget = Math.max(indianMin, Math.min(indianMax, Math.round(total * 0.7)));

  let out: any[] = [
    ...indianAll.slice(0, indianTarget),
    ...globalAll.slice(0, total - Math.min(indianAll.length, indianTarget)),
  ];

  const curIndian = out.filter((e) => e.is_indian).length;

  // If still short, top up with more Indian items
  if (curIndian < indianMin) {
    const needed = indianMin - curIndian;
    const candidates = indianAll.filter((e) => !out.includes(e)).slice(0, needed);
    out.push(...candidates);
    out = out.sort((a, b) => b.score - a.score).slice(0, total);
  }

  // If too many Indian items, trade out for globals if available
  if (out.filter((e) => e.is_indian).length > indianMax) {
    const excess = out.filter((e) => e.is_indian).length - indianMax;
    const globalsLeft = globalAll.filter((e) => !out.includes(e)).slice(0, excess);
    let removed = 0;
    out = out
      .sort((a, b) => a.score - b.score)
      .filter((e) => {
        if (removed < globalsLeft.length && e.is_indian) {
          removed++;
          return false;
        }
        return true;
      });
    out.push(...globalsLeft);
    out = out.sort((a, b) => b.score - a.score).slice(0, total);
  }

  if (out.length < total) {
    out.push(...events.filter((e) => !out.includes(e)).slice(0, total - out.length));
    out = out.slice(0, total);
  }

  return out;
}

/* =========================
   Graph Nodes
========================= */

// 1) Normalize date & limit
const normalizeDate = (async (s: S) => {
  const limit = Math.min(Math.max(Number(s.limit) || DEFAULT_TARGET_TOTAL, 10), MAX_TARGET_TOTAL);
  const d = s.date ? parseISODateUTC(s.date) : new Date(); // if date missing, fallback today (UTC)
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const readableDate = `${monthsFull[d.getUTCMonth()]} ${d.getUTCDate()}`;

  return { limit, date: `${d.getUTCFullYear()}-${mm}-${dd}`, mm, dd, readableDate } as Partial<S>;
}) as any;

// 2) Fetch Wikipedia feeds + Perplexity (both global & India-focused)
const fetchSources = (async (s: S) => {
  const [evFeed, brFeed, deFeed] = await Promise.all([
    wikiOnThisDay(s.mm!, s.dd!, "events").catch(() => ({ events: [] })),
    wikiOnThisDay(s.mm!, s.dd!, "births").catch(() => ({ births: [] })),
    wikiOnThisDay(s.mm!, s.dd!, "deaths").catch(() => ({ deaths: [] })),
  ]);

  const wiki = extractWikiList(evFeed as any, brFeed as any, deFeed as any);

  // Perplexity calls (safe: may return [])
  const [pxAll, pxIndia] = await Promise.all([
    perplexityEvents(s.readableDate!, s.mm!, s.dd!, { indiaOnly: false }).catch(() => []),
    perplexityEvents(s.readableDate!, s.mm!, s.dd!, { indiaOnly: true }).catch(() => []),
  ]);

  return { wiki, px: pxAll, px_india: pxIndia } as Partial<S>;
}) as any;

// 3) Verify (date consensus), dedupe, merge, score
const verifyAndMerge = (async (s: S) => {
  const mm = s.mm!;
  const dd = s.dd!;

  // Map PX notes for enrichment later
  const pxNotes = new Map<string, string>();
  [...(s.px || []), ...(s.px_india || [])].forEach((p) => {
    if (p.title) pxNotes.set(norm(stripKnownPrefixAll(p.title)), p.note || "");
  });

  const verifiedFromWiki: any[] = [];
  for (const w of s.wiki || []) {
    const strictTreaty =
      /treaty|accord|agreement/i.test(w.title) || /treaty|accord|agreement/i.test(w.text || "");
    const gate = await requireDateConsensus(w.page_title, w.title, w.kind, mm, dd, strictTreaty);

    if (!gate.ok) continue;

    const yr = w.year != null ? String(w.year) : "";
    const is_indian = isIndianText(`${w.title} ${w.text || ""}`);
    const summary = trimSummary(w.text || "");
    const score = scoreEvent({
      title: w.title,
      summary,
      year: yr,
      kind: w.kind,
      is_indian,
    });

    verifiedFromWiki.push({
      kind: w.kind,
      title: w.title,
      year: yr,
      summary,
      date_iso: gate.iso ?? null,
      is_indian,
      verified_day: !!gate.iso,
      sources: { wikipedia_page: w.sources?.wikipedia_page ?? null },
      score,
    });
  }

  // Merge PX-derived items only if they fuzzy-match something in wiki (and same year if given)
  const fromPX: any[] = [];
  for (const p of [...(s.px || []), ...(s.px_india || [])]) {
    const yNum = /^\-?\d+$/.test(String(p.year || "")) ? Number(p.year) : undefined;
    let best: WikiItem | null = null;
    let bestScore = 0;

    for (const w of s.wiki || []) {
      if (yNum != null && w.year != null && Number(w.year) !== yNum) continue;
      const sim = Math.max(jaccard(p.title, w.title), jaccard(p.title, w.text || ""));
      if (sim > bestScore) {
        bestScore = sim;
        best = w;
      }
    }
    if (!best || bestScore < 0.6) continue;

    const strictTreaty =
      /treaty|accord|agreement/i.test(best.title) || /treaty|accord|agreement/i.test(best.text || "");

    const gate = await requireDateConsensus(best.page_title, best.title, best.kind, mm, dd, strictTreaty);
    if (!gate.ok) continue;

    const yr = best.year != null ? String(best.year) : p.year || "";
    const is_indian = isIndianText(`${best.title} ${best.text || ""} ${p.note || ""}`);
    let summary = trimSummary((best.text || "") + (p.note ? ` ${p.note}` : ""));
    const score = scoreEvent({
      title: best.title,
      summary,
      year: yr,
      kind: best.kind,
      is_indian,
    });

    fromPX.push({
      kind: best.kind,
      title: best.title,
      year: yr,
      summary,
      date_iso: gate.iso ?? null,
      is_indian,
      verified_day: !!gate.iso,
      sources: { wikipedia_page: best.sources?.wikipedia_page ?? null },
      score,
      px_rank: p.px_rank,
    });
  }

  // Merge + Dedupe (prefer PX-verified, then higher score; prefer Indian on duplicate)
  const items = [...fromPX, ...verifiedFromWiki];
  const out: any[] = [];
  for (const e of items) {
    const dup = out.find(
      (o) =>
        e.year &&
        o.year &&
        String(e.year) === String(o.year) &&
        jaccard(stripKnownPrefixAll(e.title), stripKnownPrefixAll(o.title)) > 0.72
    );
    if (!dup) {
      out.push(e);
    } else {
      // prefer PX-verified > wiki-only; else prefer Indian; else higher score
      const eScore = (e.px_rank ? 1 : 0) + (e.is_indian ? 1 : 0) + e.score / 100;
      const dScore = (dup.px_rank ? 1 : 0) + (dup.is_indian ? 1 : 0) + dup.score / 100;
      if (eScore > dScore) {
        const i = out.indexOf(dup);
        out[i] = e;
      }
    }
  }

  // Order: PX-verified first by px_rank, then score desc
  out.sort((a, b) => {
    const ap = a.px_rank ? 0 : 1;
    const bp = b.px_rank ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return b.score - a.score;
  });

  return { merged: out } as Partial<S>;
}) as any;

// 4) Selection with bounds & caps
const selectTop = (async (s: S) => {
  const total = Math.min(Math.max(Number(s.limit) || DEFAULT_TARGET_TOTAL, 10), MAX_TARGET_TOTAL);
  const minI = Math.round(total * 0.70); // aim 70–85% Indian
  const maxI = Math.round(total * 0.85);

  let selected = pickWithBounds(s.merged || [], total, minI, maxI);

  // Cap births+deaths
  const bd = selected.filter((e) => e.kind === "birth" || e.kind === "death");
  if (bd.length > BIRTH_DEATH_MAX) {
    const toRemove = bd.sort((a, b) => a.score - b.score).slice(0, bd.length - BIRTH_DEATH_MAX);
    const key = (e: any) => e.title + "|" + e.year;
    const rm = new Set(toRemove.map(key));
    selected = selected.filter((e) => !rm.has(key(e)));
    // fill back with events
    const pool = (s.merged || []).filter(
      (e) => e.kind === "event" && !selected.find((x) => key(x) === key(e))
    );
    selected.push(...pool.slice(0, total - selected.length));
  }

  // Cap battles
  const isBattle = (x: any) =>
    /\b(battle|siege|crusade|skirmish)\b/i.test(x.title) ||
    /\b(battle|siege|crusade|skirmish)\b/i.test(x.summary || "");
  const battles = selected.filter(isBattle);
  if (battles.length > BATTLE_MAX) {
    const toRemove = battles.sort((a, b) => a.score - b.score).slice(0, battles.length - BATTLE_MAX);
    const key = (e: any) => e.title + "|" + e.year;
    const rm = new Set(toRemove.map(key));
    selected = selected.filter((e) => !rm.has(key(e)));
    const pool = (s.merged || []).filter(
      (e) => e.kind === "event" && !isBattle(e) && !selected.find((x) => key(x) === key(e))
    );
    selected.push(...pool.slice(0, total - selected.length));
  }

  // Final re-sort by score
  selected = selected.sort((a, b) => b.score - a.score).slice(0, total);

  return { selected } as Partial<S>;
}) as any;

// 5) Enrich summaries & finalize output
const enrichAndFinalize = (async (s: S) => {
  const out: EventOut[] = [];
  for (const e of s.selected || []) {
    // Try Wikipedia lead if it’s more informative
    const lead = await wikiSummaryByTitle(stripKnownPrefixAll(e.title)).catch(() => null);
    const betterSummary =
      lead && lead.length > (e.summary?.length || 0) ? trimSummary(lead) : e.summary || "";

    out.push({
      title: e.title,
      summary: betterSummary,
      date_iso: e.date_iso ?? null,
      year: e.year,
      kind: e.kind,
      is_indian: !!e.is_indian,
      verified_day: !!e.verified_day,
      score: e.score,
      sources: { wikipedia_page: e.sources?.wikipedia_page ?? null },
    });
  }

  return { events: out } as Partial<S>;
}) as any;

/* =========================
   Build & Export Graph
========================= */

const graph = new StateGraph<S>({} as any) // keep types simple
  .addNode("normalizeDate", normalizeDate)
  .addNode("fetchSources", fetchSources)
  .addNode("verifyAndMerge", verifyAndMerge)
  .addNode("selectTop", selectTop)
  .addNode("enrichAndFinalize", enrichAndFinalize)
  .addEdge("__start__", "normalizeDate")
  .addEdge("normalizeDate", "fetchSources")
  .addEdge("fetchSources", "verifyAndMerge")
  .addEdge("verifyAndMerge", "selectTop")
  .addEdge("selectTop", "enrichAndFinalize")
  .addEdge("enrichAndFinalize", END)
  .compile();

export default graph;

/* =========================
   Handy runner (optional)
========================= */

export async function runFlow(input: { date?: string; limit?: number }) {
  const res = await graph.invoke({
    date: input.date,
    limit: input.limit,
  } as S);

  const events: EventOut[] = (res as any).events || [];
  const indian = events.filter((x) => x.is_indian).length;
  const births_deaths = events.filter((x) => x.kind === "birth" || x.kind === "death").length;
  const battles = events.filter((x) => /\b(battle|siege|skirmish)\b/i.test(x.title)).length;

  return {
    success: true,
    date: (res as any).date || input.date || "",
    totals: {
      returned: events.length,
      indian,
      global: events.length - indian,
      births_deaths,
      battles,
    },
    events,
  };
}
