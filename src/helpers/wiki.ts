import { norm } from "./utils.js";
import type { EventItem } from "../types.js";

const MONTHS = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december"
];

function toISO(y: number, m: number, d: number) {
  return `${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

function sameMonthDay(iso: string | null | undefined, mm: string, dd: string) {
  return !!iso && iso.slice(5, 7) === mm && iso.slice(8, 10) === dd;
}

export async function wikiOnThisDay(mm: string, dd: string, type: "events"|"births"|"deaths") {
  const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/${type}/${mm}/${dd}`;
  const res = await fetch(url, { headers: { "User-Agent": "AI-History/1.0" } });
  if (!res.ok) throw new Error(`Wikipedia ${type} feed error: ${res.status}`);
  return res.json();
}

export function extractWikiList(evFeed: any, brFeed: any, deFeed: any): EventItem[] {
  const out: EventItem[] = [];
  (evFeed?.events || []).forEach((it: any) => {
    const p0 = it?.pages?.[0];
    const title = (p0?.titles?.normalized || p0?.normalizedtitle || p0?.titles?.display || it?.text || "").trim();
    out.push({
      kind: "event",
      year: String(it?.year ?? ""),
      title,
      text: String(it?.text || "").trim(),
      sources: { wikipedia_page: p0?.content_urls?.desktop?.page || null },
    } as any);
  });
  (brFeed?.births || []).forEach((it: any) => {
    const p0 = it?.pages?.[0];
    const title = (p0?.titles?.normalized || p0?.normalizedtitle || p0?.titles?.display || it?.text || "").trim();
    out.push({
      kind: "birth",
      year: String(it?.year ?? ""),
      title,
      text: String(it?.text || "").trim(),
      sources: { wikipedia_page: p0?.content_urls?.desktop?.page || null },
    } as any);
  });
  (deFeed?.deaths || []).forEach((it: any) => {
    const p0 = it?.pages?.[0];
    const title = (p0?.titles?.normalized || p0?.normalizedtitle || p0?.titles?.display || it?.text || "").trim();
    out.push({
      kind: "death",
      year: String(it?.year ?? ""),
      title,
      text: String(it?.text || "").trim(),
      sources: { wikipedia_page: p0?.content_urls?.desktop?.page || null },
    } as any);
  });
  return out;
}

export async function wikiSummaryByTitle(title: string) {
  if (!title) return null;
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { "User-Agent": "AI-History/1.0" } });
  if (!res.ok) return null;
  const data = await res.json();
  const extract = data?.extract;
  return typeof extract === "string" && extract.length ? extract : null;
}

/** ---- Date consensus (article HTML + Wikidata) ---- */
async function articleDateAuditISO(title: string) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`;
    const res = await fetch(url, { headers: { "User-Agent": "AI-History/1.0" } });
    if (!res.ok) return { iso: null as string | null, evidence: null as string | null };
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
  } catch {
    return { iso: null, evidence: null };
  }
}

async function wikidataDateAuditISO(title: string) {
  try {
    const sumRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
      headers: { "User-Agent": "AI-History/1.0" },
    });
    if (!sumRes.ok) return { iso: null as string | null, property: null as string | null };
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

export async function requireDateConsensus(
  title: string,
  kind: "event" | "birth" | "death",
  mm: string,
  dd: string,
  stricter = false
) {
  const art = await articleDateAuditISO(title);
  if (sameMonthDay(art.iso, mm, dd)) return { ok: true, via: "article", iso: art.iso };

  const wd = await wikidataDateAuditISO(title);
  if (sameMonthDay(wd.iso, mm, dd)) return { ok: true, via: `wikidata:${wd.property}`, iso: wd.iso };

  if (stricter) return { ok: false, via: "strict-mismatch", iso: null };

  // births/deaths often lack explicit day in HTML; allow lenient pass without day
  if ((kind === "birth" || kind === "death") && !art.iso && !wd.iso) return {
    ok: true, via: "lenient-no-day-found", iso: null,
  };

  return { ok: false, via: "mismatch", iso: null };
}
