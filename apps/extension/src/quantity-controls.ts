import {
  browserPurchaseQuantities,
  type ActiveBrowserPurchaseQuantity,
  type MarketplaceSource
} from "@ticket-agent/contracts";

export function quantityPassesForSource(
  source: MarketplaceSource
): readonly ActiveBrowserPurchaseQuantity[] {
  return browserPurchaseQuantities(source);
}

export function matchesQuantityOptionLabel(
  label: string,
  quantity: ActiveBrowserPurchaseQuantity
) {
  const normalized = label.replace(/\s+/g, " ").trim().toLowerCase();
  return [
    `${quantity} ticket`,
    `${quantity} tickets`,
    `select ${quantity} ticket`,
    `select ${quantity} tickets`
  ].includes(normalized);
}

function visibleButtons() {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .filter((button) => button.offsetParent !== null && !button.disabled);
}

function buttonLabel(button: HTMLButtonElement) {
  return (button.getAttribute("aria-label") || button.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function clickQuantityOption(quantity: ActiveBrowserPurchaseQuantity) {
  const option = visibleButtons()
    .find((button) => matchesQuantityOptionLabel(buttonLabel(button), quantity));
  option?.click();
  return Boolean(option);
}

export async function selectMarketplaceQuantity(
  source: MarketplaceSource,
  quantity: ActiveBrowserPurchaseQuantity
): Promise<boolean> {
  if (!quantityPassesForSource(source).includes(quantity)) return true;

  const currentControl = visibleButtons().find((button) =>
    /^(?:any|\d+)\s+tickets?$/i.test(buttonLabel(button))
  );
  if (
    currentControl &&
    matchesQuantityOptionLabel(buttonLabel(currentControl), quantity) &&
    !currentControl.closest('[role="dialog"]')
  ) {
    return true;
  }

  if (clickQuantityOption(quantity)) {
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    return true;
  }

  if (!currentControl) {
    // SeatGeek and StubHub evidence includes an explicit provider quantity
    // range, so exact single/pair filtering remains safe even when the page
    // does not expose a quantity selector.
    return source === "SeatGeek" || source === "StubHub";
  }
  currentControl.click();
  await new Promise((resolve) => window.setTimeout(resolve, 250));
  if (!clickQuantityOption(quantity)) return false;
  await new Promise((resolve) => window.setTimeout(resolve, 800));
  return true;
}

export function resetMarketplaceScroll() {
  window.scrollTo({ top: 0, behavior: "instant" });
  for (const element of document.querySelectorAll<HTMLElement>(
    "main, [role='region'], [role='list']"
  )) {
    if (element.scrollHeight > element.clientHeight + 400) {
      element.scrollTo({ top: 0, behavior: "instant" });
    }
  }
}
