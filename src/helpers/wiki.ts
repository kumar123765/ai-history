// src/helpers/wiki.ts
import { toISO, MONTHS, monthsFull } from "./utils.js";

export type WikiItem = {
  kind: "event"|"birth"|"death";
  year?: number|string;
  title: string;       // human/semantic title we’ll show later
  text?: string;
  pageUrl?: string|null;
  page_title?: string|null;  // <- exact page title from the feed (specific)
  sources?: { wikipedia_page?: string|null };
};

export async function wikiOnThisDay(mm: string, dd: string, type: "events"|"births"|"deaths") {
  const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/${type}/${mm}/${dd}`;
  const res = await fetch(url, { headers: { "User-Agent": "HT-One-Events/1.6" } });
  if (!res.ok) throw new Error(`Wikipedia ${type} feed error: ${res.status}`);
  return res.json();
}

export function extractWikiList(
  evFeed: any, brFeed: any, deFeed: any
): WikiItem[] {
  const out: WikiItem[] = [];

  (evFeed?.events || []).forEach((it: any) => {
    const p0 = it?.pages?.[0];
    out.push({
      kind: "event",
      year: it?.year,
      title: (p0?.titles?.display || it?.text || "").trim(),
      text: String(it?.text || "").trim(),
      pageUrl: p0?.content_urls?.desktop?.page || null,
      page_title: p0?.titles?.normalized || p0?.normalizedtitle || null,
      sources: { wikipedia_page: p0?.content_urls?.desktop?.page || null },
    });
  });

  (brFeed?.births || []).forEach((it: any) => {
    const p0 = it?.pages?.[0];
    out.push({
      kind: "birth",
      year: it?.year,
      title: (p0?.titles?.display || it?.text || "").trim(),
      text: String(it?.text || "").trim(),
      pageUrl: p0?.content_urls?.desktop?.page || null,
      page_title: p0?.titles?.normalized || p0?.normalizedtitle || null,
      sources: { wikipedia_page: p0?.content_urls?.desktop?.page || null },
    });
  });

  (deFeed?.deaths || []).forEach((it: any) => {
    const p0 = it?.pages?.[0];
    out.push({
      kind: "death",
      year: it?.year,
      title: (p0?.titles?.display || it?.text || "").trim(),
      text: String(it?.text || "").trim(),
      pageUrl: p0?.content_urls?.desktop?.page || null,
      page_title: p0?.titles?.normalized || p0?.normalizedtitle || null,
      sources: { wikipedia_page: p0?.content_urls?.desktop?.page || null },
    });
  });

  return out;
}

/** ---- Date consensus using page HTML first; falls back to Wikidata ---- */
async function articleDateAuditISO(title: string) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`;
    const res = await fetch(url, { headers: { "User-Agent": "HT-One-Events/1.6" } });
    if (!res.ok) return { iso: null as string|null, evidence: null as string|null };
    const html = await res.text();
    const rx = new RegExp(`(?:signed|born|died|launched|declared|independence|assassinated|founded|started)[^\\w]{0,30}(\\d{1,2})\\s+(${MONTHS.join("|")})\\s+(\\d{3,4})`, "i");
    let m = html.match(rx);
    if (!m) {
      const rx2 = new RegExp(`(?:date\\s*(?:signed|of\\s*signing)|signed)[^A-Za-z0-9]{0,10}(\\d{1,2})\\s+(${MONTHS.join("|")})\\s+(\\d{3,4})`, "i");
      m = html.match(rx2);
    }
    if (!m) return { iso: null, evidence: null };
    const day = Number(m[1]);
    const mon = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    const year = Number(m[3]);
    return { iso: toISO(year, mon, day), evidence: m[0] };
  } catch { return { iso: null, evidence: null }; }
}

async function wikidataDateAuditISO(title: string) {
  try {
    const sumRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
      headers: { "User-Agent": "HT-One-Events/1.6" }
    });
    if (!sumRes.ok) return { iso: null as string|null, property: null as string|null };
    const sum = await sumRes.json();
    const qid = sum?.wikibase_item;
    if (!qid) return { iso: null, property: null };

    const entRes = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
    if (!entRes.ok) return { iso: null, property: null };
    const ent = await entRes.json();
    const claims = ent?.entities?.[qid]?.claims || {};
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
    for (const p of ["P585","P571","P580","P577"]) {
      const iso = pick(p);
      if (iso) return { iso, property: p };
    }
    return { iso: null, property: null };
  } catch { return { iso: null, property: null }; }
}

/** Try specific OTD page title first, then fallback to general title */
export async function requireDateConsensus(
  preferredTitle: string|undefined,
  fallbackTitle: string,
  kind: "event"|"birth"|"death",
  mm: string,
  dd: string,
  stricter = false
) {
  const tryOne = async (title: string) => {
    const art = await articleDateAuditISO(title);
    if (art.iso && art.iso.slice(5,7) === mm && art.iso.slice(8,10) === dd) {
      return { ok: true, via: "article", iso: art.iso };
    }
    const wd = await wikidataDateAuditISO(title);
    if (wd.iso && wd.iso.slice(5,7) === mm && wd.iso.slice(8,10) === dd) {
      return { ok: true, via: `wikidata:${wd.property}`, iso: wd.iso };
    }
    return { ok: false, via: "mismatch", iso: null as string|null };
  };

  if (preferredTitle) {
    const r = await tryOne(preferredTitle);
    if (r.ok) return r;
  }
  const r2 = await tryOne(fallbackTitle);
  if (r2.ok) return r2;

  // Be lenient for births/deaths if no exact day found anywhere:
  if (!stricter && (kind === "birth" || kind === "death")) {
    return { ok: true, via: "lenient-no-day-found", iso: null as string|null };
  }
  // Strict mismatch (e.g., treaties)
  return stricter ? { ok: false, via: "strict-mismatch", iso: null } : r2;
}

export async function wikiSummaryByTitle(title: string) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { "User-Agent": "HT-One-Events/1.6" } });
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data?.extract === "string" && data.extract.length ? data.extract : null;
}
