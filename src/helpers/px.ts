import { PXItem } from "../types.js";

function sanitizeToObj(text: string): any | null {
  try { return JSON.parse(text); } catch {
    const m = text.replace(/```json|```/gi, "").match(/\{[\s\S]*?"events"\s*:\s*\[[\s\S]*?\}\s*$/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

function parseMarkdownFallback(text: string): PXItem[] {
  const out: PXItem[] = []; const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim(); if (!line) continue;
    let m = line.match(/^\*{0,2}\s*\**\s*(\-?\d{1,4}\s*BCE|\d{3,4})[^\w]+(.+?)\**\s*:?\s*(.+)$/i);
    if (!m) m = line.match(/^\*{0,2}\s*\**.*?(\-?\d{1,4}\s*BCE|\d{3,4})\**[^\w]+(.+?)\s*:\s*(.+)$/i);
    if (m) {
      const yStr = m[1].replace(/\s*BCE/i, "").trim();
      const year = /^\-?\d+$/.test(yStr) ? yStr : "";
      const title = (m[2] || "").replace(/\*\*/g, "").trim();
      const note = (m[3] || "").replace(/\*\*/g, "").trim();
      if (title) out.push({ px_rank: out.length+1, title, year, note });
      continue;
    }
  }
  return out;
}

export async function perplexityEvents(readableDate: string, mm: string, dd: string): Promise<PXItem[]> {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return [];
  const schemaHint = `Return MINIFIED JSON ONLY EXACTLY like:
{"events":[{"year":"YYYY or -YY","title":"...","note":"why newsworthy (no dates)"}]}
No markdown, no headings, no bullets, no extra keys.`;

  async function call(prompt: string) {
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar-pro",
        temperature: 0.1,
        max_tokens: 3000,
        messages: [
          { role: "system", content: "You output VALID MINIFIED JSON only. No markdown, no prose." },
          { role: "user", content: prompt }
        ]
      })
    });
    if (!r.ok) return null;
    return r.json().catch(() => null);
  }

  const basePrompt = `${schemaHint}
Date: ${readableDate} (${mm}-${dd})
Rules:
- Indian items must be 60–80% overall (constitutional, Supreme Court, ISRO, GST, elections, national observances, major cultural/sport).
- Include major global items (treaties, space, Nobel, Olympics/records).
- De-emphasise medieval battles unless highly consequential.
- 20–30 items total.`;

  const j1 = await call(basePrompt);
  const content1: string = j1?.choices?.[0]?.message?.content?.trim() || "";
  let obj = sanitizeToObj(content1);
  if (!obj || !Array.isArray(obj.events)) {
    const j2 = await call(`${schemaHint}\nONLY return the JSON object. No words.`);
    const content2: string = j2?.choices?.[0]?.message?.content?.trim() || "";
    obj = sanitizeToObj(content2);
    if (!obj || !Array.isArray(obj.events)) {
      const recovered = parseMarkdownFallback(content1);
      if (recovered.length === 0) return [];
      return recovered.slice(0, 36);
    }
  }
  return obj.events.slice(0, 36).map((e: any, i: number) => ({
    px_rank: i + 1,
    title: String(e?.title || "").trim(),
    year: String(e?.year ?? "").trim(),
    note: String(e?.note || "").trim()
  })).filter((e: PXItem) => e.title);
}
