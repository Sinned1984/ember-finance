import type { ReactNode } from "react";

export function AuthShell({ children, stage }: { children: ReactNode; stage: "login" | "verify" }) {
  return <main className="login-page" id="main">
    <aside className="login-story" aria-label="Over Ember Finance">
      <div className="login-story-brand"><span className="brand-mark" aria-hidden="true">e</span><span>Ember<span>FINANCE</span></span></div>
      <div className="login-story-copy">
        <p className="eyebrow">PRIVATE FINANCE, HELDER GEMAAKT</p>
        <h2>{stage === "verify" ? "Beveiliging zonder omwegen." : "Je financiën, zonder de ruis."}</h2>
        <p>Je eigen financiële bron blijft leidend. Ember maakt je rekeningen, transacties, budgetten en rapporten rustig leesbaar.</p>
      </div>
      <div className="login-story-meta"><span>Self-hosted</span><span>Read-only</span><span>Server-side beveiligd</span></div>
    </aside>
    {children}
  </main>;
}
