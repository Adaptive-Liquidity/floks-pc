import { HonestyStrip } from "@/components/HonestyStrip";
import { Door } from "@/components/Door";
import { KitMark } from "@/components/KitMark";
import { PayPills } from "@/components/PayPills";
import { JOIN_HEADLINE, JOIN_SUB } from "@/lib/copy";

export const metadata = {
  title: "Join",
  description: "Pay for this seat. Same three plans. After Stripe, a magic link goes to the billing email.",
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
        <Door kicker="Named buy URL" title={JOIN_HEADLINE}>
          <p className="lede">{JOIN_SUB}</p>
          {handoff ? <p className="handoff">{handoff}</p> : null}
          <PayPills />
        </Door>
        <KitMark placement="join" />
      </div>
      <HonestyStrip />
    </>
  );
}
