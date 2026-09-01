import { LEGAL_NAV } from "@/lib/legal";
import { SELLER, SUPPORT_EMAIL } from "@/lib/config";

export function LegalFooter() {
  return (
    <footer className="foot">
      <a className="foot-mark" href="/">
        FLOKS
      </a>
      <nav className="foot-nav" aria-label="Policies">
        {LEGAL_NAV.map((item) => (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ))}
      </nav>
      <p className="foot-copy">
        © {SELLER} · {SUPPORT_EMAIL}
      </p>
    </footer>
  );
}
