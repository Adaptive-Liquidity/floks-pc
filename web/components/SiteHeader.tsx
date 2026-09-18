"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { LayoutGrid } from "lucide-react";
import { useChrome } from "@/components/Chrome";
import { CREATE_ACCOUNT, LOGOUT, MANAGE_BILLING, SETUP_SIGN_IN } from "@/lib/copy";
import { logoutSetup, openPortal } from "@/lib/setup-client";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/product", label: "Product" },
  { href: "/how", label: "How" },
  { href: "/now", label: "Now" },
  { href: "/faq", label: "FAQ" },
  { href: "/legal", label: "Legal" },
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
    <motion.header
      initial={{ opacity: 0, y: -20, filter: "blur(10px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="fixed top-0 left-0 w-full z-50 bg-surface/60 backdrop-blur-xl border-b border-white/10 shadow-2xl"
    >
      <div className="flex justify-between items-center px-margin-x py-stack-sm max-w-container-max mx-auto gap-4">
        <Link
          className="font-headline-md text-headline-md font-bold tracking-tighter text-tertiary-fixed flex items-center gap-2 shrink-0"
          href="/"
        >
          <LayoutGrid className="w-7 h-7" aria-hidden="true" />
          FLOKS
        </Link>
        <nav className="hidden lg:flex space-x-6" aria-label="Site">
          {LINKS.map((item) => (
            <Link
              key={item.href}
              className="text-on-surface-variant/80 hover:text-primary-fixed transition-colors duration-300 font-body-md text-body-md"
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden md:flex items-center gap-4 shrink-0">
          {authed ? (
            <>
              <Link
                className="text-on-surface-variant/80 hover:text-white transition-colors duration-300 font-label-mono text-label-mono uppercase tracking-widest"
                href="/setup"
              >
                Account
              </Link>
              <button
                className="text-on-surface-variant/80 hover:text-white transition-colors duration-300 font-label-mono text-label-mono uppercase tracking-widest"
                type="button"
                onClick={() => {
                  billing();
                }}
              >
                {MANAGE_BILLING}
              </button>
              <button
                className="text-on-surface-variant/80 hover:text-white transition-colors duration-300 font-label-mono text-label-mono uppercase tracking-widest"
                type="button"
                onClick={() => {
                  void logout();
                }}
              >
                {LOGOUT}
              </button>
            </>
          ) : (
            <>
              <Link
                className="text-on-surface-variant/80 hover:text-white transition-colors duration-300 font-label-mono text-label-mono uppercase tracking-widest"
                href="/login"
              >
                {SETUP_SIGN_IN}
              </Link>
              <Link
                className="text-on-surface-variant/80 hover:text-white transition-colors duration-300 font-label-mono text-label-mono uppercase tracking-widest"
                href="/join"
              >
                Plans
              </Link>
              <Link
                className="button-primary px-6 py-2 rounded-full font-label-mono text-label-mono uppercase tracking-widest"
                href="/signup"
              >
                {CREATE_ACCOUNT}
              </Link>
            </>
          )}
        </div>
        <details className="nav-more md:hidden">
          <summary>Menu</summary>
          <div className="nav-drawer">
            {LINKS.map((item) => (
              <Link key={item.href} className="top-link" href={item.href}>
                {item.label}
              </Link>
            ))}
            {authed ? (
              <>
                <Link className="top-link" href="/setup">
                  Account
                </Link>
                <button
                  className="top-link"
                  type="button"
                  onClick={() => {
                    billing();
                  }}
                >
                  {MANAGE_BILLING}
                </button>
                <button
                  className="top-link"
                  type="button"
                  onClick={() => {
                    void logout();
                  }}
                >
                  {LOGOUT}
                </button>
              </>
            ) : (
              <>
                <Link className="top-link" href="/signup">
                  {CREATE_ACCOUNT}
                </Link>
                <Link className="top-link" href="/login">
                  {SETUP_SIGN_IN}
                </Link>
                <Link className="top-link" href="/join">
                  Plans
                </Link>
              </>
            )}
          </div>
        </details>
      </div>
    </motion.header>
  );
}
