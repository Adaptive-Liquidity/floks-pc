/** Four-move onboarding diagram — AuthKit hairline boxes + connectors. */

const STEPS = [
  {
    n: "01",
    title: "Pay",
    body: "Stripe Checkout is register. Pick Spark, Desk, or Shift. Payment creates the seat.",
  },
  {
    n: "02",
    title: "Sign in",
    body: "Magic link to the billing email. No password form.",
  },
  {
    n: "03",
    title: "Allow in Grok",
    body: "Proves the customer, not which Bot. The Bot is not auto-claimed.",
  },
  {
    n: "04",
    title: "Approve",
    body: "The pair code shows on /setup. Approve once. The code burns.",
  },
] as const;

export function FlowDiagram() {
  return (
    <ol className="flow">
      {STEPS.map((step, i) => (
        <li key={step.n} className="flow-step">
          <div className="flow-card">
            <p className="flow-index">{step.n}</p>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </div>
          {i < STEPS.length - 1 ? <span className="flow-rule" aria-hidden="true" /> : null}
        </li>
      ))}
    </ol>
  );
}
