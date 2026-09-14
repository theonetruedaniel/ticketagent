import {
  emailRetryState,
  escapeHtml,
  MAX_ALERT_DELIVERIES_PER_HOUR
} from "@ticket-agent/contracts";
import { alertCopyForListing } from "@/lib/alert-copy";
import { requireCronSecret } from "@/lib/env";
import { systemAlertDeliveryEligible } from "@/lib/delivery-eligibility";
import { createAdminClient } from "@/lib/supabase/server";
import { sendTelegramAlert, telegramAlertText } from "@/lib/telegram";
import { createUnsubscribeToken } from "@/lib/unsubscribe";

export async function POST(request: Request) {
  if (!(await requireCronSecret(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const telegramChatId = process.env.TELEGRAM_CHAT_ID?.trim();
  const emailConfigured = Boolean(apiKey && from);
  const telegramConfigured = Boolean(telegramBotToken && telegramChatId);
  if (!emailConfigured && !telegramConfigured) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: "No email or Telegram delivery channel is configured"
    });
  }

  const resend = emailConfigured
    ? new (await import("resend")).Resend(apiKey)
    : null;
  const supabase = createAdminClient();
  const { data: messages, error } = await supabase
    .from("email_outbox")
    .select("*,profiles!inner(email,alerts_enabled)")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(MAX_ALERT_DELIVERIES_PER_HOUR);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let sent = 0;
  let failed = 0;
  let cancelled = 0;
  for (const message of messages ?? []) {
    const profile = Array.isArray(message.profiles)
      ? message.profiles[0]
      : message.profiles;
    if (
      profile?.alerts_enabled === false ||
      (!profile?.email && !telegramConfigured)
    ) {
      await supabase
        .from("email_outbox")
        .update({ status: "cancelled" })
        .eq("id", message.id);
      cancelled += 1;
      continue;
    }

    if (!systemAlertDeliveryEligible(message.payload)) {
      await supabase
        .from("email_outbox")
        .update({
          status: "cancelled",
          last_error: "Cancelled by final delivery eligibility check"
        })
        .eq("id", message.id);
      cancelled += 1;
      continue;
    }

    const { count: sentInLastHour, error: rateError } = await supabase
      .from("email_outbox")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", message.owner_id)
      .eq("status", "sent")
      .gte("sent_at", new Date(Date.now() - 60 * 60_000).toISOString());
    if (rateError) {
      failed += 1;
      continue;
    }
    if ((sentInLastHour ?? 0) >= MAX_ALERT_DELIVERIES_PER_HOUR) {
      await supabase
        .from("email_outbox")
        .update({
          status: "cancelled",
          last_error: `Cancelled by ${MAX_ALERT_DELIVERIES_PER_HOUR}-per-hour safety cap`
        })
        .eq("id", message.id);
      cancelled += 1;
      continue;
    }

    const listing = message.payload?.listing;
    const priority = message.payload?.priority === true;
    const infieldDeal = message.payload?.infieldDeal === true;
    const alertKind = priority
      ? "priorityClub" as const
      : infieldDeal
        ? "infieldDeal" as const
        : "standard" as const;
    try {
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL?.trim() ?? new URL(request.url).origin;
      const unsubscribeUrl = `${appUrl}/unsubscribe?token=${encodeURIComponent(
        createUnsubscribeToken(message.owner_id)
      )}`;
      const source = escapeHtml(listing?.source);
      const section = escapeHtml(listing?.section || "—");
      const row = escapeHtml(listing?.row || "—");
      const price = escapeHtml(listing?.pricePerTicket || "—");
      const quantity =
        listing?.quantityMin != null && listing?.quantityMax != null
          ? listing.quantityMin === listing.quantityMax
            ? `${listing.quantityMin} ticket${listing.quantityMin === 1 ? "" : "s"}`
            : `${listing.quantityMin}-${listing.quantityMax} tickets`
          : "quantity unavailable";
      const deepLink = escapeHtml(listing?.deepLink || appUrl);
      const alertCopy = alertCopyForListing(
        listing?.section ?? "",
        alertKind
      );

      let emailMessageId = "";
      if (resend && from && profile?.email) {
        const result = await resend.emails.send(
          {
            from,
            to: profile.email,
            subject: `${alertCopy.title}: ${
              listing?.section ?? "new listing"
            } at $${
              listing?.pricePerTicket ?? "—"
            }`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#071525">
                <h1 style="font-size:22px">${alertCopy.emailHeading}</h1>
                <p><strong>${source}</strong> · Section ${section} · Row ${row} · ${escapeHtml(quantity)}</p>
                <p style="font-size:28px;font-weight:700">$${price} <small style="font-size:12px">all-in per ticket</small></p>
                <p><a href="${deepLink}">Open the marketplace listing</a></p>
                <hr><p style="font-size:11px;color:#667">Sent only to your verified account. <a href="${unsubscribeUrl}">Disable alerts</a>.</p>
              </div>`,
            headers: {
              "X-Entity-Ref-ID": message.idempotency_key,
              "List-Unsubscribe": `<${unsubscribeUrl}>`
            }
          },
          { idempotencyKey: message.idempotency_key }
        );
        if (result.error) throw new Error(result.error.message);
        emailMessageId = result.data?.id ?? "";
      }

      const telegramMessageId =
        telegramConfigured && telegramBotToken && telegramChatId
          ? await sendTelegramAlert({
              botToken: telegramBotToken,
              chatId: telegramChatId,
              text: telegramAlertText(listing, alertKind)
            })
          : "";
      const providerMessageId = [
        emailMessageId ? `email:${emailMessageId}` : "",
        telegramMessageId ? `telegram:${telegramMessageId}` : ""
      ]
        .filter(Boolean)
        .join(";");

      await supabase
        .from("email_outbox")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_message_id: providerMessageId || null
        })
        .eq("id", message.id);
      sent += 1;
    } catch (sendError) {
      const retry = emailRetryState(Number(message.attempts ?? 0));
      await supabase
        .from("email_outbox")
        .update({
          status: retry.status,
          attempts: retry.attempts,
          last_error:
            sendError instanceof Error ? sendError.message : "Send failed",
          next_attempt_at: retry.nextAttemptAt
        })
        .eq("id", message.id);
      failed += 1;
    }
  }

  return Response.json({
    ok: true,
    sent,
    failed,
    cancelled,
    channels: {
      email: emailConfigured,
      telegram: telegramConfigured
    }
  });
}
