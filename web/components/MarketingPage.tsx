import type { ReactNode } from "react";
import { PayPills } from "@/components/PayPills";

export function MarketingPage({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="marketing">
      <p className="kicker">{eyebrow}</p>
      <h1>{title}</h1>
      {children}
      <div style={{ marginTop: 32 }}>
        <PayPills />
        <p className="lede">
          <a className="top-link" href="/login">
            Sign in
          </a>
        </p>
      </div>
    </article>
  );
}
