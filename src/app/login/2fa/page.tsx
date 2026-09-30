import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getIronSession } from "iron-session";
import { authConfig } from "@/lib/auth/session";
import { activePreAuth, preAuthOptions, type PreAuthData } from "@/lib/auth/preauth";
import { AuthShell } from "@/components/auth-shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verificatie · Ember Finance", description: "Bevestig je login met je authenticatorcode." };

export default async function TwoFactor({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  let active = false;
  try {
    const config = authConfig();
    const session = await getIronSession<PreAuthData>(await cookies(), preAuthOptions(config));
    active = await activePreAuth(session, config);
  } catch { /* Invalid or unavailable authentication configuration fails closed. */ }
  if (!active) redirect("/login?error=expired");
  const failed = (await searchParams).error === "1";

  return <AuthShell stage="verify"><section className="login-card" aria-labelledby="two-factor-heading">
    <div className="brand"><span className="brand-mark" aria-hidden="true">e</span><span>Ember<span className="brand-subtitle">FINANCE</span></span></div>
    <p className="eyebrow">STAP 2 VAN 2</p><h1 id="two-factor-heading">Nog één stap.</h1>
    <p className="login-intro">Open Google Authenticator en voer de zescijferige verificatiecode in.</p>
    {failed && <p className="login-error" role="alert">De code is ongeldig. Probeer het opnieuw.</p>}
    <form action="/api/auth/totp" method="post" className="login-form">
      <label htmlFor="code">Verificatiecode</label>
      <input className="totp-input" id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoFocus aria-describedby="totp-help" />
      <p className="login-help" id="totp-help">De code vernieuwt iedere 30 seconden.</p>
      <button type="submit" className="button login-submit">Verifiëren <span aria-hidden="true">→</span></button>
    </form>
    <form action="/api/auth/logout" method="post" className="login-cancel"><button type="submit" className="button">Annuleren</button></form>
    <p className="login-footer">Twee stappen. Eén beveiligd overzicht.</p>
  </section></AuthShell>;
}
