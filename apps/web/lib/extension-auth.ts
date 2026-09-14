import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "./supabase/server";

const AUTHORIZED_BROWSER_SCANNER_DEVICE =
  "Braves Ticket Scanner (jjlffdkhdebpcohggndlokildeofonoj)";

export function hashSecret(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function randomToken() {
  return randomBytes(32).toString("base64url");
}

export async function authenticateExtension(request: Request) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!bearer) return null;

  const devToken = process.env.DEV_EXTENSION_TOKEN;
  if (devToken && bearer === devToken && process.env.NODE_ENV !== "production") {
    return {
      userId: "00000000-0000-0000-0000-000000000001",
      tokenId: "dev",
      deviceName: "Local development extension",
      browserAutomationAllowed: true
    };
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("extension_tokens")
    .select("id,owner_id,device_name,browser_automation_allowed,revoked_at,expires_at")
    .eq("token_hash", hashSecret(bearer))
    .maybeSingle();

  if (
    error ||
    !data ||
    data.revoked_at ||
    (data.expires_at && Date.parse(data.expires_at) <= Date.now())
  ) {
    return null;
  }

  await supabase
    .from("extension_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return {
    userId: data.owner_id as string,
    tokenId: data.id as string,
    deviceName: data.device_name as string,
    browserAutomationAllowed:
      data.browser_automation_allowed === true ||
      data.device_name === AUTHORIZED_BROWSER_SCANNER_DEVICE
  };
}
