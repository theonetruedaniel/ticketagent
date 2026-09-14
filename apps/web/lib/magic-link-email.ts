import { escapeHtml } from "@ticket-agent/contracts";
import { createAdminClient } from "./supabase/server";

type MagicLinkSendErrorOptions = {
  code?: string;
  status?: number;
};

export class MagicLinkSendError extends Error {
  code?: string;
  status?: number;

  constructor(message: string, options: MagicLinkSendErrorOptions = {}) {
    super(message);
    this.name = "MagicLinkSendError";
    this.code = options.code;
    this.status = options.status;
  }
}

async function claimEmailCooldown(ownerId: string) {
  const supabase = createAdminClient();
  const now = new Date();
  const lastAllowed = new Date(now.getTime() - 60_000).toISOString();
  const value = { owner_id: ownerId, last_sent_at: now.toISOString() };

  const inserted = await supabase
    .from("auth_email_cooldowns")
    .insert(value)
    .select("owner_id")
    .maybeSingle();

  if (!inserted.error && inserted.data) return;
  if (inserted.error?.code !== "23505") {
    throw new MagicLinkSendError("Unable to enforce email cooldown");
  }

  const updated = await supabase
    .from("auth_email_cooldowns")
    .update({ last_sent_at: value.last_sent_at })
    .eq("owner_id", ownerId)
    .lt("last_sent_at", lastAllowed)
    .select("owner_id")
    .maybeSingle();

  if (updated.error) {
    throw new MagicLinkSendError("Unable to enforce email cooldown");
  }
  if (!updated.data) {
    throw new MagicLinkSendError(
      "For security purposes, you can only request this after 60 seconds.",
      { code: "over_email_send_rate_limit", status: 429 }
    );
  }
}

export async function sendMagicLinkEmail(email: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "http://localhost:3000";
  if (!apiKey || !from) {
    throw new MagicLinkSendError("Authentication email is not configured");
  }

  const supabase = createAdminClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .single();
  if (profileError || !profile) {
    throw new MagicLinkSendError("Verified account does not exist");
  }

  await claimEmailCooldown(profile.id);

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: appUrl }
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    throw new MagicLinkSendError("Unable to generate sign-in link");
  }

  const signInUrl = `${appUrl}/auth/confirm?token_hash=${encodeURIComponent(
    tokenHash
  )}&type=email`;
  const resend = new (await import("resend")).Resend(apiKey);
  const result = await resend.emails.send(
    {
      from,
      to: email,
      subject: "Sign in to Braves Ticket Ops",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#071525">
          <h1 style="font-size:22px">Sign in to Braves Ticket Ops</h1>
          <p>Use this one-time link to open your private dashboard.</p>
          <p style="margin:28px 0">
            <a href="${escapeHtml(signInUrl)}" style="background:#e51b3e;color:#fff;padding:13px 18px;text-decoration:none;font-weight:700">SIGN IN</a>
          </p>
          <p style="font-size:12px;color:#667">This link expires shortly and can only be used once.</p>
        </div>`,
      text: `Sign in to Braves Ticket Ops: ${signInUrl}`
    },
    {
      idempotencyKey: `magic-link-${profile.id}-${Math.floor(
        Date.now() / 60_000
      )}`
    }
  );

  if (result.error) {
    throw new MagicLinkSendError("Unable to send sign-in email");
  }
}
