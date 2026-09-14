import { describe, expect, it } from "vitest";
import { alertCopyForListing } from "./alert-copy";

describe("alertCopyForListing", () => {
  it.each([
    ["Delta Club 122", "priorityClub", "Delta Club Deal — $100 or Less"],
    ["Xfinity Club 218", "priorityClub", "Xfinity Club Deal — $60 or Less"],
    ["Section 125", "infieldDeal", "100-Level Deal — $60 or Less"],
    ["Section 225", "infieldDeal", "200-Level Deal — $40 or Less"]
  ] as const)(
    "labels %s alerts as %s",
    (section, alertKind, expectedTitle) => {
      expect(alertCopyForListing(section, alertKind)).toMatchObject({
        title: expectedTitle,
        emailHeading: `${expectedTitle} Found`,
        telegramHeading: `⚾ ${expectedTitle.toUpperCase()}`
      });
    }
  );

  it("keeps ordinary custom alerts generic", () => {
    expect(alertCopyForListing("Section 122", "standard")).toEqual({
      title: "Braves Ticket Alert",
      emailHeading: "A Braves listing matched your alert",
      telegramHeading: "🔔 BRAVES TICKET ALERT"
    });
  });
});
