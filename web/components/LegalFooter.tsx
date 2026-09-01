import { LEGAL_NAV } from "@/lib/legal";
import { SELLER, SUPPORT_EMAIL } from "@/lib/config";

export function LegalFooter() {
  return (
    <footer className="foot">
      {LEGAL_NAV.map((item) => (
        <a key={item.href} href={item.href}>
          {item.label}
        </a>
      ))}
      <span>
        © {SELLER} · {SUPPORT_EMAIL}
      </span>
    </footer>
  );
}
