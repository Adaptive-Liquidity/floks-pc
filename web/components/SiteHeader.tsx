"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useChrome } from "@/components/Chrome";
import { LOGOUT, MANAGE_BILLING } from "@/lib/copy";
import { logoutSetup, openPortal } from "@/lib/setup-client";

const LINKS = [
  { href: "/product", label: "Product" },
  { href: "/how", label: "How" },
  { href: "/now", label: "Now" },
  { href: "/faq", label: "FAQ" },
  { href: "/legal", label: "Policies" },
] as const;

export function SiteHeader() {
  const { authed } = useChrome();
  const pathname = usePathname();

  function billing() {
    openPortal();
  }

  async function logout() {
    await logoutSetup();
    window.location.assign("/");
  }

  return (
    <header className="top">
      <Link className="mark" href="/">
        FLOKS
      </Link>
      <nav className="top-nav nav-wide" aria-label="Site">
        {LINKS.map((item) => (
          <Link
            key={item.href}
            className="top-link"
            href={item.href}
            aria-current={pathname === item.href ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
        {authed ? (
          <>
            <button className="top-link" type="button" onClick={() => void billing()}>
              {MANAGE_BILLING}
            </button>
            <button className="top-link" type="button" onClick={() => void logout()}>
              {LOGOUT}
            </button>
          </>
        ) : (
          <>
            <Link className="top-link" href="/login">
              Sign in
            </Link>
            <Link className="top-buy" href="/join">
              Buy
            </Link>
          </>
        )}
      </nav>
      <details className="nav-more">
        <summary>Menu</summary>
        <div className="nav-drawer">
          {LINKS.map((item) => (
            <Link key={item.href} className="top-link" href={item.href}>
              {item.label}
            </Link>
          ))}
          {authed ? (
            <>
              <button className="top-link" type="button" onClick={() => void billing()}>
                {MANAGE_BILLING}
              </button>
              <button className="top-link" type="button" onClick={() => void logout()}>
                {LOGOUT}
              </button>
            </>
          ) : (
            <>
              <Link className="top-link" href="/login">
                Sign in
              </Link>
              <Link className="top-link" href="/join">
                Buy
              </Link>
            </>
          )}
        </div>
      </details>
    </header>
  );
}
