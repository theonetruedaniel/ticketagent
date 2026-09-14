import { currentIdentity } from "@/lib/auth";
import { demoEvents, demoListings } from "@/lib/demo-data";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const [{ id }, identity] = await Promise.all([context.params, currentIdentity()]);
    if (identity.demo) {
      const event = demoEvents.find((item) => item.id === id || item.mlbGamePk === id);
      return Response.json({
        listings: demoListings.filter((item) => item.mlbGamePk === event?.mlbGamePk),
        mode: "demo"
      });
    }
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("listings")
      .select("*")
      .eq("owner_id", identity.id)
      .eq("event_id", id)
      .eq("available", true)
      .order("price_per_ticket");
    if (error) throw error;
    return Response.json({ listings: data });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ error: "Could not load listings" }, { status: 500 });
  }
}
