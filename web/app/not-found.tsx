import { ERROR_ONE_LINE } from "@/lib/copy";
import { SUPPORT_EMAIL } from "@/lib/config";

export default function NotFound() {
  return (
    <section className="one-line">
      <p>{ERROR_ONE_LINE}</p>
      <nav>
        <a href="/">Home</a>
        <a href="/legal">Policies</a>
        <a href={`mailto:${SUPPORT_EMAIL}`}>Support</a>
      </nav>
    </section>
  );
}
