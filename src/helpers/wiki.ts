// src/helpers/wiki.ts
import { MONTHS, toISO, stripHtml, trimSummary } from "./utils.js";

type FeedPage = {
  titles?: { normalized?: string; display?: string };
  normalizedtitle?: string;
  content_urls?: { desktop?: { page?: string } };
};

type FeedEvent = {
  year?: number | string;
  text?: string;
  pages?: FeedPage[];
};

type OnThisDayEvents = { events?: FeedEvent[] };
type OnThisDayBirths = { births?: FeedEvent[] };
type OnThisDayDeaths = { deaths?: FeedEvent[] };

/** Call Wikipedia OTD feed */
export async function wikiOnThisDay(
  mm: string,
  dd: string,
  type: "events" | "births" | "deaths"
): Promise<OnThisDayEvents | OnThisDayBirths | OnThisDayDeaths> {
  const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/${type}/${mm}/${dd}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "HT-One-Events/1.5" },
  });
  if (!res.ok) throw new Error(`Wikipedia ${type} feed error: ${res.status}`);
  return res.json();
}

/** Summaries by title (used in enrichment) */
export async function wikiSummaryByTitle(title: string) {
  if (!title) return null;
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "HT-One-Events/1.5" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const extract = (data as any)?.extract;
  return typeof extract === "string" && extract.length ? extract : null;
}

/** Extract list from 3 feeds (events/births/deaths) with sanitized titles.
 *  Accepts partial shapes so callers can pass fallbacks like { events: [] }.
 */
export function extractWikiList(
  ev: { events?: FeedEvent[] } | null | undefined,
  br: { births?: FeedEvent[] } | null | undefined,
  de: { deaths?: FeedEvent[] } | null | undefined
) {
  const out: Array<{
    kind: "event" | "birth" | "death";
    year?: string | number;
    title: string;
    page_title?: string; // exact page title (normalized), used for date consensus
    text?: string;
    sources?: { wikipedia_page?: string | null };
  }> = [];

  const pushIt = (kind: "event" | "birth" | "death", it?: FeedEvent) => {
    if (!it) return;
    const p0 = it.pages?.[0];

    // Prefer normalized "titles.normalized" (plain text), fallback to normalizedtitle, then display.
    const rawDisplay =
      p0?.titles?.normalized ??
      p0?.normalizedtitle ??
      p0?.titles?.display ??
      it?.text ??
      "";

    const display = stripHtml(String(rawDisplay || "").trim());
    const pageTitle = p0?.titles?.normalized || p0?.normalizedtitle || null;

    out.push({
      kind,
      year: it.year,
      title: display,                  // sanitized for UI
      page_title: pageTitle || undefined, // raw page title for verification
      text: trimSummary(String(it?.text || "")),
      sources: {
        wikipedia_page: p0?.content_urls?.desktop?.page || null,
      },
    });
  };

  (ev?.events || []).forEach((it) => pushIt("event", it));
  (br?.births || []).forEach((it) => pushIt("birth", it));
  (de?.deaths || []).forEach((it) => pushIt("death", it));

  return out;
}

/** Internal: try to extract an ISO date from article HTML by regex */
async function articleDateAuditISO(titleForHtml: string) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(titleForHtml)}`;
    const res = await fetch(url, { headers: { "User-Agent": "HT-One-Events/1.5" } });
    if (!res.ok) return { iso: null as string | null, evidence: null as string | null };

    const html = await res.text();
    // Look for "... 10 August 1947" style patterns near verbs
    const rx = new RegExp(
      `(?:signed|born|died|launched|declared|independence|assassinated|founded|started|arrested|storming|crash(?:ed|es)?)[^\\w]{0,30}(\\d{1,2})\\s+(${MONTHS.join(
        "|"
      )})\\s+(\\d{3,4})`,
      "i"
    );
    let m = html.match(rx);
    if (!m) {
      // a bit more specific for treaties/signings
      const rx2 = new RegExp(
        `(?:date\\s*(?:signed|of\\s*signing)|signed)[^A-Za-z0-9]{0,10}(\\d{1,2})\\s+(${MONTHS.join(
          "|"
        )})\\s+(\\d{3,4})`,
        "i"
      );
      m = html.match(rx2);
    }
    if (!m) return { iso: null, evidence: null };

    const day = Number(m[1]);
    const mon = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    const year = Number(m[3]);
    return { iso: toISO(year, mon, day), evidence: m[0] };
  } catch {
    return { iso: null, evidence: null };
  }
}

/** Internal: try Wikidata (P585/P571/P580/P577) with references */
async function wikidataDateAuditISO(titleForSummary: string) {
  try {
    const sumRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titleForSummary)}`,
      { headers: { "User-Agent": "HT-One-Events/1.5" } }
    );
    if (!sumRes.ok) return { iso: null as string | null, property: null as string | null };

    const sum = await sumRes.json();
    const qid = (sum as any)?.wikibase_item;
    if (!qid) return { iso: null, property: null };

    const entRes = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
    if (!entRes.ok) return { iso: null, property: null };

    const ent = await entRes.json();
    const claims = (ent as any)?.entities?.[qid]?.claims || {};

    function pick(prop: string) {
      const arr = claims[prop];
      if (!Array.isArray(arr)) return null;
      for (const c of arr) {
        const val = c?.mainsnak?.datavalue?.value;
        const ref = Array.isArray(c?.references) && c.references.length > 0;
        const time = val?.time;
        if (ref && typeof time === "string") {
          const m = time.match(/^[+\-]?(\d{4})-(\d{2})-(\d{2})/);
          if (m) return `${m[1]}-${m[2]}-${m[3]}`;
        }
      }
      return null;
    }

    const order = ["P585", "P571", "P580", "P577"];
    for (const p of order) {
      const iso = pick(p);
      if (iso) return { iso, property: p };
    }
    return { iso: null, property: null };
  } catch {
    return { iso: null, property: null };
  }
}

/** Check that extracted date matches month/day; prefer exact page title if provided */
export async function requireDateConsensus(
  exactPageTitle: string | undefined,
  fallbackDisplayTitle: string,
  kind: "event" | "birth" | "death",
  mm: string,
  dd: string,
  stricter = false
) {
  const tryTitles = Array.from(
    new Set(
      [exactPageTitle, fallbackDisplayTitle]
        .filter(Boolean)
        .map((t) => stripHtml(String(t)))
    )
  ) as string[];

  for (const title of tryTitles) {
    // 1) Article HTML
    const art = await articleDateAuditISO(title);
    if (art.iso && art.iso.slice(5, 7) === mm && art.iso.slice(8, 10) === dd) {
      return { ok: true, via: "article", iso: art.iso };
    }
    // 2) Wikidata
    const wd = await wikidataDateAuditISO(title);
    if (wd.iso && wd.iso.slice(5, 7) === mm && wd.iso.slice(8, 10) === dd) {
      return { ok: true, via: `wikidata:${wd.property}`, iso: wd.iso };
    }
  }

  if (stricter) return { ok: false, via: "strict-mismatch", iso: null };

  // Birth/death: if neither source yields a day, allow lenient pass
  if (kind === "birth" || kind === "death") {
    return { ok: true, via: "lenient-no-day-found", iso: null };
  }

  return { ok: false, via: "mismatch", iso: null };
}
