import { createAdminClient } from "@/lib/supabase/server";
import { ingestScan } from "@/lib/ingest";

type ConnectorImportRow = {
  id: string;
  owner_id: string | null;
  source: "SeatGeek" | "StubHub" | "TickPick" | "GameTime";
  source_event_id: string;
  batch: unknown;
};

export async function processConnectorListingImports() {
  const supabase = createAdminClient();
  const { data: pending, error: pendingError } = await supabase
    .from("connector_listing_imports")
    .select("id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);
  if (pendingError) throw pendingError;

  let processed = 0;
  let failed = 0;
  const results = [];

  for (const candidate of pending ?? []) {
    const { data: claimed, error: claimError } = await supabase
      .from("connector_listing_imports")
      .update({ status: "processing" })
      .eq("id", candidate.id)
      .eq("status", "pending")
      .select("id,owner_id,source,source_event_id,batch")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) continue;

    const row = claimed as ConnectorImportRow;
    try {
      let ownerId = row.owner_id;
      if (!ownerId) {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id")
          .limit(1)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!profile) throw new Error("No private TicketAgent account is configured");
        ownerId = profile.id;
      }
      if (!ownerId) throw new Error("Connector import owner could not be resolved");

      const result = await ingestScan(row.batch, ownerId);
      const { data: sourceEvent, error: sourceEventError } = await supabase
        .from("source_events")
        .select("summary")
        .eq("source", row.source)
        .eq("source_event_id", row.source_event_id)
        .maybeSingle();
      if (sourceEventError) throw sourceEventError;
      const { error: mappingError } = await supabase
        .from("source_events")
        .update({
          summary: {
            ...((sourceEvent?.summary as Record<string, unknown> | null) ?? {}),
            collectionMode: "connector_alert",
            priceBasis: "all_in",
            browserAutomationAllowed: false,
            capabilityMessage:
              "Exact listing prices are supplied by the authorized marketplace connector."
          }
        })
        .eq("source", row.source)
        .eq("source_event_id", row.source_event_id);
      if (mappingError) throw mappingError;

      const { error: completeError } = await supabase
        .from("connector_listing_imports")
        .update({
          status: "processed",
          result,
          last_error: null,
          processed_at: new Date().toISOString()
        })
        .eq("id", row.id);
      if (completeError) throw completeError;
      processed += 1;
      results.push({ id: row.id, source: row.source, ok: true, ...result });
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 1000) : "Connector import failed";
      await supabase
        .from("connector_listing_imports")
        .update({
          status: "failed",
          last_error: message,
          processed_at: new Date().toISOString()
        })
        .eq("id", row.id);
      failed += 1;
      results.push({ id: row.id, source: row.source, ok: false, error: message });
    }
  }

  return { received: pending?.length ?? 0, processed, failed, results };
}
