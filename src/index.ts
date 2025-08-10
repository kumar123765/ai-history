import Fastify from "fastify";
import { runEventsFlow } from "./flow.js";

const app = Fastify();
const PORT = Number(process.env.PORT || 8080);

app.get("/", async () => ({ ok: true, service: "ai-history-api" }));

app.post("/api/history", async (req, reply) => {
  try {
    const body = (req.body ?? {}) as any;
    const { date, limit } = body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return reply.code(400).send({ ok:false, error: "Body must include { date: 'YYYY-MM-DD' }" });
    }
    const result = await runEventsFlow(String(date), Math.min(Math.max(Number(limit)||25, 10), 30));
    return reply.send(result);
  } catch (e:any) {
    return reply.code(200).send({
      success: false,
      error: "UPSTREAM_OR_PARSE_FAILURE",
      detail: e?.message || "Unknown"
    });
  }
});

app.listen({ port: PORT, host: "0.0.0.0" })
  .then(() => console.log(`✅ Render API listening on ${PORT}`))
  .catch(err => { console.error(err); process.exit(1); });
