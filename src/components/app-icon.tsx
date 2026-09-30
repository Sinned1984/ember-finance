import type { ReactNode } from "react";

export type IconName =
  | "overview"
  | "transactions"
  | "budgets"
  | "accounts"
  | "subscriptions"
  | "reports"
  | "search"
  | "refresh"
  | "logout"
  | "profile"
  | "shield"
  | "close"
  | "arrow-left"
  | "arrow-right"
  | "calendar";

const paths: Record<IconName, ReactNode> = {
  overview: <><path d="M4 13h6V4H4z" /><path d="M14 20h6V11h-6z" /><path d="M4 20h6v-3H4z" /><path d="M14 7h6V4h-6z" /></>,
  transactions: <><path d="M7 7h11" /><path d="m15 4 3 3-3 3" /><path d="M17 17H6" /><path d="m9 14-3 3 3 3" /></>,
  budgets: <><path d="M4 5h16v14H4z" /><path d="M8 9h4" /><path d="M8 13h8" /><path d="M8 17h6" /></>,
  accounts: <><path d="M3 9h18" /><path d="m5 9 7-5 7 5" /><path d="M5 20h14" /><path d="M7 9v8" /><path d="M12 9v8" /><path d="M17 9v8" /></>,
  subscriptions: <><path d="M6 7h12a2 2 0 0 1 2 2v9H4V9a2 2 0 0 1 2-2Z" /><path d="M8 7V5" /><path d="M16 7V5" /><path d="M8 12h8" /></>,
  reports: <><path d="M5 19V9" /><path d="M12 19V5" /><path d="M19 19v-7" /><path d="M3 19h18" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.8-4" /><path d="M4 3v5h5" /><path d="M4 13a8 8 0 0 0 14.8 4" /><path d="M20 21v-5h-5" /></>,
  logout: <><path d="M10 5H5v14h5" /><path d="M14 8l4 4-4 4" /><path d="M18 12H9" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  shield: <><path d="M12 3 5 6v5c0 4.6 2.7 8.2 7 10 4.3-1.8 7-5.4 7-10V6z" /><path d="m9.5 12 1.7 1.7 3.5-3.7" /></>,
  close: <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>,
  "arrow-left": <><path d="m15 18-6-6 6-6" /></>,
  "arrow-right": <><path d="m9 18 6-6-6-6" /></>,
  calendar: <><path d="M5 5h14v15H5z" /><path d="M8 3v4" /><path d="M16 3v4" /><path d="M5 10h14" /></>,
};

export function AppIcon({ name, className = "app-icon" }: { name: IconName; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
