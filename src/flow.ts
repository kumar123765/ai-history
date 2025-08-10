import { StateGraph, Annotation, END } from "@langchain/langgraph";
import { EventItem, PXItem } from "./types.js";
import {
  parseISODateUTC,
  monthsFull,
  jaccard,
  stripKnownPrefixAll,
  trimSummary,
  norm,
} from "./helpers/utils.js";
import {
  wikiOnThisDay,
  extractWikiList,
  requireDateConsensus,
  wikiSummaryByTitle,
} from "./helpers/wiki.js";
import { perplexityEvents } from "./helpers/px.js";
import { scoreEvent, semanticTitle } from "./helpers/signals.js";

/** ---------- Helpers (unchanged) ---------- */
function pickWithBounds(
  events: EventItem[],
  total: number,
  indianMin: number,
  indianMax: number
) {
  const indianAll = events
    .filter((e) => e.is_indian)
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  const globalAll = events
    .filter((e) => !e.is_indian)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  let indianTarget = Math.max(
    indianMin,
    Math.min(indianMax, Math.round(total * 0.6))
  );

  let out = [
    ...indianAll.slice(0, indianTarget),
    ...globalAll.slice(0, total - Math.min(indianAll.length, indianTarget)),
  ];

  let curIndian = out.filter((e) => e.is_indian).length;

  if (curIndian < indianMin) {
    const needed = indianMin - curIndian;
    const candidates = indianAll
      .filter((e) => !out.includes(e))
      .slice(0, needed);
    out.push(...candidates);
    out = out.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, total);
    curIndian = out.filter((e) => e.is_indian).length;
  }

  if (curIndian > indianMax) {
    const excess = curIndian - indianMax;
    const globalsLeft = globalAll
      .filter((e) => !out.includes(e))
      .slice(0, excess);
    let removed = 0;
    out = out
      .sort((a, b) => (a.score || 0) - (b.score || 0))
      .filter((e) => {
        if (removed < globalsLeft.length && e.is_indian) {
          removed++;
          return false;
        }
        return true;
      });
    out.push(...globalsLeft);
    out = out.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, total);
  }

  if (out.length < total) {
    out.push(...events.filter((e) => !out.includes(e)).slice(0, total - out.length));
    out = out.slice(0, total);
  }
  return out;
}

function enforceBirthDeathCap(sel: EventItem[], pool: EventItem[], cap: number) {
  const bd = sel.filter((e) => e.kind === "birth" || e.kind === "death");
  if (bd.length <= cap) return sel;

  const toRemove = bd
    .sort((a, b) => (a.score || 0) - (b.score || 0))
    .slice(0, bd.length - cap);
  const rem = new Set(toRemove.map((e) => e.title + "|" + e.year));
  let trimmed = sel.filter((e) => !rem.has(e.title + "|" + e.year));

  const inKey = (e: EventItem) => e.title + "|" + e.year;
  const selectedKeys = new Set(trimmed.map(inKey));
  const eventPool = pool
    .filter((e) => e.kind === "event" && !selectedKeys.has(inKey(e)))
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  for (const cand of eventPool) {
    if (trimmed.length >= sel.length) break;
    trimmed.push(cand);
  }
  return trimmed;
}

function enforceBattleCap(sel: EventItem[], pool: EventItem[], cap: number) {
  const isBattle = (x: EventItem) =>
    /\b(battle|siege|crusade|skirmish)\b/i.test(x.title) ||
    /\b(battle|siege|crusade|skirmish)\b/i.test(x.summary || "");
  const battles = sel.filter(isBattle);
  if (battles.length <= cap) return sel;

  const toRemove = battles
    .sort((a, b) => (a.score || 0) - (b.score || 0))
    .slice(0, battles.length - cap);
  const rem = new Set(toRemove.map((e) => e.title + "|" + e.year));
  let trimmed = sel.filter((e) => !rem.has(e.title + "|" + e.year));

  const inKey = (e: EventItem) => e.title + "|" + e.year;
  const selectedKeys = new Set(trimmed.map(inKey));
  const nonBattlePool = pool
    .filter(
      (e) =>
        e.kind === "event" && !selectedKeys.has(inKey(e)) && !isBattle(e)
    )
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  for (const cand of nonBattlePool) {
    if (trimmed.length >= sel.length) break;
    trimmed.push(cand);
  }
  return trimmed;
}

