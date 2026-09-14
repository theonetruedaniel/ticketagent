import { createAdminClient } from "@/lib/supabase/server";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const userId = verifyUnsubscribeToken(token);
  if (!userId) return NextResponse.redirect(new URL("/unsubscribe", request.url), { status: 303 });

  const supabase = createAdminClient();
  const { error } = await supabase.from("profiles").update({
    alerts_enabled: false,
    unsubscribed_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).eq("id", userId);
  if (error) return new Response("Could not update email preferences", { status: 500 });
  return NextResponse.redirect(new URL("/unsubscribe?done=1", request.url), { status: 303 });
}
