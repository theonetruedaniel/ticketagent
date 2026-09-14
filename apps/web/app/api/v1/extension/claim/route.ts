import { hashSecret, randomToken } from "@/lib/extension-auth";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    code?: string;
    deviceName?: string;
    extensionId?: string;
  } | null;
  const code = body?.code?.trim().toUpperCase();
  if (!code) return Response.json({ error: "Connection code is required" }, { status: 400 });

  if (code === "LOCAL1" && process.env.NODE_ENV !== "production") {
    const token = process.env.DEV_EXTENSION_TOKEN;
    if (!token) {
      return Response.json({ error: "Set DEV_EXTENSION_TOKEN for local claims" }, { status: 409 });
    }
    return Response.json({
      token,
      dashboardUrl:
        process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "http://localhost:3000"
    });
  }

  const extensionId = body?.extensionId?.trim();
  const deviceName = extensionId && /^[a-z]{32}$/.test(extensionId)
    ? `Braves Ticket Scanner (${extensionId})`
    : body?.deviceName?.slice(0, 120) ?? "Chrome extension";
  const supabase = createAdminClient();
  const token = randomToken();
  const { data: claimed, error } = await supabase
    .rpc("claim_extension_code", {
      p_code_hash: hashSecret(code),
      p_token_hash: hashSecret(token),
      p_device_name: deviceName
    })
    .maybeSingle();
  if (error) return Response.json({ error: "Could not issue extension token" }, { status: 500 });
  if (!claimed) {
    return Response.json({ error: "Code is invalid, expired, or already used" }, { status: 401 });
  }

  return Response.json({
    token,
    dashboardUrl: process.env.NEXT_PUBLIC_APP_URL?.trim()
  });
}
