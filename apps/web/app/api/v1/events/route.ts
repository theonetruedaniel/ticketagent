import { currentIdentity } from "@/lib/auth";
import { demoEvents } from "@/lib/demo-data";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const identity = await currentIdentity();
    if (identity.demo) return Response.json({ events: demoEvents, mode: "demo" });

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("events")
      .select("*,event_summaries(*)")
      .eq("home_team", "Atlanta Braves")
      .gte("starts_at", new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString())
      .order("starts_at");
    if (error) throw error;
    return Response.json({ events: data });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ error: "Could not load events" }, { status: 500 });
  }
}
