import { createHmac, timingSafeEqual } from "node:crypto";

function secret() {
  const value = process.env.UNSUBSCRIBE_SECRET?.trim();
  if (!value) throw new Error("UNSUBSCRIBE_SECRET is not configured");
  return value;
}

export function createUnsubscribeToken(userId: string) {
  const expires = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const payload = `${userId}.${expires}`;
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

export function verifyUnsubscribeToken(token: string) {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const [userId, expiresText, signature] = decoded.split(".");
    if (!userId || !expiresText || !signature || Number(expiresText) < Date.now() / 1000) return null;
    const payload = `${userId}.${expiresText}`;
    const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) return null;
    return userId;
  } catch {
    return null;
  }
}
