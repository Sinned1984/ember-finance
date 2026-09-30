import type { Metadata } from "next";
import { Bricolage_Grotesque, Onest } from "next/font/google";
import "./globals.css";

const bodyFont = Onest({ subsets: ["latin"], variable: "--font-body" });
const displayFont = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "Overzicht · Ember Finance",
  description: "Een onafhankelijke, moderne interface voor Firefly III.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="nl-NL"><body className={`${bodyFont.variable} ${displayFont.variable}`}>{children}</body></html>;
}


