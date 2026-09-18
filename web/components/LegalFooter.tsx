import { FOOTER_NAV } from "@/lib/legal";
import { FOOTER_MARK, FOOTER_ORG } from "@/lib/copy";
import { SELLER, SUPPORT_EMAIL } from "@/lib/config";

export function LegalFooter() {
  return (
    <footer className="border-t border-white/5 py-12 px-margin-x mt-auto relative z-10">
      <div className="max-w-container-max mx-auto flex flex-col md:flex-row justify-between gap-8">
        <div className="space-y-2">
          <a className="font-headline-md text-headline-md text-tertiary-fixed tracking-tighter" href="/">
            {FOOTER_MARK}
          </a>
          <p className="font-body-md text-on-surface-variant max-w-sm">
            {FOOTER_ORG} · {SELLER} · {SUPPORT_EMAIL}
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-3 font-label-mono text-[12px] uppercase tracking-wider" aria-label="Policies">
          <a className="text-on-surface-variant hover:text-secondary-fixed transition-all" href="/product">
            Product
          </a>
          <a className="text-on-surface-variant hover:text-secondary-fixed transition-all" href="/how">
            How
          </a>
          <a className="text-on-surface-variant hover:text-secondary-fixed transition-all" href="/now">
            Now
          </a>
          <a className="text-on-surface-variant hover:text-secondary-fixed transition-all" href="/faq">
            FAQ
          </a>
          <a className="text-on-surface-variant hover:text-secondary-fixed transition-all" href="/join">
            Buy
          </a>
          {FOOTER_NAV.map((item) => (
            <a
              key={item.href}
              className="text-on-surface-variant hover:text-secondary-fixed transition-all"
              href={item.href}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
