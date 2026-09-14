import { alertRuleSchema } from "@ticket-agent/contracts";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveRequestOwner } from "@/lib/request-owner";

export async function GET(request: Request) {
  const owner = await resolveRequestOwner(request);
  if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (owner.demo) return Response.json({ alerts: [] });
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("alert_rules").select("*").eq("owner_id", owner.userId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ alerts: data });
}

export async function POST(request: Request) {
  const owner = await resolveRequestOwner(request);
  if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = alertRuleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid alert", issues: parsed.error.issues }, { status: 400 });

  const alert = parsed.data;
  if (owner.demo) return Response.json({ ok: true, alert });
  const supabase = createAdminClient();
  const { data: existing, error: existingError } = await supabase
    .from("alert_rules")
    .select("owner_id")
    .eq("id", alert.id)
    .maybeSingle();
  if (existingError) return Response.json({ error: "Could not validate alert ownership" }, { status: 500 });
  if (existing && existing.owner_id !== owner.userId) {
    return Response.json({ error: "Alert id belongs to another account" }, { status: 403 });
  }
  let eventId: string | null = null;
  if (alert.mlbGamePk) {
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id")
      .eq("mlb_game_pk", alert.mlbGamePk)
      .maybeSingle();
    if (eventError) return Response.json({ error: "Could not resolve alert game" }, { status: 500 });
    if (!event) return Response.json({ error: "Braves home game not found" }, { status: 400 });
    eventId = event?.id ?? null;
  }
  const { error } = await supabase.from("alert_rules").upsert({
    id: alert.id,
    owner_id: owner.userId,
    event_id: eventId,
    rule_type: alert.type,
    name: `${alert.type} · ${alert.sectionQuery || "Any section"}`,
    enabled: alert.enabled,
    email_enabled: alert.emailEnabled,
    source: alert.source,
    section_query: alert.sectionQuery,
    quantity: alert.quantity,
    max_price: alert.maxPrice,
    accessible: alert.accessible,
    updated_at: new Date().toISOString()
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const owner = await resolveRequestOwner(request);
  if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Alert id is required" }, { status: 400 });
  if (owner.demo) return Response.json({ ok: true });
  const supabase = createAdminClient();
  const { error } = await supabase.from("alert_rules").delete().eq("id", id).eq("owner_id", owner.userId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
