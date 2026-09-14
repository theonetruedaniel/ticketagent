import { verifyUnsubscribeToken } from "@/lib/unsubscribe";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  searchParams
}: {
  searchParams: Promise<{ token?: string; done?: string }>;
}) {
  const { token, done } = await searchParams;
  const valid = token ? Boolean(verifyUnsubscribeToken(token)) : false;
  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="eyebrow">EMAIL PREFERENCES</p>
        <h1>{done ? "Alerts disabled" : "Stop email alerts"}</h1>
        {done ? (
          <p className="login-copy">Browser alerts remain local. You can re-enable email from your private dashboard.</p>
        ) : valid ? (
          <form action="/api/v1/alerts/unsubscribe" method="post">
            <input type="hidden" name="token" value={token} />
            <p className="login-copy">This disables all Braves Ticket Ops email alerts for your verified account.</p>
            <button type="submit">DISABLE EMAIL ALERTS</button>
          </form>
        ) : (
          <p className="login-copy">This unsubscribe link is invalid or expired. Sign in to change your preference.</p>
        )}
      </section>
    </main>
  );
}
