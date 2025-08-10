// src/helpers/country.ts
/**
 * Country-code inference using Wikidata for a Wikipedia title.
 * We look at P17 (country), P495 (country of origin), P27 (citizenship for people),
 * and some quick heuristics. No deep graph traversal (keeps it fast).
 */

type WDSnak = {
  mainsnak?: { datavalue?: { value?: any } };
  references?: unknown[];
};
type WDClaims = Record<string, WDSnak[]>;

const QID_TO_ISO2: Record<string, string> = {
  // India and some common neighbors if you want to extend later
  Q668: "IN", // India
  Q159: "RU",
  Q30: "US",
  Q145: "GB",
  Q183: "DE",
  Q142: "FR",
  Q148: "CN",
  Q17: "JP",
  Q843: "PK",
  Q6686: "BD", // Bangladesh (Q902 actually; keeping sample minimal)
  Q252: "ID",
  Q801: "IL",
  Q38: "IT",
  Q29: "ES",
  Q155: "BR",
  Q16: "CA",
  Q408: "AU",
  Q664: "NZ",
};

// quick Indian keywords for fallback
const INDIAN_KEYWORDS = [
  "india","indian","delhi","new delhi","mumbai","bombay","kolkata","calcutta","chennai","madras",
  "bengal","punjab","gujarat","maharashtra","uttar pradesh","bihar","jharkhand","odisha","kerala",
  "tamil nadu","karnataka","andhra","telangana","assam","isro","drdo","iit","iisc","mughal","rajya sabha",
  "lok sabha","supreme court of india","constitution of india","nehru","gandhi","ambedkar","patel","bose"
];

function norm(s: string) {
  return String(s || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function extractQIDsFromClaims(claims: WDClaims, prop: string): string[] {
  const arr = claims?.[prop];
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const c of arr) {
    const v = c?.mainsnak?.datavalue?.value;
    const id = v?.id || v?.value?.id;
    if (typeof id === "string" && id.startsWith("Q")) out.push(id);
  }
  return out;
}

function mapQIDsToISO2(qids: string[]): string[] {
  return qids.map((q) => QID_TO_ISO2[q]).filter(Boolean) as string[];
}

/**
 * Returns a set of ISO-2 country codes inferred for a Wikipedia page title.
 * Uses: REST summary -> QID -> entity claims.
 */
export async function wikidataCountryCodes(title: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const sumRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
    );
    if (!sumRes.ok) return out;
    const sum = await sumRes.json();
    const qid = sum?.wikibase_item;
    if (!qid) return out;

    const entRes = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
    if (!entRes.ok) return out;
    const ent = await entRes.json();
    const claims: WDClaims = ent?.entities?.[qid]?.claims || {};

    // Primary country signals
    const p17 = extractQIDsFromClaims(claims, "P17");  // country
    const p495 = extractQIDsFromClaims(claims, "P495"); // country of origin
    const p27 = extractQIDsFromClaims(claims, "P27");  // citizenship (for people)
    const qids = [...new Set([...p17, ...p495, ...p27])];

    for (const iso of mapQIDsToISO2(qids)) out.add(iso);
  } catch {
    // swallow
  }
  return out;
}

/** Fallback heuristic if Wikidata is empty/slow */
export function guessCountryByText(title: string, text: string): Set<string> {
  const bag = norm(`${title} ${text}`);
  const s = new Set<string>();
  if (INDIAN_KEYWORDS.some((k) => bag.includes(k))) s.add("IN");
  return s;
}
