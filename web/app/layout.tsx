import type { Metadata } from "next";
import { Geist, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { ChromeProvider } from "@/components/Chrome";
import { LegalFooter } from "@/components/LegalFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { HOME_HEADLINE, HOME_LINE, HOME_SUB } from "@/lib/copy";
import "./globals.css";

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "FLOKS",
    template: "%s — FLOKS",
  },
  description: `${HOME_HEADLINE} ${HOME_SUB} ${HOME_LINE}`,
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} ${display.variable}`}>
        <a className="skip" href="#content">
          Skip to content
        </a>
        <ChromeProvider>
          <div className="shell">
            <SiteHeader />
            <main id="content" className="main">
              {children}
            </main>
            <LegalFooter />
          </div>
        </ChromeProvider>
      </body>
    </html>
  );
}
