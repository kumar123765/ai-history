import { createServer, IncomingMessage, ServerResponse } from "http";
import { runFlow, runEventsFlow } from "./flow.js";

type Json = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function send(res: ServerResponse, status: number, data: Json) {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      return res.end();
    }

    // Health
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { ...corsHeaders, "Content-Type": "text/plain" });
      return res.end("ok");
    }

    // Main endpoint
    if (req.method === "POST" && (req.url === "/" || req.url === "/events")) {
      const body = await readJson(req);
      const { date, limit } = (body ?? {}) as { date?: string; limit?: number };
      const out = await runEventsFlow({ date, limit });
      return send(res, 200, out);
    }

    return send(res, 404, { success: false, error: "Not found" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("❌ Server error:", err);
    return send(res, 500, { success: false, error: msg });
  }
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => {
  console.log(`✅ Server listening on :${PORT}`);
});
