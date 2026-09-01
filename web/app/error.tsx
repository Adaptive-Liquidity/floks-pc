"use client";

import { SERVER_ERROR_ONE_LINE } from "@/lib/copy";
import { SUPPORT_EMAIL } from "@/lib/config";

export default function ErrorPage(_props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="one-line">
      <p>{SERVER_ERROR_ONE_LINE}</p>
      <nav>
        <a href="/">Home</a>
        <a href="/legal">Policies</a>
        <a href={`mailto:${SUPPORT_EMAIL}`}>Support</a>
      </nav>
    </section>
  );
}
