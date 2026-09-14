import { marketplaceSourceSchema } from "@ticket-agent/contracts";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveRequestOwner } from "@/lib/request-owner";
import { z } from "zod";

const watchRequestSchema = z.object({
  source: marketplaceSourceSchema,
  listingId: z.string().min(1).max(240),
  watched: z.boolean().default(true)
});

export async function POST(request: Request) {
  const owner = await resolveRequestOwner(request);
  if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = watchRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid watch item", issues: parsed.error.issues }, { status: 400 });
  const body = parsed.data;
  if (owner.demo) return Response.json({ ok: true });
  const supabase = createAdminClient();
  if (body.watched === false) {
    const { error } = await supabase.from("watchlists").delete()
      .eq("owner_id", owner.userId).eq("source", body.source).eq("listing_id", body.listingId);
    if (error) return Response.json({ error: "Could not remove watch item" }, { status: 500 });
  } else {
    const { data: listing, error: listingError } = await supabase
      .from("listings")
      .select("event_id")
      .eq("owner_id", owner.userId)
      .eq("source", body.source)
      .eq("listing_id", body.listingId)
      .maybeSingle();
    if (listingError) return Response.json({ error: "Could not resolve watch item" }, { status: 500 });
    if (!listing) return Response.json({ error: "Listing not found" }, { status: 404 });
    const { error } = await supabase.from("watchlists").upsert({
      owner_id: owner.userId,
      source: body.source,
      listing_id: body.listingId,
      event_id: listing.event_id
    }, { onConflict: "owner_id,source,listing_id" });
    if (error) return Response.json({ error: "Could not save watch item" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
