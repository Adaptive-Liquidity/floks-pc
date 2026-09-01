import { HonestyStrip } from "@/components/HonestyStrip";
import { Door } from "@/components/Door";
import { KitMark } from "@/components/KitMark";
import { PayPills } from "@/components/PayPills";
import {
  HOME_HEADLINE,
  HOME_KICKER,
  HOME_LINE,
  HOME_SUB,
  HOME_TOOLS,
  JOIN_LINE,
} from "@/lib/copy";

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
        <Door kicker={HOME_KICKER} title={HOME_HEADLINE}>
          <p className="lede">{HOME_SUB}</p>
          <p className="lede">{HOME_LINE}</p>
          <p className="lede">{JOIN_LINE}</p>
          {handoff ? <p className="handoff">{handoff}</p> : null}
          <PayPills />
          <p className="lede">{HOME_TOOLS}</p>
        </Door>
        <KitMark placement="join" />
      </div>
      <HonestyStrip />
    </>
  );
}
