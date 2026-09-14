import { describe, expect, it } from "vitest";
import { magicLinkErrorRedirect } from "./magic-link-error";

describe("magicLinkErrorRedirect", () => {
  it("shows the remaining cooldown for Supabase email rate limits", () => {
    expect(
      magicLinkErrorRedirect({
        code: "over_email_send_rate_limit",
        message:
          "For security purposes, you can only request this after 22 seconds.",
        status: 429
      })
    ).toBe("/login?error=rate-limit&retry=22");
  });

  it("uses a safe default when a 429 response has no countdown", () => {
    expect(magicLinkErrorRedirect({ status: 429 })).toBe(
      "/login?error=rate-limit&retry=60"
    );
  });

  it("keeps unexpected delivery failures generic", () => {
    expect(
      magicLinkErrorRedirect({ message: "SMTP provider unavailable", status: 500 })
    ).toBe("/login?error=magic-link");
  });
});
