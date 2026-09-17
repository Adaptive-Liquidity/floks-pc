import type { ReactNode } from "react";
import { PlanGrid } from "@/components/studio/PlanGrid";

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
    <article className="flex-1 pt-32 pb-20 px-margin-x max-w-container-max mx-auto w-full">
      <div className="max-w-3xl space-y-4 mb-12">
        <p className="font-label-mono text-[11px] text-secondary uppercase tracking-widest">{eyebrow}</p>
        <h1 className="font-display-lg text-display-md md:text-display-lg text-tertiary-fixed uppercase leading-[1.05]">
          {title}
        </h1>
      </div>
      <div className="space-y-10 max-w-3xl font-body-lg text-body-lg text-on-surface-variant leading-relaxed">
        {children}
      </div>
      <div className="max-w-5xl mt-12 space-y-6">
        <PlanGrid />
        <p>
          <a
            className="font-label-mono text-label-mono uppercase tracking-widest text-on-surface-variant hover:text-white"
            href="/login"
          >
            Sign in
          </a>
        </p>
      </div>
    </article>
  );
}
