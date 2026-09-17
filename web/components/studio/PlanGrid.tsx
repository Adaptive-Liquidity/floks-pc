import { STRIPE_LINKS } from "@/lib/config";
import { PLANS } from "@/lib/copy";

const HREF = {
  spark: STRIPE_LINKS.spark,
  desk: STRIPE_LINKS.desk,
  shift: STRIPE_LINKS.shift,
} as const;

const PRICE = {
  spark: "$19 / 8h",
  desk: "$39 / 25h",
  shift: "$69 / 60h",
} as const;

export function PlanGrid() {
  return (
    <div className="grid md:grid-cols-3 gap-6 pt-4">
      {PLANS.map((plan) => {
        const primary = plan.id === "desk";
        return (
          <article
            key={plan.id}
            className={
              primary
                ? "glass-card p-8 rounded-2xl glow-border relative text-left flex flex-col bg-surface-container/60"
                : "glass-card p-8 rounded-2xl border border-white/5 text-left flex flex-col"
            }
          >
            {primary ? (
              <div className="absolute top-0 right-8 -translate-y-1/2 bg-primary-fixed text-on-primary-fixed font-label-mono text-[10px] uppercase px-3 py-1 rounded-full tracking-wider">
                Most Popular
              </div>
            ) : null}
            <h3 className="font-headline-sm text-headline-sm text-tertiary-fixed uppercase mb-2">{plan.name}</h3>
            <p className="font-label-mono text-label-mono text-primary-fixed mb-6">{PRICE[plan.id]}</p>
            <a
              href={HREF[plan.id]}
              rel="noopener noreferrer"
              className={`${primary ? "button-primary" : "button-secondary"} py-3 w-full rounded-full font-label-mono text-label-mono uppercase mt-auto text-center`}
            >
              {plan.short}
            </a>
          </article>
        );
      })}
    </div>
  );
}
