import { STRIPE_LINKS } from "@/lib/config";
import { PLANS } from "@/lib/copy";

const HREF = {
  spark: STRIPE_LINKS.spark,
  desk: STRIPE_LINKS.desk,
  shift: STRIPE_LINKS.shift,
} as const;

export function PayPills() {
  return (
    <div className="pills">
      {PLANS.map((plan) => (
        <a
          key={plan.id}
          className="pill"
          href={HREF[plan.id]}
          rel="noopener noreferrer"
        >
          {plan.line}
        </a>
      ))}
    </div>
  );
}
