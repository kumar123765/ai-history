// deno-lint-ignore-file no-explicit-any
import { norm } from "./utils.js";
import type { PXItem } from "../types.js";

function tryParseObj(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.replace(/```json|```/gi, "").match(/\{[\s\S]*?"events"\s*:\s*\[[\s\S]*?\}\s*$/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

function parseMarkdownToEvents(text: string) {
  const lines = text.split(/\r?\n/);
  const out: PXItem[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let m = line.match(/^\*{0,2}\s*\**\s*(\-?\d{1,4}\s*BCE|\d{3,4})[^\w]+(.+?)\**\s*:?\s*(.+)$/i);
    if (!m) m = line.match(/^\*{0,2}\s*\**.*?(\-?\d{1,4}\s*BCE|\d{3,4})\**[^\w]+(.+?)\s*:\s*(.+)$/i);
    if (m) {
      const yStr = m[1].replace(/\s*BCE/i, "").trim();
      const year = /^\-?\d+$/.test(yStr) ? yStr : "";
      const title = (m[2] || "").replace(/\*\*/g, "").trim();
      const note = (m[3] || "").replace(/\*\*/g, "").trim();
      if (title) out.push({ px_rank: out.length + 1, title, year, note });
      continue;
    }
    const m2 = line.match(/^\*{0,2}\s*\**\s*(Birthday of|Death of)\s+(.+?)\**\s*:?\s*(.+)$/i);
    if (m2) out.push({ px_rank: out.length + 1, title: `${m2[1]} ${m2[2]}`.trim(), year: "", note: m2[3].trim() });
  }
  return out;
}

export async function perplexityEvents(readableDate: string, mm: string, dd: string): Promise<PXItem[]> {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return [];

  const schema = `Return MINIFIED JSON ONLY EXACTLY like: {"events":[{"year":"YYYY or -YY","title":"...","note":"why newsworthy"}]}`;
  const basePrompt = `${schema}
Date: ${readableDate} (${mm}-${dd})
Rules:
- Prioritize Indian items (60–80%) across constitutional/Supreme Court, ISRO, economy (GST/demonetisation), elections, cultural/sports milestones.
- Include major global items (treaties, space, Nobel, Olympics/records).
- Strongly de-emphasise medieval battles unless highly consequential.
- 20–30 items total.`;

  async function call(prompt: string) {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        temperature: 0.1,
        max_tokens: 2200,
        messages: [
          { role: "system", content: "You output VALID MINIFIED JSON only. No markdown, no prose." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  }

  const j1 = await call(basePrompt);
  const content1 = j1?.choices?.[0]?.message?.content?.trim() || "";
  let obj = tryParseObj(content1);

  if (!obj || !Array.isArray(obj.events)) {
    const j2 = await call(schema);
    const content2 = j2?.choices?.[0]?.message?.content?.trim() || "";
    obj = tryParseObj(content2);
    if (!obj || !Array.isArray(obj.events)) {
      const recovered = parseMarkdownToEvents(content1);
      if (recovered.length === 0) return [];
      obj = { events: recovered };
    }
  }

  const out: PXItem[] = (obj.events || [])
    .slice(0, 36)
    .map((e: any, i: number) => ({
      px_rank: i + 1,
      title: String(e?.title || "").trim(),
      year: String(e?.year ?? "").trim(),
      note: String(e?.note || "").trim(),
    }))
    .filter((e: PXItem) => e.title);

  return out;
}
