import { HonestyStrip } from "@/components/HonestyStrip";
import { KitMark } from "@/components/KitMark";
import { PayPills } from "@/components/PayPills";
import { JOIN_HOURS, JOIN_LINE, JOIN_SUB, JOIN_TITLE } from "@/lib/copy";

export const metadata = {
  title: "Join",
  description: JOIN_LINE,
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
      <div style={{ position: "relative" }}>
        <section className="marketing">
          <p className="kicker">Pay first</p>
          <h1>{JOIN_TITLE}</h1>
          <p className="lede">{JOIN_SUB}</p>
          <p className="lede">{JOIN_HOURS}</p>
          <p className="mono-line">{JOIN_LINE}</p>
          {handoff ? <p className="handoff">{handoff}</p> : null}
          <PayPills />
          <p className="lede">
            Already paid? <a href="/login">Sign in</a>.
          </p>
        </section>
        <KitMark placement="join" />
      </div>
      <HonestyStrip />
    </>
  );
}
