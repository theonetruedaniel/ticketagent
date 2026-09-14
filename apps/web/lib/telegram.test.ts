import { describe, expect, it, vi } from "vitest";
import { sendTelegramAlert, telegramAlertText } from "./telegram";

const listing = {
  source: "SeatGeek" as const,
  eventName: "New York Mets at Atlanta Braves",
  section: "Delta SKY360 Club",
  row: "12",
  quantityMin: 1,
  quantityMax: 2,
  pricePerTicket: 100,
  allIn: true,
  deepLink: "https://seatgeek.com/example"
};

describe("Telegram alert delivery", () => {
  it("formats a priority alert with deal details and a marketplace link", () => {
    expect(telegramAlertText(listing, "priorityClub")).toBe(
      [
        "⚾ DELTA CLUB DEAL — $100 OR LESS",
        "",
        "Delta SKY360 Club · Row 12",
        "$100 per ticket · 1-2 tickets",
        "SeatGeek · all-in price",
        "New York Mets at Atlanta Braves",
        "",
        "https://seatgeek.com/example"
      ].join("\n")
    );
  });

  it("gives each built-in deal category a distinct title", () => {
    expect(telegramAlertText(
      { ...listing, section: "122", row: "8", pricePerTicket: 60 },
      "infieldDeal"
    )).toContain("⚾ 100-LEVEL DEAL — $60 OR LESS");
    expect(telegramAlertText(
      { ...listing, section: "216", row: "8", pricePerTicket: 40 },
      "infieldDeal"
    )).toContain("⚾ 200-LEVEL DEAL — $40 OR LESS");
    expect(telegramAlertText(
      { ...listing, section: "Xfinity Club 218", row: "8", pricePerTicket: 60 },
      "priorityClub"
    )).toContain("⚾ XFINITY CLUB DEAL — $60 OR LESS");
  });

  it("sends through the official Bot API", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ ok: true, result: { message_id: 321 } })
    );
    await expect(sendTelegramAlert({
      botToken: "secret-token",
      chatId: "12345",
      text: "Ticket alert",
      fetcher
    })).resolves.toBe("321");

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.telegram.org/botsecret-token/sendMessage",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          chat_id: "12345",
          text: "Ticket alert",
          link_preview_options: { is_disabled: true }
        })
      })
    );
  });

  it("reports API failures without echoing the bot token", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        { ok: false, description: "Bad Request: chat not found" },
        { status: 400 }
      )
    );
    await expect(sendTelegramAlert({
      botToken: "do-not-leak",
      chatId: "missing",
      text: "Ticket alert",
      fetcher
    })).rejects.toThrow("Telegram delivery failed (400): Bad Request: chat not found");
  });
});
