type AuthErrorLike = {
  code?: string;
  message?: string;
  status?: number;
};

export function magicLinkErrorRedirect(error: AuthErrorLike) {
  const isRateLimit =
    error.code === "over_email_send_rate_limit" || error.status === 429;

  if (!isRateLimit) return "/login?error=magic-link";

  const seconds = Number(
    error.message?.match(/after\s+(\d+)\s+seconds?/i)?.[1] ?? 60
  );
  const retry = Number.isFinite(seconds)
    ? Math.min(60, Math.max(1, Math.round(seconds)))
    : 60;

  return `/login?error=rate-limit&retry=${retry}`;
}
