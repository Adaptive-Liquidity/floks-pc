import { MarketingPage } from "@/components/MarketingPage";
import { FAQ_EYEBROW, FAQ_QA, FAQ_TITLE } from "@/lib/copy";

export const metadata = { title: "FAQ" };

export default function FaqPage() {
  return (
    <MarketingPage eyebrow={FAQ_EYEBROW} title={FAQ_TITLE}>
      {FAQ_QA.map(([q, a]) => (
        <section key={q}>
          <h2>{q}</h2>
          <p>{a}</p>
        </section>
      ))}
    </MarketingPage>
  );
}
