import {
  DELTA_CLUB_MAX_PRICE,
  infieldDealMaxPriceForSection,
  sectionNumber
} from "@ticket-agent/contracts";

export type AlertKind = "standard" | "priorityClub" | "infieldDeal";

export type AlertCopy = {
  title: string;
  emailHeading: string;
  telegramHeading: string;
};

export function alertCopyForListing(
  sectionLabel: string,
  alertKind: AlertKind
): AlertCopy {
  if (alertKind === "standard") {
    return {
      title: "Braves Ticket Alert",
      emailHeading: "A Braves listing matched your alert",
      telegramHeading: "🔔 BRAVES TICKET ALERT"
    };
  }

  const normalizedSection = sectionLabel.toLowerCase();
  const numberedSection = sectionNumber(sectionLabel);
  const maxPrice =
    alertKind === "priorityClub" && normalizedSection.includes("delta")
      ? DELTA_CLUB_MAX_PRICE
      : infieldDealMaxPriceForSection(sectionLabel) ?? 60;

  let title: string;
  if (
    alertKind === "priorityClub" &&
    normalizedSection.includes("delta") &&
    (
      numberedSection == null ||
      (numberedSection >= 122 && numberedSection <= 130)
    )
  ) {
    title = `Delta Club Deal — $${maxPrice} or Less`;
  } else if (
    alertKind === "priorityClub" &&
    normalizedSection.includes("xfinity") &&
    (
      numberedSection == null ||
      (numberedSection >= 216 && numberedSection <= 235)
    )
  ) {
    title = `Xfinity Club Deal — $${maxPrice} or Less`;
  } else if (
    numberedSection != null &&
    numberedSection >= 116 &&
    numberedSection <= 135
  ) {
    title = `100-Level Deal — $${maxPrice} or Less`;
  } else if (
    numberedSection != null &&
    numberedSection >= 216 &&
    numberedSection <= 235
  ) {
    title = `200-Level Deal — $${maxPrice} or Less`;
  } else {
    title =
      alertKind === "priorityClub"
        ? "Club Ticket Deal — $60 or Less"
        : `Braves Seating Deal — $${maxPrice} or Less`;
  }

  return {
    title,
    emailHeading: `${title} Found`,
    telegramHeading: `⚾ ${title.toUpperCase()}`
  };
}
