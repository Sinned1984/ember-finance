"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type RefObject } from "react";
import { AppIcon } from "./app-icon";

type Status = { enabled: boolean; activatedAt: number | null };
type Setup = { qrCode: string; secret: string; expires: number };

export function ProfileModal({ open, onClose, opener, username }: {
  open: boolean;
  onClose: () => void;
  opener: RefObject<HTMLButtonElement | null>;
  username: string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDivElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"profile" | "security">("profile");
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch("/api/auth/2fa/status", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (response.status === 401) return router.replace("/login");
        if (!response.ok) throw new Error();
        setStatus(await response.json() as Status);
      })
      .catch(fetchError => {
        if (fetchError.name !== "AbortError") setError("De beveiligingsstatus kon niet worden geladen.");
      });
    return () => controller.abort();
  }, [open, router]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const openerElement = opener.current;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>("button")?.focus());
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") return onClose();
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keyboard);
      openerElement?.focus();
    };
  }, [onClose, open, opener]);

  async function startSetup() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/2fa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "",
      });
      if (response.status === 401) return router.replace("/login");
      const body = await response.json() as Setup & { error?: string };
      if (!response.ok) throw new Error(body.error || "De setup kon niet worden gestart.");
      setSetup(body);
      setCode("");
      requestAnimationFrame(() => codeInput.current?.focus());
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "De setup kon niet worden gestart.");
    } finally { setLoading(false); }
  }

  async function confirmSetup(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError("Voer de zescijferige code uit je authenticator in.");
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/2fa/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code }),
      });
      if (response.status === 401) return router.replace("/login");
      const body = await response.json() as { activated?: boolean; error?: string };
      if (!response.ok || !body.activated) throw new Error(body.error || "Activeren is mislukt.");
      router.replace("/login?error=2fa-enabled");
      router.refresh();
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : "Activeren is mislukt.");
    } finally { setLoading(false); }
  }

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="settings-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={dialog}>
        <header className="settings-header">
          <div><p className="eyebrow">MIJN OMGEVING</p><h2 id="settings-title">Profielinstellingen</h2></div>
          <button className="settings-close" type="button" onClick={onClose} aria-label="Profielinstellingen sluiten"><AppIcon name="close" /></button>
        </header>
        <div className="settings-body">
          <div className="settings-tabs" role="tablist" aria-label="Profielinstellingen">
            <button type="button" role="tab" aria-selected={tab === "profile"} aria-controls="profile-panel" id="profile-tab" onClick={() => setTab("profile")}><AppIcon name="profile" />Profiel</button>
            <button type="button" role="tab" aria-selected={tab === "security"} aria-controls="security-panel" id="security-tab" onClick={() => setTab("security")}><AppIcon name="shield" />Beveiliging</button>
          </div>

          {tab === "profile" ? <section className="settings-panel" role="tabpanel" id="profile-panel" aria-labelledby="profile-tab">
            <div className="profile-identity"><span className="profile-avatar" aria-hidden="true">{username.slice(0, 1).toUpperCase()}</span><div><p>Ingelogd als</p><strong>{username}</strong></div></div>
            <label className="settings-label" htmlFor="profile-username">Gebruikersnaam</label>
            <input className="settings-input" id="profile-username" value={username} readOnly />
            <p className="settings-help">Je gebruikersnaam en wachtwoord worden door de beheerder van deze Ember-installatie beheerd.</p>
          </section> : <section className="settings-panel security-panel" role="tabpanel" id="security-panel" aria-labelledby="security-tab">
            <div className="security-heading">
              <div><p className="eyebrow">EXTRA LOGINBEVEILIGING</p><h3>Twee-factor-authenticatie</h3></div>
              <span className={`security-status ${status?.enabled ? "is-enabled" : ""}`}><span aria-hidden="true" />{status === null ? "Controleren" : status.enabled ? "Ingeschakeld" : "Uitgeschakeld"}</span>
            </div>

            {error && <p className="settings-error" role="alert">{error}</p>}
            {status?.enabled ? <div className="security-complete">
              <span className="security-check" aria-hidden="true">✓</span>
              <div><strong>Je account gebruikt 2FA.</strong><p>Na je wachtwoord vraagt Ember altijd om een actuele code uit Google Authenticator.</p></div>
            </div> : setup ? <div className="totp-setup">
              <ol className="setup-steps" aria-label="Stappen voor 2FA">
                <li><span>1</span><div><strong>Scan de QR-code</strong><p>Open Google Authenticator, voeg een account toe en scan deze code.</p></div></li>
              </ol>
              <div className="qr-frame"><Image src={setup.qrCode} alt="QR-code voor Google Authenticator" width={256} height={256} unoptimized priority /></div>
              <button className="secret-toggle" type="button" onClick={() => setShowSecret(value => !value)} aria-expanded={showSecret}>{showSecret ? "Geheime sleutel verbergen" : "Lukt scannen niet? Geheime sleutel tonen"}</button>
              {showSecret && <div className="manual-secret"><span>Handmatige sleutel</span><code>{setup.secret.match(/.{1,4}/g)?.join(" ")}</code><p>Deel deze sleutel met niemand. Wie hem heeft, kan jouw codes genereren.</p></div>}
              <form className="setup-confirm" onSubmit={confirmSetup}>
                <div className="setup-step-copy"><span>2</span><div><strong>Bevestig de koppeling</strong><p>Vul de zescijferige code uit de app in.</p></div></div>
                <label className="settings-label" htmlFor="setup-code">Verificatiecode</label>
                <input ref={codeInput} className="settings-input setup-code" id="setup-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required />
                <p className="settings-help">Na activering word je overal uitgelogd. Gebruik bij de volgende login een nieuwe code als deze code nog in beeld staat.</p>
                <button className="button settings-primary" type="submit" disabled={loading || code.length !== 6}>{loading ? "Activeren…" : "2FA activeren"}</button>
              </form>
            </div> : <div className="security-intro">
              <div className="security-symbol" aria-hidden="true"><AppIcon name="shield" /></div>
              <h3>Een extra controle na je wachtwoord.</h3>
              <p>Je scant één keer een QR-code met Google Authenticator. Daarna heb je bij iedere nieuwe login ook een tijdelijke zescijferige code nodig.</p>
              <button className="button settings-primary" type="button" onClick={startSetup} disabled={loading || status === null}>{loading ? "Voorbereiden…" : "2FA instellen"}</button>
            </div>}
          </section>}
        </div>
      </div>
    </div>, document.body,
  );
}
