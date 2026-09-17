import { MarketingPage } from "@/components/MarketingPage";
import { HOW_EYEBROW, HOW_STEPS, HOW_TITLE } from "@/lib/copy";

export const metadata = { title: "How" };

export default function HowPage() {
  return (
    <MarketingPage eyebrow={HOW_EYEBROW} title={HOW_TITLE}>
      <div className="cap-grid" style={{ gridTemplateColumns: "1fr" }}>
        {HOW_STEPS.map((step) => (
          <section key={step.n} className="step-card">
            <p className="kicker">
              {step.n} · {step.title}
            </p>
            <p>{step.body}</p>
          </section>
        ))}
      </div>
      <p>Then observe and operate. The Bot works inside. You watch the boundary.</p>
    </MarketingPage>
  );
}
