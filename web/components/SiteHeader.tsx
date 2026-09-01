"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="top">
      <Link className="mark" href="/">
        FLOKS
      </Link>
      <Link
        className="top-link"
        href="/setup"
        aria-current={path === "/setup" || path.startsWith("/setup/") ? "page" : undefined}
      >
        Setup
      </Link>
    </header>
  );
}
