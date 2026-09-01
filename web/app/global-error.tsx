"use client";

import { SERVER_ERROR_ONE_LINE } from "@/lib/copy";
import { SUPPORT_EMAIL } from "@/lib/config";

export default function GlobalError(_props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ background: "#18120d", color: "#f4efe6", fontFamily: "ui-sans-serif, sans-serif" }}>
        <section style={{ padding: "4rem 1.5rem" }}>
          <p>{SERVER_ERROR_ONE_LINE}</p>
          <p>
            <a href="/" style={{ color: "#d3fd64" }}>
              Home
            </a>{" "}
            <a href="/legal" style={{ color: "#d3fd64" }}>
              Policies
            </a>{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "#d3fd64" }}>
              Support
            </a>
          </p>
        </section>
      </body>
    </html>
  );
}
