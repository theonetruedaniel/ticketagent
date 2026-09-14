import { createUserClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (tokenHash && type === "email") {
    const supabase = await createUserClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "email"
    });

    if (!error) return NextResponse.redirect(new URL("/", url.origin));
  }

  return NextResponse.redirect(new URL("/login?error=callback", url.origin));
}
