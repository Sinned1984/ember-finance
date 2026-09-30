"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <section className="notice" role="alert"><h1>Er ging iets mis</h1><p>Deze pagina kan niet worden weergegeven. Probeer het opnieuw.</p><button className="button" onClick={reset}>Opnieuw proberen</button></section>;
}

