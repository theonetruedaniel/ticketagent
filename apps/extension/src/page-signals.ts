export function detectBlocker(text: string): string | null {
  const normalized = text.slice(0, 12_000).toLowerCase();
  if (
    /captcha|verify you are human|checking your browser|human verification|just a moment|enable javascript and cookies to continue/.test(normalized)
  ) {
    return "Bot or CAPTCHA challenge detected";
  }
  if (
    /access denied|access to this page has been denied|temporarily blocked|unusual traffic|request blocked|request unsuccessful|forbidden|error\s*403|incapsula|pardon our interruption/.test(normalized)
  ) {
    return "Marketplace access is blocked";
  }
  if (/sign in to view|log in to view|sign in to continue/.test(normalized)) {
    return "Marketplace login is required";
  }
  return null;
}

export function isProgressControlLabel(text: string) {
  return /^(load|show|view)\s+more\b|^next(?:\s+page)?$/i.test(text.trim());
}

export function hasExplicitEmptyInventory(text: string) {
  const normalized = text.slice(0, 20_000).toLowerCase();
  return /(?:no|zero)\s+(?:tickets|listings)\s+(?:available|found)|sold\s+out|inventory\s+unavailable/.test(normalized);
}

export function isSuspiciousEmptyAccessPage(
  title: string,
  bodyText: string,
  candidateCount: number
) {
  if (candidateCount > 0 || bodyText.trim().length >= 80) return false;
  return /^(?:www\.)?(?:seatgeek|stubhub)\.com$/i.test(title.trim());
}
