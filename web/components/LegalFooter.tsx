import { FOOTER_NAV } from "@/lib/legal";
import { SELLER, SUPPORT_EMAIL } from "@/lib/config";

export function LegalFooter() {
  return (
    <footer className="foot">
      <nav className="foot-nav" aria-label="Policies">
        {FOOTER_NAV.map((item) => (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ))}
      </nav>
      <p className="foot-copy">
        {SELLER} · {SUPPORT_EMAIL}
      </p>
    </footer>
  );
}
