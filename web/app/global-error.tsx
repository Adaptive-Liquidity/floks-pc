"use client";

import { SERVER_ERROR_ONE_LINE } from "@/lib/copy";
import { SUPPORT_EMAIL } from "@/lib/config";

export default function GlobalError(_props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ background: "#0a0a0a", color: "#e5e2e1", fontFamily: "Geist, ui-sans-serif, sans-serif" }}>
        <section style={{ padding: "4rem 1.5rem" }}>
          <p style={{ fontFamily: "Space Grotesk, ui-sans-serif, sans-serif", fontWeight: 700 }}>
            {SERVER_ERROR_ONE_LINE}
          </p>
          <p>
            <a href="/" style={{ color: "#c3f400" }}>
              Home
            </a>{" "}
            <a href="/legal" style={{ color: "#c3f400" }}>
              Policies
            </a>{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "#c3f400" }}>
              Support
            </a>
          </p>
        </section>
      </body>
    </html>
  );
}
