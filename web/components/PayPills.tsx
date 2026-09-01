import { STRIPE_LINKS } from "@/lib/config";
import { PLANS } from "@/lib/copy";

const HREF = {
  spark: STRIPE_LINKS.spark,
  desk: STRIPE_LINKS.desk,
  shift: STRIPE_LINKS.shift,
} as const;

export function PayPills() {
  return (
    <div className="desks">
      {PLANS.map((plan) => (
        <article key={plan.id} className="desk-plate">
          <p className="kicker">{plan.name}</p>
          <p className="meta">
            {plan.price} · {plan.hours} · 1 computer
          </p>
          <a className="pill" href={HREF[plan.id]} rel="noopener noreferrer">
            {plan.line}
          </a>
        </article>
      ))}
    </div>
  );
}
