import { enterpriseContactHref, PLAN_CATALOG } from "@/lib/billing/catalog";
import { PLANS } from "@/lib/copy";
import { planCheckoutHref, SUPPORT_EMAIL } from "@/lib/config";

export function PlanGrid({
  email = null,
  signedIn = false,
}: {
  email?: string | null;
  signedIn?: boolean;
}) {
  return (
    <div className="space-y-8">
      <div className="grid md:grid-cols-3 gap-6 pt-4">
        {PLANS.map((plan) => {
          const catalog = PLAN_CATALOG[plan.id];
          const primary = catalog.highlight;
          const href = planCheckoutHref(plan.id, { signedIn });
          const external = href.startsWith("https://");
          return (
            <article
              key={plan.id}
              className={
                primary
                  ? "glass-card p-8 rounded-2xl glow-border relative text-left flex flex-col bg-surface-container/60"
                  : "glass-card p-8 rounded-2xl border border-white/5 text-left flex flex-col"
              }
            >
              <h3 className="font-headline-sm text-headline-sm text-tertiary-fixed uppercase mb-2">{plan.name}</h3>
              <p className="font-label-mono text-label-mono text-primary-fixed mb-2">{plan.price}</p>
              <p className="font-body-md text-on-surface-variant mb-6">{catalog.blurb}</p>
              {signedIn ? (
                <form method="POST" action="/api/checkout" className="mt-auto space-y-3">
                  <input type="hidden" name="plan" value={plan.id} />
                  {plan.id === "team" ? (
                    <label className="block font-label-mono text-[11px] text-on-surface-variant uppercase tracking-wider">
                      Agents
                      <input
                        className="mt-1 w-full rounded-full bg-surface-container px-4 py-2 text-white"
                        type="number"
                        name="quantity"
                        min={catalog.minAgents}
                        defaultValue={catalog.minAgents}
                      />
                    </label>
                  ) : null}
                  <button
                    type="submit"
                    className={`${primary ? "button-primary" : "button-secondary"} py-3 w-full rounded-full font-label-mono text-label-mono uppercase`}
                  >
                    {plan.short}
                  </button>
                </form>
              ) : (
                <a
                  href={href}
                  rel={external ? "noopener noreferrer" : undefined}
                  className={`${primary ? "button-primary" : "button-secondary"} py-3 w-full rounded-full font-label-mono text-label-mono uppercase mt-auto text-center`}
                >
                  {plan.short}
                </a>
              )}
            </article>
          );
        })}
      </div>
      <article className="glass-card p-8 rounded-2xl border border-white/5 text-left">
        <h3 className="font-headline-sm text-headline-sm text-tertiary-fixed uppercase mb-2">
          {PLAN_CATALOG.enterprise.name}
        </h3>
        <p className="font-label-mono text-label-mono text-primary-fixed mb-2">{PLAN_CATALOG.enterprise.priceLabel}</p>
        <p className="font-body-md text-on-surface-variant mb-6">{PLAN_CATALOG.enterprise.blurb}</p>
        <a
          className="button-secondary py-3 px-6 rounded-full font-label-mono text-label-mono uppercase inline-block"
          href={enterpriseContactHref(SUPPORT_EMAIL)}
        >
          Contact us
        </a>
      </article>
      {email ? <p className="sr-only">Checkout email {email}</p> : null}
    </div>
  );
}
