import { ConfigurationError } from "@/lib/env";
import { FireflyError } from "@/lib/firefly/client";
import { RefreshButton } from "./refresh-button";

export function dataErrorMessage(error: unknown): string {
  if (error instanceof ConfigurationError) return "De verbinding met Firefly III is nog niet ingesteld. Controleer de serverinstellingen en herstart Ember.";
  if (error instanceof FireflyError && error.message.includes("rejected access")) return "Firefly III weigert toegang. Controleer de toegangsrechten op de server.";
  return "Deze gegevens kunnen nu niet worden geladen. Probeer het opnieuw.";
}

export function DataNotice({ error }: { error: unknown }) {
  return <div className="notice" role="status"><h3>{error instanceof ConfigurationError ? "Verbind met Firefly III" : "Gegevens niet beschikbaar"}</h3><p>{dataErrorMessage(error)}</p><RefreshButton label="Opnieuw proberen" /></div>;
}

