import type { ReactNode } from "react";

export function Door({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="stage">
      <div className="door">
        <span className="door-lamp" aria-hidden="true" />
        <p className="kicker">{kicker}</p>
        <h1 className="question">{title}</h1>
        {children}
      </div>
    </section>
  );
}
