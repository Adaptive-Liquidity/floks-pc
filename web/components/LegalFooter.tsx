import { FOOTER_NAV } from "@/lib/legal";
import { FOOTER_MARK, FOOTER_ORG } from "@/lib/copy";
import { SELLER, SUPPORT_EMAIL } from "@/lib/config";

export function LegalFooter() {
  return (
    <footer className="foot">
      <p className="foot-copy">
        <a className="foot-mark" href="/">
          {FOOTER_MARK}
        </a>
        {" · "}
        <span>{FOOTER_ORG}</span>
        {" · "}
        {SELLER} · {SUPPORT_EMAIL}
      </p>
      <nav className="foot-nav" aria-label="Policies">
        <a href="/product">Product</a>
        <a href="/how">How</a>
        <a href="/now">Now</a>
        <a href="/faq">FAQ</a>
        <a href="/join">Buy</a>
        {FOOTER_NAV.map((item) => (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ))}
      </nav>
    </footer>
  );
}
