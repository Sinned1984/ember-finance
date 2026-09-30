import Link from "next/link";

export default function NotFound() {
  return <section className="empty-state"><h1>Pagina niet gevonden</h1><p>Deze pagina bestaat niet of is verplaatst.</p><Link className="button" href="/">Naar het overzicht</Link></section>;
}
