import { MarketingPage } from "@/components/MarketingPage";
import { HOW_EYEBROW, HOW_STEPS, HOW_TITLE } from "@/lib/copy";

export const metadata = { title: "How" };

export default function HowPage() {
  return (
    <MarketingPage eyebrow={HOW_EYEBROW} title={HOW_TITLE}>
      <div className="space-y-8">
        {HOW_STEPS.map((step) => (
          <section key={step.n} className="glass-card p-6 rounded-2xl border border-white/5 space-y-2">
            <p className="font-label-mono text-[11px] text-secondary uppercase tracking-widest">
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
