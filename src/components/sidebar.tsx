"use client";
import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ProfileModal } from "./profile-modal";
import { AppIcon, type IconName } from "./app-icon";
const pages: { name: string; href: string; icon: IconName }[] = [
  { name: "Overzicht", href: "/", icon: "overview" },
  { name: "Transacties", href: "/transactions", icon: "transactions" },
  { name: "Budgetten", href: "/budgets", icon: "budgets" },
  { name: "Rekeningen", href: "/accounts", icon: "accounts" },
  { name: "Abonnementen", href: "/subscriptions", icon: "subscriptions" },
  { name: "Rapporten", href: "/reports", icon: "reports" },
];

export function Sidebar({ username }: { username: string }) {
  const pathname = usePathname();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileButton = useRef<HTMLButtonElement>(null);
  const active = (href: string) => pathname === href || (href === "/budgets" && pathname.startsWith("/budgets/")) || (href === "/transactions" && pathname.startsWith("/categories/"));
  return <><aside className="sidebar">
    <Link href="/" className="brand" aria-label="Ember Finance: naar het overzicht"><span className="brand-mark">e</span><span>Ember<span className="brand-subtitle">FINANCE</span></span></Link>
    <Link className="sidebar-search" href="/transactions#transaction-search" prefetch={false}><AppIcon name="search" /><span>Transacties zoeken</span></Link>
    <nav aria-label="Hoofdnavigatie">
      <p className="eyebrow nav-caption">MIJN FINANCIËN</p>
      {pages.map(({ name, href, icon }) => <Link key={name} href={href} prefetch={false} aria-current={active(href) ? "page" : undefined} className={`nav-item ${active(href) ? "selected" : ""}`}><AppIcon name={icon} /><span>{name}</span></Link>)}
    </nav>
    <div className="sidebar-bottom">
      <div className="sidebar-note"><span className="eyebrow">EMBER PRINCIPLE</span><h2>Rust in je financiën.</h2><p>Firefly blijft je bron. Ember brengt alleen focus aan.</p></div>
      <button ref={profileButton} className="workspace-label" type="button" onClick={() => setProfileOpen(true)} aria-haspopup="dialog" aria-expanded={profileOpen}><span className="workspace-avatar">{username.slice(0, 1).toUpperCase()}</span><span>{username}<small>Profielinstellingen</small></span><AppIcon name="arrow-right" className="workspace-chevron" /></button>
      <form action="/api/auth/logout" method="post" className="logout-form"><button className="button" type="submit"><AppIcon name="logout" />Uitloggen</button></form>
    </div>
  </aside>{profileOpen && <ProfileModal open onClose={() => setProfileOpen(false)} opener={profileButton} username={username} />}</>;
}





