import { type NormalizedListing } from "@ticket-agent/contracts";
import {
  alertCopyForListing,
  type AlertKind
} from "./alert-copy";

type TelegramListing = Partial<
  Pick<
    NormalizedListing,
    | "source"
    | "eventName"
    | "section"
    | "row"
    | "quantityMin"
    | "quantityMax"
    | "pricePerTicket"
    | "allIn"
    | "deepLink"
  >
>;

export function telegramAlertText(
  listing: TelegramListing | null | undefined,
  alertKind: AlertKind = "standard"
): string {
  const heading = alertCopyForListing(
    listing?.section ?? "",
    alertKind
  ).telegramHeading;
  const quantity =
    listing?.quantityMin != null && listing?.quantityMax != null
      ? listing.quantityMin === listing.quantityMax
        ? `${listing.quantityMin} ticket${listing.quantityMin === 1 ? "" : "s"}`
        : `${listing.quantityMin}-${listing.quantityMax} tickets`
      : "Quantity unavailable";
  const detailLines = [
    `${listing?.section ?? "Section unavailable"} · Row ${listing?.row ?? "TBD"}`,
    `$${listing?.pricePerTicket ?? "—"} per ticket · ${quantity}`,
    `${listing?.source ?? "Marketplace"} · ${listing?.allIn ? "all-in price" : "fees may vary"}`,
    listing?.eventName
  ].filter((line): line is string => Boolean(line));
  const lines = [
    heading,
    "",
    ...detailLines,
    ...(listing?.deepLink ? ["", listing.deepLink] : [])
  ];

  return lines.join("\n").slice(0, 4096);
}

export async function sendTelegramAlert(options: {
  botToken: string;
  chatId: string;
  text: string;
  fetcher?: typeof fetch;
}): Promise<string> {
  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(
      `https://api.telegram.org/bot${options.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: options.chatId,
          text: options.text,
          link_preview_options: { is_disabled: true }
        })
      }
    );
  } catch {
    throw new Error("Telegram delivery request failed");
  }

  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    description?: string;
    result?: { message_id?: number };
  } | null;
  if (!response.ok || payload?.ok !== true) {
    throw new Error(
      `Telegram delivery failed (${response.status})${
        payload?.description ? `: ${payload.description}` : ""
      }`
    );
  }
  return String(payload.result?.message_id ?? "");
}
