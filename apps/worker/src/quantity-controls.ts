import {
  browserPurchaseQuantities,
  type ActiveBrowserPurchaseQuantity,
  type MarketplaceSource
} from "@ticket-agent/contracts";
import type { Page } from "playwright";

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
  const ticketWord = quantity === 1 ? "ticket" : "tickets";
  return (
    normalized === `${quantity} ${ticketWord}` ||
    normalized === `${quantity} ticket` ||
    normalized === `${quantity} tickets` ||
    normalized === `select ${quantity} ticket` ||
    normalized === `select ${quantity} tickets`
  );
}

export async function selectMarketplaceQuantity(
  page: Page,
  source: MarketplaceSource,
  quantity: ActiveBrowserPurchaseQuantity
): Promise<boolean> {
  if (!quantityPassesForSource(source).includes(quantity)) return true;

  const alreadySelected = await page.evaluate(({ requested }) => {
    const expected = new Set([
      `${requested} ticket`,
      `${requested} tickets`
    ]);
    for (const button of document.querySelectorAll<HTMLButtonElement>("button")) {
      if (
        button.offsetParent === null ||
        button.disabled ||
        button.closest('[role="dialog"]')
      ) continue;
      const value = (button.getAttribute("aria-label") || button.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (expected.has(value)) return true;
    }
    return false;
  }, { requested: quantity });
  if (alreadySelected) return true;

  const clickTarget = () =>
    page.evaluate(({ requested }) => {
      const targetLabels = new Set([
        `${requested} ticket`,
        `${requested} tickets`,
        `select ${requested} ticket`,
        `select ${requested} tickets`
      ]);
      for (const button of document.querySelectorAll<HTMLButtonElement>("button")) {
        if (button.offsetParent === null || button.disabled) continue;
        const value = (button.getAttribute("aria-label") || button.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        if (!targetLabels.has(value)) continue;
        button.click();
        return true;
      }
      return false;
    }, { requested: quantity });

  if (await clickTarget()) {
    await page.waitForTimeout(800);
    return true;
  }

  const opened = await page.evaluate(() => {
    for (const button of document.querySelectorAll<HTMLButtonElement>("button")) {
      if (button.offsetParent === null || button.disabled) continue;
      const value = (button.getAttribute("aria-label") || button.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!/^(?:any|\d+)\s+tickets?$/i.test(value)) continue;
      button.click();
      return true;
    }
    return false;
  });
  if (!opened) {
    return source === "SeatGeek" || source === "StubHub";
  }

  await page.waitForTimeout(250);
  const selected = await clickTarget();
  if (selected) await page.waitForTimeout(800);
  return selected;
}

export async function resetMarketplaceScroll(page: Page) {
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    for (const element of document.querySelectorAll<HTMLElement>(
      "main, [role='region'], [role='list']"
    )) {
      if (element.scrollHeight > element.clientHeight + 400) {
        element.scrollTo({ top: 0, behavior: "instant" });
      }
    }
  });
}
