import { hasSupabaseEnv } from "./env";
import { requireUser } from "./supabase/server";

export async function currentIdentity() {
  if (!hasSupabaseEnv() || process.env.REQUIRE_AUTH === "false") {
    return { id: "00000000-0000-0000-0000-000000000001", email: "local@braves.ops", demo: true };
  }
  const { user } = await requireUser();
  const allowedEmail = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (allowedEmail && user.email?.toLowerCase() !== allowedEmail) {
    throw new Error("UNAUTHORIZED");
  }
  return { id: user.id, email: user.email ?? "", demo: false };
}
