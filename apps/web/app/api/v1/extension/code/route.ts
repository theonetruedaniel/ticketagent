import { randomBytes } from "node:crypto";
import { currentIdentity } from "@/lib/auth";
import { hashSecret } from "@/lib/extension-auth";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const identity = await currentIdentity();
    if (identity.demo) {
      return Response.json({
        code: "LOCAL1",
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        demo: true
      });
    }
    const code = randomBytes(5).toString("base64url").slice(0, 6).toUpperCase();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const supabase = createAdminClient();
    const { error } = await supabase.from("extension_connection_codes").insert({
      owner_id: identity.id,
      code_hash: hashSecret(code),
      expires_at: expiresAt
    });
    if (error) throw error;
    return Response.json({ code, expiresAt });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ error: "Could not create connection code" }, { status: 500 });
  }
}
