import { hasSupabaseEnv } from "@/lib/env";
import { sendMagicLinkEmail } from "@/lib/magic-link-email";
import { magicLinkErrorRedirect } from "@/lib/magic-link-error";
import { Mail, ShieldCheck, Ticket } from "lucide-react";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function sendMagicLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return;
  const allowedEmail = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (allowedEmail && email.toLowerCase() !== allowedEmail) {
    redirect("/login?error=not-allowed");
  }
  try {
    await sendMagicLinkEmail(email);
  } catch (error) {
    redirect(
      magicLinkErrorRedirect(
        error instanceof Error ? error : { message: "Unknown error" }
      )
    );
  }
  redirect("/login?sent=1");
}

export default async function Login({
  searchParams
}: {
  searchParams: Promise<{ sent?: string; error?: string; retry?: string }>;
}) {
  const { sent, error, retry } = await searchParams;
  if (!hasSupabaseEnv()) redirect("/");
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-mark"><Ticket size={25} /></div>
        <p className="eyebrow">PRIVATE ACCESS / ATLANTA</p>
        <h1>Braves Ticket Ops</h1>
        <p className="login-copy">One verified inbox. No passwords, shared links, or public inventory.</p>
        {sent ? (
          <div className="magic-sent"><Mail size={19} /><div><strong>Check your inbox</strong><span>Your sign-in link expires shortly.</span></div></div>
        ) : (
          <>
            {error === "not-allowed" && <div className="login-error">That address is not authorized for this private dashboard.</div>}
            {error === "magic-link" && <div className="login-error">The sign-in email could not be sent. Verify the account exists and try again.</div>}
            {error === "rate-limit" && <div className="login-error">A sign-in email was already sent. Use the newest link in your inbox, or wait {retry ?? "60"} seconds before requesting another.</div>}
            {error === "callback" && <div className="login-error">That sign-in link is invalid or expired. Request a new one.</div>}
            <form action={sendMagicLink}>
              <label>VERIFIED EMAIL<input type="email" name="email" required autoComplete="email" placeholder="you@example.com" /></label>
              <button type="submit">SEND MAGIC LINK <Mail size={16} /></button>
            </form>
          </>
        )}
        <footer><ShieldCheck size={15} /> Authentication is rechecked on every server request.</footer>
      </section>
    </main>
  );
}
