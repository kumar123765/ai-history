import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { runFlow as runEventsFlow } from "./flow.js"; // ✅ Corrected import

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

serve(async (req) => {
  // Handle preflight CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { date, limit } = await req.json();
    console.log(`📅 Running events flow for: ${date || "today"}, limit: ${limit || "default"}`);

    const result = await runEventsFlow({ date, limit });

    return new Response(JSON.stringify(result, null, 2), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
      status: 200
    });

  } catch (err) {
    console.error("❌ Error in API handler:", err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
      status: 500
    });
  }
});
