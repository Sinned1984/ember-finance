import { requireUser } from "@/lib/auth/require-user";
import { Sidebar } from "@/components/sidebar";
import { SessionExpiry } from "@/components/session-expiry";

export default async function FinancialLayout({ children }: { children: React.ReactNode }) {
  const { expires, username } = await requireUser();
  return <><SessionExpiry expires={expires} /><a className="skip-link" href="#main">Naar de inhoud</a><div className="app-shell"><Sidebar username={username} /><main id="main">{children}</main></div></>;
}
