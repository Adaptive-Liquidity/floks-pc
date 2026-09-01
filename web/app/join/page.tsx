import { HonestyStrip } from "@/components/HonestyStrip";
import { KitMark } from "@/components/KitMark";
import { PayPills } from "@/components/PayPills";
import { JOIN_HEADLINE, JOIN_SUB } from "@/lib/copy";

export const metadata = {
  title: "Join",
  robots: { index: true, follow: true },
};

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ handoff?: string | string[] }>;
}) {
  const query = await searchParams;
  const handoff = typeof query.handoff === "string" ? query.handoff.trim() : "";
  return (
    <>
      <section className="paper column" style={{ margin: "0 auto", position: "relative" }}>
        <p className="kicker">Named buy URL</p>
        <h1 className="question">{JOIN_HEADLINE}</h1>
        <p className="lede">{JOIN_SUB}</p>
        {handoff ? <p className="handoff">{handoff}</p> : null}
        <PayPills />
        <KitMark placement="join" />
      </section>
      <HonestyStrip />
    </>
  );
}
