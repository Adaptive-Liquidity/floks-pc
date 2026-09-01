import { ERROR_ONE_LINE } from "@/lib/copy";
import { SUPPORT_EMAIL } from "@/lib/config";

export default function NotFound() {
  return (
    <section className="one-line">
      <p>{ERROR_ONE_LINE}</p>
      <nav>
        <a href="/">/</a>
        <a href="/legal">/legal</a>
        <a href={`mailto:${SUPPORT_EMAIL}`}>Support</a>
      </nav>
    </section>
  );
}
