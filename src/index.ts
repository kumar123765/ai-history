import express from "express";
import cors from "cors";
import { runFlow as runEventsFlow } from "./flow.js"; // uses the export from flow.ts

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

// Main endpoint
app.post("/", async (req, res) => {
  try {
    const { date, limit } = (req.body ?? {}) as { date?: string; limit?: number };
    console.log(`📅 Running events flow for: ${date || "today"}, limit: ${limit || "default"}`);

    const result = await runEventsFlow({ date, limit });
    res.status(200).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("❌ Error in API handler:", err);
    res.status(500).json({ success: false, error: msg });
  }
});

// Start server (Render provides PORT)
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on :${PORT}`);
});
