"use client";

import Link from "next/link";
import { useChrome } from "@/components/Chrome";
import { LOGOUT, MANAGE_BILLING } from "@/lib/copy";
import { SUPPORT_EMAIL } from "@/lib/config";
import { logoutSetup, openPortal } from "@/lib/setup-client";

export function SiteHeader() {
  const { authed } = useChrome();

  function billing() {
    openPortal();
  }

  async function logout() {
    await logoutSetup();
    window.location.assign("/setup");
  }

  return (
    <header className="top">
      <Link className="mark" href="/">
        FLOKS
      </Link>
      <nav className="top-nav" aria-label="Site">
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
            <a className="top-link" href={`mailto:${SUPPORT_EMAIL}`}>
              Support
            </a>
            <a className="top-link" href="/legal">
              Policies
            </a>
          </>
        )}
      </nav>
    </header>
  );
}
