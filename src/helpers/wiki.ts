import { MONTHS, toISO, stripHtml } from "./utils.js";

export type OnThisDayEventItem = {
  year: number;
  text: string;
  pages?: Array<{
    titles?: { normalized?: string; display?: string };
    normalizedtitle?: string;
    content_urls?: { desktop?: { page?: string } };
  }>;
};

export type OnThisDayEvents = { events: OnThisDayEventItem[] };
export type OnThisDayBirths = { births: OnThisDayEventItem[] };
export type OnThisDayDeaths = { deaths: OnThisDayEventItem[] };

export async function wikiOnThisDay(mm: string, dd: string, type: "events" | "births" | "deaths") {
  const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/${type}/${mm}/${dd}`;
  const res = await fetch(url, { headers: { "User-Agent": "AI-History/1.0" } });
  if (!res.ok) {
    // Return empty structurally compatible object
    return type === "events" ? { events: [] } :
           type === "births" ? { births: [] } :
           { deaths: [] };
  }
  return res.json();
}

export async function wikiSummaryByTitle(title: string): Promise<string | null> {
  const clean = encodeURIComponent(title);
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${clean}`;
  const res = await fetch(url, { headers: { "User-Agent": "AI-History/1.0" } });
  if (!res.ok) return null;
  const data: any = await res.json();
  const extract: string | undefined = data?.extract;
  return extract && extract.length ? extract : null;
}

/** Try to verify exact day by scanning article HTML for "... 10 August 1945" patterns */
export async function articleDateAuditISO(title: string): Promise<{ iso: string | null }> {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`;
    const res = await fetch(url, { headers: { "User-Agent": "AI-History/1.0" } });
    if (!res.ok) return { iso: null };
    const html = await res.text();
    // Look for "10 August 1945"/"August 10, 1945" loosely
    const rx1 = new RegExp(`(\\d{1,2})\\s+(${MONTHS.join("|")})\\s+(\\d{3,4})`, "i");
    const rx2 = new RegExp(`(${MONTHS.join("|")})\\s+(\\d{1,2}),\\s*(\\d{3,4})`, "i");

    let m = html.match(rx1);
    if (m) {
      const day = Number(m[1]);
      const mon = MONTHS.indexOf(m[2].toLowerCase()) + 1;
      const year = Number(m[3]);
      return { iso: toISO(year, mon, day) };
    }
    m = html.match(rx2);
    if (m) {
      const mon = MONTHS.indexOf(m[1].toLowerCase()) + 1;
      const day = Number(m[2]);
      const year = Number(m[3]);
      return { iso: toISO(year, mon, day) };
    }
    return { iso: null };
  } catch {
    return { iso: null };
  }
}

/** Clean title from page block (many times has HTML or nested fields) */
export function pickTitleFromPage(it: OnThisDayEventItem): string {
  const p0 = it?.pages?.[0] ?? ({} as any);
  const t =
    p0?.titles?.normalized ??
    p0?.normalizedtitle ??
    p0?.titles?.display ??
    it?.text ??
    "";
  return stripHtml(String(t)).trim();
}

export function pageUrlFromItem(it: OnThisDayEventItem): string | null {
  const p0 = it?.pages?.[0];
  return p0?.content_urls?.desktop?.page ?? null;
}
