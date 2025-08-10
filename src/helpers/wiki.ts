import { sameMonthDay, toISO } from "./utils.js";
import { EventItem } from "../types.js";

const UA = { "User-Agent": "AI-History/1.0 (+render)" };

export async function wikiOnThisDay(mm: string, dd: string, type: "events"|"births"|"deaths") {
  const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/${type}/${mm}/${dd}`;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`Wikipedia ${type} feed error: ${r.status}`);
  return r.json();
}

export async function wikiSummaryByTitle(title: string) {
  if (!title) return null;
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) return null;
  const data = await r.json();
  const extract = typeof data?.extract === "string" ? data.extract : null;
  return extract && extract.length ? extract : null;
}

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

async function articleDateAuditISO(title: string) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`;
    const res = await fetch(url, { headers: UA });
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
    const sumRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: UA });
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

export async function requireDateConsensus(title: string, kind: string, mm: string, dd: string, stricter = false) {
  const art = await articleDateAuditISO(title);
  if (sameMonthDay(art.iso, mm, dd)) return { ok: true, via: "article", iso: art.iso };
  const wd = await wikidataDateAuditISO(title);
  if (sameMonthDay(wd.iso, mm, dd)) return { ok: true, via: `wikidata:${wd.property}`, iso: wd.iso };
  if (stricter) return { ok: false, via: "strict-mismatch", iso: null as string|null };
  if ((kind === "birth" || kind === "death") && !art.iso && !wd.iso) return { ok: true, via: "lenient-no-day-found", iso: null as string|null };
  return { ok: false, via: "mismatch", iso: null as string|null };
}

export function extractWikiList(ev: any, br: any, de: any): EventItem[] {
  const out: EventItem[] = [];
  (ev?.events || []).forEach((it: any) => {
    const p0 = it?.pages?.[0];
    const title = (p0?.titles?.normalized || p0?.normalizedtitle || p0?.titles?.display || it?.text || "").trim();
    out.push({ kind: "event", title, year: String(it?.year ?? ""), text: String(it?.text || ""), pageUrl: p0?.content_urls?.desktop?.page ?? null });
  });
  (br?.births || []).forEach((it: any) => {
    const p0 = it?.pages?.[0];
    const title = (p0?.titles?.normalized || p0?.normalizedtitle || p0?.titles?.display || it?.text || "").trim();
    out.push({ kind: "birth", title, year: String(it?.year ?? ""), text: String(it?.text || ""), pageUrl: p0?.content_urls?.desktop?.page ?? null });
  });
  (de?.deaths || []).forEach((it: any) => {
    const p0 = it?.pages?.[0];
    const title = (p0?.titles?.normalized || p0?.normalizedtitle || p0?.titles?.display || it?.text || "").trim();
    out.push({ kind: "death", title, year: String(it?.year ?? ""), text: String(it?.text || ""), pageUrl: p0?.content_urls?.desktop?.page ?? null });
  });
  return out;
}
