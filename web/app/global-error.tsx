"use client";

import { SERVER_ERROR_ONE_LINE } from "@/lib/copy";
import { SUPPORT_EMAIL } from "@/lib/config";

export default function GlobalError(_props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ background: "#050505", color: "#ffffff", fontFamily: "Manrope, ui-sans-serif, sans-serif" }}>
        <section style={{ padding: "4rem 1.5rem" }}>
          <p style={{ fontFamily: "Hanken Grotesk, ui-sans-serif, sans-serif", fontWeight: 700 }}>
            {SERVER_ERROR_ONE_LINE}
          </p>
          <p>
            <a href="/" style={{ color: "#e3f2fd" }}>
              /
            </a>{" "}
            <a href="/legal" style={{ color: "#e3f2fd" }}>
              /legal
            </a>{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "#e3f2fd" }}>
              Support
            </a>
          </p>
        </section>
      </body>
    </html>
  );
}
