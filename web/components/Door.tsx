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
        <div className="door-interior" aria-hidden="true" />
        <span className="door-lamp" aria-hidden="true" />
        <div className="door-copy">
          <p className="kicker kicker-badge">{kicker}</p>
          <h1 className="question">{title}</h1>
          {children}
        </div>
      </div>
    </section>
  );
}
