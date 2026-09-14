import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";

export function hasSupabaseEnv() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

function secretsMatch(actual: string, expected: string) {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export async function requireCronSecret(request: Request) {
  const bearer = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  const configured = process.env.CRON_SECRET?.trim();
  if (configured) return Boolean(bearer && secretsMatch(bearer, configured));
  if (process.env.NODE_ENV !== "production") return true;
  if (!bearer) return false;

  try {
    const { data, error } = await createAdminClient().rpc(
      "verify_cron_secret",
      { candidate: bearer }
    );
    return !error && data === true;
  } catch {
    return false;
  }
}
