export const dynamic = "force-dynamic";
export const metadata = { title: "Inloggen · Ember Finance", description: "Log veilig in op je persoonlijke Ember Finance-omgeving." };

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const error = (await searchParams).error;
  const message = error === "expired" ? "De verificatie is verlopen. Log opnieuw in."
    : error === "2fa" ? "De verificatie is gestopt. Log opnieuw in om verder te gaan."
    : error === "2fa-enabled" ? "2FA is ingeschakeld. Log opnieuw in en bevestig je authenticatorcode."
    : error === "1" ? "Inloggen mislukt. Controleer je gegevens." : null;
  return <AuthShell stage="login"><section className="login-card" aria-labelledby="login-heading">
    <div className="brand"><span className="brand-mark" aria-hidden="true">e</span><span>Ember<span className="brand-subtitle">FINANCE</span></span></div>
    <p className="eyebrow">JE PERSOONLIJKE OMGEVING</p><h1 id="login-heading">Welkom terug.</h1>
    <p className="login-intro">Log in om je financiën te bekijken.</p>
    {message && <p className={error === "2fa-enabled" ? "login-success" : "login-error"} role="alert">{message}</p>}
    <form action="/api/auth/login" method="post" className="login-form">
      <label htmlFor="username">Gebruikersnaam</label><input id="username" name="username" autoComplete="username" required maxLength={128} autoCapitalize="none" spellCheck={false} />
      <label htmlFor="password">Wachtwoord</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={72} />
      <button type="submit" className="button login-submit">Inloggen <span aria-hidden="true">→</span></button>
    </form><p className="login-footer">Jouw overzicht. Alleen voor jou.</p>
  </section></AuthShell>;
}
import { AuthShell } from "@/components/auth-shell";
