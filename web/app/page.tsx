import { HonestyStrip } from "@/components/HonestyStrip";
import { Door } from "@/components/Door";
import { KitMark } from "@/components/KitMark";
import { PayPills } from "@/components/PayPills";
import { HOME_HEADLINE, HOME_KICKER, HOME_LINE, HOME_SUB, HOME_TOOLS } from "@/lib/copy";

export default function HomePage() {
  return (
    <>
      <div style={{ position: "relative" }}>
        <Door kicker={HOME_KICKER} title={HOME_HEADLINE}>
          <p className="lede">{HOME_SUB}</p>
          <p className="lede">{HOME_LINE}</p>
          <PayPills />
          <p className="lede">{HOME_TOOLS}</p>
        </Door>
        <KitMark placement="home" />
      </div>
      <HonestyStrip />
    </>
  );
}