/** ---------- LangGraph v0.4 State (Annotations) ---------- */
const S = Annotation.Root({
  date: Annotation<string>(),
  limit: Annotation<number>(),

  mm: Annotation<string | undefined>(),
  dd: Annotation<string | undefined>(),
  readableDate: Annotation<string | undefined>(),

  wiki: Annotation<EventItem[] | undefined>(),
  px: Annotation<PXItem[] | undefined>(),
  merged: Annotation<EventItem[] | undefined>(),
  selected: Annotation<EventItem[] | undefined>(),
  events: Annotation<any[] | undefined>(),
});

/** ---------- Graph ---------- */
export const app = new StateGraph(S)
  .addNode("normalizeDate", async (state) => {
    // return only updates, not full state
    const d = parseISODateUTC(state.date);
    return {
      mm: String(d.getUTCMonth() + 1).padStart(2, "0"),
      dd: String(d.getUTCDate()).padStart(2, "0"),
      readableDate: `${monthsFull[d.getUTCMonth()]} ${d.getUTCDate()}`,
    };
  })

  .addNode("fetchInParallel", async (state) => {
    const timeout = Number(process.env.PX_WIKI_TIMEOUT_MS || 8000);
    const withTimeout = <T>(p: Promise<T>) =>
      Promise.race<T>([
        p,
        new Promise<T>((_, rej) =>
          setTimeout(() => rej(new Error("PX_WIKI_HARD_TIMEOUT")), timeout)
        ),
      ]);

    const [ev, br, de, px] = await Promise.all([
      withTimeout(wikiOnThisDay(state.mm!, state.dd!, "events")).catch(() => ({ events: [] })),
      withTimeout(wikiOnThisDay(state.mm!, state.dd!, "births")).catch(() => ({ births: [] })),
      withTimeout(wikiOnThisDay(state.mm!, state.dd!, "deaths")).catch(() => ({ deaths: [] })),
      withTimeout(perplexityEvents(state.readableDate!, state.mm!, state.dd!)).catch(() => []),
    ]);

    return {
      wiki: extractWikiList(ev, br, de),
      px: px as PXItem[],
    };
  })

  .addNode("verifyAndMerge", async (state) => {
    const { mm, dd, readableDate } = state;

    const verifiedFromPx: EventItem[] = [];
    for (const e of state.px || []) {
      const yNum = /^\-?\d+$/.test(e.year || "") ? Number(e.year) : undefined;
      let best: EventItem | null = null,
        bestScore = 0;

      for (const w of state.wiki || []) {
        if (yNum != null && /^\-?\d+$/.test(w.year || "") && Number(w.year) !== yNum)
          continue;
        const score = Math.max(jaccard(e.title, w.title), jaccard(e.title, w.text || ""));
        if (score > bestScore) {
          bestScore = score;
          best = w;
        }
      }
      if (!best || bestScore < 0.6) continue;

      const strict =
        /treaty|accord|agreement/i.test(best.title) ||
        /treaty|accord|agreement/i.test(best.text || "");
      const gate = await requireDateConsensus(best.title || e.title, best.kind, mm!, dd!, strict);
      if (!gate.ok) continue;

      const yr = best.year ?? e.year ?? "";
      const date_iso = gate.iso
        ? gate.iso
        : yr && /^\d+$/.test(yr) && Number(yr) > 0
        ? `${yr}-${mm}-${dd}`
        : null;
      const disp =
        yr && /^\-?\d+$/.test(yr) && Number(yr) > 0
          ? `${readableDate}, ${yr}`
          : yr && /^\-?\d+$/.test(yr) && Number(yr) < 0
          ? `${readableDate}, ${Math.abs(Number(yr))} BCE`
          : readableDate;

      const rawTitle = best.title || e.title;
      const rawText = best.text || e.note || "";
      const semTitle = semanticTitle(best.kind, rawTitle, rawText);

      const prelim: EventItem = {
        kind: best.kind,
        title: semTitle,
        year: String(yr || ""),
        summary: trimSummary((best.text || "") + (e.note ? ` ${e.note}` : "")),
        date_iso,
        display_date: disp,
        is_indian: undefined,
        sources: { wikipedia_page: (best as any).pageUrl ?? null },
        px_rank: e.px_rank,
      };
      prelim.score = scoreEvent(prelim);
      verifiedFromPx.push(prelim);
    }

    const wikiDirect = (
      await Promise.all(
        (state.wiki || []).map(async (w) => {
          const strict =
            /treaty|accord|agreement/i.test(w.title) ||
            /treaty|accord|agreement/i.test(w.text || "");
          const gate = await requireDateConsensus(w.title, w.kind, mm!, dd!, strict);
          if (!gate.ok) return null;

          const yr = w.year ?? "";
          const date_iso = gate.iso
            ? gate.iso
            : yr && /^\d+$/.test(yr) && Number(yr) > 0
            ? `${yr}-${mm}-${dd}`
            : null;
          const disp =
            yr && /^\-?\d+$/.test(yr) && Number(yr) > 0
              ? `${readableDate}, ${yr}`
              : yr && /^\-?\d+$/.test(yr) && Number(yr) < 0
              ? `${readableDate}, ${Math.abs(Number(yr))} BCE`
              : readableDate;

          const semTitle = semanticTitle(w.kind, w.title, w.text || "");
          const prelim: EventItem = {
            kind: w.kind,
            title: semTitle,
            year: String(yr || ""),
            summary: trimSummary(w.text || ""),
            date_iso,
            display_date: disp,
            is_indian: undefined,
            sources: { wikipedia_page: (w as any).pageUrl ?? null },
            px_rank: undefined,
          };
          prelim.score = scoreEvent(prelim);
          return prelim;
        })
      )
    ).filter(Boolean) as EventItem[];

    const items = [...verifiedFromPx, ...wikiDirect];
    const out: EventItem[] = [];
    for (const e of items) {
      const dup =
        out.find(
          (o) =>
            e.year &&
            o.year &&
            String(e.year) === String(o.year) &&
            jaccard(stripKnownPrefixAll(e.title), stripKnownPrefixAll(o.title)) > 0.72
        ) || null;
      if (!dup) out.push(e);
    }

    out.sort((a, b) => {
      const ap = a.px_rank ? 0 : 1,
        bp = b.px_rank ? 0 : 1;
      return ap !== bp ? ap - bp : (b.score || 0) - (a.score || 0);
    });

    // return partial update
    return { merged: out };
  })

  .addNode("selectEnforce", async (state) => {
    const total = Math.min(Math.max(state.limit || 25, 10), 30);
    const minI = Math.round(total * 0.6),
      maxI = Math.round(total * 0.8);

    let sel = pickWithBounds(state.merged || [], total, minI, maxI);
    sel = enforceBirthDeathCap(sel, state.merged || [], 6);
    sel = enforceBattleCap(sel, state.merged || [], 3);

    return { selected: sel };
  })

  .addNode("enrich", async (state) => {
    const pxNotes = new Map(
      (state.px || []).map((p) => [norm(stripKnownPrefixAll(p.title)), p.note || ""])
    );

    const enriched = await Promise.all(
      (state.selected || []).map(async (e) => {
        const guess = stripKnownPrefixAll(e.title);
        const sum = await wikiSummaryByTitle(guess).catch(() => null);
        if (sum && sum.length > (e.summary?.length || 0)) e.summary = trimSummary(sum);
        const note = pxNotes.get(norm(guess));
        if (note && (e.summary || "").length < 240)
          e.summary = trimSummary(`${e.summary || ""} ${note}`);
        return e;
      })
    );

    return { events: enriched };
  })

  // Edges
  .addEdge("normalizeDate", "fetchInParallel")
  .addEdge("fetchInParallel", "verifyAndMerge")
  .addEdge("verifyAndMerge", "selectEnforce")
  .addEdge("selectEnforce", "enrich")
  .addEdge("enrich", END)

  // Explicit entry
  .setEntryPoint("normalizeDate")
  .compile();

/** ---------- Public runner ---------- */
export async function runEventsFlow(date: string, limit = 25) {
  const result = await app.invoke({ date, limit });
  const events = (result.events || []).map((e: any) => ({
    title: e.title,
    summary: e.summary,
    date_iso: e.date_iso,
    display_date: e.display_date,
    year: e.year,
    kind: e.kind,
    is_indian: e.is_indian,
    score: e.score,
    sources: e.sources,
  }));
  return {
    success: true,
    date,
    totals: {
      returned: events.length,
      indian: events.filter((x: any) => x.is_indian).length,
      global: events.filter((x: any) => !x.is_indian).length,
      births_deaths: events.filter((x: any) => x.kind === "birth" || x.kind === "death").length,
      battles: events.filter((x: any) => /\b(battle|siege|crusade|skirmish)\b/i.test(x.title)).length,
    },
    events,
  };
}
