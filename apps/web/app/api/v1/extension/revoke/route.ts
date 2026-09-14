import { authenticateExtension } from "@/lib/extension-auth";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const extension = await authenticateExtension(request);
  if (!extension) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (extension.tokenId === "dev") {
    return Response.json({ ok: true, demo: true });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("extension_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", extension.tokenId)
    .eq("owner_id", extension.userId);
  if (error) {
    return Response.json(
      { error: "Could not revoke extension token" },
      { status: 500 }
    );
  }
  return Response.json({ ok: true });
}
