import { currentIdentity } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const identity = await currentIdentity();
    const body = (await request.json().catch(() => null)) as { enabled?: boolean } | null;
    if (typeof body?.enabled !== "boolean") {
      return Response.json({ error: "enabled must be boolean" }, { status: 400 });
    }
    if (identity.demo) return Response.json({ ok: true, enabled: body.enabled });
    const supabase = createAdminClient();
    const { error } = await supabase.from("profiles").update({
      alerts_enabled: body.enabled,
      unsubscribed_at: body.enabled ? null : new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq("id", identity.id);
    if (error) throw error;
    return Response.json({ ok: true, enabled: body.enabled });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ error: "Could not update alert preference" }, { status: 500 });
  }
}
